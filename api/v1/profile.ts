// Build 8 Profile tab: profile photo (avatar) and display name. The avatar reuses the photos upload flow
// (presigned PUT of a full image and a device-made thumbnail, then complete), stored privately under
// avatars/<userId>/<avatarId>/ and served as 24 h presigned GETs. In-app only: widgets never read it.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Avatar, AvatarUploadResponse, PhotoContentType, User } from "../../contracts/honto-api";
import { database } from "../../app/server-auth";
import { headObject, presignPut, StorageError, storageConfig } from "../../app/storage";
import { apiError, noStore, requireUser, toApiUser } from "./context";
import { ensureFoundationSchema } from "./foundation-schema";
import { ensureLifecycleSchema, getObjectStore, hitRateLimit, randomId, type ObjectStore } from "./lifecycle";

type Sql = NeonQueryFunction<false, false>;
type AvatarRow = { id: string; userId: string; status: "pending" | "ready"; objectKey: string; thumbKey: string; contentType: string; bytes: number; thumbContentType: string; thumbBytes: number; updatedAt: string };

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
/** Contract limits (AvatarUploadRequest): JPEG/WebP, full 1 MB or less, thumb 128 KB or less, sides 2048 px or less. */
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_MAX_THUMB_BYTES = 128 * 1024;
export const AVATAR_MAX_SIDE = 2048;
/** Upload reservations per user per hour. */
export const AVATAR_HOURLY_LIMIT = 20;
const AVATAR_URL_SECONDS = 24 * 60 * 60;
const EXTENSIONS: Record<PhotoContentType, string> = { "image/jpeg": "jpg", "image/webp": "webp" };
const DISPLAY_NAME_MAX = 80;

let ready: Promise<void> | null = null;

