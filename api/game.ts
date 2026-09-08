import { neon } from "@neondatabase/serverless";

type CardType = "honto" | "question" | "preference" | "estimate" | "rps" | "both";
type RpsChoice = "rock" | "paper" | "scissors";
type Body = {
  action?: string; code?: string; name?: string; token?: string; roundCount?: number;
  themeCategory?: string; customTheme?: string | null; prompt?: string; statements?: string[];
  truthIndex?: number; guessedIndex?: number; question?: string; sips?: number;
  choice?: "answer" | "skip"; preferenceIndex?: number; correctNumber?: number; estimate?: number; rpsChoice?: RpsChoice;
};

const WORDS = ["MOON", "MINT", "WAVE", "SAKE", "NEON", "MISO", "YUZU", "NORI", "KITSU", "MOMO", "SORA", "KUMA", "HOSHI", "RAMEN", "UMAMI"];
const CARD_TYPES: CardType[] = ["honto", "question", "preference", "estimate", "rps", "both"];
const ROOM_IDLE_MS = 12 * 60 * 60 * 1000;
const ESTIMATE_QUESTIONS = [
  "How many countries have you visited?", "How many hours do you usually sleep each night?",
  "How many concerts have you been to?", "How many times a week do you order food?",
  "How many unread messages are on your phone right now?", "How many alarms do you set to wake up?",
  "How many pairs of shoes do you own?", "How many minutes does it take you to get ready?",
  "How many photos are currently on your phone?", "How many books have you read this year?",
  "How many apps do you use every day?", "How many cities have you lived in?",
];
const PREFERENCE_CARDS = [
  { question: "Which place would you visit first?", options: ["Japan", "Italy", "Iceland"] },
  { question: "Which comfort food would you choose tonight?", options: ["Pizza", "Sushi", "Tacos"] },
  { question: "Which kind of trip sounds best?", options: ["Beach escape", "Mountain cabin", "Big city"] },
  { question: "Which plan would you pick for a free day?", options: ["Stay home", "Explore somewhere new", "Meet friends"] },
  { question: "Which new skill would you rather learn?", options: ["Play an instrument", "Speak a language", "Cook really well"] },
  { question: "Which movie night would you choose?", options: ["Comedy", "Horror", "Romance"] },
  { question: "Which surprise would make you happiest?", options: ["A planned trip", "A meaningful gift", "A surprise party"] },
  { question: "Which place would you rather live for a year?", options: ["By the sea", "In the countryside", "In a huge city"] },
  { question: "Which little luxury matters most?", options: ["Great coffee", "A perfect bed", "Fast internet"] },
  { question: "Which evening sounds most like you?", options: ["A quiet dinner", "A crowded party", "A spontaneous adventure"] },
  { question: "Which pet would you choose?", options: ["Dog", "Cat", "Something unusual"] },
  { question: "Which gift would you rather receive?", options: ["An experience", "Something useful", "Something sentimental"] },
];

const sql = neon(process.env.DATABASE_URL ?? "");
let schemaReady: Promise<void> | null = null;

function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
    await sql`CREATE TABLE IF NOT EXISTS rooms (id text PRIMARY KEY, code text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'lobby', round_count integer NOT NULL DEFAULT 12, current_round integer NOT NULL DEFAULT 1, theme_category text NOT NULL DEFAULT 'safe', custom_theme text, started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS theme_category text NOT NULL DEFAULT 'safe'`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS custom_theme text`;
    await sql`CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, name text NOT NULL, token text UNIQUE NOT NULL, is_host boolean NOT NULL DEFAULT false, sips integer NOT NULL DEFAULT 0, joined_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS deck_cards (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, card_number integer NOT NULL, type text NOT NULL, actor_id text NOT NULL REFERENCES players(id), target_id text NOT NULL REFERENCES players(id), status text NOT NULL DEFAULT 'hidden', payload text NOT NULL DEFAULT '{}', secret text NOT NULL DEFAULT '{}', result text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE(room_id, card_number))`;
    await sql`ALTER TABLE deck_cards ADD COLUMN IF NOT EXISTS revealed_by text[] NOT NULL DEFAULT '{}'`;
    await sql`CREATE INDEX IF NOT EXISTS idx_deck_cards_room_status ON deck_cards(room_id, status, card_number)`;
  })();
  return schemaReady;
}

const id = () => crypto.randomUUID();
const code = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(10 + Math.random() * 90)}`;
const spinSips = () => 1 + Math.floor(Math.random() * 3);
const cleanName = (value?: string) => value?.trim().replace(/\s+/g, " ").slice(0, 24) ?? "";
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

