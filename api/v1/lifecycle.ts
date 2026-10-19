import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { CronRetentionResult, ExportStatus, UnpairResult, UnpairState } from "../../contracts/honto-api";
import { ensureFoundationSchema } from "./foundation-schema";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;
let ready: Promise<void> | null = null;

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
/** Days a partner keeps their own photos (read-only, exportable) after unpairing. */
export const UNPAIR_GRACE_DAYS = 30;
/** Export ZIPs stay in `exports/` this long; the signed GET is valid 24h (renewed on every status read). */
export const EXPORT_KEEP_DAYS = 7;
export const EXPORT_URL_SECONDS = 24 * 60 * 60;

/**
 * Idempotent W1b schema (mirrors drizzle/0012_couple_lifecycle.sql) on top of the W1a foundation:
 * email magic-link tokens, fixed-window rate limits, photo exports (same definition as the W2a plan, so
 * whichever runs first creates it) and the object-storage deletion queue.
 */
export function ensureLifecycleSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureFoundationSchema(sql);
    // One open pairing code per user (a new code revokes the previous one; replaced duplicates are revoked first).
    await sql`UPDATE couple_invites i SET revoked_at = now() WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND EXISTS (SELECT 1 FROM couple_invites n WHERE n.created_by = i.created_by AND n.used_at IS NULL AND n.revoked_at IS NULL AND (n.created_at, n.code) > (i.created_at, i.code))`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_invites_open ON couple_invites(created_by) WHERE used_at IS NULL AND revoked_at IS NULL`;
    await sql`CREATE TABLE IF NOT EXISTS email_login_tokens (token_hash text PRIMARY KEY, email text NOT NULL, code_hash text NOT NULL, platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')), attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_email_login_tokens_email ON email_login_tokens(email, created_at DESC)`;
    // Rotating refresh tokens for the apps (hm_r_, single use). A family is one sign-in and all its rotations.
    await sql`CREATE TABLE IF NOT EXISTS v1_refresh_tokens (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, family_id text NOT NULL, platform text NOT NULL CHECK (platform IN ('ios', 'android')), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz)`;
    // Hash of the hm_u_ access token issued with each refresh token, so logout can end that chain.
    await sql`ALTER TABLE v1_refresh_tokens ADD COLUMN IF NOT EXISTS access_hash text`;
    await sql`CREATE INDEX IF NOT EXISTS idx_v1_refresh_tokens_family ON v1_refresh_tokens(family_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_v1_refresh_tokens_access ON v1_refresh_tokens(access_hash) WHERE access_hash IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_v1_refresh_tokens_user ON v1_refresh_tokens(user_id)`;
    await sql`CREATE TABLE IF NOT EXISTS v1_rate_limits (scope text NOT NULL, subject text NOT NULL, window_start timestamptz NOT NULL, hits integer NOT NULL DEFAULT 0, PRIMARY KEY (scope, subject, window_start))`;
    await sql`CREATE TABLE IF NOT EXISTS photo_exports (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')), object_key text, photo_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, expires_at timestamptz)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_photo_exports_user ON photo_exports(user_id, created_at DESC)`;
    // Keys whose rows are already gone; the retention cron deletes the objects (the bucket has no lifecycle rules).
    await sql`CREATE TABLE IF NOT EXISTS storage_deletions (object_key text PRIMARY KEY, reason text NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, last_error text)`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

// ---------------------------------------------------------------------------------------------------
// Object storage seam. W2a owns app/storage.ts (private S3-compatible bucket); wire it with
// setObjectStore(...) once it is on main. Until then nothing reaches the bucket: deletions stay queued in
// storage_deletions, exports answer 503 missing_config and photo URLs are null.
// ---------------------------------------------------------------------------------------------------
export type StoredObject = { key: string; lastModified: Date | string | null };
export type ObjectStore = {
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  getObject(key: string): Promise<Uint8Array | null>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  listPrefix(prefix: string): Promise<StoredObject[]>;
  deleteObjects(keys: string[]): Promise<void>;
};
let objectStore: ObjectStore | null = null;
export function setObjectStore(store: ObjectStore | null) { objectStore = store; }
export function getObjectStore() { return objectStore; }

// ---------------------------------------------------------------------------------------------------
// Tables owned by other workstreams, read only when present (W2a photos, W3 calendar/entitlements,
// W2b trips/nudges). Present tables never disappear, so a fully present set is cached.
// ---------------------------------------------------------------------------------------------------
export type OptionalTables = { photos: boolean; exports: boolean; calendar: boolean; trips: boolean; nudges: boolean; entitlements: boolean };
const PHOTO_COLUMNS = 10;
let allTables: OptionalTables | null = null;
export async function optionalTables(sql: Sql): Promise<OptionalTables> {
  if (allTables) return allTables;
  const row = (await sql`SELECT
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'couple_photos' AND column_name IN ('author_user_id', 'local_day', 'is_daily', 'status', 'object_key', 'thumb_key', 'delete_after', 'width', 'height', 'ready_at')) AS "photoColumns",
      to_regclass('photo_exports') IS NOT NULL AS exports,
      (to_regclass('calendar_busy') IS NOT NULL AND to_regclass('calendar_sync') IS NOT NULL) AS calendar,
      to_regclass('trips') IS NOT NULL AS trips,
      to_regclass('couple_nudges') IS NOT NULL AS nudges,
      to_regclass('entitlements') IS NOT NULL AS entitlements`)[0];
  const tables = { photos: Number(row.photoColumns) === PHOTO_COLUMNS, exports: Boolean(row.exports), calendar: Boolean(row.calendar), trips: Boolean(row.trips), nudges: Boolean(row.nudges), entitlements: Boolean(row.entitlements) };
  if (Object.values(tables).every(Boolean)) allTables = tables;
  return tables;
}

/** Salted SHA-256 (same salt as user_sessions / mobile_tokens); `scope` keeps link, code, refresh and IP hashes apart. */
export async function saltedHash(scope: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${process.env.AUTH_SESSION_SALT ?? "honto-auth"}:${scope}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The hash app/server-auth.ts stores for `mobile_tokens` and `user_sessions` (salted SHA-256, no scope). That
 * helper is private and frozen, so it is mirrored here; tests check both agree (a revoked row stops working).
 */
export async function sessionTokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${process.env.AUTH_SESSION_SALT ?? "honto-auth"}:${token}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** First hop of x-forwarded-for (set by Vercel), for per-IP limits. Only ever stored through saltedHash. */
export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** `prefix` + 20 random base32 chars (lowercase), e.g. `cpl_k3v…`. */
export function randomId(prefix: string) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return prefix + [...crypto.getRandomValues(new Uint8Array(20))].map((byte) => alphabet[byte & 31]).join("");
}

/**
 * Counts one hit in a fixed window and returns the seconds to wait (0 = allowed).
 * `subject` should already be an id or a hash (never a raw IP or email).
 */
export async function hitRateLimit(sql: Sql, scope: string, subject: string, limit: number, windowSeconds: number) {
  const rows = await sql`INSERT INTO v1_rate_limits (scope, subject, window_start, hits) VALUES (${scope}, ${subject}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}::int) * ${windowSeconds}::int), 1)
    ON CONFLICT (scope, subject, window_start) DO UPDATE SET hits = v1_rate_limits.hits + 1
    RETURNING hits, GREATEST(1, ceil(extract(epoch FROM (window_start + make_interval(secs => ${windowSeconds}::int) - now()))))::int AS "retryAfter"`;
  return Number(rows[0].hits) > limit ? Number(rows[0].retryAfter) : 0;
}

// ---------------------------------------------------------------------------------------------------
// Unpair
// ---------------------------------------------------------------------------------------------------

/**
 * DELETE /api/v1/couple. One statement ends the couple for both members (so every couple-scoped read stops
 * at once: they all require an active couple) and clears the shared couple fields. Then the shared history
 * of other workstreams is removed when their tables exist (trips with their Live Activity tokens, nudges,
 * both calendar mirrors) and each author's photos get `delete_after` = unpair + 30 days. The retention cron
 * finishes anything a failure here leaves behind. Returns null when the couple was already unpaired.
 */
export async function unpairCouple(sql: Sql, coupleId: string): Promise<UnpairResult | null> {
  await ensureLifecycleSchema(sql);
  const rows = await sql`WITH c AS (
      UPDATE couples SET unpaired_at = now(), updated_at = now(), started_on = NULL, reunion_at = NULL, reunion_city = NULL, reunion_time_zone = NULL
      WHERE id = ${coupleId} AND legacy = false AND unpaired_at IS NULL RETURNING id, unpaired_at
    ), m AS (
      UPDATE couple_members SET left_at = c.unpaired_at FROM c WHERE couple_members.couple_id = c.id AND couple_members.left_at IS NULL RETURNING couple_members.user_id
    )
    SELECT to_char(c.unpaired_at AT TIME ZONE 'UTC', ${ISO}) AS "unpairedAt", to_char((c.unpaired_at + make_interval(days => ${UNPAIR_GRACE_DAYS}::int)) AT TIME ZONE 'UTC', ${ISO}) AS "photosAvailableUntil", (SELECT count(*)::int FROM m) AS members FROM c`;
  if (!rows[0]) return null;
  await purgeSharedHistory(sql, coupleId);
  return { unpairedAt: String(rows[0].unpairedAt), photosAvailableUntil: String(rows[0].photosAvailableUntil) };
}

/** Removes what both partners shared. Safe to repeat (also run by the retention cron for unpaired couples). */
async function purgeSharedHistory(sql: Sql, coupleId: string) {
  const tables = await optionalTables(sql);
  if (tables.trips) await sql`DELETE FROM trips WHERE couple_id = ${coupleId}`;
  if (tables.nudges) await sql`DELETE FROM couple_nudges WHERE couple_id = ${coupleId}`;
  if (tables.calendar) await sql`DELETE FROM calendar_busy WHERE user_id IN (SELECT m.user_id FROM couple_members m WHERE m.couple_id = ${coupleId} AND NOT EXISTS (SELECT 1 FROM couple_members a WHERE a.user_id = m.user_id AND a.left_at IS NULL))`;
  if (tables.photos) await sql`UPDATE couple_photos p SET delete_after = c.unpaired_at + make_interval(days => ${UNPAIR_GRACE_DAYS}::int) FROM couples c WHERE c.id = p.couple_id AND p.couple_id = ${coupleId} AND c.unpaired_at IS NOT NULL AND p.delete_after IS NULL`;
}

/** Most recent unpair whose 30-day photo grace is still running for this user, or null. */
export async function latestUnpair(sql: Sql, userId: string): Promise<UnpairState | null> {
  const rows = await sql`SELECT to_char(c.unpaired_at AT TIME ZONE 'UTC', ${ISO}) AS "unpairedAt", to_char((c.unpaired_at + make_interval(days => ${UNPAIR_GRACE_DAYS}::int)) AT TIME ZONE 'UTC', ${ISO}) AS "photosAvailableUntil"
    FROM couple_members m JOIN couples c ON c.id = m.couple_id
    WHERE m.user_id = ${userId} AND m.left_at IS NOT NULL AND c.unpaired_at IS NOT NULL AND c.unpaired_at > now() - make_interval(days => ${UNPAIR_GRACE_DAYS}::int)
    ORDER BY c.unpaired_at DESC LIMIT 1`;
  return rows[0] ? { unpairedAt: String(rows[0].unpairedAt), photosAvailableUntil: String(rows[0].photosAvailableUntil) } : null;
}

async function isPaired(sql: Sql, userId: string) {
  const rows = await sql`SELECT 1 FROM couple_members m JOIN couples c ON c.id = m.couple_id AND c.unpaired_at IS NULL WHERE m.user_id = ${userId} AND m.left_at IS NULL LIMIT 1`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------------------
// Export of my own photos (ZIP in exports/<userId>/<exportId>.zip)
// ---------------------------------------------------------------------------------------------------
type ExportRow = { id: string; status: "pending" | "ready" | "failed"; objectKey: string | null; photoCount: number; readyAt: string | null; expiresAt: string | null; expired: boolean; stale: boolean; fresh: boolean };

async function latestExport(sql: Sql, userId: string) {
  const rows = await sql`SELECT id, status, object_key AS "objectKey", photo_count AS "photoCount", to_char(ready_at AT TIME ZONE 'UTC', ${ISO}) AS "readyAt", to_char(expires_at AT TIME ZONE 'UTC', ${ISO}) AS "expiresAt",
      (expires_at IS NOT NULL AND expires_at <= now()) AS expired, (status = 'pending' AND created_at <= now() - interval '15 minutes') AS stale, (created_at > now() - interval '10 minutes') AS fresh
    FROM photo_exports WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`;
  return (rows[0] as ExportRow | undefined) ?? null;
}

/** My ready photos still kept (current couple, or a previous one inside its 30-day grace). */
async function exportablePhotos(sql: Sql, userId: string) {
  if (!(await optionalTables(sql)).photos) return [];
  return await sql`SELECT id, object_key AS "objectKey", to_char(local_day, 'YYYY-MM-DD') AS "localDay", created_at AS "createdAt"
    FROM couple_photos WHERE author_user_id = ${userId} AND status = 'ready' AND object_key IS NOT NULL AND (delete_after IS NULL OR delete_after > now())
    ORDER BY local_day, is_daily DESC, created_at` as { id: string; objectKey: string; localDay: string | null; createdAt: string | Date }[];
}

/** Export window: while paired (photosAvailableUntil null), or during the 30 days after the last unpair. */
async function exportWindow(sql: Sql, userId: string) {
  if (await isPaired(sql, userId)) return { available: true, photosAvailableUntil: null };
  const unpair = await latestUnpair(sql, userId);
  return { available: Boolean(unpair), photosAvailableUntil: unpair?.photosAvailableUntil ?? null };
}

/** GET /api/v1/me/export. A ready export gets a fresh 24h signed GET (never past the object's 7-day expiry). */
export async function exportStatus(sql: Sql, userId: string, store = getObjectStore()): Promise<ExportStatus> {
  await ensureLifecycleSchema(sql);
  const window = await exportWindow(sql, userId);
  const latest = await latestExport(sql, userId);
  const photoCount = (await exportablePhotos(sql, userId)).length;
  const base = { url: null, expiresAt: null, photosAvailableUntil: window.photosAvailableUntil };
  if (latest?.status === "ready" && latest.objectKey && !latest.expired && store) {
    const objectExpiry = latest.expiresAt ? Date.parse(latest.expiresAt) : Date.now() + EXPORT_URL_SECONDS * 1000;
    const seconds = Math.max(60, Math.min(EXPORT_URL_SECONDS, Math.floor((objectExpiry - Date.now()) / 1000)));
    return { status: "ready", url: await store.presignGet(latest.objectKey, seconds), expiresAt: toIso(new Date(Date.now() + seconds * 1000)), photoCount: latest.photoCount, photosAvailableUntil: window.photosAvailableUntil };
  }
  if (latest?.status === "pending" && !latest.stale) return { ...base, status: "pending", photoCount };
  if (latest?.status === "ready" && latest.expired) return { ...base, status: window.available ? "expired" : "unavailable", photoCount };
  return { ...base, status: window.available ? "none" : "unavailable", photoCount };
}

export type ExportRequest = { status: 202; body: ExportStatus; build: (() => Promise<void>) | null } | { status: 410 | 503 | 429; code: "export_unavailable" | "missing_config" | "rate_limited"; error: string; retryAfter?: number };

/**
 * POST /api/v1/me/export. Reuses a pending export or a ready one made in the last 10 minutes with the
 * same photos; otherwise queues a new one (5 per day) and returns `build`, which the route runs after the
 * response (`after()`), or inline when that is not available.
 */
export async function requestExport(sql: Sql, userId: string, store = getObjectStore()): Promise<ExportRequest> {
  await ensureLifecycleSchema(sql);
  const window = await exportWindow(sql, userId);
  const photos = await exportablePhotos(sql, userId);
  if (!window.available || photos.length === 0) return { status: 410, code: "export_unavailable", error: photos.length ? "Your photos are no longer available." : "You have no photos to export yet." };
  if (!store) return { status: 503, code: "missing_config", error: "Photo storage is not configured." };
  const latest = await latestExport(sql, userId);
  if ((latest?.status === "pending" && !latest.stale) || (latest?.status === "ready" && latest.fresh && !latest.expired && latest.photoCount === photos.length)) {
    return { status: 202, body: await exportStatus(sql, userId, store), build: null };
  }
  const wait = await hitRateLimit(sql, "export", userId, 5, 24 * 60 * 60);
  if (wait) return { status: 429, code: "rate_limited", error: "Too many exports today. Try again later.", retryAfter: wait };
  if (latest?.stale) await sql`UPDATE photo_exports SET status = 'failed' WHERE id = ${latest.id} AND status = 'pending'`;
  const id = randomId("exp_");
  await sql`INSERT INTO photo_exports (id, user_id, status, photo_count) VALUES (${id}, ${userId}, 'pending', ${photos.length}::int)`;
  return { status: 202, body: { status: "pending", url: null, expiresAt: null, photoCount: photos.length, photosAvailableUntil: window.photosAvailableUntil }, build: () => buildExport(sql, id, store) };
}

/** Fetches my photos from object storage, writes one stored (uncompressed: JPEG/WebP) ZIP and marks the export ready. */
export async function buildExport(sql: Sql, exportId: string, store: ObjectStore) {
  const row = (await sql`SELECT user_id AS "userId" FROM photo_exports WHERE id = ${exportId} AND status = 'pending'`)[0];
  if (!row) return;
  const userId = String(row.userId);
  try {
    const photos = await exportablePhotos(sql, userId);
    const files: ZipEntry[] = [];
    await mapLimit(photos, 6, async (photo, index) => {
      const data = await store.getObject(photo.objectKey);
      if (!data) return;
      const ext = photo.objectKey.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? "jpg";
      files[index] = { name: `honto-photos/${photo.localDay ?? "undated"}_${photo.id}.${ext}`, data, date: new Date(photo.createdAt) };
    });
    const entries = files.filter(Boolean);
    const key = `exports/${userId}/${exportId}.zip`;
    await store.putObject(key, zipStore(entries), "application/zip");
    await sql`UPDATE photo_exports SET status = 'ready', object_key = ${key}, photo_count = ${entries.length}::int, ready_at = now(), expires_at = now() + make_interval(days => ${EXPORT_KEEP_DAYS}::int) WHERE id = ${exportId}`;
  } catch (cause) {
    console.error("[v1/export] build failed", cause);
    await sql`UPDATE photo_exports SET status = 'failed' WHERE id = ${exportId}`;
  }
}

async function mapLimit<T>(items: T[], limit: number, run: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; await run(items[index], index); }
  }));
}

