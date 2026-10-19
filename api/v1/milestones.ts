import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { CoupleStreak, Milestone, MilestoneList, MilestoneType } from "../../contracts/honto-api";
import { database } from "../../app/server-auth";
import { apiError, noStore, requireCouple, type V1Couple, type V1Partner, type V1User } from "./context";
import { ensureLifecycleSchema, optionalTables, randomId } from "./lifecycle";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;
type Paired = { user: V1User; couple: V1Couple; partner: V1Partner };

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
/** Streak lengths that are celebrated (once per couple each). */
export const STREAK_MILESTONES = [7, 30, 100] as const;
/** "100 days together" (days since `couples.started_on`). */
export const DAYS_TOGETHER_MILESTONE = 100;
const MILESTONE_TYPES: MilestoneType[] = ["first_photo", "days_together", "anniversary", "reunion", "streak"];
let ready: Promise<void> | null = null;

/**
 * Idempotent schema for streaks and milestones (mirrors drizzle/0013_streak_milestones.sql), on top of the
 * W1b lifecycle schema. The streak itself is computed from `couple_photos` on every read; only the best
 * streak is kept (so it survives deleted photos). Milestones are recorded once per couple
 * (`UNIQUE (couple_id, type, dedupe_key)`); `seenAt` is per user.
 */
export function ensureMilestonesSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureLifecycleSchema(sql);
    await sql`CREATE TABLE IF NOT EXISTS couple_streaks (couple_id text PRIMARY KEY REFERENCES couples(id) ON DELETE CASCADE, best integer NOT NULL DEFAULT 0, best_ended_on date, updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS couple_milestones (id text PRIMARY KEY, couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, type text NOT NULL CHECK (type IN ('first_photo', 'days_together', 'anniversary', 'reunion', 'streak')), dedupe_key text NOT NULL, value integer, local_day date NOT NULL, achieved_at timestamptz NOT NULL DEFAULT now(), UNIQUE (couple_id, type, dedupe_key))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_milestones_day ON couple_milestones(couple_id, local_day)`;
    await sql`CREATE TABLE IF NOT EXISTS couple_milestone_seen (milestone_id text NOT NULL REFERENCES couple_milestones(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (milestone_id, user_id))`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

// ---------------------------------------------------------------------------------------------------
// Days (local days are compared as `YYYY-MM-DD` keys, never converted between zones)
// ---------------------------------------------------------------------------------------------------

/** `YYYY-MM-DD` of `at` in `timeZone` (same as api/v1/couple.ts `localDay`). */
export function dayIn(timeZone: string | null, at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Same month/day `years` later; Feb 29 falls on Feb 28 in non-leap years. */
export function addYears(day: string, years: number) {
  const [y, m, d] = day.split("-").map(Number);
  const year = y + years;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------------------------------

/** Days (ascending) on which both members have at least one ready photo on that local day. */
export function completeDays(rows: { author: string; day: string }[], members: [string, string]) {
  const byDay = new Map<string, Set<string>>();
  for (const { author, day } of rows) {
    if (!members.includes(author)) continue;
    byDay.set(day, (byDay.get(day) ?? new Set()).add(author));
  }
  return [...byDay].filter(([, authors]) => authors.size === 2).map(([day]) => day).sort();
}

/**
 * `openDay` is the earliest of both members' current local days: the most recent day that is not over
 * for both of us yet. A day only breaks the streak once it is before `openDay`, so the partner who is a
 * day ahead never sees a reset while the other can still post. `current` ends at the most recent complete
 * day if that day is `openDay - 1` or later (a photo dated one day ahead by a device clock still counts).
 */
export function computeStreak(days: string[], openDay: string) {
  let best = 0;
  let bestEndedOn: string | null = null;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    if (run > best) { best = run; bestEndedOn = day; }
    previous = day;
  }
  const last = days.at(-1) ?? null;
  const current = last && last >= addDays(openDay, -1) ? run : 0;
  return { current, best, bestEndedOn, lastCompleteDay: last };
}

/** First day on which a run of `length` consecutive complete days was reached, or null. */
export function dayStreakReached(days: string[], length: number) {
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    if (run === length) return day;
    previous = day;
  }
  return null;
}

type PhotoDays = { rows: { author: string; day: string }[]; firstDay: string | null };

async function photoDays(sql: Sql, coupleId: string, members: [string, string]): Promise<PhotoDays> {
  const rows = (await sql`SELECT author_user_id AS author, to_char(local_day, 'YYYY-MM-DD') AS day FROM couple_photos
    WHERE couple_id = ${coupleId} AND status = 'ready' AND delete_after IS NULL AND local_day IS NOT NULL AND author_user_id IN (${members[0]}, ${members[1]})
    GROUP BY author_user_id, local_day`).map((row) => ({ author: String(row.author), day: String(row.day) }));
  const firstDay = rows.reduce<string | null>((min, row) => (min === null || row.day < min ? row.day : min), null);
  return { rows, firstDay };
}