/** Idempotent avatar schema (mirrors drizzle/0015_avatars.sql). */
export function ensureAvatarSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureFoundationSchema(sql);
    await ensureLifecycleSchema(sql);
    await sql`CREATE TABLE IF NOT EXISTS user_avatars (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')), object_key text NOT NULL, thumb_key text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, thumb_content_type text NOT NULL, thumb_size_bytes integer NOT NULL, width integer NOT NULL, height integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_avatars_ready ON user_avatars(user_id) WHERE status = 'ready'`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_avatars_user ON user_avatars(user_id, created_at DESC)`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

const isType = (value: unknown): value is PhotoContentType => typeof value === "string" && value in EXTENSIONS;
const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const baseType = (value: string | null) => (value ?? "").split(";")[0].trim().toLowerCase();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
const toIso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function storageUnavailable() {
  return storageConfig() ? null : apiError(503, "storage_not_configured", "Photo storage is not configured yet.");
}

async function avatarRow(sql: Sql, userId: string, avatarId: string) {
  const rows = await sql`SELECT id, user_id AS "userId", status, object_key AS "objectKey", thumb_key AS "thumbKey", content_type AS "contentType", size_bytes AS bytes, thumb_content_type AS "thumbContentType", thumb_size_bytes AS "thumbBytes", to_char(COALESCE(ready_at, created_at) AT TIME ZONE 'UTC', ${ISO}) AS "updatedAt"
    FROM user_avatars WHERE id = ${avatarId} AND user_id = ${userId} LIMIT 1`;
  return (rows[0] as AvatarRow | undefined) ?? null;
}

async function toApiAvatar(row: Pick<AvatarRow, "id" | "objectKey" | "thumbKey" | "updatedAt">, store: ObjectStore, now: Date): Promise<Avatar> {
  const [full, thumb] = await Promise.all([store.presignGet(row.objectKey, AVATAR_URL_SECONDS), store.presignGet(row.thumbKey, AVATAR_URL_SECONDS)]);
  return { id: row.id, urls: { full, thumb, expiresAt: toIso(new Date(now.getTime() + AVATAR_URL_SECONDS * 1000)) }, updatedAt: row.updatedAt };
}

/**
 * Ready avatars of `userIds` (missing users are absent from the map). Without storage, or when the read
 * fails, the map is empty: callers then answer `avatar: null` instead of failing the whole response.
 */
export async function avatarsFor(sql: Sql, userIds: string[], now = new Date(), store = getObjectStore()): Promise<Map<string, Avatar>> {
  const result = new Map<string, Avatar>();
  if (!store || userIds.length === 0) return result;
  try {
    await ensureAvatarSchema(sql);
    const rows = await sql`SELECT id, user_id AS "userId", object_key AS "objectKey", thumb_key AS "thumbKey", to_char(COALESCE(ready_at, created_at) AT TIME ZONE 'UTC', ${ISO}) AS "updatedAt"
      FROM user_avatars WHERE status = 'ready' AND user_id = ANY(${userIds}::text[])`;
    for (const row of rows as AvatarRow[]) result.set(row.userId, await toApiAvatar(row, store, now));
  } catch (cause) {
    console.error("[v1/avatar] read failed", cause instanceof Error ? cause.message : cause);
  }
  return result;
}

/**
 * Deletes avatar rows of `userId` (all, or only those matching `where`) and queues their keys in
 * storage_deletions in the same statement. Returns the queued keys.
 */
async function removeAvatars(sql: Sql, userId: string, reason: string, keepId: string | null = null) {
  const rows = await sql`WITH d AS (
      DELETE FROM user_avatars WHERE user_id = ${userId} AND (${keepId}::text IS NULL OR (id <> ${keepId}::text AND status = 'ready')) RETURNING object_key, thumb_key
    ), q AS (
      INSERT INTO storage_deletions (object_key, reason) SELECT k.key, ${reason} FROM d CROSS JOIN LATERAL (VALUES (d.object_key), (d.thumb_key)) AS k(key) ON CONFLICT (object_key) DO NOTHING
    ) SELECT k.key FROM d CROSS JOIN LATERAL (VALUES (d.object_key), (d.thumb_key)) AS k(key)`;
  return rows.map((row) => String(row.key));
}

/** Best-effort immediate delete of queued keys; anything that fails stays queued for the retention cron. */
async function drainKeys(sql: Sql, keys: string[], store = getObjectStore()) {
  if (!store || keys.length === 0) return;
  try {
    await store.deleteObjects(keys);
    for (const key of keys) await sql`DELETE FROM storage_deletions WHERE object_key = ${key}`;
  } catch (cause) {
    console.error("[v1/avatar] object delete failed, left for the retention cron", cause instanceof Error ? cause.message : cause);
  }
}

/** POST /api/v1/me/avatar/upload: reserves an avatar and returns presigned PUTs for the full image and the thumbnail. */
export async function createAvatarUploadResponse(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const unavailable = storageUnavailable();
  if (unavailable) return unavailable;
  const body = await readJson(request);
  if (!body) return apiError(400, "bad_request", "Send a JSON body.");
  const { contentType, bytes, thumbContentType, thumbBytes, width, height } = body;
  if (typeof contentType !== "string" || typeof thumbContentType !== "string") return apiError(400, "bad_request", "contentType and thumbContentType are required.");
  if (!isType(contentType) || !isType(thumbContentType)) return apiError(415, "unsupported_media_type", "Profile photos must be JPEG or WebP.");
  if (!isInt(bytes, 1) || !isInt(thumbBytes, 1)) return apiError(400, "bad_request", "bytes and thumbBytes must be positive integers.");
  if (bytes > AVATAR_MAX_BYTES || thumbBytes > AVATAR_MAX_THUMB_BYTES) return apiError(413, "too_large", "The profile photo must be 1 MB or smaller and the thumbnail 128 KB or smaller.");
  if (!isInt(width, 1, AVATAR_MAX_SIDE) || !isInt(height, 1, AVATAR_MAX_SIDE)) return apiError(400, "bad_request", `width and height must be between 1 and ${AVATAR_MAX_SIDE}.`);

  const sql = database()!;
  await ensureAvatarSchema(sql);
  const userId = auth.user.id;
  const wait = await hitRateLimit(sql, "avatar_upload", userId, AVATAR_HOURLY_LIMIT, 60 * 60);
  if (wait) return Response.json({ error: "Too many profile photo uploads. Try again later.", code: "rate_limited", retryAfterSeconds: wait }, { status: 429, headers: { ...noStore, "Retry-After": String(wait) } });

  const id = randomId("av_");
  const prefix = `avatars/${userId}/${id}`;
  const objectKey = `${prefix}/full.${EXTENSIONS[contentType]}`;
  const thumbKey = `${prefix}/thumb.${EXTENSIONS[thumbContentType]}`;
  await sql`INSERT INTO user_avatars (id, user_id, status, object_key, thumb_key, content_type, size_bytes, thumb_content_type, thumb_size_bytes, width, height)
    VALUES (${id}, ${userId}, 'pending', ${objectKey}, ${thumbKey}, ${contentType}, ${bytes}, ${thumbContentType}, ${thumbBytes}, ${width}, ${height})`;
  const [full, thumb] = await Promise.all([
    presignPut(objectKey, { contentType, bytes }),
    presignPut(thumbKey, { contentType: thumbContentType, bytes: thumbBytes }),
  ]);
  const result: AvatarUploadResponse = { avatarId: id, upload: { full, thumb } };
  return json(result, 201);
}

/**
 * POST /api/v1/me/avatar/complete `{ avatarId }`: HEADs both uploads (size and type must match what was
 * declared), makes it my profile photo and deletes the previous one (row now, objects right away or via the
 * retention cron). Idempotent.
 */
export async function completeAvatarResponse(request: Request, now = new Date()) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const unavailable = storageUnavailable();
  if (unavailable) return unavailable;
  const body = await readJson(request);
  if (typeof body?.avatarId !== "string" || !body.avatarId) return apiError(400, "bad_request", "avatarId is required.");
  const sql = database()!;
  await ensureAvatarSchema(sql);
  const userId = auth.user.id;
  const store = getObjectStore();
  const row = await avatarRow(sql, userId, body.avatarId);
  if (!row) return apiError(404, "not_found", "Profile photo not found. Upload again.");
  if (row.status === "ready" && store) return json(await toApiAvatar(row, store, now));

  let full, thumb;
  try {
    [full, thumb] = await Promise.all([headObject(row.objectKey), headObject(row.thumbKey)]);
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
    console.error(`[v1/avatar] complete: ${error.message}`);
    return apiError(503, "storage_not_configured", "Photo storage is unavailable right now. Try again shortly.", { "Retry-After": "60" });
  }
  if (!full || !thumb) return apiError(422, "upload_missing", "The profile photo upload was not found. Upload again.");
  if (full.size !== row.bytes || thumb.size !== row.thumbBytes || full.size > AVATAR_MAX_BYTES || thumb.size > AVATAR_MAX_THUMB_BYTES) {
    return apiError(422, "upload_size_mismatch", "The uploaded file does not match the declared size. Upload again.");
  }
  if (baseType(full.contentType) !== row.contentType || baseType(thumb.contentType) !== row.thumbContentType) {
    return apiError(422, "unsupported_media_type", "The uploaded file does not match the declared type. Upload again.");
  }

  // Previous ready avatar out first (the partial unique index allows one ready row per user), then this one in.
  const old = await removeAvatars(sql, userId, "avatar", row.id);
  try {
    await sql`UPDATE user_avatars SET status = 'ready', ready_at = now() WHERE id = ${row.id} AND user_id = ${userId} AND status = 'pending'`;
  } catch (error) {
    // Two completes racing for different avatars: the loser retries after removing the winner's row.
    if ((error as { code?: string })?.code !== "23505") throw error;
    old.push(...await removeAvatars(sql, userId, "avatar", row.id));
    await sql`UPDATE user_avatars SET status = 'ready', ready_at = now() WHERE id = ${row.id} AND user_id = ${userId} AND status = 'pending'`;
  }
  await drainKeys(sql, old, store);
  const saved = await avatarRow(sql, userId, row.id);
  if (!saved) return apiError(404, "not_found", "Profile photo not found. Upload again.");
  if (!store) return apiError(503, "storage_not_configured", "Photo storage is not configured yet.");
  return json(await toApiAvatar(saved, store, now));
}

/** DELETE /api/v1/me/avatar: removes my profile photo (rows now, objects right away or via the retention cron). 204. */
export async function deleteAvatarResponse(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sql = database()!;
  await ensureAvatarSchema(sql);
  const keys = await removeAvatars(sql, auth.user.id, "avatar");
  await drainKeys(sql, keys);
  return new Response(null, { status: 204, headers: noStore });
}

/** Trimmed, inner whitespace collapsed, 1 to 80 characters, no control or format characters; null when invalid. */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.replace(/[\t\n\r]/g, " "))) return null;
  const name = value.replace(/\s+/g, " ").trim();
  const length = [...name].length;
  return length >= 1 && length <= DISPLAY_NAME_MAX ? name : null;
}

/** Contract `User` with my avatar (null when none). */
export async function userWithAvatar(sql: Sql, user: Parameters<typeof toApiUser>[0], now = new Date()): Promise<User> {
  const avatars = await avatarsFor(sql, [user.id], now);
  return { ...toApiUser(user), avatar: avatars.get(user.id) ?? null };
}

/** PATCH /api/v1/me `{ displayName }`: renames me; the partner sees it on their next couple / me / today read. */
export async function updateProfileResponse(request: Request, now = new Date()) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const body = await readJson(request);
  if (!body) return apiError(400, "bad_request", "Send a JSON body.");
  if (!("displayName" in body)) return apiError(400, "bad_request", "displayName is required.");
  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) return apiError(400, "bad_request", `Display name must be 1 to ${DISPLAY_NAME_MAX} characters, without control characters.`);
  const sql = database()!;
  await sql`UPDATE users SET display_name = ${displayName}, updated_at = now() WHERE id = ${auth.user.id}`;
  return json(await userWithAvatar(sql, { ...auth.user, displayName }, now));
}
