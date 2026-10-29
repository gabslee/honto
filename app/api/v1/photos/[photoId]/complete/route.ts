import { apiError, noStore, requireCouple } from "../../../../../../server/v1/context";
import { ensurePhotosSchema } from "../../../../../../server/v1/photos-schema";
import { notifyPartner } from "../../../../../push/index";
import { database } from "../../../../../server-auth";
import { headObject, StorageError } from "../../../../../storage";
import { MAX_FULL_BYTES, MAX_THUMB_BYTES, photoById, storageUnavailable, toApiPhoto } from "../../photo-rows";

export const dynamic = "force-dynamic";
// APNs uses node:http2.
export const runtime = "nodejs";

const baseType = (value: string | null) => (value ?? "").split(";")[0].trim().toLowerCase();

/**
 * POST /api/v1/photos/{photoId}/complete: HEADs both uploads (size and type must match what was declared),
 * marks the photo ready, makes it the daily photo when it is the author's first ready photo of that local
 * day, and sends `photo.new` to the partner. Idempotent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const unavailable = storageUnavailable();
  if (unavailable) return unavailable;
  const { photoId } = await params;
  const { user, couple } = auth;
  const sql = database()!;
  await ensurePhotosSchema(sql);
  const row = await photoById(sql, couple.id, photoId);
  if (!row || row.authorUserId !== user.id) return apiError(404, "not_found", "Photo not found.");
  if (row.status === "ready") return Response.json(await toApiPhoto(row, user.id), { headers: noStore });

  let full, thumb;
  try {
    [full, thumb] = await Promise.all([headObject(row.objectKey as string), headObject(row.thumbKey as string)]);
  } catch (error) {
    // A bucket answering 4xx/5xx (misconfigured endpoint or keys, outage) is retryable for the app: 503 keeps
    // the photo queued on the device instead of a 500 that ends its retries.
    if (!(error instanceof StorageError)) throw error;
    console.error(`[v1/photos] complete: ${error.message}`);
    return apiError(503, "storage_not_configured", "Photo storage is unavailable right now. Try again shortly.", { "Retry-After": "60" });
  }
  if (!full || !thumb) return apiError(422, "upload_missing", "The photo upload was not found. Upload again.");
  if (full.size !== row.bytes || thumb.size !== row.thumbBytes || full.size > MAX_FULL_BYTES || thumb.size > MAX_THUMB_BYTES) {
    return apiError(422, "upload_size_mismatch", "The uploaded file does not match the declared size. Upload again.");
  }
  if (baseType(full.contentType) !== row.contentType || baseType(thumb.contentType) !== row.thumbContentType) {
    return apiError(422, "unsupported_media_type", "The uploaded file does not match the declared type. Upload again.");
  }

  // First ready photo of this author's local day becomes the daily photo. The partial unique index
  // idx_couple_photos_daily settles a race between two completes: the loser is stored as a gallery photo.
  let marked;
  try {
    marked = await sql`UPDATE couple_photos p SET status = 'ready', ready_at = now(), is_daily = NOT EXISTS (SELECT 1 FROM couple_photos d WHERE d.couple_id = p.couple_id AND d.author_user_id = p.author_user_id AND d.local_day = p.local_day AND d.is_daily AND d.id <> p.id) WHERE p.id = ${row.id} AND p.status = 'pending' RETURNING p.id`;
  } catch (error) {
    if ((error as { code?: string })?.code !== "23505") throw error;
    marked = await sql`UPDATE couple_photos SET status = 'ready', ready_at = now(), is_daily = false WHERE id = ${row.id} AND status = 'pending' RETURNING id`;
  }
  const ready = (await photoById(sql, couple.id, row.id))!;
  const photo = await toApiPhoto(ready, user.id);
  // Only the request that flipped pending -> ready notifies (a concurrent retry does not push twice).
  if (marked.length) await notifyPartner(couple.id, user.id, { type: "photo.new", photoId: photo.id, thumbUrl: photo.urls?.thumb ?? null, fromName: user.displayName });
  return Response.json(photo, { headers: noStore });
}
