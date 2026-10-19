import { providerSignIn } from "../../../../../api/v1/provider-login";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/google `{ idToken, nonce?, platform }`: native Google Sign-In, returns an hm_u_ session. */
export async function POST(request: Request) {
  return providerSignIn(request, "google");
}