// ---------------------------------------------------------------------------------------------------
// Minimal ZIP writer (method 0 "stored", UTF-8 names). Photos are already compressed, so deflate would
// only cost CPU. Limited to 4 GB / 65535 entries (no ZIP64), far above one person's photos.
// ---------------------------------------------------------------------------------------------------
export type ZipEntry = { name: string; data: Uint8Array; date?: Date };
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
  const d = Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1980 ? new Date(Date.UTC(1980, 0, 1)) : date;
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2), day: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const { time, day } = dosDateTime(entry.date);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, day, true); local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true); local.setUint32(22, entry.data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true); central.setUint16(10, 0, true);
    central.setUint16(12, time, true); central.setUint16(14, day, true); central.setUint32(16, crc, true);
    central.setUint32(20, entry.data.length, true); central.setUint32(24, entry.data.length, true); central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, entry.data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Retention (GET /api/cron/retention, daily from the Cloudflare Worker)
// ---------------------------------------------------------------------------------------------------

/**
 * 1. photos past `delete_after` (and any photo of a v1 couple unpaired 30+ days ago) -> rows deleted, keys queued;
 * 2. v1 couples unpaired 30+ days ago -> deleted (members cascade);
 * 3. exports past their 7 days (or failed / stuck for a day) -> rows deleted, keys queued; with storage wired,
 *    `exports/` objects older than 7 days that no live export row references are queued too;
 * 4. unused invites that expired or were replaced, email sign-in tokens expired for a day, old rate-limit
 *    windows, calendar blocks outside [now - 1 day, now + 14 days];
 * 5. the deletion queue is drained through `deleteObjects` (1000 keys per call) when storage is wired.
 * Every key is queued in the same statement that deletes its row, so a crash never loses a key.
 */
