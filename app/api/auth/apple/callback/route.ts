import { generateAppleClientSecret, verifyAppleIdToken } from "../../../../apple-auth";
import { googleReturnWithAuth } from "../../../../google-return.js";
import { findOrCreateProviderUser } from "../../../../mobile-auth";
import { createUserSession, database, ensureIdentitySchema, userCookie } from "../../../../server-auth";

export const dynamic = "force-dynamic";

const cookie = (request: Request, name: string) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;

function redirect(request: Request, path: string, cookies: string[]) {
  const headers = new Headers({ Location: new URL(path, request.url).toString() });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}

function appleName(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value) as { name?: { firstName?: string; lastName?: string } };
    return [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(" ").trim().slice(0, 80);
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  const stateCookie = cookie(request, "honto_apple_state");
  const nonceCookie = cookie(request, "honto_apple_nonce");
  const returnCookie = cookie(request, "honto_apple_return");
  const clears = [clearCookie("honto_apple_state"), clearCookie("honto_apple_nonce"), clearCookie("honto_apple_return")];
  const decodedReturn = (() => { try { return decodeURIComponent(returnCookie); } catch { return "/"; } })();
  const withAuth = (result: string) => googleReturnWithAuth(decodedReturn, result);
  const form = await request.formData();
  const code = form.get("code");
  const state = form.get("state");
  if (typeof code !== "string" || !code || typeof state !== "string" || !stateCookie || state !== stateCookie || !nonceCookie) return redirect(request, withAuth("invalid_state"), clears);

  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !privateKey) return redirect(request, withAuth("missing_config"), clears);

  try {
    const redirectUri = `${new URL(request.url).origin}/api/auth/apple/callback`;
    const clientSecret = await generateAppleClientSecret({ clientId, teamId, keyId, privateKey });
    const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
    if (!tokenResponse.ok) throw new Error(`Apple token exchange failed (${tokenResponse.status})`);
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error("Apple did not return an id_token");
    const claims = await verifyAppleIdToken(tokens.id_token, clientId, nonceCookie);
    // A verified email is only needed when the Apple subject is not linked yet (findOrCreateProviderUser).
    const verified = claims.email_verified === true || claims.email_verified === "true";

    const sql = database();
    if (!sql) throw new Error("DATABASE_URL is not configured");
    await ensureIdentitySchema();
    const email = claims.email?.toLowerCase() ?? null;
    const name = appleName(form.get("user")) || email;
    const role = verified && email && process.env.HONTO_ADMIN_EMAIL?.trim().toLowerCase() === email ? "admin" : "user";
    // Linked Apple subject first, then the verified email (case-insensitive), else a new user. The subject is
    // linked without ever moving it to another user.
    const { userId } = await findOrCreateProviderUser({ provider: "apple", sub: claims.sub, email, emailVerified: verified, name: null }, name);
    if (role === "admin") await sql`UPDATE users SET role = 'admin', plan = 'premium', subscription_status = 'active', updated_at = now() WHERE id = ${userId}`;
    const session = await createUserSession(userId);
    return redirect(request, withAuth("success"), [userCookie(session), ...clears]);
  } catch (error) {
    console.error("[auth/apple] callback failed", error);
    return redirect(request, withAuth("error"), clears);
  }
}
