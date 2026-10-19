import { randomBytes } from "node:crypto";
import type { PhotoContentType, PhotoCreateResponse } from "../../../../contracts/honto-api";
import { apiError, noStore, normalizeTimeZone, requireCouple } from "../../../../api/v1/context";
import { ensurePhotosSchema } from "../../../../api/v1/photos-schema";
import { JAPANESE_PHRASES } from "../../../photo-moments.js";
import { database } from "../../../server-auth";
import { presignPut } from "../../../storage";
import { MAX_FULL_BYTES, MAX_SIDE, MAX_THUMB_BYTES, PHOTO_EXTENSIONS, addDays, isLocalDay, localDayIn, photoById, storageUnavailable, toApiPhoto, type PhotoRow } from "./photo-rows";

export const dynamic = "force-dynamic";

/** Reservations per author per rolling hour (each one hands out two presigned PUTs). */
const HOURLY_LIMIT = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isType = (value: unknown): value is PhotoContentType => typeof value === "string" && value in PHOTO_EXTENSIONS;
const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** Known phrase key -> "ja · en" (app/photo-moments.js); otherwise the custom phrase, or none. */
function resolvePhrase(phraseKey: unknown, phrase: unknown): { key: string | null; text: string | null } | null {
  if (phraseKey !== undefined && phraseKey !== null) {
    const known = JAPANESE_PHRASES.find((p) => p.key === phraseKey);
    return known ? { key: known.key, text: `${known.ja} · ${known.en}` } : null;
  }
  if (phrase === undefined || phrase === null) return { key: null, text: null };
  if (typeof phrase !== "string") return null;
  const text = phrase.replace(/\s+/g, " ").trim();
  if ([...text].length > 80) return null;
  return { key: null, text: text || null };
}

async function uploadTargets(row: PhotoRow) {
  const [full, thumb] = await Promise.all([
    presignPut(row.objectKey as string, { contentType: row.contentType, bytes: row.bytes }),
    presignPut(row.thumbKey as string, { contentType: row.thumbContentType as string, bytes: row.thumbBytes as number }),
  ]);
  return { full, thumb };
}

/**
 * POST /api/v1/photos: reserves a photo and returns presigned PUT URLs (full + device-made thumb, 10 min).
 * The bytes go straight from the device to the bucket. Idempotent by `clientId`.
 */
export async function POST(request: Request) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const unavailable = storageUnavailable();
  if (unavailable) return unavailable;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "bad_request", "Send a JSON body.");
  const { clientId, contentType, bytes, thumbContentType, thumbBytes, width, height, localDay } = body;
  if (typeof clientId !== "string" || !UUID.test(clientId)) return apiError(400, "bad_request", "clientId must be a UUID.");
  if (typeof contentType !== "string" || typeof thumbContentType !== "string") return apiError(400, "bad_request", "contentType and thumbContentType are required.");
  if (!isType(contentType) || !isType(thumbContentType)) return apiError(415, "unsupported_media_type", "Photos must be JPEG or WebP.");
  if (!isInt(bytes, 1) || !isInt(thumbBytes, 1)) return apiError(400, "bad_request", "bytes and thumbBytes must be positive integers.");
  if (bytes > MAX_FULL_BYTES || thumbBytes > MAX_THUMB_BYTES) return apiError(413, "too_large", "The photo must be 2 MB or smaller and the thumbnail 256 KB or smaller.");
  if (!isInt(width, 1, MAX_SIDE) || !isInt(height, 1, MAX_SIDE)) return apiError(400, "bad_request", "width and height must be between 1 and 4096.");
  const timeZone = normalizeTimeZone(body.timeZone);
  if (!timeZone) return apiError(400, "bad_request", "timeZone must be an IANA time zone id.");
  if (!isLocalDay(localDay)) return apiError(400, "bad_request", "localDay must be YYYY-MM-DD.");
  const phrase = resolvePhrase(body.phraseKey, body.phrase);
  if (!phrase) return apiError(400, "bad_request", "Unknown phraseKey, or phrase longer than 80 characters.");

  const sql = database()!;
  await ensurePhotosSchema(sql);
  const { user, couple } = auth;
  const now = new Date();

  const existing = await sql`SELECT id, couple_id AS "coupleId" FROM couple_photos WHERE author_user_id = ${user.id} AND client_id = ${clientId} LIMIT 1`;
  if (existing[0] && existing[0].coupleId !== couple.id) return apiError(400, "bad_request", "clientId was already used.");
  if (!existing[0]) {
    // The photo day is the photographer's local day: today in their zone, give or take one day.
    const today = localDayIn(timeZone, now);
    if (localDay < addDays(today, -1) || localDay > addDays(today, 1)) return apiError(422, "invalid_local_day", "localDay must be today or yesterday in your time zone.");
    const recent = await sql`SELECT count(*)::int AS n, to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS oldest FROM couple_photos WHERE author_user_id = ${user.id} AND created_at > now() - interval '1 hour'`;
    if (recent[0].n >= HOURLY_LIMIT) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(recent[0].oldest) + 3600_000 - now.getTime()) / 1000));
      return Response.json({ error: "Too many photos. Try again later.", code: "rate_limited", retryAfterSeconds }, { status: 429, headers: { ...noStore, "Retry-After": String(retryAfterSeconds) } });
    }
    const id = `ph_${randomBytes(10).toString("hex")}`;
    const prefix = `couples/${couple.id}/photos/${id}`;
    await sql`INSERT INTO couple_photos (id, couple_id, role, author_name, phrase_key, phrase, content_type, size_bytes, storage, author_user_id, client_id, local_day, time_zone, is_daily, status, object_key, thumb_key, thumb_content_type, thumb_size_bytes, width, height)
      VALUES (${id}, ${couple.id}, ${couple.role}, ${user.displayName}, ${phrase.key}, ${phrase.text}, ${contentType}, ${bytes}, 's3', ${user.id}, ${clientId}, ${localDay}, ${timeZone}, false, 'pending', ${`${prefix}/full.${PHOTO_EXTENSIONS[contentType]}`}, ${`${prefix}/thumb.${PHOTO_EXTENSIONS[thumbContentType]}`}, ${thumbContentType}, ${thumbBytes}, ${width}, ${height})
      ON CONFLICT (author_user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING`;
  }
  // Retries (same clientId) get the stored photo with fresh URLs for the sizes declared the first time.
  const photoId = (await sql`SELECT id FROM couple_photos WHERE author_user_id = ${user.id} AND client_id = ${clientId} LIMIT 1`)[0].id as string;
  const row = (await photoById(sql, couple.id, photoId))!;
  const result: PhotoCreateResponse = { photo: await toApiPhoto(row, user.id, now), upload: await uploadTargets(row) };
  return Response.json(result, { status: 201, headers: noStore });
}
