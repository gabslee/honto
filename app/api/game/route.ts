import { env } from "cloudflare:workers";

type Action = "create" | "join" | "configure" | "start" | "submit" | "guess";
type Payload = {
  action?: Action; code?: string; name?: string; token?: string;
  roundCount?: number; groupSipEvery?: number | null; timerMinutes?: number | null;
  prompt?: string; statements?: string[]; truthIndex?: number; guessedIndex?: number;
};

const WORDS = ["MOON", "MINT", "WAVE", "SAKE", "NEON", "MISO", "YUZU", "NORI", "KITSU", "MOMO", "SORA", "KUMA", "HOSHI", "RAMEN", "UMAMI"];
const makeId = () => crypto.randomUUID();
const roomCode = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(10 + Math.random() * 90)}`;
const cleanName = (value?: string) => value?.trim().replace(/\s+/g, " ").slice(0, 24) ?? "";

async function roomState(code: string, token: string) {
  const db = env.DB;
  const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<Record<string, unknown>>();
  if (!room) return null;
  const me = await db.prepare("SELECT id FROM players WHERE room_id = ? AND token = ?").bind(room.id, token).first<{ id: string }>();
  if (!me) throw new Error("Your session is not valid for this room.");
  const players = await db.prepare("SELECT id, name, is_host AS isHost, sips, joined_at AS joinedAt FROM players WHERE room_id = ? ORDER BY joined_at ASC").bind(room.id).all();
  const activeRound = await db.prepare(
    `SELECT r.id, r.round_number AS roundNumber, r.author_id AS authorId,
      p.name AS authorName, r.prompt, r.statement_one AS statementOne,
      r.statement_two AS statementTwo, r.statement_three AS statementThree,
      r.guessed_index AS guessedIndex, r.guesser_id AS guesserId, r.result,
      CASE WHEN r.result IS NOT NULL THEN r.truth_index ELSE NULL END AS truthIndex
     FROM rounds r JOIN players p ON p.id = r.author_id
     WHERE r.room_id = ? AND r.round_number = ? LIMIT 1`
  ).bind(room.id, room.current_round).first();
  return {
    room: {
      id: room.id, code: room.code, status: room.status,
      roundCount: room.round_count, currentRound: room.current_round,
      groupSipEvery: room.group_sip_every, timerMinutes: room.timer_minutes,
      startedAt: room.started_at,
    },
    players: players.results, activeRound, meId: me.id,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = (url.searchParams.get("code") ?? "").toUpperCase();
    const token = url.searchParams.get("token") ?? "";
    const state = await roomState(code, token);
    if (!state) return Response.json({ error: "Room not found." }, { status: 404 });
    return Response.json(state);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Payload;
    const db = env.DB;
    if (payload.action === "create") {
      const name = cleanName(payload.name);
      if (!name) return Response.json({ error: "Enter your name." }, { status: 400 });
      const roomId = makeId(); const playerId = makeId(); const token = makeId();
      let code = roomCode();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!(await db.prepare("SELECT 1 FROM rooms WHERE code = ?").bind(code).first())) break;
        code = roomCode();
      }
      await db.batch([
        db.prepare("INSERT INTO rooms (id, code) VALUES (?, ?)").bind(roomId, code),
        db.prepare("INSERT INTO players (id, room_id, name, token, is_host) VALUES (?, ?, ?, ?, 1)").bind(playerId, roomId, name, token),
      ]);
      return Response.json({ code, token }, { status: 201 });
    }
    if (payload.action === "join") {
      const code = payload.code?.trim().toUpperCase() ?? ""; const name = cleanName(payload.name);
      const room = await db.prepare("SELECT id, status FROM rooms WHERE code = ?").bind(code).first<{ id: string; status: string }>();
      if (!room) return Response.json({ error: "That room does not exist." }, { status: 404 });
      if (room.status !== "lobby") return Response.json({ error: "The game has already started." }, { status: 409 });
      if (!name) return Response.json({ error: "Enter your name." }, { status: 400 });
      const count = await db.prepare("SELECT COUNT(*) AS total FROM players WHERE room_id = ?").bind(room.id).first<{ total: number }>();
      if ((count?.total ?? 0) >= 8) return Response.json({ error: "The room is full." }, { status: 409 });
      const token = makeId();
      await db.prepare("INSERT INTO players (id, room_id, name, token) VALUES (?, ?, ?, ?)").bind(makeId(), room.id, name, token).run();
      return Response.json({ code, token }, { status: 201 });
    }

    const code = payload.code?.trim().toUpperCase() ?? ""; const token = payload.token ?? "";
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<Record<string, any>>();
    if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
    const me = await db.prepare("SELECT * FROM players WHERE room_id = ? AND token = ?").bind(room.id, token).first<Record<string, any>>();
    if (!me) return Response.json({ error: "Invalid session." }, { status: 401 });

    if (payload.action === "configure") {
      if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can change the room settings.");
      const roundCount = [10, 20, 30].includes(payload.roundCount ?? 0) ? payload.roundCount : 10;
      const groupSipEvery = [3, 5].includes(payload.groupSipEvery ?? 0) ? payload.groupSipEvery : null;
      const timerMinutes = [10, 15].includes(payload.timerMinutes ?? 0) ? payload.timerMinutes : null;
      await db.prepare("UPDATE rooms SET round_count = ?, group_sip_every = ?, timer_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(roundCount, groupSipEvery, timerMinutes, room.id).run();
    }
    if (payload.action === "start") {
      if (!me.is_host || room.status !== "lobby") throw new Error("Only the host can start the game.");
      const count = await db.prepare("SELECT COUNT(*) AS total FROM players WHERE room_id = ?").bind(room.id).first<{ total: number }>();
      if ((count?.total ?? 0) < 2) throw new Error("Wait for at least one more player.");
      await db.prepare("UPDATE rooms SET status = 'playing', current_round = 1, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(room.id).run();
    }
    if (payload.action === "submit") {
      if (room.status !== "playing") throw new Error("The game is not in progress.");
      const playerList = await db.prepare("SELECT id FROM players WHERE room_id = ? ORDER BY joined_at ASC").bind(room.id).all<{ id: string }>();
      const author = playerList.results[(Number(room.current_round) - 1) % playerList.results.length];
      if (author?.id !== me.id) throw new Error("It is not your turn yet.");
      if (await db.prepare("SELECT id FROM rounds WHERE room_id = ? AND round_number = ?").bind(room.id, room.current_round).first()) throw new Error("This round's stories have already been submitted.");
      const statements = payload.statements?.map((item) => item.trim().slice(0, 180)) ?? [];
      if (statements.length !== 3 || statements.some((item) => !item)) throw new Error("Fill in all three stories.");
      if (![0, 1, 2].includes(payload.truthIndex ?? -1)) throw new Error("Mark which story is true.");
      await db.prepare("INSERT INTO rounds (id, room_id, round_number, author_id, prompt, statement_one, statement_two, statement_three, truth_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(makeId(), room.id, room.current_round, me.id, (payload.prompt ?? "Anything goes").slice(0, 100), statements[0], statements[1], statements[2], payload.truthIndex).run();
    }
    if (payload.action === "guess") {
      const round = await db.prepare("SELECT * FROM rounds WHERE room_id = ? AND round_number = ?").bind(room.id, room.current_round).first<Record<string, any>>();
      if (!round || round.result) throw new Error("There is no guess available.");
      if (round.author_id === me.id) throw new Error("You cannot guess your own story.");
      if (![0, 1, 2].includes(payload.guessedIndex ?? -1)) throw new Error("Choose a story.");
      const correct = Number(payload.guessedIndex) === Number(round.truth_index);
      const drinkerId = correct ? round.author_id : me.id;
      const nextRound = Number(room.current_round) + 1; const finished = nextRound > Number(room.round_count);
      await db.batch([
        db.prepare("UPDATE rounds SET guessed_index = ?, guesser_id = ?, result = ?, revealed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.guessedIndex, me.id, correct ? "correct" : "wrong", round.id),
        db.prepare("UPDATE players SET sips = sips + 1 WHERE id = ?").bind(drinkerId),
        db.prepare("UPDATE rooms SET current_round = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(finished ? room.current_round : nextRound, finished ? "finished" : "playing", room.id),
      ]);
      return Response.json({ ...(await roomState(code, token)), reveal: { correct, truthIndex: round.truth_index, drinkerId, roundNumber: room.current_round } });
    }
    return Response.json(await roomState(code, token));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400 });
  }
}