type StreakState = { streak: CoupleStreak; days: string[]; firstDay: string | null };

/** The couple streak as seen by `user` at `now` (each person's day in their own zone, as in /today). */
export async function coupleStreak(sql: Sql, { user, couple, partner }: Paired, now: Date, photosReady: boolean): Promise<StreakState> {
  const myDay = dayIn(user.timeZone ?? "UTC", now);
  const partnerDay = partner.timeZone ? dayIn(partner.timeZone, now) : null;
  const photos = photosReady ? await photoDays(sql, couple.id, [user.id, partner.id]) : { rows: [], firstDay: null };
  const days = completeDays(photos.rows, [user.id, partner.id]);
  const openDay = partnerDay && partnerDay < myDay ? partnerDay : myDay;
  const computed = computeStreak(days, openDay);
  const stored = (await sql`SELECT best FROM couple_streaks WHERE couple_id = ${couple.id}`)[0];
  const storedBest = stored ? Number(stored.best) : 0;
  if (computed.best > storedBest) {
    await sql`INSERT INTO couple_streaks (couple_id, best, best_ended_on, updated_at) VALUES (${couple.id}, ${computed.best}, ${computed.bestEndedOn}::date, now())
      ON CONFLICT (couple_id) DO UPDATE SET best = EXCLUDED.best, best_ended_on = EXCLUDED.best_ended_on, updated_at = now() WHERE couple_streaks.best < EXCLUDED.best`;
  }
  const meDoneToday = photos.rows.some((row) => row.author === user.id && row.day === myDay);
  const partnerDoneToday = Boolean(partnerDay) && photos.rows.some((row) => row.author === partner.id && row.day === partnerDay);
  return {
    streak: { current: computed.current, best: Math.max(computed.best, storedBest), todayComplete: meDoneToday && partnerDoneToday, meDoneToday, partnerDoneToday, lastCompleteDay: computed.lastCompleteDay },
    days,
    firstDay: photos.firstDay,
  };
}

// ---------------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------------
export type MilestoneCandidate = { type: MilestoneType; key: string; value: number | null; localDay: string };

/**
 * Milestones reached by `today` (my local day). Date milestones (100 days together, anniversaries, reunion
 * day) only count from `pairedDay` on, so a couple together for years does not get a burst of past
 * anniversaries when they start using the app. Photo milestones (first photo, streaks) are always after pairing.
 */
export function milestoneCandidates(input: { today: string; pairedDay: string; startedOn: string | null; reunionDay: string | null; firstPhotoDay: string | null; completeDays: string[] }): MilestoneCandidate[] {
  const { today, pairedDay, startedOn, reunionDay, firstPhotoDay } = input;
  const inWindow = (day: string) => day >= pairedDay && day <= today;
  const out: MilestoneCandidate[] = [];
  if (firstPhotoDay && firstPhotoDay <= addDays(today, 1)) out.push({ type: "first_photo", key: "first", value: null, localDay: firstPhotoDay });
  if (startedOn) {
    const hundred = addDays(startedOn, DAYS_TOGETHER_MILESTONE);
    if (inWindow(hundred)) out.push({ type: "days_together", key: String(DAYS_TOGETHER_MILESTONE), value: DAYS_TOGETHER_MILESTONE, localDay: hundred });
    for (let years = 1; years <= 150; years++) {
      const day = addYears(startedOn, years);
      if (day > today) break;
      if (day >= pairedDay) out.push({ type: "anniversary", key: String(years), value: years, localDay: day });
    }
  }
  if (reunionDay && inWindow(reunionDay)) out.push({ type: "reunion", key: reunionDay, value: null, localDay: reunionDay });
  for (const length of STREAK_MILESTONES) {
    const day = dayStreakReached(input.completeDays, length);
    if (day) out.push({ type: "streak", key: String(length), value: length, localDay: day });
  }
  return out;
}

