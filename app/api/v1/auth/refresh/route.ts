import { refreshSessionResponse } from "../../../../../api/v1/refresh-tokens";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/refresh `{ refreshToken, platform }`: rotate for a new hm_u_ access token. */
export async function POST(request: Request) {
  return refreshSessionResponse(request);
}
