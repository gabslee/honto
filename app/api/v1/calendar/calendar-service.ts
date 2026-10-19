import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { CalendarBlock, CalendarBusyResult, CalendarSide, CalendarView, PartnerStatus } from "../../../../contracts/honto-api";
import { normalizeTimeZone } from "../../../../api/v1/context";
import { ensureCalendarSchema } from "../../../../api/v1/calendar-schema";

type Sql = NeonQueryFunction<false, false>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Longest upload or read window. */
export const MAX_WINDOW_MS = 14 * DAY;
/** Upload `to` may reach now + 14 days, plus this much client clock skew. */
const AHEAD_SKEW_MS = HOUR;
/** Upload `from` may start this far back (start of the local day, plus skew). */
const MAX_PAST_MS = 2 * DAY;
export const MAX_BLOCKS = 500;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** Epoch ms (whole seconds) of an RFC 3339 timestamp with a `Z` or `±hh:mm` offset, or null. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string" || !RFC3339.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) * 1000 : null;
}

/** RFC 3339 UTC without fractions (`2026-10-19T12:00:00Z`), as every v1 timestamp. */
export const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export type Interval = { start: number; end: number };
export type BusyUpload = { from: number; to: number; timeZone: string; blocks: Interval[]; ignoredAllDay: number; droppedTitles: number };

/**
 * Validates a `CalendarBusyUpload`. Window: `from < to`, at most 14 days long, ending at most 14 days from
 * now and starting at most 2 days ago. Blocks: at most 500, valid `start < end`. `allDay: true` blocks are
 * rejected (counted in `ignoredAllDay`, never stored); titles are never stored yet (counted in
 * `droppedTitles`). Blocks are clipped to the window; blocks outside it are skipped.
 */
export function parseBusyUpload(body: unknown, now: number): BusyUpload | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send a JSON object." };
  const input = body as Record<string, unknown>;
  const from = parseInstant(input.from);
  const to = parseInstant(input.to);
  if (from === null || to === null || from >= to) return { error: "from and to must be RFC 3339 timestamps with from before to." };
  if (to - from > MAX_WINDOW_MS) return { error: "The window can span at most 14 days." };
  if (to > now + MAX_WINDOW_MS + AHEAD_SKEW_MS) return { error: "The window can end at most 14 days from now." };
  if (from < now - MAX_PAST_MS) return { error: "The window can start at most 2 days ago." };
  const timeZone = normalizeTimeZone(input.timeZone);
  if (!timeZone) return { error: "timeZone must be an IANA time zone id." };
  if (!Array.isArray(input.blocks)) return { error: "blocks must be an array." };
  if (input.blocks.length > MAX_BLOCKS) return { error: `Send at most ${MAX_BLOCKS} blocks.` };
  const blocks: Interval[] = [];
  let ignoredAllDay = 0;
  let droppedTitles = 0;
  for (const raw of input.blocks) {
    if (!raw || typeof raw !== "object") return { error: "Each block needs start and end." };
    const block = raw as Record<string, unknown>;
    if (block.allDay === true) {
      ignoredAllDay += 1;
      continue;
    }
    const start = parseInstant(block.start);
    const end = parseInstant(block.end);
    if (start === null || end === null || start >= end) return { error: "Each block needs RFC 3339 start and end with start before end." };
    if (typeof block.title === "string" && block.title.trim()) droppedTitles += 1;
    const clipped = { start: Math.max(start, from), end: Math.min(end, to) };
    if (clipped.start < clipped.end) blocks.push(clipped);
  }
  return { from, to, timeZone, blocks, ignoredAllDay, droppedTitles };
}

/** Parses the `from`/`to` query of `GET /api/v1/calendar` (`from < to`, at most 14 days apart). */
export function parseCalendarRange(url: URL): { from: number; to: number } | { error: string } {
  const from = parseInstant(url.searchParams.get("from"));
  const to = parseInstant(url.searchParams.get("to"));
  if (from === null || to === null || from >= to) return { error: "from and to must be RFC 3339 timestamps with from before to." };
  if (to - from > MAX_WINDOW_MS) return { error: "The window can span at most 14 days." };
  return { from, to };
}

export type SyncState = { syncedAt: number; windowFrom: number; windowTo: number };

/**
 * Partner status at `now`, from the partner's blocks (any order) and last upload:
 * - `unknown` when the partner never uploaded in this couple or `now` is outside the uploaded window;
 * - `busy` when a block covers `now`: `busyUntil` is the end of the run of overlapping or back-to-back
 *   blocks that starts there (a 9-10 and a 10-11 meeting read as busy until 11);
 * - `free` otherwise: `freeUntil` is the start of the next block inside the uploaded window, or null.
 * All instants are UTC epoch ms, so the partner's and the viewer's zones do not matter here; clients format
 * `busyUntil` in the partner's zone ("Busy until 3 PM").
 */
