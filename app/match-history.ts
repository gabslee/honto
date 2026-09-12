import { database, ensureIdentitySchema } from "./server-auth";

let historySchemaReady: Promise<void> | null = null;

export function ensureHistorySchema() {
  const sql = database();
  if (!sql) return Promise.resolve();
  if (!historySchemaReady) historySchemaReady = (async () => {
    await ensureIdentitySchema();
    await sql`CREATE TABLE IF NOT EXISTS matches (id text PRIMARY KEY, room_id text UNIQUE NOT NULL, room_code text NOT NULL, mode text NOT NULL, player_count integer NOT NULL, card_count integer NOT NULL, started_at timestamptz, ended_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS match_players (match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE, player_id text NOT NULL, user_id text REFERENCES users(id) ON DELETE SET NULL, display_name text NOT NULL, sips integer NOT NULL DEFAULT 0, placement integer NOT NULL, is_winner boolean NOT NULL DEFAULT false, PRIMARY KEY(match_id, player_id))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id, match_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at DESC)`;
  })();
  return historySchemaReady;
}

export async function archiveFinishedMatch(roomId: string) {
  const sql = database();
  if (!sql) return;
  await ensureHistorySchema();
  const rooms = await sql`SELECT id, code, multiplayer, round_count, started_at, status, group_state FROM rooms WHERE id = ${roomId} LIMIT 1`;
  const room = rooms[0] as any;
  if (!room || room.status !== "finished") return;
  const rows = await sql`SELECT id, user_id, name, sips FROM players WHERE room_id = ${roomId} ORDER BY joined_at, id` as any[];
  if (!rows.some((player) => player.user_id)) return;
  const scores: Record<string, number> = room.multiplayer && room.group_state?.scores ? room.group_state.scores : {};
  const ranked = rows.map((player) => ({ ...player, sips: Number(scores[player.id] ?? player.sips ?? 0) })).sort((a, b) => a.sips - b.sips || a.id.localeCompare(b.id));
  const winnerScore = ranked[0]?.sips ?? 0;
  const matchId = crypto.randomUUID();
  const inserted = await sql`INSERT INTO matches (id, room_id, room_code, mode, player_count, card_count, started_at) VALUES (${matchId}, ${room.id}, ${room.code}, ${room.multiplayer ? "multiplayer" : "duo"}, ${ranked.length}, ${Number(room.round_count)}, ${room.started_at}) ON CONFLICT (room_id) DO NOTHING RETURNING id`;
  if (!inserted.length) return;
  for (const player of ranked) {
    const placement = 1 + ranked.filter((other) => other.sips < player.sips).length;
    await sql`INSERT INTO match_players (match_id, player_id, user_id, display_name, sips, placement, is_winner) VALUES (${matchId}, ${player.id}, ${player.user_id}, ${player.name}, ${player.sips}, ${placement}, ${player.sips === winnerScore})`;
  }
}

export async function historyForUser(userId: string) {
  const sql = database();
  if (!sql) return [];
  await ensureHistorySchema();
  return sql`SELECT m.id, m.room_code AS "roomCode", m.mode, m.player_count AS "playerCount", m.card_count AS "cardCount", m.started_at AS "startedAt", m.ended_at AS "endedAt", mp.sips, mp.placement, mp.is_winner AS "isWinner" FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = ${userId} ORDER BY m.ended_at DESC LIMIT 100`;
}

export async function historyMatchForUser(matchId: string, userId: string) {
  const sql = database();
  if (!sql) return null;
  await ensureHistorySchema();
  const matches = await sql`SELECT m.id, m.room_code AS "roomCode", m.mode, m.player_count AS "playerCount", m.card_count AS "cardCount", m.started_at AS "startedAt", m.ended_at AS "endedAt" FROM matches m WHERE m.id = ${matchId} AND EXISTS (SELECT 1 FROM match_players mine WHERE mine.match_id = m.id AND mine.user_id = ${userId}) LIMIT 1`;
  if (!matches[0]) return null;
  const players = await sql`SELECT display_name AS name, sips, placement, is_winner AS "isWinner", (user_id = ${userId}) AS "isMe" FROM match_players WHERE match_id = ${matchId} ORDER BY placement, display_name`;
  return { ...matches[0], players };
}
