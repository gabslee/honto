import type { NeonQueryFunction } from "@neondatabase/serverless";
import { localDay } from "../app/daily-card.js";
import { daysUntil, summarizeMoment, validReunionDate } from "../app/couple-history.js";
import { ensureDailySchema } from "./daily-card";

type Sql = NeonQueryFunction<false, false>;
const parse = (value: unknown) => { try { return typeof value === "string" ? JSON.parse(value) : (value ?? {}); } catch { return {}; } };

export async function ensureCoupleSchema(sql: Sql) {
  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS reunion_date text`;
  await sql`CREATE TABLE IF NOT EXISTS couple_moments (card_id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, type text NOT NULL, prompt text NOT NULL, answer text, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_couple_moments_room ON couple_moments(room_id, created_at DESC)`;
}

/** Copy completed 2-player game cards into the couple history (idempotent). Called before decks are reset. */
export async function snapshotMoments(sql: Sql, room: { id: string; multiplayer?: boolean }) {
  if (room.multiplayer) return;
  await ensureCoupleSchema(sql);
  const rows = await sql`SELECT c.id, c.type, c.payload, c.result, c.secret, c.completed_at AS "completedAt", a.name AS "actorName", t.name AS "targetName" FROM deck_cards c JOIN players a ON a.id = c.actor_id JOIN players t ON t.id = c.target_id WHERE c.room_id = ${room.id} AND c.status = 'complete'`;
  for (const row of rows as any[]) {
    const summary = summarizeMoment({ type: row.type, payload: parse(row.payload), result: parse(row.result), secret: parse(row.secret), actorName: row.actorName, targetName: row.targetName });
    if (!summary || !summary.prompt) continue;
    await sql`INSERT INTO couple_moments (card_id, room_id, type, prompt, answer, created_at) VALUES (${row.id}, ${room.id}, ${row.type}, ${summary.prompt.slice(0, 600)}, ${summary.answer ? String(summary.answer).slice(0, 600) : null}, ${row.completedAt ?? new Date().toISOString()}) ON CONFLICT DO NOTHING`;
  }
}

export async function handleHistory(sql: Sql, room: any, me: any, body: Record<string, any>) {
  if (room.multiplayer) throw new Error("Couple history is for two-player rooms.");
  await ensureCoupleSchema(sql);
  await ensureDailySchema(sql);
  if (body.action === "setReunion") {
    const value = body.reunionDate === null || body.reunionDate === "" ? null : String(body.reunionDate ?? "");
    if (!validReunionDate(value)) throw new Error("Choose a valid date.");
    await sql`UPDATE rooms SET reunion_date = ${value} WHERE id = ${room.id}`;
    room.reunion_date = value;
  }
  await snapshotMoments(sql, room);
  const today = localDay(String(body.timeZone ?? "UTC"));
  const moments = await sql`SELECT type, prompt, answer, created_at AS "at" FROM couple_moments WHERE room_id = ${room.id} ORDER BY created_at DESC LIMIT 60`;
  // Only revealed daily cards (both partners answered) are part of the shared history.
  const daily = await sql`SELECT a.day, a.slot, c.deck, c.card_index AS "index", json_agg(json_build_object('name', p.name, 'answer', a.answer, 'mine', p.id = ${me.id}) ORDER BY p.joined_at) AS answers FROM daily_answers a JOIN players p ON p.id = a.player_id JOIN daily_cards c ON c.room_id = a.room_id AND c.day = a.day AND c.slot = a.slot WHERE a.room_id = ${room.id} GROUP BY a.day, a.slot, c.deck, c.card_index HAVING count(*) >= 2 ORDER BY a.day DESC, a.slot LIMIT 60`;
  const reunionDate = room.reunion_date ?? null;
  return { history: { reunionDate, daysUntilReunion: daysUntil(reunionDate, today), today, moments, daily } };
}
