import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { ESTIMATE_QUESTIONS_BY_THEME, PREFERENCE_CARDS_BY_THEME, type CuratedTheme } from "../data/curated";
import { ESTIMATE_QUESTIONS_BY_THEME_JA, PREFERENCE_CARDS_BY_THEME_JA } from "../data/curated-ja";
import { makeRoomCode, normalizeRoomSettings, replaceEstimateQuestion } from "./game-contract";
import { ensureIdentitySchema, getCurrentUser, hasPremiumAccess, type CurrentUser } from "../app/server-auth";
import { assertMultiplayerHost, assertRoomCapacity, assertMultiplayerStart, mutateWithRetry } from "./multiplayer-service";
import { createMultiplayerState, reduceMultiplayer, publicMultiplayer, type MultiplayerCard } from "./multiplayer";
import { multiplayerPrompts } from "../data/multiplayer-prompts";
import { archiveFinishedMatch } from "../app/match-history";
import { handleDaily } from "./daily-card";
import { normalizeDrinkMode } from "../app/date-mode.js";
import { deckRequiresPremium } from "../app/deck-access.js";

type CardType = "honto" | "question" | "wouldrather" | "preference" | "estimate" | "rps" | "both";
type Locale = "en" | "ja" | "pt-BR";
type RpsChoice = "rock" | "paper" | "scissors";
type Body = {
  action?: string; drinkMode?: string; code?: string; name?: string; token?: string; roundCount?: number;
  themeCategory?: string; customTheme?: string | null; prompt?: string; statements?: string[];
  truthIndex?: number; guessedIndex?: number; question?: string; sips?: number;
  choice?: "answer" | "skip"; preferenceIndex?: number; correctNumber?: number; estimate?: number; rpsChoice?: RpsChoice; locale?: Locale; wager?: string; wouldRatherIndex?: number; cardTypes?: string;
  multiplayer?: boolean; groupAction?: any; playerId?: string; requestId?: string;
};

const WORDS = ["MOON", "MINT", "WAVE", "SAKE", "NEON", "MISO", "YUZU", "NORI", "KITSU", "MOMO", "SORA", "KUMA", "HOSHI", "RAMEN", "UMAMI"];
const CARD_TYPES: CardType[] = ["honto", "question", "wouldrather", "preference", "estimate", "rps", "both"];
const ROOM_IDLE_MS = 12 * 60 * 60 * 1000;
const PLAYER_ONLINE_MS = 15_000;

const databaseUrl = process.env.DATABASE_URL;
const sql = databaseUrl
  ? neon(databaseUrl)
  : (() => { throw new Error("DATABASE_URL is not configured."); }) as unknown as NeonQueryFunction<false, false>;
let schemaReady: Promise<void> | null = null;

