import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { JWTVerifyGetKey } from "jose";
import type { AuthPlatform, AuthSession, LogoutResponse, User } from "../../contracts/honto-api";
import { verifyAppleNativeToken, verifyGoogleIdToken, type ProviderIdentity } from "../../app/mobile-auth";
import { bearerToken, clearUserCookie, createMobileToken, database, ensureIdentitySchema, revokeMobileToken } from "../../app/server-auth";
import { apiError, noStore, requireUser } from "./context";
import { ensureLifecycleSchema, sessionTokenHash } from "./lifecycle";
import { issueRefreshToken, REFRESH_TTL_DAYS } from "./refresh-tokens";

type Sql = NeonQueryFunction<false, false>;
type Provider = "google" | "apple";
const PLATFORMS: AuthPlatform[] = ["ios", "android"];

let testKeys: Partial<Record<Provider, JWTVerifyGetKey>> = {};
/** Tests: verify against a local JWKS instead of Google's / Apple's. */
export function setProviderKeys(keys: Partial<Record<Provider, JWTVerifyGetKey>>) { testKeys = keys; }

/**
 * jose verification against the provider JWKS (signature, issuer, expiry, nonce when sent):
 * - Google: audience = GOOGLE_CLIENT_ID / GOOGLE_IOS_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID; `email_verified` is required.
 * - Apple: audience = the bundle id (APPLE_IOS_BUNDLE_ID, default com.hontogame.app).
 */
async function verifyIdentity(provider: Provider, idToken: string, nonce: unknown) {
  return provider === "google"
    ? verifyGoogleIdToken(idToken, { nonce, keys: testKeys.google })
    : verifyAppleNativeToken(idToken, { nonce, keys: testKeys.apple });
}

/**
 * Same Honto account across the web game, /api/mobile and the new app:
 * 1. the provider subject already linked in auth_accounts (Apple only sends the email on the first sign-in);
 * 2. else an existing user with the same email (lower(), so mixed-case rows from older flows match), only when
 *    the provider says the email is verified; the subject is linked to that user, so existing accounts
 *    (Premium included) are relinked, never duplicated;
 * 3. else a new user, again only with a verified email.
 * Without a verified email and no linked subject it throws `email_required`.
 */
export async function findOrLinkProviderUser(sql: Sql, identity: ProviderIdentity, name: string | null) {
  await ensureIdentitySchema();
  const linked = await sql`SELECT a.user_id AS "userId" FROM auth_accounts a JOIN users u ON u.id = a.user_id WHERE a.provider = ${identity.provider} AND a.provider_account_id = ${identity.sub} LIMIT 1`;
  if (linked[0]) return { userId: String(linked[0].userId), created: false };
  const email = identity.email?.trim().toLowerCase();
  if (!email || !identity.emailVerified) throw new Error("email_required");
  let created = false;
  let user = (await sql`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY created_at, id LIMIT 1`)[0];
  if (!user) {
    const displayName = (name?.trim() || identity.name?.trim() || email.split("@")[0]).slice(0, 80);
    const role = process.env.HONTO_ADMIN_EMAIL?.trim().toLowerCase() === email ? "admin" : "user";
    const inserted = await sql`INSERT INTO users (id, email, display_name, role, plan, subscription_status) VALUES (${crypto.randomUUID()}, ${email}, ${displayName}, ${role}, ${role === "admin" ? "premium" : "free"}, ${role === "admin" ? "active" : "inactive"}) ON CONFLICT (email) DO NOTHING RETURNING id`;
    user = inserted[0] ?? (await sql`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY created_at, id LIMIT 1`)[0];
    created = Boolean(inserted[0]);
  }
  const userId = String(user.id);
  await sql`INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES (${crypto.randomUUID()}, ${userId}, ${identity.provider}, ${identity.sub}) ON CONFLICT (provider, provider_account_id) DO UPDATE SET user_id = EXCLUDED.user_id`;
  return { userId, created };
}

/**
 * POST /api/v1/auth/google and /api/v1/auth/apple `{ idToken, nonce?, platform, name? }`. Returns the same
 * session as the email login: an opaque `hm_u_` token (365 days) plus a rotating `hm_r_` refresh token.
 * 200 existing account, 201 new; 400 bad body / `email_required`; 401 `invalid_token`; 503 `missing_config`.
 */
export async function providerSignIn(request: Request, provider: Provider) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
  const platform = body?.platform as AuthPlatform;
  if (!idToken || !PLATFORMS.includes(platform)) return apiError(400, "bad_request", "Send idToken and platform (ios or android).");
  const sql = database();
  if (!sql) return apiError(503, "missing_config", "Database is not configured.");
  let identity: ProviderIdentity;
  try {
    identity = await verifyIdentity(provider, idToken, body?.nonce);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "missing_config") return apiError(503, "missing_config", "Sign-in is not configured.");
    return apiError(401, "invalid_token", "Invalid sign-in token.");
  }
  if (provider === "google" && !identity.emailVerified) return apiError(400, "email_required", "Your Google email must be verified.");
  await ensureLifecycleSchema(sql);
  let account: { userId: string; created: boolean };
  try {
    account = await findOrLinkProviderUser(sql, identity, provider === "apple" && typeof body?.name === "string" ? body.name : null);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "email_required") return apiError(400, "email_required", "Share your email the first time you sign in.");
    throw cause;
  }
  const token = await createMobileToken({ kind: "user", userId: account.userId, platform });
  const refreshToken = await issueRefreshToken(sql, account.userId, platform, undefined, token);
  const user = (await sql`SELECT id, email, display_name AS "displayName", time_zone AS "timeZone", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt" FROM users WHERE id = ${account.userId}`)[0] as User;
  const result: AuthSession = { token, tokenType: "Bearer", expiresInDays: 365, created: account.created, user: { id: user.id, email: user.email, displayName: user.displayName, timeZone: user.timeZone ?? null, createdAt: user.createdAt }, refreshToken, refreshExpiresInDays: REFRESH_TTL_DAYS };
  return Response.json(result, { status: account.created ? 201 : 200, headers: noStore });
}

/**
 * POST /api/v1/auth/logout: revokes the credential of this request. Bearer `hm_u_`: the token and the refresh
 * chain issued with it. Cookie: the `honto_session` row, and the cookie is cleared. 401 when not signed in.
 */
export async function logoutResponse(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sql = database()!;
  await ensureLifecycleSchema(sql);
  const headers: Record<string, string> = { ...noStore };
  let revoked: boolean;
  const bearer = bearerToken(request);
  if (bearer) {
    revoked = await revokeMobileToken(request);
    await sql`UPDATE v1_refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND family_id IN (SELECT family_id FROM v1_refresh_tokens WHERE access_hash = ${await sessionTokenHash(bearer)})`;
  } else {
    const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("honto_session="))?.slice("honto_session=".length) ?? "";
    revoked = (await sql`DELETE FROM user_sessions WHERE token_hash = ${await sessionTokenHash(cookie)} RETURNING user_id`).length > 0;
    headers["Set-Cookie"] = clearUserCookie();
  }
  const result: LogoutResponse = { revoked };
  return Response.json(result, { headers });
}
