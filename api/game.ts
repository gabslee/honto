import { neon } from "@neondatabase/serverless";

type Body = { action?: string; code?: string; name?: string; token?: string; roundCount?: number; groupSipEvery?: number | null; timerMinutes?: number | null; reminderMinutes?: number | null; writeTimerMinutes?: number | null; guessTimerMinutes?: number | null; themeCategory?: string; exclusiveThemes?: boolean; customTheme?: string | null; gameMode?: "honto" | "truth_sips"; miniGameEnabled?: boolean; question?: string; sips?: number; miniChoice?: "truth" | "dare"; miniAnswer?: string; prompt?: string; statements?: string[]; truthIndex?: number; guessedIndex?: number };

const WORDS = ["MOON", "MINT", "WAVE", "SAKE", "NEON", "MISO", "YUZU", "NORI", "KITSU", "MOMO", "SORA", "KUMA", "HOSHI", "RAMEN", "UMAMI"];
const ROOM_IDLE_MS = 12 * 60 * 60 * 1000;
const sql = neon(process.env.DATABASE_URL ?? "");
let schemaReady: Promise<void> | null = null;

function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
    await sql`CREATE TABLE IF NOT EXISTS rooms (id text PRIMARY KEY, code text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'lobby', round_count integer NOT NULL DEFAULT 10, current_round integer NOT NULL DEFAULT 1, group_sip_every integer, timer_minutes integer, write_timer_minutes integer, guess_timer_minutes integer, theme_category text NOT NULL DEFAULT 'safe', exclusive_themes boolean NOT NULL DEFAULT false, custom_theme text, game_mode text NOT NULL DEFAULT 'honto', mini_game_enabled boolean NOT NULL DEFAULT false, mini_game_next_round integer, session_paused boolean NOT NULL DEFAULT false, paused_at timestamptz, paused_seconds integer NOT NULL DEFAULT 0, round_started_at timestamptz, started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS write_timer_minutes integer`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS guess_timer_minutes integer`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS theme_category text NOT NULL DEFAULT 'safe'`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS exclusive_themes boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS custom_theme text`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS game_mode text NOT NULL DEFAULT 'honto'`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mini_game_enabled boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mini_game_next_round integer`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS session_paused boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS paused_at timestamptz`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS paused_seconds integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS round_started_at timestamptz`;
    await sql`CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, name text NOT NULL, token text UNIQUE NOT NULL, is_host boolean NOT NULL DEFAULT false, sips integer NOT NULL DEFAULT 0, joined_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS rounds (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, round_number integer NOT NULL, author_id text NOT NULL REFERENCES players(id), prompt text NOT NULL, statement_one text NOT NULL, statement_two text NOT NULL, statement_three text NOT NULL, truth_index integer NOT NULL, guessed_index integer, guesser_id text REFERENCES players(id), result text, created_at timestamptz NOT NULL DEFAULT now(), revealed_at timestamptz, UNIQUE(room_id, round_number))`;
    await sql`CREATE TABLE IF NOT EXISTS mini_games (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, trigger_round integer NOT NULL, type text NOT NULL DEFAULT 'question', prompt text NOT NULL DEFAULT '__QUESTION__', assigned_player_id text NOT NULL REFERENCES players(id), asker_id text REFERENCES players(id), target_player_id text REFERENCES players(id), status text NOT NULL DEFAULT 'ask', question text, sips integer NOT NULL DEFAULT 1, choice text, answer text, completed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE(room_id, trigger_round))`;
    await sql`ALTER TABLE mini_games ADD COLUMN IF NOT EXISTS asker_id text REFERENCES players(id)`;
    await sql`ALTER TABLE mini_games ADD COLUMN IF NOT EXISTS target_player_id text REFERENCES players(id)`;
    await sql`ALTER TABLE mini_games ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ask'`;
    await sql`ALTER TABLE mini_games ADD COLUMN IF NOT EXISTS question text`;
    await sql`ALTER TABLE mini_games ADD COLUMN IF NOT EXISTS sips integer NOT NULL DEFAULT 1`;
    await sql`ALTER TABLE mini_games ADD COLUMN IF NOT EXISTS choice text`;
    await sql`ALTER TABLE mini_games ADD COLUMN IF NOT EXISTS answer text`;
  })();
  return schemaReady;
}

