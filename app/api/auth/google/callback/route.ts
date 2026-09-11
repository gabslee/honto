import { ensureIdentitySchema, createUserSession, userCookie, database } from "../../../../server-auth";

export const dynamic = "force-dynamic";

function redirect(request: Request, path: string, cookies: string | string[] = []) {
  const headers = new Headers({ Location: new URL(path, request.url).toString() });
  for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateCookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("honto_google_state="))?.slice("honto_google_state=".length) ?? "";
  const clearState = "honto_google_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  if (!url.searchParams.get("code") || !stateCookie || stateCookie !== url.searchParams.get("state")) return redirect(request, "/?auth=invalid_state", clearState);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirect(request, "/?auth=missing_config", clearState);
  try {
    const origin = url.origin;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/auth/callback/google`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: url.searchParams.get("code")!, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
    if (!tokenResponse.ok) throw new Error(`Google token exchange failed (${tokenResponse.status})`);
    const tokens = await tokenResponse.json() as { access_token?: string };
    if (!tokens.access_token) throw new Error("Google did not return an access token");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) throw new Error(`Google profile lookup failed (${profileResponse.status})`);
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
    if (!profile.sub || !profile.email || profile.email_verified === false) throw new Error("Google account email is not verified");
    const sql = database();
    if (!sql) throw new Error("DATABASE_URL is not configured");
    await ensureIdentitySchema();
    const users = await sql`INSERT INTO users (id, email, display_name, role) VALUES (${crypto.randomUUID()}, ${profile.email.toLowerCase()}, ${(profile.name ?? profile.email).slice(0, 80)}, 'user') ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now() RETURNING id`;
    const userId = String(users[0].id);
    await sql`INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES (${crypto.randomUUID()}, ${userId}, 'google', ${profile.sub}) ON CONFLICT (provider, provider_account_id) DO UPDATE SET user_id = EXCLUDED.user_id`;
    const session = await createUserSession(userId);
    return redirect(request, "/?auth=success", [userCookie(session), clearState]);
  } catch (error) {
    console.error("[auth/google] callback failed", error);
    return redirect(request, "/?auth=error", clearState);
  }
}
