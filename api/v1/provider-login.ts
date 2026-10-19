import type { JWTVerifyGetKey } from "jose";
import type { AuthPlatform, AuthSession, LinkProvider, LogoutResponse, ProviderLinkResult, User } from "../../contracts/honto-api";
import { findLinkedUser, findOrCreateProviderUser, isPrivateRelayEmail, linkProviderIdentity, verifyAppleNativeToken, verifyGoogleIdToken, type ProviderIdentity } from "../../app/mobile-auth";
import { bearerToken, clearUserCookie, createMobileToken, database, revokeMobileToken } from "../../app/server-auth";
import { apiError, noStore, requireUser } from "./context";
import { ensureLifecycleSchema, sessionTokenHash } from "./lifecycle";
import { issueRefreshToken, REFRESH_TTL_DAYS } from "./refresh-tokens";

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
 * POST /api/v1/auth/google and /api/v1/auth/apple `{ idToken, nonce?, platform, name? }`. The account comes from
 * `findOrCreateProviderUser` (shared with /api/mobile and the web callbacks): linked subject, then verified
 * `lower(email)` (existing and Premium accounts are relinked, never duplicated), else a new user; identities are
 * never moved between users. Returns the same session as the email login (opaque `hm_u_`, 365 days, plus a
 * rotating `hm_r_`) with `isNewUser` and `usedPrivateRelayEmail` so the app can suggest linking.
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
    const name = provider === "apple" && typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : null;
    account = await findOrCreateProviderUser(identity, name);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "email_not_verified") return apiError(400, "email_required", "Share a verified email the first time you sign in.");
    throw cause;
  }
  const token = await createMobileToken({ kind: "user", userId: account.userId, platform });
  const refreshToken = await issueRefreshToken(sql, account.userId, platform, undefined, token);
  const user = (await sql`SELECT id, email, display_name AS "displayName", time_zone AS "timeZone", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt" FROM users WHERE id = ${account.userId}`)[0] as User;
  const result: AuthSession = { token, tokenType: "Bearer", expiresInDays: 365, created: account.created, user: { id: user.id, email: user.email, displayName: user.displayName, timeZone: user.timeZone ?? null, createdAt: user.createdAt }, refreshToken, refreshExpiresInDays: REFRESH_TTL_DAYS, isNewUser: account.created, usedPrivateRelayEmail: isPrivateRelayEmail(user.email) || isPrivateRelayEmail(identity.email) };
  return Response.json(result, { status: account.created ? 201 : 200, headers: noStore });
}

const LINK_PROVIDERS: LinkProvider[] = ["apple", "google"];
const providerName = (provider: LinkProvider) => provider === "apple" ? "Apple ID" : "Google account";

/**
 * POST /api/v1/auth/link/{provider} `{ idToken, nonce? }` (signed in): adds the token's provider subject to my
 * account. 201 linked now, 200 already mine, 409 `identity_in_use` when it belongs to another account (nothing
 * is moved), 401 not signed in / invalid token, 404 unknown provider, 503 provider not configured.
 */
export async function linkProviderResponse(request: Request, provider: string) {
  if (!LINK_PROVIDERS.includes(provider as LinkProvider)) return apiError(404, "not_found", "Unknown sign-in provider.");
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) return apiError(400, "bad_request", "idToken is required.");
  let identity: ProviderIdentity;
  try {
    identity = await verifyIdentity(provider as Provider, idToken, body?.nonce);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "missing_config") return apiError(503, "missing_config", "Sign-in is not configured.");
    return apiError(401, "invalid_token", "Invalid sign-in token.");
  }
  const me = auth.user.id;
  const inUse = () => apiError(409, "identity_in_use", `This ${providerName(provider as LinkProvider)} is already used by another Honto account.`);
  const result = (alreadyLinked: boolean): ProviderLinkResult => ({ provider: provider as LinkProvider, alreadyLinked, email: identity.email, usedPrivateRelayEmail: isPrivateRelayEmail(identity.email) });
  const current = await findLinkedUser(identity.provider, identity.sub);
  if (current === me) return Response.json(result(true), { headers: noStore });
  if (current) return inUse();
  const owner = await linkProviderIdentity(identity.provider, identity.sub, me);
  return owner === me ? Response.json(result(false), { status: 201, headers: noStore }) : inUse();
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
