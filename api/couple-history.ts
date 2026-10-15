import type { NeonQueryFunction } from "@neondatabase/serverless";
import { localDay } from "../app/daily-card.js";
import { daysUntil, summarizeMoment, validReunionDate } from "../app/couple-history.js";
import { roleFor } from "../app/couple-identity.js";
import { ensureCoupleSchema, resolveCouple } from "./couple";
import { dailyCardText } from "./daily-card";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, any>;
const parse = (value: unknown) => { try { return typeof value === "string" ? JSON.parse(value) : (value ?? {}); } catch { return {}; } };

/** Copy completed 2-player game cards into the couple history (idempotent). Called before decks are reset. */
export async function snapshotMoments(sql: Sql, room: Row) {
  if (room.multiplayer) return;
  const couple = await resolveCouple(sql, room);
  const rows = await sql`SELECT c.id, c.type, c.payload, c.result, c.secret, c.completed_at AS "completedAt", a.name AS "actorName", t.name AS "targetName" FROM deck_cards c JOIN players a ON a.id = c.actor_id JOIN players t ON t.id = c.target_id WHERE c.room_id = ${room.id} AND c.status = 'complete'`;
  for (const row of rows as Row[]) {
    const summary = summarizeMoment({ type: row.type, payload: parse(row.payload), result: parse(row.result), secret: parse(row.secret), actorName: row.actorName, targetName: row.targetName });
    if (!summary || !summary.prompt) continue;
    await sql`INSERT INTO couple_moments (card_id, room_id, couple_id, type, prompt, answer, created_at) VALUES (${row.id}, ${room.id}, ${couple.id}, ${row.type}, ${summary.prompt.slice(0, 600)}, ${summary.answer ? String(summary.answer).slice(0, 600) : null}, ${row.completedAt ?? new Date().toISOString()}) ON CONFLICT DO NOTHING`;
  }
}

export async function historyState(sql: Sql, room: Row, me: Row, timeZone: string) {
  const couple = await resolveCouple(sql, room);
  const today = localDay(timeZone);
  const moments = await sql`SELECT type, prompt, answer, created_at AS "at" FROM couple_moments WHERE couple_id = ${couple.id} ORDER BY created_at DESC LIMIT 60`;
  // Only revealed daily cards (both partners answered) are part of the shared history.
  const rows = await sql`SELECT a.day, a.slot, c.deck, c.card_index AS "index", json_agg(json_build_object('name', a.author_name, 'answer', a.answer, 'role', a.role) ORDER BY a.role) AS answers FROM daily_answers a JOIN daily_cards c ON c.couple_id = a.couple_id AND c.day = a.day AND c.slot = a.slot WHERE a.couple_id = ${couple.id} GROUP BY a.day, a.slot, c.deck, c.card_index HAVING count(*) >= 2 ORDER BY a.day DESC, a.slot LIMIT 60`;
  const myRole = roleFor(me);
  const daily = (rows as Row[]).map((row) => ({ day: row.day, slot: row.slot, deck: row.deck, index: row.index, text: dailyCardText(row.deck, row.index), answers: (typeof row.answers === "string" ? JSON.parse(row.answers) : row.answers).map((answer: Row) => ({ name: answer.name, answer: answer.answer, mine: answer.role === myRole })) }));
  return { history: { coupleId: couple.id, reunionDate: couple.reunionDate, daysUntilReunion: daysUntil(couple.reunionDate, today), today, moments, daily } };
}

export async function handleHistory(sql: Sql, room: Row, me: Row, body: Row) {
  if (room.multiplayer) throw new Error("Couple history is for two-player rooms.");
  await ensureCoupleSchema(sql);
  if (body.action === "setReunion") {
    const value = body.reunionDate === null || body.reunionDate === "" ? null : String(body.reunionDate ?? "");
    if (!validReunionDate(value)) throw new Error("Choose a valid date.");
    const couple = await resolveCouple(sql, room);
    await sql`UPDATE couples SET reunion_date = ${value}, updated_at = now() WHERE id = ${couple.id}`;
  }
  await snapshotMoments(sql, room);
  return historyState(sql, room, me, String(body.timeZone ?? "UTC"));
}
