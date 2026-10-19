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

export const PRIVATE_RELAY_SUFFIX = "@privaterelay.appleid.com";
/** Apple "Hide My Email" address: the account cannot be found by the person's real email later. */
export function isPrivateRelayEmail(email: string | null | undefined) {
  return Boolean(email && email.trim().toLowerCase().endsWith(PRIVATE_RELAY_SUFFIX));
}

/** User already linked to this provider subject, or null. */
export async function findLinkedUser(provider: string, sub: string) {
  const sql = database();
  if (!sql) throw new Error("DATABASE_URL is not configured");
  const rows = await sql`SELECT a.user_id FROM auth_accounts a JOIN users u ON u.id = a.user_id WHERE a.provider = ${provider} AND a.provider_account_id = ${sub} LIMIT 1`;
  return rows[0] ? String(rows[0].user_id) : null;
}

/**
 * Links a provider subject to a user. Never moves an identity: if the subject already belongs to someone,
 * nothing is written. Returns the user the subject belongs to after the call (`userId` when linked now or
 * already; another id when it was taken, which callers treat as a conflict or as the account to sign in to).
 */
export async function linkProviderIdentity(provider: string, sub: string, userId: string) {
  const sql = database();
  if (!sql) throw new Error("DATABASE_URL is not configured");
  const inserted = await sql`INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES (${crypto.randomUUID()}, ${userId}, ${provider}, ${sub}) ON CONFLICT (provider, provider_account_id) DO NOTHING RETURNING user_id`;
  if (inserted[0]) return userId;
  const owner = await sql`SELECT user_id FROM auth_accounts WHERE provider = ${provider} AND provider_account_id = ${sub} LIMIT 1`;
  return owner[0] ? String(owner[0].user_id) : userId;
}

/**
 * Same account as the web login:
 * 1. the provider subject already linked in auth_accounts (Apple only sends the email on the first sign-in);
 * 2. else, only when the provider says the email is verified, an existing user with that email
 *    (`lower(email)`, so mixed-case rows from older flows match), and the subject is linked to it;
 * 3. else a new user with that verified email.
 * Throws `email_not_verified` when there is no linked subject and no verified email. Identities are never
 * moved between users: if the subject was linked concurrently, that owner is the account returned.
 */
export async function findOrCreateProviderUser(identity: ProviderIdentity, displayName?: string | null) {
  const sql = database();
  if (!sql) throw new Error("DATABASE_URL is not configured");
  await ensureIdentitySchema();
  const linked = await findLinkedUser(identity.provider, identity.sub);
  if (linked) return { userId: linked, created: false };
  const email = identity.email?.trim().toLowerCase();
  if (!email || !identity.emailVerified) throw new Error("email_not_verified");
  let created = false;
  let user = (await sql`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY created_at, id LIMIT 1`)[0];
  if (!user) {
    const name = (displayName || identity.name || email).trim().slice(0, 80);
    const role = process.env.HONTO_ADMIN_EMAIL?.trim().toLowerCase() === email ? "admin" : "user";
    const inserted = await sql`INSERT INTO users (id, email, display_name, role, plan, subscription_status) VALUES (${crypto.randomUUID()}, ${email}, ${name}, ${role}, ${role === "admin" ? "premium" : "free"}, ${role === "admin" ? "active" : "inactive"}) ON CONFLICT (email) DO NOTHING RETURNING id`;
    user = inserted[0] ?? (await sql`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY created_at, id LIMIT 1`)[0];
    created = Boolean(inserted[0]);
  }
  const userId = String(user.id);
  const owner = await linkProviderIdentity(identity.provider, identity.sub, userId);
  return { userId: owner, created: created && owner === userId };
}
