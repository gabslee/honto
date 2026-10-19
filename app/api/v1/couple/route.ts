import type { UnpairResult } from "../../../../contracts/honto-api";
import { apiError, noStore, requireCouple } from "../../../../api/v1/context";
import { getCoupleResponse, patchCoupleResponse } from "../../../../api/v1/couple";
import { unpairCouple } from "../../../../api/v1/lifecycle";
import { database } from "../../../server-auth";

export const dynamic = "force-dynamic";

/** GET /api/v1/couple: partner, start date, next reunion and derived counters. */
export async function GET(request: Request) {
  return getCoupleResponse(request);
}

/** PATCH /api/v1/couple `{ startedOn?, reunion? }` (omit = keep, null = clear). */
export async function PATCH(request: Request) {
  return patchCoupleResponse(request);
}

/** DELETE /api/v1/couple: unpair. Shared history goes now; each keeps their own photos for 30 days. */
export async function DELETE(request: Request) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const result: UnpairResult | null = await unpairCouple(database()!, auth.couple.id);
  if (!result) return apiError(409, "not_paired", "Pair with your partner first.");
  // TODO(W2a push): send couple.unpaired to the partner and end the couple's Live Activities.
  return Response.json(result, { headers: noStore });
}
