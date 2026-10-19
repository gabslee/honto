// Shared by /api/v1/photos and /api/v1/memories: photo rows, contract mapping, limits and local days.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Photo, PhotoContentType, PhotoThumb } from "../../../../contracts/honto-api";
import { apiError } from "../../../../api/v1/context";
import { GET_TTL_SECONDS, presignGet, storageConfig } from "../../../storage";

type Sql = NeonQueryFunction<false, false>;

/** Contract limits (PhotoCreateRequest): JPEG/WebP only, full ≤ 2 MB, thumb ≤ 256 KB, sides ≤ 4096 px. */
export const MAX_FULL_BYTES = 2 * 1024 * 1024;
export const MAX_THUMB_BYTES = 256 * 1024;
export const MAX_SIDE = 4096;
export const PHOTO_EXTENSIONS: Record<PhotoContentType, string> = { "image/jpeg": "jpg", "image/webp": "webp" };

/** A couple_photos row as the v1 code reads it. Legacy rows have `storage = 'blob'` and a public `url`. */
export type PhotoRow = {
  id: string;
  coupleId: string;
  authorUserId: string;
  localDay: string;
  isDaily: boolean;
  status: "pending" | "ready";
  phraseKey: string | null;
  phrase: string | null;
  width: number;
  height: number;
  createdAt: string;
  storage: string;
  url: string | null;
  objectKey: string | null;
  thumbKey: string | null;
  contentType: string;
  bytes: number;
  thumbContentType: string | null;
  thumbBytes: number | null;
};

/** 503 while the bucket credentials are unset (or null when storage is ready). */
export function storageUnavailable() {
  return storageConfig() ? null : apiError(503, "storage_not_configured", "Photo storage is not configured yet.");
}

export async function photoById(sql: Sql, coupleId: string, photoId: string) {
  const rows = await sql`SELECT id, couple_id AS "coupleId", author_user_id AS "authorUserId", to_char(local_day, 'YYYY-MM-DD') AS "localDay", is_daily AS "isDaily", status, phrase_key AS "phraseKey", phrase, COALESCE(width, 0) AS width, COALESCE(height, 0) AS height, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt", storage, url, object_key AS "objectKey", thumb_key AS "thumbKey", content_type AS "contentType", size_bytes AS bytes, thumb_content_type AS "thumbContentType", thumb_size_bytes AS "thumbBytes"
    FROM couple_photos WHERE id = ${photoId} AND couple_id = ${coupleId} AND author_user_id IS NOT NULL AND local_day IS NOT NULL LIMIT 1`;
  return (rows[0] as PhotoRow | undefined) ?? null;
}

/** Ready photos of both partners in [from, to] (local days), daily first, then by time. */
export async function readyPhotosBetween(sql: Sql, coupleId: string, from: string, to: string) {
  return await sql`SELECT id, couple_id AS "coupleId", author_user_id AS "authorUserId", to_char(local_day, 'YYYY-MM-DD') AS "localDay", is_daily AS "isDaily", status, phrase_key AS "phraseKey", phrase, COALESCE(width, 0) AS width, COALESCE(height, 0) AS height, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt", storage, url, object_key AS "objectKey", thumb_key AS "thumbKey", content_type AS "contentType", size_bytes AS bytes, thumb_content_type AS "thumbContentType", thumb_size_bytes AS "thumbBytes"
    FROM couple_photos WHERE couple_id = ${coupleId} AND status = 'ready' AND author_user_id IS NOT NULL AND local_day BETWEEN ${from}::date AND ${to}::date AND (delete_after IS NULL OR delete_after > now())
    ORDER BY local_day, is_daily DESC, created_at, id` as PhotoRow[];
}

const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Signed (or legacy Blob) full + thumb URLs, valid 24h. */
export async function photoUrls(row: PhotoRow, now = new Date()) {
  if (row.storage === "blob" && row.url) return { full: row.url, thumb: row.url, expiresAt: rfc3339(now.getTime() + GET_TTL_SECONDS * 1000) };
  const [full, thumb] = await Promise.all([presignGet(row.objectKey as string, { now }), presignGet((row.thumbKey ?? row.objectKey) as string, { now })]);
  return { full: full.url, thumb: thumb.url, expiresAt: full.expiresAt };
}

/** Contract `Photo` as seen by `viewerId` (`author` = me / partner); `urls` is null while pending. */
export async function toApiPhoto(row: PhotoRow, viewerId: string, now = new Date()): Promise<Photo> {
  return {
    id: row.id,
    author: row.authorUserId === viewerId ? "me" : "partner",
    authorUserId: row.authorUserId,
    localDay: row.localDay,
    isDaily: row.isDaily,
    status: row.status,
    phraseKey: row.phraseKey,
    phrase: row.phrase || null,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    urls: row.status === "ready" ? await photoUrls(row, now) : null,
  };
}

/** Contract `PhotoThumb` (signed thumb, or the legacy Blob url). */
export async function toPhotoThumb(row: PhotoRow, now = new Date()): Promise<PhotoThumb> {
  const urls = await photoUrls(row, now);
  return { photoId: row.id, thumbUrl: urls.thumb, expiresAt: urls.expiresAt };
}

/** `YYYY-MM-DD` of `date` in an IANA zone. */
export function localDayIn(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Calendar arithmetic on `YYYY-MM-DD` (no time zones involved). */
export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A real calendar day in `YYYY-MM-DD` form. */
export function isLocalDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

/** Free history window: the first unlocked day is 6 days before today in the viewer's zone (UTC until known). */
export function freeWindowStart(timeZone: string | null, now = new Date()) {
  return addDays(localDayIn(timeZone || "UTC", now), -6);
}
