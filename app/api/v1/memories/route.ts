import type { MemoriesMonth, MemoryDaySummary } from "../../../../contracts/honto-api";
import { apiError, isCouplePremium, noStore, requireCouple } from "../../../../server/v1/context";
import { ensurePhotosSchema } from "../../../../server/v1/photos-schema";
import { database } from "../../../server-auth";
import { addDays, freeWindowStart, readyPhotosBetween, storageUnavailable, toPhotoThumb, type PhotoRow } from "../photos/photo-rows";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/memories?month=YYYY-MM: days of the month with at least one ready photo, each with my and my
 * partner's daily thumbnail. Free couples see the last 7 days (today in my zone and the 6 before); older
 * days come back `locked` with no thumbnails.
 */
export async function GET(request: Request) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const unavailable = storageUnavailable();
  if (unavailable) return unavailable;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return apiError(400, "bad_request", "month must be YYYY-MM.");
  const { user, couple } = auth;
  const sql = database()!;
  await ensurePhotosSchema(sql);
  const premium = await isCouplePremium(sql, couple.id);
  const now = new Date();
  const windowStart = premium ? null : freeWindowStart(user.timeZone, now);

  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 8) + "01", -1);
  const rows = await readyPhotosBetween(sql, couple.id, first, last);
  const byDay = new Map<string, PhotoRow[]>();
  for (const row of rows) byDay.set(row.localDay, [...(byDay.get(row.localDay) ?? []), row]);

  const days: MemoryDaySummary[] = [];
  for (const [day, photos] of byDay) {
    const locked = windowStart !== null && day < windowStart;
    // Rows are ordered daily first, so the first photo of each author is their daily photo.
    const mine = photos.find((p) => p.authorUserId === user.id);
    const theirs = photos.find((p) => p.authorUserId !== user.id);
    days.push({
      day,
      locked,
      photoCount: photos.length,
      me: !locked && mine ? await toPhotoThumb(mine, now) : null,
      partner: !locked && theirs ? await toPhotoThumb(theirs, now) : null,
    });
  }
  const result: MemoriesMonth = { month, historyLimitDays: premium ? null : 7, days };
  return Response.json(result, { headers: noStore });
}
