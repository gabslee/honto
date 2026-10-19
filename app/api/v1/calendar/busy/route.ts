import { apiError, noStore, requireCouple } from "../../../../../api/v1/context";
import { database } from "../../../../server-auth";
import { parseBusyUpload, replaceBusyBlocks } from "../calendar-service";

export const dynamic = "force-dynamic";

/**
 * PUT /api/v1/calendar/busy: atomically replaces my busy blocks in `[from, to)` (at most 14 days ahead,
 * 500 blocks). Allowed on Free so the data is ready when Premium starts; titles and all-day blocks are
 * never stored.
 */
export async function PUT(request: Request) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const now = Date.now();
  const upload = parseBusyUpload(await request.json().catch(() => null), now);
  if ("error" in upload) return apiError(400, "bad_request", upload.error);
  const result = await replaceBusyBlocks(database()!, auth.couple.id, auth.user.id, upload, now);
  return Response.json(result, { headers: noStore });
}
