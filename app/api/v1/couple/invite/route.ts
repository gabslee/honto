import { createInviteResponse, getInviteResponse } from "../../../../../server/v1/couple";

export const dynamic = "force-dynamic";

/** GET /api/v1/couple/invite: my open pairing code. */
export async function GET(request: Request) {
  return getInviteResponse(request);
}

/** POST /api/v1/couple/invite: `{ code, url, expiresAt }`, 48h, replaces my previous code. */
export async function POST(request: Request) {
  return createInviteResponse(request);
}
