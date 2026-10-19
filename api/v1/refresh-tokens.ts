import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { AuthPlatform, AuthSession, User } from "../../contracts/honto-api";
import { createMobileToken, database, revokeMobileToken } from "../../app/server-auth";
import { apiError, noStore } from "./context";
import { clientIp, ensureLifecycleSchema, hitRateLimit, randomId, saltedHash, sessionTokenHash } from "./lifecycle";

type Sql = NeonQueryFunction<false, false>;

export const REFRESH_TTL_DAYS = 365;
/** A refresh token presented again within this window is a client retry (two requests raced), not theft. */
const RETRY_GRACE_SECONDS = 10;
const PLATFORMS: AuthPlatform[] = ["ios", "android"];

/**
 * New single-use `hm_r_` refresh token for the apps. `familyId` ties a sign-in to all its rotations;
 * `accessToken` is the `hm_u_` issued with it (only its hash is kept), so logout can end the chain.
 */
export async function issueRefreshToken(sql: Sql, userId: string, platform: AuthPlatform, familyId = randomId("rf_"), accessToken: string | null = null) {
  await ensureLifecycleSchema(sql);
  const token = `hm_r_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
  const accessHash = accessToken ? await sessionTokenHash(accessToken) : null;
  await sql`INSERT INTO v1_refresh_tokens (token_hash, user_id, family_id, platform, expires_at, access_hash) VALUES (${await saltedHash("refresh", token)}, ${userId}, ${familyId}, ${platform}, now() + make_interval(days => ${REFRESH_TTL_DAYS}::int), ${accessHash})`;
  return token;
}

/** Revokes every refresh token of a user (logout everywhere, account deletion). */
export async function revokeRefreshTokens(sql: Sql, userId: string) {
  await ensureLifecycleSchema(sql);
  await sql`UPDATE v1_refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
}

const invalid = () => apiError(401, "invalid_token", "Sign in again.");

/**
 * POST /api/v1/auth/refresh `{ refreshToken, platform }`. Rotation: the token is consumed by the statement
 * that checks it and a new access + refresh pair is returned. A token used again after the retry grace
 * revokes its whole family (it was copied), so the next refresh from either holder fails. The old access
 * token, when sent as `Authorization: Bearer hm_u_…`, is revoked.
 */
export async function refreshSessionResponse(request: Request) {
  const body = await request.json().catch(() => null) as { refreshToken?: unknown; platform?: unknown } | null;
  const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken.trim() : "";
  const platform = body?.platform as AuthPlatform;
  if (!refreshToken.startsWith("hm_r_") || refreshToken.length > 128 || !PLATFORMS.includes(platform)) return apiError(400, "bad_request", "Send refreshToken and platform (ios or android).");
  const sql = database();
  if (!sql) return apiError(500, "missing_config", "Database is not configured.");
  await ensureLifecycleSchema(sql);
  const wait = await hitRateLimit(sql, "refresh_ip", await saltedHash("ip", clientIp(request)), 30, 15 * 60);
  if (wait) return Response.json({ error: "Too many tries. Try again in a few minutes.", code: "rate_limited", retryAfterSeconds: wait }, { status: 429, headers: { ...noStore, "Retry-After": String(wait) } });

  const hash = await saltedHash("refresh", refreshToken);
  const used = await sql`UPDATE v1_refresh_tokens SET used_at = now() WHERE token_hash = ${hash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING user_id AS "userId", family_id AS "familyId"`;
  if (!used[0]) {
    // Reuse outside the retry grace: assume the token leaked and end the whole chain.
    await sql`UPDATE v1_refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM v1_refresh_tokens WHERE token_hash = ${hash} AND used_at IS NOT NULL AND used_at < now() - make_interval(secs => ${RETRY_GRACE_SECONDS}::int))`;
    return invalid();
  }
  const userId = String(used[0].userId);
  if (request.headers.get("authorization")?.toLowerCase().startsWith("bearer hm_u_")) await revokeMobileToken(request);
  const user = (await sql`SELECT id, email, display_name AS "displayName", time_zone AS "timeZone", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt" FROM users WHERE id = ${userId}`)[0] as User | undefined;
  if (!user) return invalid();
  const token = await createMobileToken({ kind: "user", userId, platform });
  const next = await issueRefreshToken(sql, userId, platform, String(used[0].familyId), token);
  const result: AuthSession = { token, tokenType: "Bearer", expiresInDays: 365, created: false, user: { id: user.id, email: user.email, displayName: user.displayName, timeZone: user.timeZone ?? null, createdAt: user.createdAt }, refreshToken: next, refreshExpiresInDays: REFRESH_TTL_DAYS };
  return Response.json(result, { headers: noStore });
}
