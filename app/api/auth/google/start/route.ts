import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return Response.redirect(new URL("/?auth=missing_config", request.url));
  const state = randomUUID() + randomUUID();
  const origin = new URL(request.url).origin;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/auth/callback/google`;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", access_type: "offline", prompt: "select_account", state });
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, "Set-Cookie": `honto_google_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
}
