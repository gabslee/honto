// Third-party cleanup when an account is deleted (after the database transaction commits): the RevenueCat
// subscriber and the Sign in with Apple grant (App Store guideline 5.1.1(v)). Every call here is best effort:
// it never throws, never logs a token or key, and is a logged no-op while its settings are missing.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { generateAppleClientSecret } from "../../app/apple-auth";

type Sql = NeonQueryFunction<false, false>;

const REVENUECAT_API = "https://api.revenuecat.com/v2/projects/";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const TIMEOUT_MS = 10_000;

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : "unknown error");

/**
 * DELETE /v2/projects/{project_id}/customers/{customer_id} (RevenueCat REST API v2; needs a v2 secret key with
 * customer_information:customers:read_write). The app logs in to RevenueCat with the Honto user id, so that is the
 * customer id. 404 (never purchased, or already gone) counts as done. Without REVENUECAT_SECRET_API_KEY or
 * REVENUECAT_PROJECT_ID it logs a warning and does nothing. Resolves with the HTTP status, or null.
 */
export async function deleteRevenueCatCustomer(userId: string, env: Record<string, string | undefined> = process.env): Promise<number | null> {
  const key = env.REVENUECAT_SECRET_API_KEY?.trim();
  const projectId = env.REVENUECAT_PROJECT_ID?.trim();
  const missing = [!key && "REVENUECAT_SECRET_API_KEY", !projectId && "REVENUECAT_PROJECT_ID"].filter(Boolean);
  if (missing.length) {
    console.warn(`[v1/account] ${missing.join(" and ")} not set; the RevenueCat customer of the deleted account was not deleted`);
    return null;
  }
  const url = `${REVENUECAT_API}${encodeURIComponent(projectId!)}/customers/${encodeURIComponent(userId)}`;
  try {
    const response = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 404) return 404;
    if (!response.ok) console.error(`[v1/account] RevenueCat customer delete failed (${response.status})`);
    return response.status;
  } catch (cause) {
    console.error(`[v1/account] RevenueCat customer delete failed: ${errorText(cause)}`);
    return null;
  }
}

export type AppleToken = { clientId: string; refreshToken: string };
type AppleKey = { teamId: string; keyId: string; privateKey: string };

/** The Sign in with Apple key (same settings as the web flow in app/api/auth/apple/callback), or null when incomplete. */
export function appleKeyConfig(env: Record<string, string | undefined> = process.env): AppleKey | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  const privateKey = env.APPLE_PRIVATE_KEY;
  return teamId && keyId && privateKey ? { teamId, keyId, privateKey } : null;
}

/**
 * Exchanges a Sign in with Apple authorization code (web callback, or the native credential's
 * `authorizationCode`) for Apple's refresh token, the token the deletion revokes. `clientId` is the services id
 * for the web and the bundle id for the app. Null when the key is not configured or Apple refuses the code.
 */
export async function exchangeAppleCode(code: string, clientId: string, options: { redirectUri?: string; env?: Record<string, string | undefined> } = {}): Promise<string | null> {
  const key = appleKeyConfig(options.env);
  if (!key || !code || !clientId) return null;
  try {
    const body = new URLSearchParams({ client_id: clientId, client_secret: await generateAppleClientSecret({ clientId, ...key }), code, grant_type: "authorization_code" });
    if (options.redirectUri) body.set("redirect_uri", options.redirectUri);
    const response = await fetch(APPLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) { console.warn(`[auth/apple] authorization code exchange failed (${response.status})`); return null; }
    const tokens = await response.json() as { refresh_token?: unknown };
    return typeof tokens.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : null;
  } catch (cause) {
    console.warn(`[auth/apple] authorization code exchange failed: ${errorText(cause)}`);
    return null;
  }
}

/** Keeps the newest Apple refresh token per user and client id (apple_tokens, drizzle/0016_account_deletion.sql). */
export async function storeAppleRefreshToken(sql: Sql, userId: string, clientId: string, refreshToken: string) {
  await sql`INSERT INTO apple_tokens (user_id, client_id, refresh_token) VALUES (${userId}, ${clientId}, ${refreshToken})
    ON CONFLICT (user_id, client_id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, updated_at = now()`;
}

/**
 * POST https://appleid.apple.com/auth/revoke for each stored refresh token (token_type_hint refresh_token), so
 * the app disappears from the person's "Sign in with Apple" list. Without the Apple key settings it logs a
 * warning per token and does nothing. Resolves with the number revoked.
 */
export async function revokeAppleTokens(tokens: AppleToken[], env: Record<string, string | undefined> = process.env): Promise<number> {
  if (!tokens.length) return 0;
  const key = appleKeyConfig(env);
  if (!key) {
    console.warn(`[v1/account] APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY are not set; ${tokens.length} Sign in with Apple token(s) were not revoked`);
    return 0;
  }
  let revoked = 0;
  for (const token of tokens) {
    try {
      const body = new URLSearchParams({ client_id: token.clientId, client_secret: await generateAppleClientSecret({ clientId: token.clientId, ...key }), token: token.refreshToken, token_type_hint: "refresh_token" });
      const response = await fetch(APPLE_REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.ok) revoked += 1; else console.error(`[v1/account] Apple token revoke failed (${response.status})`);
    } catch (cause) {
      console.error(`[v1/account] Apple token revoke failed: ${errorText(cause)}`);
    }
  }
  return revoked;
}