export async function runRetention(sql: Sql, store = getObjectStore()): Promise<CronRetentionResult> {
  await ensureLifecycleSchema(sql);
  const tables = await optionalTables(sql);
  const count = (rows: Row[]) => Number(rows[0]?.n ?? 0);
  let photosDeleted = 0;
  if (tables.photos) {
    photosDeleted = count(await sql`WITH d AS (
        DELETE FROM couple_photos WHERE (delete_after IS NOT NULL AND delete_after <= now())
          OR couple_id IN (SELECT id FROM couples WHERE legacy = false AND unpaired_at IS NOT NULL AND unpaired_at <= now() - make_interval(days => ${UNPAIR_GRACE_DAYS}::int))
        RETURNING object_key, thumb_key
      ), q AS (
        INSERT INTO storage_deletions (object_key, reason) SELECT k.key, 'photo' FROM d CROSS JOIN LATERAL (VALUES (d.object_key), (d.thumb_key)) AS k(key) WHERE k.key IS NOT NULL ON CONFLICT (object_key) DO NOTHING
      ) SELECT count(*)::int AS n FROM d`);
  }
  const stale = await sql`SELECT id FROM couples WHERE legacy = false AND unpaired_at IS NOT NULL AND unpaired_at <= now() - make_interval(days => ${UNPAIR_GRACE_DAYS}::int)`;
  for (const couple of stale) await purgeSharedHistory(sql, String(couple.id));
  const couplesPurged = count(await sql`WITH d AS (DELETE FROM couples WHERE legacy = false AND unpaired_at IS NOT NULL AND unpaired_at <= now() - make_interval(days => ${UNPAIR_GRACE_DAYS}::int) RETURNING id) SELECT count(*)::int AS n FROM d`);

  let exportsDeleted = count(await sql`WITH d AS (
      DELETE FROM photo_exports WHERE (expires_at IS NOT NULL AND expires_at <= now()) OR (status <> 'ready' AND created_at <= now() - interval '1 day') RETURNING object_key
    ), q AS (
      INSERT INTO storage_deletions (object_key, reason) SELECT object_key, 'export' FROM d WHERE object_key IS NOT NULL ON CONFLICT (object_key) DO NOTHING
    ) SELECT count(*)::int AS n FROM d`);
  if (store) {
    const cutoff = Date.now() - EXPORT_KEEP_DAYS * 24 * 60 * 60 * 1000;
    const old = (await store.listPrefix("exports/")).filter((object) => object.lastModified && new Date(object.lastModified).getTime() <= cutoff).map((object) => object.key);
    for (const key of old) {
      const live = await sql`SELECT 1 FROM photo_exports WHERE object_key = ${key} AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`;
      if (live.length) continue;
      const queued = await sql`INSERT INTO storage_deletions (object_key, reason) VALUES (${key}, 'export') ON CONFLICT (object_key) DO NOTHING RETURNING object_key`;
      exportsDeleted += queued.length;
    }
  }

  const invitesDeleted = count(await sql`WITH d AS (DELETE FROM couple_invites WHERE used_at IS NULL AND (expires_at <= now() OR revoked_at IS NOT NULL) RETURNING code) SELECT count(*)::int AS n FROM d`);
  const tokensRevoked = count(await sql`WITH d AS (DELETE FROM email_login_tokens WHERE expires_at <= now() - interval '1 day' RETURNING token_hash) SELECT count(*)::int AS n FROM d`)
    + count(await sql`WITH d AS (DELETE FROM v1_refresh_tokens WHERE expires_at <= now() OR revoked_at <= now() - interval '30 days' OR used_at <= now() - interval '30 days' RETURNING token_hash) SELECT count(*)::int AS n FROM d`);
  await sql`DELETE FROM v1_rate_limits WHERE window_start <= now() - interval '2 days'`;
  const calendarBlocksDeleted = tables.calendar
    ? count(await sql`WITH d AS (DELETE FROM calendar_busy WHERE ends_at < now() - interval '1 day' OR starts_at > now() + interval '14 days' RETURNING 1) SELECT count(*)::int AS n FROM d`)
    : 0;

  const objectsDeleted = store ? await drainDeletionQueue(sql, store) : 0;
  const objectsPending = count(await sql`SELECT count(*)::int AS n FROM storage_deletions`);
  return { ok: true, photosDeleted, couplesPurged, exportsDeleted, calendarBlocksDeleted, tokensRevoked, invitesDeleted, objectsDeleted, objectsPending };
}

async function drainDeletionQueue(sql: Sql, store: ObjectStore) {
  let deleted = 0;
  for (let round = 0; round < 10; round++) {
    const keys = (await sql`SELECT object_key AS key FROM storage_deletions WHERE attempts < 10 ORDER BY queued_at, object_key LIMIT 1000`).map((row) => String(row.key));
    if (!keys.length) break;
    try {
      await store.deleteObjects(keys);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : "delete failed";
      for (const key of keys) await sql`UPDATE storage_deletions SET attempts = attempts + 1, last_error = ${message} WHERE object_key = ${key}`;
      break;
    }
    for (const key of keys) await sql`DELETE FROM storage_deletions WHERE object_key = ${key}`;
    deleted += keys.length;
    if (keys.length < 1000) break;
  }
  return deleted;
}

function toIso(date: Date) { return date.toISOString().replace(/\.\d{3}Z$/, "Z"); }
