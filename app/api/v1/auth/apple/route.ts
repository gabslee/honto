import { providerSignIn } from "../../../../../api/v1/provider-login";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/apple `{ idToken, nonce?, name?, platform }`: native Sign in with Apple, returns an hm_u_ session. */
export async function POST(request: Request) {
  return providerSignIn(request, "apple");
}
