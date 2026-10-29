import { linkProviderResponse } from "../../../../../../server/v1/provider-login";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/link/{provider} `{ idToken, nonce? }`: add a Google / Apple sign-in to my account. */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return linkProviderResponse(request, (await params).provider);
}