const id = () => crypto.randomUUID();
const code = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(10 + Math.random() * 90)}`;
const miniGameGap = () => 5 + Math.floor(Math.random() * 4);
const cleanName = (value?: string) => value?.trim().replace(/\s+/g, " ").slice(0, 24) ?? "";
const json = (res: any, body: unknown, status = 200) => { res.setHeader?.("Cache-Control", "no-store, max-age=0"); return res.status(status).json(body); };

async function queueMiniGame(room: any, triggerRound: number) {
  if (!room.mini_game_enabled || Number(room.mini_game_next_round ?? 0) !== triggerRound) return;
  const players = await sql`SELECT id FROM players WHERE room_id = ${room.id} ORDER BY joined_at ASC`;
  if (players.length < 2) return;
  const asker = players[triggerRound % players.length]?.id;
  const target = players.find((player: any) => player.id !== asker)?.id;
  if (!asker || !target) return;
  await sql`INSERT INTO mini_games (id, room_id, trigger_round, type, prompt, assigned_player_id, asker_id, target_player_id, status) VALUES (${id()}, ${room.id}, ${triggerRound}, 'question', '__QUESTION__', ${asker}, ${asker}, ${target}, 'ask') ON CONFLICT (room_id, trigger_round) DO NOTHING`;
  await sql`UPDATE rooms SET mini_game_next_round = null, updated_at = now() WHERE id = ${room.id}`;
}

async function state(roomCode: string, token: string) {
  const rooms = await sql`SELECT * FROM rooms WHERE code = ${roomCode}`;
  const room: any = rooms[0];
  if (!room) return null;
  if (room.status !== "finished" && room.updated_at && Date.now() - new Date(room.updated_at).getTime() > ROOM_IDLE_MS) {
    await sql`UPDATE rooms SET status = 'finished', session_paused = false, updated_at = now() WHERE id = ${room.id}`;
    room.status = "finished";
  }
  const meRows = await sql`SELECT id FROM players WHERE room_id = ${room.id} AND token = ${token}`;
  if (!meRows[0]) throw new Error("Your session is not valid for this room.");
  const players = await sql`SELECT id, name, is_host AS "isHost", sips, joined_at AS "joinedAt" FROM players WHERE room_id = ${room.id} ORDER BY joined_at ASC`;
  const rounds = await sql`SELECT r.id, r.round_number AS "roundNumber", r.author_id AS "authorId", p.name AS "authorName", r.prompt, r.statement_one AS "statementOne", r.statement_two AS "statementTwo", r.statement_three AS "statementThree", r.guessed_index AS "guessedIndex", r.guesser_id AS "guesserId", r.result, r.created_at AS "createdAt", CASE WHEN r.result IS NOT NULL THEN r.truth_index ELSE NULL END AS "truthIndex" FROM rounds r JOIN players p ON p.id = r.author_id WHERE r.room_id = ${room.id} AND r.round_number = ${room.current_round} LIMIT 1`;
  const lastRows = await sql`SELECT r.round_number AS "roundNumber", r.author_id AS "authorId", r.guesser_id AS "guesserId", r.truth_index AS "truthIndex", r.guessed_index AS "guessedIndex", r.result, r.statement_one AS "statementOne", r.statement_two AS "statementTwo", r.statement_three AS "statementThree" FROM rounds r WHERE r.room_id = ${room.id} AND r.result IS NOT NULL ORDER BY r.round_number DESC LIMIT 1`;
  const last = lastRows[0] as any;
  const miniRows = await sql`SELECT m.id, m.trigger_round AS "triggerRound", m.type, m.status, m.question, m.sips, m.choice, m.answer, m.assigned_player_id AS "assignedPlayerId", a.name AS "askerName", p.name AS "assignedPlayerName", t.name AS "targetPlayerName" FROM mini_games m JOIN players p ON p.id = m.assigned_player_id LEFT JOIN players a ON a.id = m.asker_id LEFT JOIN players t ON t.id = m.target_player_id WHERE m.room_id = ${room.id} AND m.completed = false ORDER BY m.created_at ASC LIMIT 1`;
  const miniGame = miniRows[0] ?? null;
  const drinkerId = last ? (last.result === "correct" ? last.authorId : last.result === "timeout" && last.statementOne === "__TIMEOUT__" ? last.authorId : last.guesserId) : null;
  return { room: { code: room.code, status: room.status, roundCount: room.round_count, currentRound: room.current_round, groupSipEvery: room.group_sip_every, timerMinutes: room.timer_minutes, writeTimerMinutes: room.write_timer_minutes, guessTimerMinutes: room.guess_timer_minutes, themeCategory: room.theme_category, exclusiveThemes: Boolean(room.exclusive_themes), customTheme: room.custom_theme, gameMode: room.game_mode === "truth_sips" ? "truth_sips" : "honto", miniGameEnabled: Boolean(room.mini_game_enabled), startedAt: room.started_at, roundStartedAt: room.round_started_at, sessionPaused: room.session_paused, pausedAt: room.paused_at, pausedSeconds: room.paused_seconds }, players, activeRound: rounds[0] ?? null, miniGame, lastReveal: last ? { ...last, timeoutStage: last.result === "timeout" ? (last.statementOne === "__TIMEOUT__" ? "writing" : "guessing") : null, drinkerId } : null, meId: meRows[0].id };
}

export default async function handler(req: any, res: any) {
  try {
    await ensureSchema();
    const body = (req.body ?? {}) as Body;
    const query = req.query ?? {};
    if (req.method === "GET") {
      const roomCode = String(query.code ?? "").toUpperCase();
      const result = await state(roomCode, String(query.token ?? ""));
      return result ? json(res, result) : json(res, { error: "Room not found." }, 404);
    }
    if (body.action === "create") {
      const name = cleanName(body.name); if (!name) return json(res, { error: "Enter your name." }, 400);
      let roomCode = code();
      for (let i = 0; i < 5 && (await sql`SELECT 1 FROM rooms WHERE code = ${roomCode}`).length; i += 1) roomCode = code();
      const roomId = id(); const playerId = id(); const token = id();
      await sql`INSERT INTO rooms (id, code) VALUES (${roomId}, ${roomCode})`;
      await sql`INSERT INTO players (id, room_id, name, token, is_host) VALUES (${playerId}, ${roomId}, ${name}, ${token}, true)`;
      return json(res, { code: roomCode, token }, 201);
    }
    const roomCode = String(body.code ?? "").trim().toUpperCase();
    if (body.action === "join") {
      const rooms = await sql`SELECT id, status FROM rooms WHERE code = ${roomCode}`; const room: any = rooms[0];
      if (!room) return json(res, { error: "That room does not exist." }, 404);
      if (room.status !== "lobby") return json(res, { error: "The game has already started." }, 409);
      const name = cleanName(body.name); if (!name) return json(res, { error: "Enter your name." }, 400);
      const count = await sql`SELECT COUNT(*)::int AS total FROM players WHERE room_id = ${room.id}`;
      if ((count[0]?.total ?? 0) >= 8) return json(res, { error: "The room is full." }, 409);
      const token = id(); await sql`INSERT INTO players (id, room_id, name, token) VALUES (${id()}, ${room.id}, ${name}, ${token})`;
      return json(res, { code: roomCode, token }, 201);
    }
    const token = String(body.token ?? "");
    const rooms = await sql`SELECT * FROM rooms WHERE code = ${roomCode}`; const room: any = rooms[0];
    if (!room) return json(res, { error: "Room not found." }, 404);
    const meRows = await sql`SELECT * FROM players WHERE room_id = ${room.id} AND token = ${token}`; const me: any = meRows[0];
    if (!me) return json(res, { error: "Invalid session." }, 401);
    if (body.action === "configure") {
      if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can change the room settings.");
      const rounds = Number.isInteger(body.roundCount) && (body.roundCount ?? 0) >= 1 && (body.roundCount ?? 0) <= 100 ? body.roundCount : 10;
      const group = Number.isInteger(body.groupSipEvery) && (body.groupSipEvery ?? 0) >= 1 && (body.groupSipEvery ?? 0) <= 30 ? body.groupSipEvery : null;
      const timer = Number.isInteger(body.reminderMinutes ?? body.timerMinutes) && (body.reminderMinutes ?? body.timerMinutes ?? 0) >= 1 && (body.reminderMinutes ?? body.timerMinutes ?? 0) <= 180 ? (body.reminderMinutes ?? body.timerMinutes) : null;
      const writeTimer = Number.isInteger(body.writeTimerMinutes) && (body.writeTimerMinutes ?? 0) >= 1 && (body.writeTimerMinutes ?? 0) <= 60 ? body.writeTimerMinutes : null;
      const guessTimer = Number.isInteger(body.guessTimerMinutes) && (body.guessTimerMinutes ?? 0) >= 1 && (body.guessTimerMinutes ?? 0) <= 60 ? body.guessTimerMinutes : null;
      const allowed = new Set(["mixed", "family", "innocent", "life", "flirty", "spicy"]);
      const selected = (body.themeCategory ?? "").split(",").map((item) => item.trim()).filter((item) => allowed.has(item));
      const category = [...new Set(selected)].join(",") || "safe";
      const exclusiveThemes = body.exclusiveThemes === true;
      const customTheme = typeof body.customTheme === "string" ? body.customTheme.trim().slice(0, 80) || null : null;
      const gameMode = body.gameMode === "truth_sips" ? "truth_sips" : "honto";
      const miniGameEnabled = gameMode === "truth_sips" || body.miniGameEnabled === true;
      await sql`UPDATE rooms SET round_count = ${rounds}, group_sip_every = ${group}, timer_minutes = ${timer}, write_timer_minutes = ${writeTimer}, guess_timer_minutes = ${guessTimer}, theme_category = ${category}, exclusive_themes = ${exclusiveThemes}, custom_theme = ${customTheme}, game_mode = ${gameMode}, mini_game_enabled = ${miniGameEnabled}, mini_game_next_round = null, updated_at = now() WHERE id = ${room.id}`;
    }
    if (body.action === "start") {
      if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can start the game.");
      const count = await sql`SELECT COUNT(*)::int AS total FROM players WHERE room_id = ${room.id}`;
      if ((count[0]?.total ?? 0) < 2) throw new Error("Wait for at least one more player.");
      const gameMode = room.game_mode === "truth_sips" ? "truth_sips" : "honto";
      const firstMiniRound = Number(room.mini_game_enabled) ? (gameMode === "truth_sips" ? 1 : 1 + miniGameGap()) : null;
      await sql`UPDATE rooms SET status = 'playing', current_round = 1, round_started_at = now(), started_at = now(), mini_game_next_round = ${firstMiniRound}, session_paused = false, paused_seconds = 0, updated_at = now() WHERE id = ${room.id}`;
      if (gameMode === "truth_sips") await queueMiniGame({ ...room, mini_game_enabled: true, mini_game_next_round: 1 }, 1);
    }
    if (body.action === "pause") {
      if (!me.is_host || room.status !== "playing") throw new Error("Only the host can pause the session.");
      if (room.session_paused) {
        const extra = room.paused_at ? Math.max(0, Math.floor((Date.now() - new Date(room.paused_at).getTime()) / 1000)) : 0;
        await sql`UPDATE rooms SET session_paused = false, paused_at = null, paused_seconds = paused_seconds + ${extra}, updated_at = now() WHERE id = ${room.id}`;
      } else {
        await sql`UPDATE rooms SET session_paused = true, paused_at = now(), updated_at = now() WHERE id = ${room.id}`;
      }
    }
    if (body.action === "timeout") {
      if (room.status !== "playing") throw new Error("The game is not in progress.");
      const pendingMini = await sql`SELECT id FROM mini_games WHERE room_id = ${room.id} AND completed = false LIMIT 1`;
      if (pendingMini[0]) return json(res, await state(roomCode, token));
      const players = await sql`SELECT id FROM players WHERE room_id = ${room.id} ORDER BY joined_at ASC`;
      const authorId = players[(Number(room.current_round) - 1) % players.length]?.id;
      const currentRounds = await sql`SELECT * FROM rounds WHERE room_id = ${room.id} AND round_number = ${room.current_round}`;
      const current: any = currentRounds[0];
      const writePhase = !current;
      const timedOutId = writePhase ? authorId : (players.find((player: any) => player.id !== current.author_id)?.id ?? authorId);
      if (!timedOutId) throw new Error("There is no player to time out.");
      if (writePhase) {
        const inserted = await sql`INSERT INTO rounds (id, room_id, round_number, author_id, prompt, statement_one, statement_two, statement_three, truth_index, guesser_id, result, revealed_at) VALUES (${id()}, ${room.id}, ${room.current_round}, ${authorId}, '__TIMEOUT__', '__TIMEOUT__', '__TIMEOUT__', '__TIMEOUT__', 0, ${timedOutId}, 'timeout', now()) ON CONFLICT (room_id, round_number) DO NOTHING RETURNING id`;
        if (!inserted[0]) return json(res, await state(roomCode, token));
      } else {
        const updated = await sql`UPDATE rounds SET guesser_id = ${timedOutId}, result = 'timeout', revealed_at = now() WHERE id = ${current.id} AND result IS NULL RETURNING id`;
        if (!updated[0]) return json(res, await state(roomCode, token));
      }
      const nextRound = Number(room.current_round) + 1; const finished = nextRound > Number(room.round_count);
      await sql`UPDATE players SET sips = sips + 1 WHERE id = ${timedOutId}`;
      await sql`UPDATE rooms SET current_round = ${finished ? room.current_round : nextRound}, status = ${finished ? "finished" : "playing"}, round_started_at = CASE WHEN ${finished} THEN round_started_at ELSE now() END, updated_at = now() WHERE id = ${room.id}`;
      if (!finished) await queueMiniGame(room, nextRound);
      return json(res, { ...(await state(roomCode, token)), timeout: { playerId: timedOutId, roundNumber: room.current_round, stage: writePhase ? "writing" : "guessing" } });
    }
    if (body.action === "submitMiniQuestion") {
      const miniRows = await sql`SELECT * FROM mini_games WHERE room_id = ${room.id} AND completed = false AND status = 'ask' ORDER BY created_at ASC LIMIT 1`;
      const mini: any = miniRows[0];
      if (!mini) return json(res, await state(roomCode, token));
      if (mini.assigned_player_id !== me.id) throw new Error("It is the other player's mini game.");
      const question = typeof body.question === "string" ? body.question.trim().slice(0, 180) : "";
      const sips = Number(body.sips);
      if (question.length < 3) throw new Error("Write a question first.");
      if (!Number.isInteger(sips) || sips < 1 || sips > 3) throw new Error("Choose between 1 and 3 sips.");
      await sql`UPDATE mini_games SET question = ${question}, sips = ${sips}, status = 'answer', assigned_player_id = target_player_id WHERE id = ${mini.id} AND completed = false AND status = 'ask'`;
      return json(res, await state(roomCode, token));
    }
    if (body.action === "answerMini") {
      const miniRows = await sql`SELECT * FROM mini_games WHERE room_id = ${room.id} AND completed = false AND status = 'answer' ORDER BY created_at ASC LIMIT 1`;
      const mini: any = miniRows[0];
      if (!mini) return json(res, await state(roomCode, token));
      if (mini.assigned_player_id !== me.id) throw new Error("It is the other player's mini game.");
      if (body.miniChoice !== "truth" && body.miniChoice !== "dare") throw new Error("Choose truth or dare.");
      const answer = typeof body.miniAnswer === "string" ? body.miniAnswer.trim().slice(0, 300) : "";
      await sql`UPDATE mini_games SET choice = ${body.miniChoice}, answer = ${body.miniChoice === "truth" ? answer : null}, status = 'done', completed = true, completed_at = now() WHERE id = ${mini.id} AND completed = false AND status = 'answer'`;
      if (body.miniChoice === "dare") await sql`UPDATE players SET sips = sips + ${Number(mini.sips) || 1} WHERE id = ${me.id}`;
      if (room.game_mode === "truth_sips") {
        const nextRound = Number(room.current_round) + 1;
        const finished = nextRound > Number(room.round_count);
        await sql`UPDATE rooms SET current_round = ${finished ? room.current_round : nextRound}, status = ${finished ? "finished" : "playing"}, round_started_at = CASE WHEN ${finished} THEN round_started_at ELSE now() END, mini_game_next_round = ${finished ? null : nextRound}, updated_at = now() WHERE id = ${room.id}`;
        if (!finished) await queueMiniGame({ ...room, mini_game_enabled: true, mini_game_next_round: nextRound }, nextRound);
      } else {
        const nextMiniRound = Number(room.current_round) + miniGameGap();
        if (room.mini_game_enabled && room.status === "playing" && Number(room.current_round) < Number(room.round_count)) await sql`UPDATE rooms SET mini_game_next_round = ${nextMiniRound}, updated_at = now() WHERE id = ${room.id}`;
      }
      return json(res, await state(roomCode, token));
    }
    if (body.action === "submit") {
      if (room.status !== "playing") throw new Error("The game is not in progress.");
      const pendingMini = await sql`SELECT id FROM mini_games WHERE room_id = ${room.id} AND completed = false LIMIT 1`;
      if (pendingMini[0]) throw new Error("Finish the Truth or Dare mini game first.");
      const players = await sql`SELECT id FROM players WHERE room_id = ${room.id} ORDER BY joined_at ASC`;
      if (players[(Number(room.current_round) - 1) % players.length]?.id !== me.id) throw new Error("It is not your turn yet.");
      const existing = await sql`SELECT id FROM rounds WHERE room_id = ${room.id} AND round_number = ${room.current_round}`;
      if (existing[0]) throw new Error("This round's stories have already been submitted.");
      const statements = body.statements?.map((item) => item.trim().slice(0, 180)) ?? [];
      if (statements.length !== 3 || statements.some((item) => !item)) throw new Error("Fill in all three stories.");
      if (![0, 1, 2].includes(body.truthIndex ?? -1)) throw new Error("Mark which story is true.");
      await sql`INSERT INTO rounds (id, room_id, round_number, author_id, prompt, statement_one, statement_two, statement_three, truth_index) VALUES (${id()}, ${room.id}, ${room.current_round}, ${me.id}, ${(body.prompt ?? "Anything goes").slice(0, 100)}, ${statements[0]}, ${statements[1]}, ${statements[2]}, ${body.truthIndex})`;
    }
    if (body.action === "guess") {
      const pendingMini = await sql`SELECT id FROM mini_games WHERE room_id = ${room.id} AND completed = false LIMIT 1`;
      if (pendingMini[0]) throw new Error("Finish the Truth or Dare mini game first.");
      const rounds = await sql`SELECT * FROM rounds WHERE room_id = ${room.id} AND round_number = ${room.current_round}`; const round: any = rounds[0];
      if (!round || round.result) throw new Error("There is no guess available.");
      if (round.author_id === me.id) throw new Error("You cannot guess your own story.");
      if (![0, 1, 2].includes(body.guessedIndex ?? -1)) throw new Error("Choose a story.");
      const correct = Number(body.guessedIndex) === Number(round.truth_index); const drinkerId = correct ? round.author_id : me.id;
      const nextRound = Number(room.current_round) + 1; const finished = nextRound > Number(room.round_count);
      await sql`UPDATE rounds SET guessed_index = ${body.guessedIndex}, guesser_id = ${me.id}, result = ${correct ? "correct" : "wrong"}, revealed_at = now() WHERE id = ${round.id}`;
      await sql`UPDATE players SET sips = sips + 1 WHERE id = ${drinkerId}`;
      await sql`UPDATE rooms SET current_round = ${finished ? room.current_round : nextRound}, status = ${finished ? "finished" : "playing"}, round_started_at = CASE WHEN ${finished} THEN round_started_at ELSE now() END, updated_at = now() WHERE id = ${room.id}`;
      if (!finished) await queueMiniGame(room, nextRound);
      return json(res, { ...(await state(roomCode, token)), reveal: { correct, truthIndex: round.truth_index, drinkerId, authorId: round.author_id, guesserId: me.id, roundNumber: room.current_round } });
    }
    return json(res, await state(roomCode, token));
  } catch (error) {
    return json(res, { error: error instanceof Error ? error.message : "Unexpected error." }, 400);
  }
}