/** Records the milestones reached so far (each once per couple; concurrent readers are safe). */
export async function detectMilestones(sql: Sql, { user, couple }: Paired, now: Date, state: StreakState) {
  const zone = user.timeZone ?? "UTC";
  const candidates = milestoneCandidates({
    today: dayIn(zone, now),
    pairedDay: dayIn(zone, new Date(couple.pairedAt)),
    startedOn: couple.startedOn,
    reunionDay: couple.reunionAt ? dayIn(zone, new Date(couple.reunionAt)) : null,
    firstPhotoDay: state.firstDay,
    completeDays: state.days,
  });
  if (!candidates.length) return;
  const existing = new Set((await sql`SELECT type, dedupe_key AS key FROM couple_milestones WHERE couple_id = ${couple.id}`).map((row) => `${row.type}:${row.key}`));
  for (const candidate of candidates) {
    if (existing.has(`${candidate.type}:${candidate.key}`)) continue;
    await sql`INSERT INTO couple_milestones (id, couple_id, type, dedupe_key, value, local_day, achieved_at) VALUES (${randomId("ms_")}, ${couple.id}, ${candidate.type}, ${candidate.key}, ${candidate.value}::int, ${candidate.localDay}::date, ${now.toISOString()}::timestamptz)
      ON CONFLICT (couple_id, type, dedupe_key) DO NOTHING`;
  }
}

function toMilestone(row: Row): Milestone {
  const type = MILESTONE_TYPES.includes(row.type as MilestoneType) ? row.type as MilestoneType : "first_photo";
  return { id: String(row.id), type, value: row.value === null || row.value === undefined ? null : Number(row.value), localDay: String(row.localDay), achievedAt: String(row.achievedAt), seenAt: (row.seenAt as string | null) ?? null };
}

/** Milestones of the couple with my `seenAt`, ascending by day. */
export async function listMilestones(sql: Sql, coupleId: string, userId: string, onlyUnseen = false): Promise<Milestone[]> {
  const rows = await sql`SELECT m.id, m.type, m.value, to_char(m.local_day, 'YYYY-MM-DD') AS "localDay", to_char(m.achieved_at AT TIME ZONE 'UTC', ${ISO}) AS "achievedAt", to_char(s.seen_at AT TIME ZONE 'UTC', ${ISO}) AS "seenAt"
    FROM couple_milestones m LEFT JOIN couple_milestone_seen s ON s.milestone_id = m.id AND s.user_id = ${userId}
    WHERE m.couple_id = ${coupleId} AND (NOT ${onlyUnseen}::boolean OR s.seen_at IS NULL)
    ORDER BY m.local_day, m.achieved_at, m.id`;
  return rows.map(toMilestone);
}

/**
 * Streak + detection + my unseen milestones, for GET /api/v1/today. Never takes /today down: a failure
 * here is logged and the fields fall back to an empty streak and no milestones.
 */
export async function todayMilestones(sql: Sql, paired: Paired, now: Date): Promise<{ streak: CoupleStreak; unseenMilestones: Milestone[] }> {
  try {
    await ensureMilestonesSchema(sql);
    const state = await coupleStreak(sql, paired, now, (await optionalTables(sql)).photos);
    await detectMilestones(sql, paired, now, state);
    return { streak: state.streak, unseenMilestones: await listMilestones(sql, paired.couple.id, paired.user.id, true) };
  } catch (cause) {
    console.error("[v1/milestones] streak/milestones failed", cause);
    return { streak: { current: 0, best: 0, todayComplete: false, meDoneToday: false, partnerDoneToday: false, lastCompleteDay: null }, unseenMilestones: [] };
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** GET /api/v1/milestones[?unseen=true] */
export async function listMilestonesResponse(request: Request, now = new Date()) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const unseen = new URL(request.url).searchParams.get("unseen");
  if (unseen !== null && unseen !== "true" && unseen !== "false") return apiError(400, "bad_request", "unseen must be true or false.");
  const sql = database()!;
  await ensureMilestonesSchema(sql);
  const state = await coupleStreak(sql, auth, now, (await optionalTables(sql)).photos);
  await detectMilestones(sql, auth, now, state);
  const body: MilestoneList = { milestones: await listMilestones(sql, auth.couple.id, auth.user.id, unseen === "true") };
  return json(body);
}

/** POST /api/v1/milestones/{milestoneId}/seen: idempotent, keeps the first seenAt. 404 outside my couple. */
export async function markMilestoneSeenResponse(request: Request, milestoneId: string) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const sql = database()!;
  await ensureMilestonesSchema(sql);
  const found = (await sql`SELECT id FROM couple_milestones WHERE id = ${milestoneId} AND couple_id = ${auth.couple.id}`)[0];
  if (!found) return apiError(404, "not_found", "Milestone not found.");
  await sql`INSERT INTO couple_milestone_seen (milestone_id, user_id) VALUES (${milestoneId}, ${auth.user.id}) ON CONFLICT (milestone_id, user_id) DO NOTHING`;
  const milestone = (await listMilestones(sql, auth.couple.id, auth.user.id)).find((m) => m.id === milestoneId)!;
  return json(milestone);
}
