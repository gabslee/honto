import { apiError, noStore, requireCouple } from "../../../../../server/v1/context";
import { ensurePhotosSchema } from "../../../../../server/v1/photos-schema";
import { database } from "../../../../server-auth";
import { deleteObjects, StorageError } from "../../../../storage";
import { photoById, storageUnavailable } from "../photo-rows";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/photos/{photoId}: author only. Removes both objects from the bucket, then the row; when it
 * was the daily photo, the author's next ready photo of that local day (first to become ready) is promoted.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const unavailable = storageUnavailable();
  if (unavailable) return unavailable;
  const { photoId } = await params;
  const { user, couple } = auth;
  const sql = database()!;
  await ensurePhotosSchema(sql);
  const row = await photoById(sql, couple.id, photoId);
  if (!row) return apiError(404, "not_found", "Photo not found.");
  if (row.authorUserId !== user.id) return apiError(403, "forbidden", "Only the author can delete a photo.");

  if (row.storage === "s3") {
    let errors: { key: string; code: string }[];
    try {
      ({ errors } = await deleteObjects([row.objectKey, row.thumbKey].filter((key): key is string => Boolean(key))));
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      console.error(`[v1/photos] delete: ${error.message}`);
      return apiError(503, "storage_not_configured", "Photo storage is unavailable right now. Try again shortly.", { "Retry-After": "60" });
    }
    if (errors.length) return apiError(500, "internal", "Could not delete the photo. Try again.");
  }
  await sql`DELETE FROM couple_photos WHERE id = ${row.id}`;
  if (row.isDaily) {
    await sql`UPDATE couple_photos SET is_daily = true WHERE id = (SELECT id FROM couple_photos WHERE couple_id = ${couple.id} AND author_user_id = ${user.id} AND local_day = ${row.localDay}::date AND status = 'ready' ORDER BY ready_at NULLS LAST, created_at, id LIMIT 1) AND NOT EXISTS (SELECT 1 FROM couple_photos WHERE couple_id = ${couple.id} AND author_user_id = ${user.id} AND local_day = ${row.localDay}::date AND is_daily)`;
  }
  return new Response(null, { status: 204, headers: noStore });
}
