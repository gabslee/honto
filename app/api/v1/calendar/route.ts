import { apiError, isCouplePremium, noStore, requireCouple } from "../../../../api/v1/context";
import { database } from "../../../server-auth";
import { loadCalendarView, parseCalendarRange } from "./calendar-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/calendar?from&to: my blocks and my partner's (never titles) plus the partner's status now.
 * Premium couples only (402 `premium_required`).
 */
export async function GET(request: Request) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const range = parseCalendarRange(new URL(request.url));
  if ("error" in range) return apiError(400, "bad_request", range.error);
  const sql = database()!;
  if (!(await isCouplePremium(sql, auth.couple.id))) return apiError(402, "premium_required", "The couple calendar is part of Premium.");
  const view = await loadCalendarView(sql, auth.couple.id, auth.user.id, auth.partner.id, range, Date.now());
  return Response.json(view, { headers: noStore });
}
