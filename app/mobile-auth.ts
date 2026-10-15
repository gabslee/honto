import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { database, ensureIdentitySchema } from "./server-auth";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";
let googleKeys: JWTVerifyGetKey | null = null;
let appleKeys: JWTVerifyGetKey | null = null;
const googleJwks = () => (googleKeys ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));
const appleJwks = () => (appleKeys ??= createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")));

export type ProviderIdentity = { provider: "google" | "apple"; sub: string; email: string | null; emailVerified: boolean; name: string | null };

/** Audiences accepted for native Google ID tokens: the web client and the iOS client. */
export function googleAudiences(env: Record<string, string | undefined> = process.env) {
  return [env.GOOGLE_CLIENT_ID, env.GOOGLE_IOS_CLIENT_ID, env.GOOGLE_ANDROID_CLIENT_ID].map((v) => v?.trim()).filter((v): v is string => Boolean(v));
}
export function appleAudiences(env: Record<string, string | undefined> = process.env) {
  return [env.APPLE_IOS_BUNDLE_ID?.trim() || "com.hontogame.app"];
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Native SDKs put either the raw nonce or its SHA-256 in the token; accept both when the app sends one. */
async function checkNonce(claims: JWTPayload, nonce: unknown) {
  if (typeof nonce !== "string" || !nonce) return;
  if (claims.nonce !== nonce && claims.nonce !== await sha256Hex(nonce)) throw new Error("Invalid nonce");
}
const truthy = (v: unknown) => v === true || v === "true";

export async function verifyGoogleIdToken(idToken: string, options: { audiences?: string[]; nonce?: unknown; keys?: JWTVerifyGetKey } = {}): Promise<ProviderIdentity> {
  const audiences = options.audiences ?? googleAudiences();
  if (!audiences.length) throw new Error("missing_config");
  const { payload } = await jwtVerify(idToken, options.keys ?? googleJwks(), { issuer: GOOGLE_ISSUERS, audience: audiences, algorithms: ["RS256"] });
  await checkNonce(payload, options.nonce);
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("No subject");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  return { provider: "google", sub: payload.sub, email, emailVerified: truthy(payload.email_verified), name: typeof payload.name === "string" ? payload.name : null };
}

export async function verifyAppleNativeToken(idToken: string, options: { audiences?: string[]; nonce?: unknown; keys?: JWTVerifyGetKey } = {}): Promise<ProviderIdentity> {
  const { payload } = await jwtVerify(idToken, options.keys ?? appleJwks(), { issuer: APPLE_ISSUER, audience: options.audiences ?? appleAudiences(), algorithms: ["RS256"] });
  await checkNonce(payload, options.nonce);
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("No subject");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  return { provider: "apple", sub: payload.sub, email, emailVerified: truthy(payload.email_verified), name: null };
}

/**
 * Same account as the web login: match by provider subject first (Apple only sends the email on the
 * first sign-in), then by verified email (the users.email unique key the web callbacks upsert on).
 */
export async function findOrCreateProviderUser(identity: ProviderIdentity, displayName?: string | null) {
  const sql = database();
  if (!sql) throw new Error("DATABASE_URL is not configured");
  await ensureIdentitySchema();
  const linked = await sql`SELECT user_id FROM auth_accounts WHERE provider = ${identity.provider} AND provider_account_id = ${identity.sub} LIMIT 1`;
  if (linked[0]) return { userId: String(linked[0].user_id), created: false };
  if (!identity.email || !identity.emailVerified) throw new Error("email_not_verified");
  const name = (displayName || identity.name || identity.email).trim().slice(0, 80);
  const role = process.env.HONTO_ADMIN_EMAIL?.trim().toLowerCase() === identity.email ? "admin" : "user";
  const existing = await sql`SELECT id FROM users WHERE email = ${identity.email} LIMIT 1`;
  const users = existing[0] ? existing : await sql`INSERT INTO users (id, email, display_name, role, plan, subscription_status) VALUES (${crypto.randomUUID()}, ${identity.email}, ${name}, ${role}, ${role === "admin" ? "premium" : "free"}, ${role === "admin" ? "active" : "inactive"}) ON CONFLICT (email) DO UPDATE SET updated_at = now() RETURNING id`;
  const userId = String(users[0].id);
  await sql`INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES (${crypto.randomUUID()}, ${userId}, ${identity.provider}, ${identity.sub}) ON CONFLICT (provider, provider_account_id) DO UPDATE SET user_id = EXCLUDED.user_id`;
  return { userId, created: !existing[0] };
}
