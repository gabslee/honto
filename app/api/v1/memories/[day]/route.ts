import type { MemoryDay } from "../../../../../contracts/honto-api";
import { apiError, isCouplePremium, noStore, requireCouple } from "../../../../../api/v1/context";
import { ensurePhotosSchema } from "../../../../../api/v1/photos-schema";
import { database } from "../../../../server-auth";
import { freeWindowStart, isLocalDay, readyPhotosBetween, storageUnavailable, toApiPhoto } from "../../photos/photo-rows";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/memories/{day}: every ready photo of both partners for a local day: daily photos first (mine,
 * then my partner's), then the gallery by time. `403 premium_required` for a locked day on Free.
 */
export async function GET(request: Request, { params }: { params: Promise<{ day: string }> }) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const unavailable = storageUnavailable();
  if (unavailable) return unavailable;
  const { day } = await params;
  if (!isLocalDay(day)) return apiError(400, "bad_request", "day must be YYYY-MM-DD.");
  const { user, couple } = auth;
  const sql = database()!;
  await ensurePhotosSchema(sql);
  const now = new Date();
  if (!(await isCouplePremium(sql, couple.id)) && day < freeWindowStart(user.timeZone, now)) {
    return apiError(403, "premium_required", "Older memories are part of Premium.");
  }
  const rows = await readyPhotosBetween(sql, couple.id, day, day);
  const rank = (row: (typeof rows)[number]) => (row.isDaily ? 0 : 2) + (row.isDaily && row.authorUserId !== user.id ? 1 : 0);
  rows.sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const result: MemoryDay = { day, photos: await Promise.all(rows.map((row) => toApiPhoto(row, user.id, now))) };
  return Response.json(result, { headers: noStore });
}