function makeDeckTypes(count: number) {
  const result: CardType[] = [];
  while (result.length < count) result.push(...shuffle(CARD_TYPES));
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

async function buildDeck(roomId: string, roundCount: number, players: any[]) {
  await sql`DELETE FROM deck_cards WHERE room_id = ${roomId}`;
  const types = makeDeckTypes(roundCount);
  const questions = shuffle(ESTIMATE_QUESTIONS);
  const preferences = shuffle(PREFERENCE_CARDS);
  for (let index = 0; index < roundCount; index += 1) {
    const actor = players[index % 2];
    const target = players[(index + 1) % 2];
    const type = types[index];
    const payload = type === "estimate" ? { question: questions[index % questions.length], wrongGuesses: [] } : type === "preference" ? preferences[index % preferences.length] : {};
    await sql`INSERT INTO deck_cards (id, room_id, card_number, type, actor_id, target_id, status, payload) VALUES (${id()}, ${roomId}, ${index + 1}, ${type}, ${actor.id}, ${target.id}, 'hidden', ${JSON.stringify(payload)})`;
  }
}

function publicCard(row: any, meId: string, completed = false) {
  if (!row) return null;
  const payload = parse(row.payload);
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

async function state(roomCode: string, token: string) {
  const rooms = await sql`SELECT * FROM rooms WHERE code = ${roomCode}`;
  const room: any = rooms[0];
  if (!room) return null;
  if (room.status !== "finished" && room.updated_at && Date.now() - new Date(room.updated_at).getTime() > ROOM_IDLE_MS) {
    await sql`UPDATE rooms SET status = 'finished', updated_at = now() WHERE id = ${room.id}`;
    room.status = "finished";
  }
  const meRows = await sql`SELECT id FROM players WHERE room_id = ${room.id} AND token = ${token}`;
  const me: any = meRows[0];
  if (!me) throw new Error("Your session is not valid for this room.");
  const players = await sql`SELECT id, name, is_host AS "isHost", sips, joined_at AS "joinedAt" FROM players WHERE room_id = ${room.id} ORDER BY joined_at ASC`;
  const cardRows = room.status === "playing" ? await sql`SELECT c.id, c.card_number AS "cardNumber", c.type, c.status, c.actor_id AS "actorId", a.name AS "actorName", c.target_id AS "targetId", t.name AS "targetName", c.payload, c.secret, c.result, c.revealed_by AS "revealedBy", c.completed_at AS "completedAt" FROM deck_cards c JOIN players a ON a.id = c.actor_id JOIN players t ON t.id = c.target_id WHERE c.room_id = ${room.id} AND c.card_number = ${room.current_round} LIMIT 1` : [];
  const lastRows = await sql`SELECT c.id, c.card_number AS "cardNumber", c.type, c.status, c.actor_id AS "actorId", a.name AS "actorName", c.target_id AS "targetId", t.name AS "targetName", c.payload, c.secret, c.result, c.revealed_by AS "revealedBy", c.completed_at AS "completedAt" FROM deck_cards c JOIN players a ON a.id = c.actor_id JOIN players t ON t.id = c.target_id WHERE c.room_id = ${room.id} AND c.status = 'complete' ORDER BY c.card_number DESC LIMIT 1`;
  return {
    room: { code: room.code, status: room.status, roundCount: room.round_count, currentRound: room.current_round, themeCategory: room.theme_category, customTheme: room.custom_theme, startedAt: room.started_at },
    players, activeCard: publicCard(cardRows[0], me.id), lastCard: publicCard(lastRows[0], me.id, true), meId: me.id,
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
}

export default async function handler(req: any, res: any) {
  try {
    await ensureSchema();
    const body = (req.body ?? {}) as Body;
    const query = req.query ?? {};
    if (req.method === "GET") {
      const result = await state(String(query.code ?? "").toUpperCase(), String(query.token ?? ""));
      return result ? json(res, result) : json(res, { error: "Room not found." }, 404);
    }
    if (body.action === "create") {
      const name = cleanName(body.name);
      if (!name) return json(res, { error: "Enter your name." }, 400);
      let roomCode = code();
      for (let attempt = 0; attempt < 5 && (await sql`SELECT 1 FROM rooms WHERE code = ${roomCode}`).length; attempt += 1) roomCode = code();
      const roomId = id(); const token = id();
      await sql`INSERT INTO rooms (id, code, round_count) VALUES (${roomId}, ${roomCode}, 12)`;
      await sql`INSERT INTO players (id, room_id, name, token, is_host) VALUES (${id()}, ${roomId}, ${name}, ${token}, true)`;
      return json(res, { code: roomCode, token }, 201);
    }
    const roomCode = String(body.code ?? "").trim().toUpperCase();
    if (body.action === "join") {
      const rooms = await sql`SELECT id, status FROM rooms WHERE code = ${roomCode}`; const room: any = rooms[0];
      if (!room) return json(res, { error: "That room does not exist." }, 404);
      if (room.status !== "lobby") return json(res, { error: "The game has already started." }, 409);
      const name = cleanName(body.name); if (!name) return json(res, { error: "Enter your name." }, 400);
      const count = await sql`SELECT COUNT(*)::int AS total FROM players WHERE room_id = ${room.id}`;
      if ((count[0]?.total ?? 0) >= 2) return json(res, { error: "This room already has two players." }, 409);
      const token = id(); await sql`INSERT INTO players (id, room_id, name, token) VALUES (${id()}, ${room.id}, ${name}, ${token})`;
      return json(res, { code: roomCode, token }, 201);
    }

    const token = String(body.token ?? "");
    const { room, me, card } = await getContext(roomCode, token);
    if (body.action === "startWheel") {
      const completedRows = await sql`SELECT * FROM deck_cards WHERE room_id = ${room.id} AND status = 'complete' ORDER BY card_number DESC LIMIT 1`;
      const completed = completedRows[0] as any;
      if (!completed) throw new Error("There is no completed wheel to spin.");
      const result = parse(completed.result);
      if (!["honto", "preference", "rps", "both"].includes(completed.type)) throw new Error("This card does not use the sip wheel.");
      const spinById = result.spinById ?? (completed.type === "both" ? completed.actor_id : result.drinkerId);
      if (spinById !== me.id) throw new Error("The other player is responsible for spinning this wheel.");
      if (!result.wheelStartedAt) await sql`UPDATE deck_cards SET result = ${JSON.stringify({ ...result, spinById, wheelStartedAt: new Date().toISOString() })} WHERE id = ${completed.id} AND status = 'complete'`;
    }
    if (body.action === "configure") {
      if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can change the room settings.");
      const roundCount = Number.isInteger(body.roundCount) ? Math.max(6, Math.min(60, Number(body.roundCount))) : 12;
      const allowed = new Set(["mixed", "family", "innocent", "life", "flirty", "spicy"]);
      const selected = (body.themeCategory ?? "").split(",").map((item) => item.trim()).filter((item) => allowed.has(item));
      const themeCategory = [...new Set(selected)].join(",") || "safe";
      const customTheme = typeof body.customTheme === "string" ? body.customTheme.trim().slice(0, 80) || null : null;
      await sql`UPDATE rooms SET round_count = ${roundCount}, theme_category = ${themeCategory}, custom_theme = ${customTheme}, updated_at = now() WHERE id = ${room.id}`;
    }
    if (body.action === "start") {
      if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can start the game.");
      const players = await sql`SELECT id FROM players WHERE room_id = ${room.id} ORDER BY joined_at ASC`;
      if (players.length !== 2) throw new Error("Honto needs exactly two players.");
      await buildDeck(room.id, Number(room.round_count), players);
      await sql`UPDATE players SET sips = 0 WHERE room_id = ${room.id}`;
      await sql`UPDATE rooms SET status = 'playing', current_round = 1, started_at = now(), updated_at = now() WHERE id = ${room.id}`;
    }
    if (body.action === "drawCard") {
      if (!card || card.status !== "hidden" || card.actor_id !== me.id) throw new Error("It is not your turn to draw.");
      await sql`UPDATE deck_cards SET status = 'ready' WHERE id = ${card.id} AND status = 'hidden'`;
    }
    if (body.action === "ackReveal") {
      if (!card || card.status !== "ready" || ![card.actor_id, card.target_id].includes(me.id)) throw new Error("This card is not ready to reveal.");
      await sql`UPDATE deck_cards SET revealed_by = ARRAY(SELECT DISTINCT player_id FROM unnest(COALESCE(revealed_by, ARRAY[]::text[]) || ARRAY[${me.id}]::text[]) AS player_id) WHERE id = ${card.id} AND status = 'ready'`;
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
      if (!rpsChoice || !["rock", "paper", "scissors"].includes(rpsChoice)) throw new Error("Choose your joken-pô move.");
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
      if (!Number.isInteger(correctNumber) || correctNumber < 0 || correctNumber > 1000000) throw new Error("Enter a whole number between 0 and 1,000,000.");
      const payload = { ...parse(card.payload), options: estimateOptions(correctNumber), wrongGuesses: [] };
      await sql`UPDATE deck_cards SET status = 'guess', payload = ${JSON.stringify(payload)}, secret = ${JSON.stringify({ correctNumber })} WHERE id = ${card.id} AND status = 'ready'`;
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
        const firstTry = wrongGuesses.length === 0; const drinkerId = firstTry ? card.actor_id : null;
        const updated = await sql`UPDATE deck_cards SET status = 'complete', result = ${JSON.stringify({ correctNumber, wrongGuesses, firstTry, drinkerId, sips: firstTry ? 1 : wrongGuesses.length })}, completed_at = now() WHERE id = ${card.id} AND status = 'guess' RETURNING id`;
        if (updated[0]) { if (drinkerId) await sql`UPDATE players SET sips = sips + 1 WHERE id = ${drinkerId}`; await finishCard(room); }
      }
    }
    return json(res, await state(roomCode, token));
  } catch (error) {
    return json(res, { error: error instanceof Error ? error.message : "Unexpected error." }, 400);
  }
}
