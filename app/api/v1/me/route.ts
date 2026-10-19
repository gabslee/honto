import { meResponse } from "../../../../api/v1/couple";

export const dynamic = "force-dynamic";

/** GET /api/v1/me: user, couple (or null), entitlement, pending unpair and open invite flags. */
export async function GET(request: Request) {
  return meResponse(request);
}
