import { logoutResponse } from "../../../../../api/v1/provider-login";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/logout: revoke the current bearer token (and its refresh chain) or the web session cookie. */
export async function POST(request: Request) {
  return logoutResponse(request);
}