function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
    await sql`CREATE TABLE IF NOT EXISTS rooms (id text PRIMARY KEY, code text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'lobby', round_count integer NOT NULL DEFAULT 12, current_round integer NOT NULL DEFAULT 1, theme_category text NOT NULL DEFAULT 'safe', custom_theme text, welcome_ack text[] NOT NULL DEFAULT '{}', locale text NOT NULL DEFAULT 'en', started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS theme_category text NOT NULL DEFAULT 'safe'`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS custom_theme text`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS welcome_ack text[] NOT NULL DEFAULT '{}'`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en'`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS card_types text NOT NULL DEFAULT 'honto,question,wouldrather,preference,estimate,rps,both'`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS multiplayer boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS group_state jsonb`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS drink_mode text NOT NULL DEFAULT 'sips'`;
    await sql`CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, name text NOT NULL, token text UNIQUE NOT NULL, is_host boolean NOT NULL DEFAULT false, sips integer NOT NULL DEFAULT 0, joined_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS wager text`;
    await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id text`;
    await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en'`;
    await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now()`;
    await sql`CREATE TABLE IF NOT EXISTS room_action_receipts (room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, player_id text NOT NULL, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, player_id, request_id))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_room_action_receipts_created ON room_action_receipts(created_at)`;
    await sql`CREATE TABLE IF NOT EXISTS deck_cards (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, card_number integer NOT NULL, type text NOT NULL, actor_id text NOT NULL REFERENCES players(id), target_id text NOT NULL REFERENCES players(id), status text NOT NULL DEFAULT 'hidden', payload text NOT NULL DEFAULT '{}', secret text NOT NULL DEFAULT '{}', result text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE(room_id, card_number))`;
    await sql`ALTER TABLE deck_cards ADD COLUMN IF NOT EXISTS revealed_by text[] NOT NULL DEFAULT '{}'`;
    await sql`CREATE INDEX IF NOT EXISTS idx_deck_cards_room_status ON deck_cards(room_id, status, card_number)`;
  })();
  return schemaReady;
}

const id = () => crypto.randomUUID();
const code = () => makeRoomCode(WORDS);
const spinSips = () => 1 + Math.floor(Math.random() * 3);
const spinHighSips = () => 2 + Math.floor(Math.random() * 3);
const cleanName = (value?: string) => value?.trim().replace(/\s+/g, " ").slice(0, 24) ?? "";
const LEGACY_THEME_MAP: Record<string, string> = { general: "general", relationships: "relationships", mixed: "general", family: "general", innocent: "general", life: "life", flirty: "relationships", videoCall: "videoCall", reunion: "reunion", acrossMiles: "acrossMiles", futureUs: "futureUs", deepTalk: "deepTalk", playful: "playful", spicy: "spicy", spicyLdr: "spicyLdr", wild: "general" };
const CURATED_THEME_SET = new Set<CuratedTheme>(["general", "life", "relationships", "spicy"]);
const normalizedThemes = (value?: string | null): CuratedTheme[] => {
  const themes = String(value ?? "").split(",").map((item) => LEGACY_THEME_MAP[item.trim()]).filter((item): item is CuratedTheme => CURATED_THEME_SET.has(item as CuratedTheme));
  return [...new Set(themes)].length ? [...new Set(themes)] : ["general", "life"];
};
const json = (res: any, body: unknown, status = 200) => { res.setHeader?.("Cache-Control", "no-store, max-age=0"); return res.status(status).json(body); };
const parse = (value: unknown) => { try { return JSON.parse(typeof value === "string" ? value : "{}"); } catch { return {}; } };
const shuffle = <T,>(items: T[]) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
};

function normalizedCardTypes(value?: string | null): CardType[] {
  const selected = String(value ?? "").split(",").filter((item): item is CardType => CARD_TYPES.includes(item as CardType));
  return [...new Set(selected)].length >= 3 ? [...new Set(selected)] : CARD_TYPES;
}

function makeDeckTypes(count: number, available: CardType[] = CARD_TYPES) {
  const result: CardType[] = [];
  while (result.length < count) result.push(...shuffle(available));
  return result.slice(0, count);
}

function estimateOptions(correct: number) {
  const magnitude = Math.max(1, Math.abs(correct));
  const step = magnitude >= 1000 ? Math.max(100, Math.round(magnitude / 1000) * 100) : magnitude >= 100 ? 10 : magnitude >= 20 ? 5 : 1;
  const candidates = new Set<number>([correct]);
  for (const offset of shuffle([-4, -3, -2, -1, 1, 2, 3, 4])) {
    if (candidates.size >= 5) break;
    const option = correct + offset * step;
    if (option >= 0) candidates.add(option);
  }
  for (let value = step; candidates.size < 5; value += step) candidates.add(correct + value);
  return shuffle([...candidates].slice(0, 5));
}

async function buildDeck(roomId: string, roundCount: number, players: any[], themeCategory?: string | null, locale: Locale = "en", cardTypes?: string | null) {
  const cards = [];
  const types = makeDeckTypes(roundCount, normalizedCardTypes(cardTypes));
  const themes = normalizedThemes(themeCategory);
  const questions = shuffle(themes.flatMap((theme) => ESTIMATE_QUESTIONS_BY_THEME[theme].map((en, i) => ({ en, ja: ESTIMATE_QUESTIONS_BY_THEME_JA[theme][i] }))));
  const preferences = shuffle(themes.flatMap((theme) => PREFERENCE_CARDS_BY_THEME[theme].map((en, i) => ({ en, ja: PREFERENCE_CARDS_BY_THEME_JA[theme][i] }))));
  for (let index = 0; index < roundCount; index += 1) {
    const actor = players[index % 2];
    const target = players[(index + 1) % 2];
    const type = types[index];
    const question = questions[index % questions.length];
    const preference = preferences[index % preferences.length];
    // Base copy is English; each viewer gets their own language via publicCard.
    void locale;
    const localizedDeckLocale = "en";
    const payload = type === "estimate" ? { question: question[localizedDeckLocale], localized: { en: { question: question.en }, ja: { question: question.ja } }, wrongGuesses: [] } : type === "preference" ? { ...preference[localizedDeckLocale], localized: { en: preference.en, ja: preference.ja } } : {};
    cards.push({ id: id(), room_id: roomId, card_number: index + 1, type, actor_id: actor.id, target_id: target.id, payload: JSON.stringify(payload) });
  }
  return cards;
}

function publicCard(row: any, meId: string, completed = false, locale: Locale = "en") {
  if (!row) return null;
  const payload = parse(row.payload);
  // Cards are shown in the viewer's language. Only en/ja decks exist, so every other locale (pt-BR included) uses English.
  const deckLocale = locale === "ja" ? "ja" : "en";
  const localizedCopy = payload.localized?.[deckLocale] ?? payload.localized?.en;
  if (localizedCopy) Object.assign(payload, localizedCopy);
  delete payload.localized;
  const card: any = {
    id: row.id, cardNumber: row.cardNumber, type: row.type, status: row.status, completedAt: row.completedAt ?? null,
    actorId: row.actorId, actorName: row.actorName, targetId: row.targetId, targetName: row.targetName,
    payload, result: parse(row.result), revealedBy: Array.isArray(row.revealedBy) ? row.revealedBy : [],
  };
  if (row.status === "hidden") return { ...card, type: "hidden", payload: {}, result: {} };
  if (row.type === "rps" && row.status !== "complete") {
    const secret = parse(row.secret);
    card.payload = { ...payload, hasChosen: Boolean(row.actorId === meId ? secret.actorChoice : secret.targetChoice) };
  }
  if (completed) card.secret = parse(row.secret);
  if (row.type === "estimate" && row.status === "ready" && row.actorId !== meId) card.payload = { question: payload.question };
  return card;
}

async function state(roomCode: string, token: string, currentUser: CurrentUser | null = null) {
  const rooms = await sql`SELECT * FROM rooms WHERE code = ${roomCode}`;
  const room: any = rooms[0];
  if (!room) return null;
  if (!["finished", "abandoned"].includes(room.status) && room.updated_at && Date.now() - new Date(room.updated_at).getTime() > ROOM_IDLE_MS) {
    const expired = await sql`UPDATE rooms SET status = ${room.multiplayer ? "abandoned" : "finished"}, revision = revision + 1, updated_at = now() WHERE id = ${room.id} AND revision = ${room.revision} RETURNING status`;
    if (expired.length) room.status = expired[0].status;
  }
  const meRows = await sql`UPDATE players SET last_seen_at = now() WHERE room_id = ${room.id} AND token = ${token} RETURNING id`;
  const me: any = meRows[0];
  if (!me) throw new Error("Your session is not valid for this room.");
  if (currentUser?.id) await sql`UPDATE players SET user_id = ${currentUser.id} WHERE id = ${me.id} AND room_id = ${room.id} AND user_id IS NULL`;
  const playerRows = await sql`SELECT p.id, p.name, p.is_host AS "isHost", p.sips, p.joined_at AS "joinedAt", p.last_seen_at AS "lastSeenAt", p.wager, p.user_id AS "userId", p.locale, u.display_name AS "accountName" FROM players p LEFT JOIN users u ON u.id = p.user_id WHERE p.room_id = ${room.id} ORDER BY p.joined_at ASC`;
  const savedLocale = playerRows.find((player: any) => player.id === me.id)?.locale;
  const myLocale: Locale = savedLocale === "ja" || savedLocale === "pt-BR" ? savedLocale : "en";
  const group = room.multiplayer && room.group_state ? publicMultiplayer(room.group_state, me.id, myLocale === "ja" ? "ja" : "en") : null;
  if (group && room.status === "abandoned") Object.assign(group, { finished: true, phase: "finished", winners: [], losers: [], winningWager: null, endReason: group.endReason ?? "table_closed" });
  const players = playerRows.map(({ wager, userId, accountName, locale: _playerLocale, ...player }: any) => ({ ...player, sips: group?.scores[player.id] ?? player.sips, connected: Date.now() - new Date(player.lastSeenAt).getTime() <= PLAYER_ONLINE_MS, accountConnected: Boolean(userId), accountName: player.id === me.id ? accountName ?? null : undefined, connectedProvider: player.id === me.id && userId ? "Google" : undefined, hasWager: Boolean(wager), ...(room.status === "finished" ? { wager: wager ?? null } : {}) }));
  const cardRows = room.status === "playing" ? await sql`SELECT c.id, c.card_number AS "cardNumber", c.type, c.status, c.actor_id AS "actorId", a.name AS "actorName", c.target_id AS "targetId", t.name AS "targetName", c.payload, c.secret, c.result, c.revealed_by AS "revealedBy", c.completed_at AS "completedAt" FROM deck_cards c JOIN players a ON a.id = c.actor_id JOIN players t ON t.id = c.target_id WHERE c.room_id = ${room.id} AND c.card_number = ${room.current_round} LIMIT 1` : [];
  const lastRows = await sql`SELECT c.id, c.card_number AS "cardNumber", c.type, c.status, c.actor_id AS "actorId", a.name AS "actorName", c.target_id AS "targetId", t.name AS "targetName", c.payload, c.secret, c.result, c.revealed_by AS "revealedBy", c.completed_at AS "completedAt" FROM deck_cards c JOIN players a ON a.id = c.actor_id JOIN players t ON t.id = c.target_id WHERE c.room_id = ${room.id} AND c.status = 'complete' ORDER BY c.card_number DESC LIMIT 1`;
  return {
    room: { code: room.code, status: room.status, roundCount: room.round_count, currentRound: room.current_round, themeCategory: room.theme_category, customTheme: room.custom_theme, cardTypes: room.multiplayer ? groupCardTypes(room.card_types).join(",") : normalizedCardTypes(room.card_types).join(","), welcomeAck: Array.isArray(room.welcome_ack) ? room.welcome_ack : [], locale: myLocale, startedAt: room.started_at, drinkMode: normalizeDrinkMode(room.drink_mode), canUseSpicy: hasPremiumAccess(currentUser), canCustomizeDeck: hasPremiumAccess(currentUser), multiplayer: Boolean(room.multiplayer), maxPlayers: room.multiplayer ? 6 : 2, canHostMultiplayer: Boolean(hasPremiumAccess(currentUser) && playerRows.some((p: any) => p.id === me.id && p.isHost && p.userId === currentUser?.id)) },
    players, group, activeCard: room.multiplayer ? null : publicCard(cardRows[0], me.id, false, myLocale), lastCard: room.multiplayer ? null : publicCard(lastRows[0], me.id, true, myLocale), meId: me.id,
  };
}

async function getContext(roomCode: string, token: string) {
  const rooms = await sql`SELECT * FROM rooms WHERE code = ${roomCode}`;
  const room: any = rooms[0];
  if (!room) throw new Error("Room not found.");
  const meRows = await sql`SELECT * FROM players WHERE room_id = ${room.id} AND token = ${token}`;
  const me: any = meRows[0];
  if (!me) throw new Error("Invalid session.");
  const cards = await sql`SELECT * FROM deck_cards WHERE room_id = ${room.id} AND card_number = ${room.current_round} LIMIT 1`;
  return { room, me, card: cards[0] as any };
}

async function finishCard(room: any) {
  const next = Number(room.current_round) + 1;
  const finished = next > Number(room.round_count);
  await sql`UPDATE rooms SET current_round = ${finished ? room.current_round : next}, status = ${finished ? "finished" : "playing"}, updated_at = now() WHERE id = ${room.id}`;
  if (finished) await archiveFinishedMatch(room.id);
}

const GROUP_TYPES = ["honto", "wouldrather", "preference", "estimate", "who", "challenge", "both"] as const;
function groupCardTypes(value?: string | null) {
  const selected = [...new Set(String(value ?? "").split(",").filter((type): type is typeof GROUP_TYPES[number] => GROUP_TYPES.includes(type as typeof GROUP_TYPES[number])))];
  return selected.length >= 3 ? selected : [...GROUP_TYPES];
}

function groupDeck(room: any): MultiplayerCard[] {
  const themes = normalizedThemes(room.theme_category);
  const preferences = shuffle(themes.flatMap(t => PREFERENCE_CARDS_BY_THEME[t].map((en, i) => ({ en, ja: PREFERENCE_CARDS_BY_THEME_JA[t][i] }))));
  const estimates = shuffle(themes.flatMap(t => ESTIMATE_QUESTIONS_BY_THEME[t].map((en, i) => ({ en, ja: ESTIMATE_QUESTIONS_BY_THEME_JA[t][i] }))));
  const promptsEn = multiplayerPrompts("en", themes); const promptsJa = multiplayerPrompts("ja", themes);
  const who = shuffle(promptsEn.who.map((en, i) => ({ en, ja: promptsJa.who[i] })));
  const surprise = promptsEn.surprise.map((en, i) => ({ en, ja: promptsJa.surprise[i] }));
  const cards: MultiplayerCard[] = [];
  let challenges = 0;
  const challengeTypes = shuffle<NonNullable<MultiplayerCard["challenge"]>>(["coin", "staring", "rps", "surprise"]);
  while (cards.length < Number(room.round_count)) {
    for (const type of shuffle(groupCardTypes(room.card_types))) {
      if (cards.length >= Number(room.round_count)) break;
      const index = cards.length;
      const card: MultiplayerCard = { id: id(), type };
      if (type === "preference") { const item = preferences[index % preferences.length]; Object.assign(card, { promptEn: item.en.question, optionsEn: item.en.options, promptJa: item.ja.question, optionsJa: item.ja.options }); }
      if (type === "estimate") { const item = estimates[index % estimates.length]; Object.assign(card, { promptEn: item.en, promptJa: item.ja }); }
      if (type === "who") { const item = who[index % who.length]; Object.assign(card, { promptEn: item.en, promptJa: item.ja }); }
      if (type === "challenge") {
        card.challenge = challengeTypes[challenges++ % 4];
        if (card.challenge === "surprise") { const item = surprise[Math.floor(Math.random() * surprise.length)]; Object.assign(card, { promptEn: item.en, promptJa: item.ja }); }
      }
      cards.push(card);
    }
  }
  return cards;
}

async function groupMutation(roomCode: string, token: string, body: Body, user: CurrentUser | null) {
  const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId) ? body.requestId : null;
  return mutateWithRetry(async () => {
    const context = await getContext(roomCode, token);
    const players = await sql`SELECT * FROM players WHERE room_id = ${context.room.id} ORDER BY joined_at ASC, id ASC`;
    const receipts = requestId ? await sql`SELECT 1 FROM room_action_receipts WHERE room_id = ${context.room.id} AND player_id = ${context.me.id} AND request_id = ${requestId} LIMIT 1` : [];
    return { ...context, players, replay: receipts.length > 0 };
  }, ({ room, me, players, replay }: any) => {
    if (replay) return { replay: true };
    const action = body.action;
    if (!room.multiplayer) throw new Error("This is not a multiplayer room.");
    let snapshot = room.group_state;
    let status = room.status;
    let removeId: string | null = null;
    let wager: string | null = null;
    let ackId: string | null = null;
    if (action === "leave" || action === "removePlayer") {
      if (action === "removePlayer" && !me.is_host) throw new Error("Only the host can remove a player.");
      removeId = action === "leave" ? me.id : String(body.playerId ?? "");
      if (!players.some((p: any) => p.id === removeId)) throw new Error("Player not found.");
      if (snapshot && status === "playing") {
        snapshot = reduceMultiplayer(snapshot, removeId!, { type: "leave" });
        if (snapshot.finished) status = players.length - 1 < 3 ? "abandoned" : "finished";
      }
      if (players.length === 1) status = "abandoned";
    } else if (action === "submitWager" || action === "ackWelcome") {
      if (status !== "playing" || players.every((p: any) => (room.welcome_ack ?? []).includes(p.id))) throw new Error("The welcome phase is complete.");
      if (action === "submitWager") {
        wager = String(body.wager ?? "").trim().replace(/\s+/g, " ").slice(0, 220);
        if (wager.length < 3) throw new Error("Write a wager first.");
        if ((room.welcome_ack ?? []).includes(me.id)) throw new Error("Your wager is already locked.");
      } else {
        if (players.some((p: any) => !p.wager)) throw new Error("Everyone needs to lock in their wagers first.");
        ackId = me.id;
      }
    } else if (action === "newTable") {
      if (!me.is_host || !["finished", "abandoned"].includes(status)) throw new Error("Only the host can restart a completed table.");
      assertMultiplayerHost(me, user?.id, hasPremiumAccess(user));
      snapshot = null; status = "lobby";
    } else if (action === "start") {
      if (status !== "lobby") throw new Error("The game has already started.");
      assertMultiplayerHost(me, user?.id, hasPremiumAccess(user));
      assertMultiplayerStart(players.length);
      console.info("[multiplayer] match started", { roomId: room.id, playerCount: players.length, userId: user?.id ?? null });
      snapshot = createMultiplayerState({ players: players.map((p: any) => ({ id: p.id, name: p.name })), cards: groupDeck(room) });
      status = "playing";
    } else if (action === "multiplayer") {
      if (status !== "playing" || !snapshot) throw new Error("The multiplayer game is not running.");
      if (players.some((p: any) => !(room.welcome_ack ?? []).includes(p.id))) throw new Error("Everyone needs to confirm the welcome first.");
      if (!body.groupAction || typeof body.groupAction !== "object" || body.groupAction.type === "leave") throw new Error("Invalid multiplayer action.");
      snapshot = reduceMultiplayer({ ...snapshot, wagers: Object.fromEntries(players.map((p: any) => [p.id, p.wager ?? ""])) }, me.id, body.groupAction);
      if (snapshot.finished) status = "finished";
    } else throw new Error("Invalid multiplayer action.");
    return { snapshot, status, removeId, wager, ackId, reset: action === "start" || action === "newTable", start: action === "start", replay: false };
  }, async ({ room, me }: any, next: any) => {
    if (next.replay) return true;
    // Claim the revision and apply every dependent mutation in one PostgreSQL statement.
    // Other joins/settings/actions also claim this revision, so a stale snapshot cannot win.
    const rows = await sql`WITH claimed AS (
      UPDATE rooms SET group_state = ${JSON.stringify(next.snapshot)}::jsonb,
        status = ${next.status}, revision = revision + 1, updated_at = now(),
        welcome_ack = CASE WHEN ${next.reset} THEN '{}'::text[] ELSE ARRAY(SELECT DISTINCT a FROM unnest(array_remove(welcome_ack, ${next.removeId}::text) || CASE WHEN ${next.ackId}::text IS NULL THEN '{}'::text[] ELSE ARRAY[${next.ackId}]::text[] END) a) END,
        current_round = ${next.snapshot ? Number(next.snapshot.currentIndex ?? 0) + 1 : 1},
        started_at = CASE WHEN ${next.start} THEN now() WHEN ${next.reset} THEN NULL ELSE started_at END
      WHERE id = ${room.id} AND revision = ${room.revision}
        AND (${requestId}::text IS NULL OR NOT EXISTS (SELECT 1 FROM room_action_receipts WHERE room_id = ${room.id} AND player_id = ${me.id} AND request_id = ${requestId}))
        AND EXISTS (SELECT 1 FROM players WHERE id = ${me.id} AND room_id = ${room.id}) RETURNING id
    ), receipt AS (
      INSERT INTO room_action_receipts (room_id, player_id, request_id)
      SELECT id, ${me.id}, ${requestId} FROM claimed WHERE ${requestId}::text IS NOT NULL
      ON CONFLICT DO NOTHING RETURNING room_id
    ), removed AS (
      DELETE FROM players WHERE room_id IN (SELECT id FROM claimed) AND id = ${next.removeId} RETURNING id
    ), reset_players AS (
      UPDATE players SET sips = 0, wager = NULL WHERE room_id IN (SELECT id FROM claimed) AND ${next.reset} RETURNING id
    ), transfer AS (
      UPDATE players SET is_host = (id = (SELECT id FROM players WHERE room_id = ${room.id} AND id IS DISTINCT FROM ${next.removeId} ORDER BY joined_at, id LIMIT 1))
      WHERE room_id IN (SELECT id FROM claimed) AND ${next.removeId}::text IS NOT NULL AND id IS DISTINCT FROM ${next.removeId} RETURNING id
    ), wager_update AS (
      UPDATE players SET wager = ${next.wager} WHERE room_id IN (SELECT id FROM claimed) AND id = ${me.id} AND ${next.wager}::text IS NOT NULL RETURNING id
    ) SELECT id FROM claimed`;
    return rows.length > 0;
  });
}

export default async function handler(req: any, res: any) {
  try {
    await ensureSchema();
    await ensureIdentitySchema();
    const currentUser = await getCurrentUser(new Request("https://honto.local", { headers: req.headers as HeadersInit }));
    const body = (req.body ?? {}) as Body;
    const query = req.query ?? {};
    if (req.method === "GET") {
      const result = await state(String(query.code ?? "").toUpperCase(), String(query.token ?? ""), currentUser);
      return result ? json(res, result) : json(res, { error: "Room not found." }, 404);
    }
    if (body.action === "create") {
      const name = cleanName(body.name);
      if (!name) return json(res, { error: "Enter your name." }, 400);
      let roomCode = code();
      for (let attempt = 0; attempt < 5 && (await sql`SELECT 1 FROM rooms WHERE code = ${roomCode}`).length; attempt += 1) roomCode = code();
      const roomId = id(); const token = id();
      const locale: Locale = body.locale === "ja" || body.locale === "pt-BR" ? body.locale : "en";
      await sql`INSERT INTO rooms (id, code, round_count, locale) VALUES (${roomId}, ${roomCode}, 12, ${locale})`;
      await sql`INSERT INTO players (id, room_id, name, token, is_host, user_id, locale) VALUES (${id()}, ${roomId}, ${name}, ${token}, true, ${currentUser?.id ?? null}, ${locale})`;
      return json(res, { code: roomCode, token }, 201);
    }
    const roomCode = String(body.code ?? "").trim().toUpperCase();
    if (body.action === "join") {
      const name = cleanName(body.name); if (!name) return json(res, { error: "Enter your name." }, 400);
      const token = id();
      const playerId = id();
      await mutateWithRetry(async () => {
        const rows = await sql`SELECT r.*, (SELECT COUNT(*)::int FROM players WHERE room_id = r.id) AS player_count FROM rooms r WHERE code = ${roomCode}`;
        return rows[0] as any;
      }, (room: any) => {
        if (!room) throw new Error("That room does not exist.");
        if (room.status !== "lobby") throw new Error("The game has already started.");
        assertRoomCapacity(room.multiplayer, Number(room.player_count));
        return room;
      }, async (room: any) => {
        const inserted = await sql`WITH claimed AS (
          UPDATE rooms SET revision = revision + 1, updated_at = now() WHERE id = ${room.id} AND revision = ${room.revision} AND status = 'lobby' RETURNING id
        ) INSERT INTO players (id, room_id, name, token, user_id, locale)
          SELECT ${playerId}, id, ${name}, ${token}, ${currentUser?.id ?? null}, ${body.locale === "ja" || body.locale === "pt-BR" ? body.locale : "en"} FROM claimed RETURNING id`;
        return inserted.length > 0;
      });
      return json(res, { code: roomCode, token }, 201);
    }

    const token = String(body.token ?? "");
    const { room, me, card } = await getContext(roomCode, token);
    if (typeof body.action === "string" && ["daily", "dailyAnswer", "dailyConfirmAdult"].includes(body.action)) {
      return json(res, await handleDaily(sql, room, me, body as Record<string, any>, currentUser));
    }
    if (body.action === "setLocale") {
      const locale: Locale = body.locale === "ja" || body.locale === "pt-BR" ? body.locale : "en";
      await sql`UPDATE players SET locale = ${locale} WHERE id = ${me.id} AND room_id = ${room.id}`;
      return json(res, await state(roomCode, token, currentUser));
    }
    if (room.multiplayer && ["leave", "removePlayer", "newTable", "start", "multiplayer", "submitWager", "ackWelcome"].includes(String(body.action))) {
      await groupMutation(roomCode, token, body, currentUser);
      if (body.action === "leave" || (body.action === "removePlayer" && body.playerId === me.id)) return json(res, { left: true });
      const nextState = await state(roomCode, token, currentUser);
      if (nextState?.room.status === "finished") await archiveFinishedMatch(room.id);
      return json(res, nextState);
    }
    if (body.action === "multiplayer" || body.action === "removePlayer") throw new Error("This action requires a multiplayer room.");
    if (body.action === "leave") {
      if (room.status === "lobby") {
        await mutateWithRetry(async () => getContext(roomCode, token), ({ room }: any) => {
          if (room.status !== "lobby" || room.multiplayer) throw new Error("The room changed. Please leave again.");
          return room;
        }, async ({ room, me }: any) => {
          const rows = await sql`WITH claimed AS (
            UPDATE rooms SET revision = revision + 1, updated_at = now(), status = CASE WHEN (SELECT count(*) FROM players WHERE room_id = ${room.id}) = 1 THEN 'abandoned' ELSE 'lobby' END
            WHERE id = ${room.id} AND revision = ${room.revision} AND status = 'lobby' RETURNING id
          ), removed AS (
            DELETE FROM players WHERE room_id IN (SELECT id FROM claimed) AND id = ${me.id} RETURNING id
          ), transfer AS (
            UPDATE players SET is_host = true WHERE room_id IN (SELECT id FROM claimed) AND id <> ${me.id} AND ${Boolean(me.is_host)} RETURNING id
          ) SELECT id FROM claimed`;
          return rows.length > 0;
        });
      } else if (room.status === "playing") {
        await sql`UPDATE rooms SET status = 'abandoned', updated_at = now() WHERE id = ${room.id} AND status = 'playing'`;
      }
      return json(res, { left: true });
    }
    const welcomeAck = Array.isArray(room.welcome_ack) ? room.welcome_ack : [];
    const memberRows = room.multiplayer ? await sql`SELECT id FROM players WHERE room_id = ${room.id}` : [];
    const welcomeComplete = room.multiplayer ? memberRows.every((p: any) => welcomeAck.includes(p.id)) : welcomeAck.length >= 2;
    if (room.status === "playing" && !welcomeComplete && !["submitWager", "ackWelcome"].includes(String(body.action))) throw new Error("Both players need to confirm the Honto welcome first.");
    if (body.action === "submitWager") {
      if (room.status !== "playing" || welcomeComplete) throw new Error("The wager phase is already complete.");
      const wager = String(body.wager ?? "").trim().replace(/\s+/g, " ").slice(0, 220);
      if (wager.length < 3) throw new Error("Write what the other player must do if you win.");
      await sql`UPDATE players SET wager = ${wager} WHERE id = ${me.id} AND room_id = ${room.id}`;
    }
    if (body.action === "ackWelcome") {
      if (room.status !== "playing") throw new Error("The game has not started yet.");
      const wagers = await sql`SELECT COUNT(*)::int AS total FROM players WHERE room_id = ${room.id} AND wager IS NOT NULL AND wager <> ''`;
      if (Number(wagers[0]?.total ?? 0) !== (room.multiplayer ? memberRows.length : 2)) throw new Error("Everyone needs to lock in their wagers first.");
      await sql`UPDATE rooms SET welcome_ack = ARRAY(SELECT DISTINCT player_id FROM unnest(COALESCE(welcome_ack, ARRAY[]::text[]) || ARRAY[${me.id}]::text[]) AS player_id), updated_at = now() WHERE id = ${room.id}`;
    }
    if (body.action === "startWheel") {
      const completedRows = await sql`SELECT * FROM deck_cards WHERE room_id = ${room.id} AND status = 'complete' ORDER BY card_number DESC LIMIT 1`;
      const completed = completedRows[0] as any;
      if (!completed) throw new Error("There is no completed wheel to spin.");
      const result = parse(completed.result);
      if (!["honto", "preference", "rps", "both", "wouldrather"].includes(completed.type) && !(completed.type === "estimate" && result.firstTry) && !result.skipped) throw new Error("This card does not use the sip wheel.");
      const spinById = result.spinById ?? (completed.type === "both" ? completed.actor_id : result.drinkerId);
      if (spinById !== me.id) throw new Error("The other player is responsible for spinning this wheel.");
      if (!result.wheelStartedAt) await sql`UPDATE deck_cards SET result = ${JSON.stringify({ ...result, spinById, wheelStartedAt: new Date().toISOString() })} WHERE id = ${completed.id} AND status = 'complete'`;
    }
    if (body.action === "newTable") {
      if (!me.is_host) throw new Error("Only the host can restart the table.");
      if (room.status !== "finished") throw new Error("The current game is still in progress.");
      const reset = await sql`WITH claimed AS (
        UPDATE rooms SET status = 'lobby', current_round = 1, welcome_ack = '{}', started_at = NULL, revision = revision + 1, updated_at = now()
        WHERE id = ${room.id} AND revision = ${room.revision} AND status = 'finished' AND multiplayer = false RETURNING id
      ), cards AS (DELETE FROM deck_cards WHERE room_id IN (SELECT id FROM claimed) RETURNING id),
      scores AS (UPDATE players SET sips = 0, wager = NULL WHERE room_id IN (SELECT id FROM claimed) RETURNING id)
      SELECT id FROM claimed`;
      if (!reset.length) throw new Error("The room changed. Please try again.");
    }
    if (body.action === "configure") {
      await mutateWithRetry(async () => getContext(roomCode, token), async ({ room, me }: any) => {
        if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can change the room settings.");
        if (body.multiplayer !== undefined && typeof body.multiplayer !== "boolean") throw new Error("Invalid multiplayer mode.");
        const multiplayer = body.multiplayer ?? Boolean(room.multiplayer);
        if (multiplayer && body.multiplayer === true) assertMultiplayerHost(me, currentUser?.id, hasPremiumAccess(currentUser));
        if (!multiplayer) {
          const members = await sql`SELECT id FROM players WHERE room_id = ${room.id}`;
          if (members.length > 2) throw new Error("Remove extra players before switching to two-player mode.");
        }
        const settings = normalizeRoomSettings(room, body, LEGACY_THEME_MAP);
        if (deckRequiresPremium(settings.themeCategory) && !hasPremiumAccess(currentUser)) throw new Error("Spicy is a Premium theme.");
        const switched = multiplayer !== Boolean(room.multiplayer);
        const available = multiplayer ? [...GROUP_TYPES] : CARD_TYPES;
        const rawTypes = body.cardTypes ?? (switched ? available.join(",") : room.card_types);
        const cardTypes = (multiplayer ? groupCardTypes(rawTypes) : normalizedCardTypes(rawTypes)).join(",");
        if (body.cardTypes !== undefined && cardTypes !== available.join(",") && !hasPremiumAccess(currentUser)) throw new Error("Custom decks are a Premium feature.");
        const drinkMode = normalizeDrinkMode(body.drinkMode, room.drink_mode);
        return { ...settings, multiplayer, cardTypes, drinkMode };
      }, async ({ room }: any, settings: any) => {
        const rows = await sql`UPDATE rooms SET round_count = ${settings.roundCount}, theme_category = ${settings.themeCategory}, custom_theme = ${settings.customTheme}, locale = ${settings.locale}, card_types = ${settings.cardTypes}, drink_mode = ${settings.drinkMode}, multiplayer = ${settings.multiplayer}, group_state = NULL, revision = revision + 1, updated_at = now() WHERE id = ${room.id} AND revision = ${room.revision} AND status = 'lobby' RETURNING id`;
        return rows.length > 0;
      });
    }
    if (room.multiplayer && !["configure", "submitWager", "ackWelcome"].includes(String(body.action))) throw new Error("Use the multiplayer action for this room.");
    if (body.action === "start") {
      await mutateWithRetry(async () => getContext(roomCode, token), async ({ room, me }: any) => {
        if (!me.is_host || room.status !== "lobby" || room.multiplayer) throw new Error("Only the host can start this two-player game.");
        const players = await sql`SELECT id FROM players WHERE room_id = ${room.id} ORDER BY is_host DESC, joined_at ASC, id ASC`;
        if (players.length !== 2) throw new Error("Honto needs exactly two players.");
        return buildDeck(room.id, Number(room.round_count), players, room.theme_category, room.locale === "ja" || room.locale === "pt-BR" ? room.locale : "en", room.card_types);
      }, async ({ room }: any, cards: any) => {
        const rows = await sql`WITH claimed AS (
          UPDATE rooms SET status = 'playing', revision = revision + 1, current_round = 1, welcome_ack = '{}', started_at = now(), updated_at = now()
          WHERE id = ${room.id} AND revision = ${room.revision} AND status = 'lobby' AND multiplayer = false RETURNING id
        ), deleted AS (
          DELETE FROM deck_cards WHERE room_id IN (SELECT id FROM claimed) RETURNING id
        ), reset_players AS (
          UPDATE players SET sips = 0, wager = NULL WHERE room_id IN (SELECT id FROM claimed) RETURNING id
        ), inserted AS (
          INSERT INTO deck_cards (id, room_id, card_number, type, actor_id, target_id, status, payload)
          SELECT c.id, c.room_id, c.card_number, c.type, c.actor_id, c.target_id, 'hidden', c.payload
          FROM jsonb_to_recordset(${JSON.stringify(cards)}::jsonb) AS c(id text, room_id text, card_number integer, type text, actor_id text, target_id text, payload text)
          JOIN claimed ON claimed.id = c.room_id CROSS JOIN (SELECT count(*) FROM deleted) d RETURNING id
        ) SELECT id FROM claimed`;
        return rows.length > 0;
      });
    }
    if (body.action === "drawCard") {
      if (!card || card.status !== "hidden" || card.actor_id !== me.id) throw new Error("It is not your turn to draw.");
      await sql`UPDATE deck_cards SET status = 'ready' WHERE id = ${card.id} AND status = 'hidden'`;
    }
    if (body.action === "ackReveal") {
      if (!card || card.status !== "ready" || card.actor_id !== me.id) throw new Error("Only the player who drew the card can reveal it.");
      await sql`UPDATE deck_cards SET revealed_by = ARRAY(SELECT DISTINCT player_id FROM unnest(COALESCE(revealed_by, ARRAY[]::text[]) || ARRAY[${me.id}]::text[]) AS player_id) WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "skipCard") {
      if (!card || !["ready", "guess", "choose"].includes(card.status) || card.actor_id !== me.id) throw new Error("Only the player who drew this card can skip it.");
      const sips = spinHighSips();
      const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify({ skipped: true, skipById: me.id, drinkerId: me.id, spinById: me.id, sips })}, completed_at = now() WHERE id = ${card.id} AND status IN ('ready', 'guess', 'choose') RETURNING id`;
      if (updated[0]) { await sql`UPDATE players SET sips = sips + ${sips} WHERE id = ${me.id}`; await finishCard(room); }
    }
    if (body.action === "submitHonto") {
      if (!card || card.type !== "honto" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("This card is not ready for your stories.");
      const statements = body.statements?.map((item) => item.trim().slice(0, 180)) ?? [];
      if (statements.length !== 3 || statements.some((item) => !item)) throw new Error("Fill in all three stories.");
      if (![0, 1, 2].includes(body.truthIndex ?? -1)) throw new Error("Mark which story is true.");
      await sql`UPDATE deck_cards SET status = 'guess', payload = ${JSON.stringify({ prompt: (body.prompt ?? "Anything goes").trim().slice(0, 140), statements })}, secret = ${JSON.stringify({ truthIndex: body.truthIndex })} WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "guessHonto") {
      if (!card || card.type !== "honto" || card.status !== "guess" || card.target_id !== me.id) throw new Error("This card is not ready for your guess.");
      if (![0, 1, 2].includes(body.guessedIndex ?? -1)) throw new Error("Choose one story.");
      const truthIndex = Number(parse(card.secret).truthIndex); const correct = Number(body.guessedIndex) === truthIndex;
      const drinkerId = correct ? card.actor_id : card.target_id; const sips = spinSips();
      const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify({ correct, guessedIndex: body.guessedIndex, drinkerId, spinById: drinkerId, sips })}, completed_at = now() WHERE id = ${card.id} AND status = 'guess' RETURNING id`;
      if (updated[0]) { await sql`UPDATE players SET sips = sips + ${sips} WHERE id = ${drinkerId}`; await finishCard(room); }
    }
    if (body.action === "submitQuestion") {
      if (!card || card.type !== "question" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("This card is not ready for a question.");
      const question = String(body.question ?? "").trim().slice(0, 220); const sips = Number(body.sips);
      if (question.length < 3) throw new Error("Write or choose a question first.");
      if (!Number.isInteger(sips) || sips < 1 || sips > 3) throw new Error("Choose between 1 and 3 sips.");
      await sql`UPDATE deck_cards SET status = 'choose', payload = ${JSON.stringify({ question, sips })} WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "answerQuestion") {
      if (!card || card.type !== "question" || card.status !== "choose" || card.target_id !== me.id) throw new Error("This question is not yours to answer.");
      if (body.choice !== "answer" && body.choice !== "skip") throw new Error("Choose whether to answer or take the sips.");
      const sips = Math.max(1, Math.min(3, Number(parse(card.payload).sips) || 1));
      const drinkerId = body.choice === "answer" ? card.actor_id : card.target_id;
      const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify({ choice: body.choice, drinkerId, sips })}, completed_at = now() WHERE id = ${card.id} AND status = 'choose' RETURNING id`;
      if (updated[0]) { await sql`UPDATE players SET sips = sips + ${sips} WHERE id = ${drinkerId}`; await finishCard(room); }
    }
    if (body.action === "submitWouldRather") {
      if (!card || card.type !== "wouldrather" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("This Would You Rather card is not ready.");
      const options = body.statements?.map((item) => String(item).trim().replace(/\s+/g, " ").slice(0, 140)) ?? [];
      if (options.length !== 2 || options.some((option) => option.length < 2)) throw new Error("Write both Would You Rather options.");
      await sql`UPDATE deck_cards SET status = 'choose', payload = ${JSON.stringify({ options })} WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "answerWouldRather") {
      if (!card || card.type !== "wouldrather" || card.status !== "choose" || card.target_id !== me.id) throw new Error("This Would You Rather choice is not yours.");
      const wouldRatherIndex = Number(body.wouldRatherIndex);
      if (![0, 1, 2].includes(wouldRatherIndex)) throw new Error("Choose one option or skip.");
      const skipped = wouldRatherIndex === 2;
      const drinkerId = skipped ? card.target_id : card.actor_id;
      const sips = skipped ? spinHighSips() : spinSips();
      const result = { wouldRatherIndex, skipped, skipById: skipped ? card.target_id : null, drinkerId, spinById: drinkerId, sips };
      const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify(result)}, completed_at = now() WHERE id = ${card.id} AND status = 'choose' RETURNING id`;
      if (updated[0]) await sql`UPDATE players SET sips = sips + ${sips} WHERE id = ${drinkerId}`;
      if (updated[0]) await finishCard(room);
    }
    if (body.action === "nextPreference") {
      if (!card || card.type !== "preference" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("Only the player choosing can move to the next question.");
      const payload = parse(card.payload); const themes = normalizedThemes(room.theme_category); const pool = shuffle(themes.flatMap((theme) => PREFERENCE_CARDS_BY_THEME[theme].map((en, i) => ({ en, ja: PREFERENCE_CARDS_BY_THEME_JA[theme][i] }))));
      const currentQuestion = typeof payload.question === "string" ? payload.question : ""; const next = pool.find((item) => item.en.question !== currentQuestion && item.ja?.question !== currentQuestion) ?? pool[0];
      const nextCard = next ? { ...next.en, localized: { en: next.en, ja: next.ja ?? next.en } } : null;
      if (nextCard) await sql`UPDATE deck_cards SET payload = ${JSON.stringify(nextCard)}, secret = '{}' WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "choosePreference") {
      if (!card || card.type !== "preference" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("This choice is not yours to make.");
      const options = parse(card.payload).options;
      const preferenceIndex = Number(body.preferenceIndex);
      if (!Array.isArray(options) || ![0, 1, 2].includes(preferenceIndex)) throw new Error("Choose one of the three options.");
      await sql`UPDATE deck_cards SET status = 'guess', secret = ${JSON.stringify({ preferenceIndex })} WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "guessPreference") {
      if (!card || card.type !== "preference" || card.status !== "guess" || card.target_id !== me.id) throw new Error("This choice is not yours to guess.");
      const guessedIndex = Number(body.preferenceIndex);
      if (![0, 1, 2].includes(guessedIndex)) throw new Error("Choose one of the three options.");
      const preferenceIndex = Number(parse(card.secret).preferenceIndex);
      const correct = guessedIndex === preferenceIndex;
      const drinkerId = correct ? card.actor_id : card.target_id; const sips = spinSips();
      const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify({ correct, guessedIndex, drinkerId, spinById: drinkerId, sips })}, completed_at = now() WHERE id = ${card.id} AND status = 'guess' RETURNING id`;
      if (updated[0]) { await sql`UPDATE players SET sips = sips + ${sips} WHERE id = ${drinkerId}`; await finishCard(room); }
    }
    if (body.action === "chooseRps") {
      if (!card || card.type !== "rps" || card.status !== "ready") throw new Error("This Joken-pô card is not ready.");
      if (card.actor_id !== me.id && card.target_id !== me.id) throw new Error("You are not playing this card.");
      const rpsChoice = body.rpsChoice;
      if (!rpsChoice || !["rock", "paper", "scissors"].includes(rpsChoice)) throw new Error("Choose rock, paper, or scissors.");
      const key = card.actor_id === me.id ? "actorChoice" : "targetChoice";
      const chosen = key === "actorChoice"
        ? await sql`UPDATE deck_cards SET secret = jsonb_set(secret::jsonb, '{actorChoice}', to_jsonb(${rpsChoice}::text))::text WHERE id = ${card.id} AND status = 'ready' AND NOT (secret::jsonb ? 'actorChoice') RETURNING secret`
        : await sql`UPDATE deck_cards SET secret = jsonb_set(secret::jsonb, '{targetChoice}', to_jsonb(${rpsChoice}::text))::text WHERE id = ${card.id} AND status = 'ready' AND NOT (secret::jsonb ? 'targetChoice') RETURNING secret`;
      if (!chosen[0]) throw new Error("Your choice is already locked.");
      const secret = parse(chosen[0].secret) as { actorChoice?: RpsChoice; targetChoice?: RpsChoice };
      if (!secret.actorChoice || !secret.targetChoice) {
        // The other player has not locked a move yet.
      } else if (secret.actorChoice === secret.targetChoice) {
        const payload = parse(card.payload);
        await sql`UPDATE deck_cards SET secret = '{}', payload = ${JSON.stringify({ ...payload, tieCount: Number(payload.tieCount ?? 0) + 1 })} WHERE id = ${card.id} AND status = 'ready'`;
      } else {
        const actorWins = (secret.actorChoice === "rock" && secret.targetChoice === "scissors") || (secret.actorChoice === "paper" && secret.targetChoice === "rock") || (secret.actorChoice === "scissors" && secret.targetChoice === "paper");
        const drinkerId = actorWins ? card.target_id : card.actor_id;
        const sips = spinSips();
        const result = { actorChoice: secret.actorChoice, targetChoice: secret.targetChoice, drinkerId, spinById: drinkerId, sips };
        const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify(result)}, completed_at = now() WHERE id = ${card.id} AND status = 'ready' RETURNING id`;
        if (updated[0]) { await sql`UPDATE players SET sips = sips + ${sips} WHERE id = ${drinkerId}`; await finishCard(room); }
      }
    }
    if (body.action === "spinBoth") {
      if (!card || card.type !== "both" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("It is not your turn to spin.");
      const sips = spinSips();
      const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify({ bothDrink: true, spinById: card.actor_id, sips })}, completed_at = now() WHERE id = ${card.id} AND status = 'ready' RETURNING id`;
      if (updated[0]) { await sql`UPDATE players SET sips = sips + ${sips} WHERE room_id = ${room.id}`; await finishCard(room); }
    }
    if (body.action === "submitEstimate") {
      if (!card || card.type !== "estimate" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("This estimate card is not ready for your answer.");
      const correctNumber = Number(body.correctNumber);
      const question = String(body.question ?? parse(card.payload).question ?? "").trim().replace(/\s+/g, " ").slice(0, 220);
      if (!Number.isInteger(correctNumber) || correctNumber < 0 || correctNumber > 1000000) throw new Error("Enter a whole number between 0 and 1,000,000.");
      if (question.length < 3) throw new Error("Write a number question before locking your answer.");
      const payload = { ...replaceEstimateQuestion(parse(card.payload), question), options: estimateOptions(correctNumber) };
      await sql`UPDATE deck_cards SET status = 'guess', payload = ${JSON.stringify(payload)}, secret = ${JSON.stringify({ correctNumber })} WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "nextEstimate") {
      if (!card || card.type !== "estimate" || card.status !== "ready" || card.actor_id !== me.id) throw new Error("Only the player answering can choose the next estimate.");
      const payload = parse(card.payload); const themes = normalizedThemes(room.theme_category); const pool = shuffle(themes.flatMap((theme) => ESTIMATE_QUESTIONS_BY_THEME[theme].map((en, i) => ({ en, ja: ESTIMATE_QUESTIONS_BY_THEME_JA[theme][i] ?? en }))));
      const currentQuestion = typeof payload.question === "string" ? payload.question : ""; const next = pool.find((item) => item.en !== currentQuestion && item.ja !== currentQuestion) ?? pool[0];
      const nextPayload = next ? { ...replaceEstimateQuestion(payload, next.en), localized: { en: { question: next.en }, ja: { question: next.ja } } } : replaceEstimateQuestion(payload, currentQuestion);
      await sql`UPDATE deck_cards SET payload = ${JSON.stringify(nextPayload)}, secret = '{}' WHERE id = ${card.id} AND status = 'ready'`;
    }
    if (body.action === "guessEstimate") {
      if (!card || card.type !== "estimate" || card.status !== "guess" || card.target_id !== me.id) throw new Error("This estimate is not yours to guess.");
      const payload = parse(card.payload); const options = Array.isArray(payload.options) ? payload.options.map(Number) : [];
      const wrongGuesses = Array.isArray(payload.wrongGuesses) ? payload.wrongGuesses.map(Number) : []; const estimate = Number(body.estimate);
      if (!Number.isInteger(estimate) || !options.includes(estimate) || wrongGuesses.includes(estimate)) throw new Error("Choose an available answer.");
      const correctNumber = Number(parse(card.secret).correctNumber);
      if (estimate !== correctNumber) {
        await sql`UPDATE deck_cards SET payload = ${JSON.stringify({ ...payload, wrongGuesses: [...wrongGuesses, estimate] })} WHERE id = ${card.id} AND status = 'guess'`;
        await sql`UPDATE players SET sips = sips + 1 WHERE id = ${card.target_id}`;
      } else {
        const firstTry = wrongGuesses.length === 0; const drinkerId = firstTry ? card.actor_id : null; const sips = firstTry ? spinHighSips() : wrongGuesses.length;
        const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify({ correctNumber, wrongGuesses, firstTry, drinkerId, spinById: firstTry ? drinkerId : null, sips })}, completed_at = now() WHERE id = ${card.id} AND status = 'guess' RETURNING id`;
        if (updated[0]) { if (drinkerId) await sql`UPDATE players SET sips = sips + ${sips} WHERE id = ${drinkerId}`; await finishCard(room); }
      }
    }
    return json(res, await state(roomCode, token, currentUser));
  } catch (error) {
    return json(res, { error: error instanceof Error ? error.message : "Unexpected error." }, 400);
  }
}
