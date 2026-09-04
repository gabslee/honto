import { neon } from "@neondatabase/serverless";

type Body = { action?: string; code?: string; name?: string; token?: string; roundCount?: number; groupSipEvery?: number | null; timerMinutes?: number | null; prompt?: string; statements?: string[]; truthIndex?: number; guessedIndex?: number };

const WORDS = ["MOON", "MINT", "WAVE", "SAKE", "NEON", "MISO", "YUZU", "NORI", "KITSU", "MOMO", "SORA", "KUMA", "HOSHI", "RAMEN", "UMAMI"];
const sql = neon(process.env.DATABASE_URL ?? "");
let schemaReady: Promise<void> | null = null;

function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
    await sql`CREATE TABLE IF NOT EXISTS rooms (id text PRIMARY KEY, code text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'lobby', round_count integer NOT NULL DEFAULT 10, current_round integer NOT NULL DEFAULT 1, group_sip_every integer, timer_minutes integer, started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, name text NOT NULL, token text UNIQUE NOT NULL, is_host boolean NOT NULL DEFAULT false, sips integer NOT NULL DEFAULT 0, joined_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS rounds (id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, round_number integer NOT NULL, author_id text NOT NULL REFERENCES players(id), prompt text NOT NULL, statement_one text NOT NULL, statement_two text NOT NULL, statement_three text NOT NULL, truth_index integer NOT NULL, guessed_index integer, guesser_id text REFERENCES players(id), result text, created_at timestamptz NOT NULL DEFAULT now(), revealed_at timestamptz, UNIQUE(room_id, round_number))`;
  })();
  return schemaReady;
}

const id = () => crypto.randomUUID();
const code = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(10 + Math.random() * 90)}`;
const cleanName = (value?: string) => value?.trim().replace(/\s+/g, " ").slice(0, 24) ?? "";
const json = (res: any, body: unknown, status = 200) => res.status(status).json(body);

async function state(roomCode: string, token: string) {
  const rooms = await sql`SELECT * FROM rooms WHERE code = ${roomCode}`;
  const room: any = rooms[0];
  if (!room) return null;
  const meRows = await sql`SELECT id FROM players WHERE room_id = ${room.id} AND token = ${token}`;
  if (!meRows[0]) throw new Error("Your session is not valid for this room.");
  const players = await sql`SELECT id, name, is_host AS "isHost", sips, joined_at AS "joinedAt" FROM players WHERE room_id = ${room.id} ORDER BY joined_at ASC`;
  const rounds = await sql`SELECT r.id, r.round_number AS "roundNumber", r.author_id AS "authorId", p.name AS "authorName", r.prompt, r.statement_one AS "statementOne", r.statement_two AS "statementTwo", r.statement_three AS "statementThree", r.guessed_index AS "guessedIndex", r.guesser_id AS "guesserId", r.result, CASE WHEN r.result IS NOT NULL THEN r.truth_index ELSE NULL END AS "truthIndex" FROM rounds r JOIN players p ON p.id = r.author_id WHERE r.room_id = ${room.id} AND r.round_number = ${room.current_round} LIMIT 1`;
  return { room: { code: room.code, status: room.status, roundCount: room.round_count, currentRound: room.current_round, groupSipEvery: room.group_sip_every, timerMinutes: room.timer_minutes, startedAt: room.started_at }, players, activeRound: rounds[0] ?? null, meId: meRows[0].id };
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
      const rounds = [10, 20, 30].includes(body.roundCount ?? 0) ? body.roundCount : 10;
      const group = [3, 5].includes(body.groupSipEvery ?? 0) ? body.groupSipEvery : null;
      const timer = [10, 15].includes(body.timerMinutes ?? 0) ? body.timerMinutes : null;
      await sql`UPDATE rooms SET round_count = ${rounds}, group_sip_every = ${group}, timer_minutes = ${timer}, updated_at = now() WHERE id = ${room.id}`;
    }
    if (body.action === "start") {
      if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can start the game.");
      const count = await sql`SELECT COUNT(*)::int AS total FROM players WHERE room_id = ${room.id}`;
      if ((count[0]?.total ?? 0) < 2) throw new Error("Wait for at least one more player.");
      await sql`UPDATE rooms SET status = 'playing', current_round = 1, started_at = now(), updated_at = now() WHERE id = ${room.id}`;
    }
    if (body.action === "submit") {
      if (room.status !== "playing") throw new Error("The game is not in progress.");
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
      const rounds = await sql`SELECT * FROM rounds WHERE room_id = ${room.id} AND round_number = ${room.current_round}`; const round: any = rounds[0];
      if (!round || round.result) throw new Error("There is no guess available.");
      if (round.author_id === me.id) throw new Error("You cannot guess your own story.");
      if (![0, 1, 2].includes(body.guessedIndex ?? -1)) throw new Error("Choose a story.");
      const correct = Number(body.guessedIndex) === Number(round.truth_index); const drinkerId = correct ? round.author_id : me.id;
      const nextRound = Number(room.current_round) + 1; const finished = nextRound > Number(room.round_count);
      await sql`UPDATE rounds SET guessed_index = ${body.guessedIndex}, guesser_id = ${me.id}, result = ${correct ? "correct" : "wrong"}, revealed_at = now() WHERE id = ${round.id}`;
      await sql`UPDATE players SET sips = sips + 1 WHERE id = ${drinkerId}`;
      await sql`UPDATE rooms SET current_round = ${finished ? room.current_round : nextRound}, status = ${finished ? "finished" : "playing"}, updated_at = now() WHERE id = ${room.id}`;
      return json(res, { ...(await state(roomCode, token)), reveal: { correct, truthIndex: round.truth_index, drinkerId, roundNumber: room.current_round } });
    }
    return json(res, await state(roomCode, token));
  } catch (error) {
    return json(res, { error: error instanceof Error ? error.message : "Unexpected error." }, 400);
  }
}
