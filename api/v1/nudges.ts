// "Thinking of you" (Free): POST /api/v1/nudges. One tap on the widget (App Intent) or in the app sends the
// partner a short alert and refreshes their widgets. Rate limit: 1 per 60 s and 30 per rolling 24 h per user.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { NudgeResult, NudgeSource } from "../../contracts/honto-api";
import { notifyPartner, type NotifySummary, type PushEvent } from "../../app/push/index";
import { database } from "../../app/server-auth";
import { apiError, noStore, requireCouple } from "./context";
import { ensureLifecycleSchema, randomId } from "./lifecycle";

type Sql = NeonQueryFunction<false, false>;

export const NUDGE_INTERVAL_SECONDS = 60;
export const NUDGES_PER_DAY = 30;
const SOURCES: NudgeSource[] = ["widget", "app"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

let ready: Promise<void> | null = null;

/** Idempotent schema (mirrors drizzle/0014_weather_nudges.sql and the W2b plan in drizzle/proposed). */
export function ensureNudgesSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureLifecycleSchema(sql);
    await sql`CREATE TABLE IF NOT EXISTS couple_nudges (id text PRIMARY KEY, couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, from_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, to_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, source text NOT NULL CHECK (source IN ('widget', 'app')), client_id text, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_nudges_from ON couple_nudges(from_user_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_nudges_to ON couple_nudges(to_user_id, created_at DESC)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_nudges_client ON couple_nudges(from_user_id, client_id) WHERE client_id IS NOT NULL`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

/** Seconds until `userId` may send again at `now` (0 = allowed), from their own recent nudges. */
export async function nudgeWait(sql: Sql, userId: string, now: Date): Promise<number> {
  const nowIso = now.toISOString();
  const row = (await sql`SELECT max(created_at) AS "last", count(*)::int AS "dayCount", min(created_at) AS "oldest"
    FROM couple_nudges WHERE from_user_id = ${userId} AND created_at > ${nowIso}::timestamptz - interval '24 hours'`)[0] ?? {};
  const at = (value: unknown) => (value instanceof Date ? value.getTime() : Date.parse(String(value)));
  const waits = [0];
  if (row.last) waits.push(Math.ceil((at(row.last) + NUDGE_INTERVAL_SECONDS * 1000 - now.getTime()) / 1000));
  if (Number(row.dayCount) >= NUDGES_PER_DAY && row.oldest) waits.push(Math.ceil((at(row.oldest) + 86_400_000 - now.getTime()) / 1000));
  return Math.max(...waits);
}

type Send = (coupleId: string, fromUserId: string, event: PushEvent) => Promise<NotifySummary>;

/** POST /api/v1/nudges. Idempotent per `clientId` (widget retries get the first result back). */
export async function sendNudgeResponse(request: Request, options: { now?: Date; send?: Send } = {}) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "bad_request", "Send a JSON object.");
  if (typeof body.source !== "string" || !SOURCES.includes(body.source as NudgeSource)) return apiError(400, "bad_request", "source must be widget or app.");
  if (body.clientId !== undefined && body.clientId !== null && (typeof body.clientId !== "string" || !UUID.test(body.clientId))) return apiError(400, "bad_request", "clientId must be a UUID.");
  const clientId = typeof body.clientId === "string" ? body.clientId.toLowerCase() : null;
  const now = options.now ?? new Date();
  const { user, couple, partner } = auth;
  const sql = database()!;
  await ensureNudgesSchema(sql);

  const result = (row: Record<string, unknown>): NudgeResult => ({ id: String(row.id), createdAt: String(row.createdAt), nextAllowedAt: toIso(Date.parse(String(row.createdAt)) + NUDGE_INTERVAL_SECONDS * 1000) });
  if (clientId) {
    const existing = (await sql`SELECT id, to_char(created_at AT TIME ZONE 'UTC', ${ISO}) AS "createdAt" FROM couple_nudges WHERE from_user_id = ${user.id} AND client_id = ${clientId}`)[0];
    if (existing) return Response.json(result(existing), { status: 201, headers: noStore });
  }
  const wait = await nudgeWait(sql, user.id, now);
  if (wait > 0) return apiError(429, "rate_limited", "You just sent one. Try again in a moment.", { "Retry-After": String(wait) });

  const id = randomId("ndg_");
  const rows = await sql`INSERT INTO couple_nudges (id, couple_id, from_user_id, to_user_id, source, client_id, created_at) VALUES (${id}, ${couple.id}, ${user.id}, ${partner.id}, ${body.source}, ${clientId}, ${now.toISOString()}::timestamptz)
    ON CONFLICT (from_user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
    RETURNING id, to_char(created_at AT TIME ZONE 'UTC', ${ISO}) AS "createdAt"`;
  if (!rows.length) {
    // A concurrent retry with the same clientId won the insert.
    const existing = (await sql`SELECT id, to_char(created_at AT TIME ZONE 'UTC', ${ISO}) AS "createdAt" FROM couple_nudges WHERE from_user_id = ${user.id} AND client_id = ${clientId}`)[0];
    return Response.json(result(existing), { status: 201, headers: noStore });
  }
  await (options.send ?? notifyPartner)(couple.id, user.id, { type: "nudge.new", nudgeId: id, fromName: user.displayName });
  return Response.json(result(rows[0]), { status: 201, headers: noStore });
}
