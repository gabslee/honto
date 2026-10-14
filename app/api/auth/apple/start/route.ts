import { randomUUID } from "node:crypto";
import { safeGoogleReturn } from "../../../../google-return.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) return Response.redirect(new URL("/?auth=missing_config", request.url));
  const state = randomUUID() + randomUUID();
  const nonce = randomUUID() + randomUUID();
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const requestedReturn = requestUrl.searchParams.get("return_to") || request.headers.get("referer") || "/";
  const returnTo = safeGoogleReturn(requestedReturn, origin);
  const redirectUri = `${origin}/api/auth/apple/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
    nonce,
  });
  const headers = new Headers({ Location: `https://appleid.apple.com/auth/authorize?${params}` });
  headers.append("Set-Cookie", `honto_apple_state=${state}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600`);
  headers.append("Set-Cookie", `honto_apple_nonce=${nonce}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600`);
  headers.append("Set-Cookie", `honto_apple_return=${encodeURIComponent(returnTo)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600`);
  return new Response(null, { status: 302, headers });
}