export function computePartnerStatus(blocks: Interval[], sync: SyncState | null, now: number): PartnerStatus {
  const syncedAt = sync ? toIso(sync.syncedAt) : null;
  const status = (state: PartnerStatus["state"], busyUntil: number | null = null, freeUntil: number | null = null): PartnerStatus =>
    ({ state, busyUntil: busyUntil === null ? null : toIso(busyUntil), freeUntil: freeUntil === null ? null : toIso(freeUntil), title: null, syncedAt });
  if (!sync || now < sync.windowFrom || now >= sync.windowTo) return status("unknown");
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  let busyUntil: number | null = null;
  for (const block of sorted) {
    if (block.start > (busyUntil ?? now)) break;
    if (block.end > (busyUntil ?? now)) busyUntil = block.end;
  }
  if (busyUntil !== null) return status("busy", busyUntil);
  const next = sorted.find((block) => block.start > now && block.start < sync.windowTo);
  return status("free", null, next?.start ?? null);
}

const ts = (value: unknown) => (typeof value === "string" ? Date.parse(value) : NaN);

/**
 * Atomically replaces the caller's blocks overlapping `[from, to)` with `upload.blocks`, in one transaction:
 * the calendar_sync upsert comes first so concurrent uploads of the same user queue on its row lock, then
 * the overlapping rows are deleted (in any couple of this user, so nothing stale survives) and the new ones
 * inserted for the current couple.
 */
export async function replaceBusyBlocks(sql: Sql, coupleId: string, userId: string, upload: BusyUpload, now: number): Promise<CalendarBusyResult> {
  await ensureCalendarSchema(sql);
  const syncedAt = toIso(now);
  const from = toIso(upload.from);
  const to = toIso(upload.to);
  const blocks = JSON.stringify(upload.blocks.map((block) => ({ s: toIso(block.start), e: toIso(block.end) })));
  await sql.transaction([
    sql`INSERT INTO calendar_sync (user_id, couple_id, window_from, window_to, time_zone, synced_at) VALUES (${userId}, ${coupleId}, ${from}::timestamptz, ${to}::timestamptz, ${upload.timeZone}, ${syncedAt}::timestamptz)
      ON CONFLICT (user_id) DO UPDATE SET couple_id = EXCLUDED.couple_id, window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to, time_zone = EXCLUDED.time_zone, synced_at = EXCLUDED.synced_at`,
    sql`DELETE FROM calendar_busy WHERE user_id = ${userId} AND starts_at < ${to}::timestamptz AND ends_at > ${from}::timestamptz`,
    sql`INSERT INTO calendar_busy (couple_id, user_id, starts_at, ends_at, synced_at) SELECT ${coupleId}, ${userId}, b.s, b.e, ${syncedAt}::timestamptz FROM jsonb_to_recordset(${blocks}::jsonb) AS b(s timestamptz, e timestamptz)`,
  ]);
  return { syncedAt, stored: upload.blocks.length, ignoredAllDay: upload.ignoredAllDay, droppedTitles: upload.droppedTitles };
}

/**
 * `CalendarView` for the couple: both members' blocks overlapping `[from, to)` (titles are always null in
 * this version) and the partner's status at `now`, which looks at the partner's upcoming blocks whatever
 * the requested window is.
 */
export async function loadCalendarView(sql: Sql, coupleId: string, meId: string, partnerId: string, range: { from: number; to: number }, now: number): Promise<CalendarView> {
  await ensureCalendarSchema(sql);
  const from = toIso(range.from);
  const to = toIso(range.to);
  const nowIso = toIso(now);
  const [sides, blocks, upcoming] = await Promise.all([
    // Zone: the device's latest (PUT /me/timezone on every open), else the one sent with the upload.
    sql`SELECT u.id, COALESCE(u.time_zone, s.time_zone) AS "timeZone", to_char(s.synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "syncedAt", to_char(s.window_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "windowFrom", to_char(s.window_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "windowTo"
      FROM users u LEFT JOIN calendar_sync s ON s.user_id = u.id AND s.couple_id = ${coupleId} WHERE u.id = ${meId} OR u.id = ${partnerId}`,
    sql`SELECT user_id AS "userId", to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start, to_char(ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "end"
      FROM calendar_busy WHERE couple_id = ${coupleId} AND (user_id = ${meId} OR user_id = ${partnerId}) AND starts_at < ${to}::timestamptz AND ends_at > ${from}::timestamptz ORDER BY starts_at, ends_at`,
    sql`SELECT to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start, to_char(ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "end"
      FROM calendar_busy WHERE couple_id = ${coupleId} AND user_id = ${partnerId} AND ends_at > ${nowIso}::timestamptz ORDER BY starts_at, ends_at LIMIT ${MAX_BLOCKS * 2}`,
  ]);
  const side = (userId: string): CalendarSide => {
    const row = sides.find((candidate) => candidate.id === userId);
    const list: CalendarBlock[] = blocks.filter((block) => block.userId === userId).map((block) => ({ start: block.start, end: block.end, title: null }));
    return { timeZone: row?.timeZone ?? null, syncedAt: row?.syncedAt ?? null, blocks: list };
  };
  const partnerSync = sides.find((row) => row.id === partnerId);
  const sync = partnerSync?.syncedAt ? { syncedAt: ts(partnerSync.syncedAt), windowFrom: ts(partnerSync.windowFrom), windowTo: ts(partnerSync.windowTo) } : null;
  const partnerStatus = computePartnerStatus(upcoming.map((block) => ({ start: ts(block.start), end: ts(block.end) })), sync, now);
  return { from, to, me: side(meId), partner: side(partnerId), partnerStatus };
}
