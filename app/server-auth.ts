import { neon } from "@neondatabase/serverless";

const ADMIN_COOKIE = "honto_admin_session";
const USER_COOKIE = "honto_session";
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let schemaReady: Promise<void> | null = null;

export type AdminUser = { id: string; email: string; displayName: string; role: "admin" };
export type CurrentUser = { id: string; email: string; displayName: string; role: "user" | "admin"; plan: "free" | "premium"; subscriptionStatus: "inactive" | "active" | "past_due" | "canceled"; subscriptionExpiresAt: string | null; trialStartedAt: string | null; trialEndsAt: string | null; stripeCustomerId: string | null; stripeSubscriptionId: string | null; termsAcceptedAt: string | null; termsVersion: string | null };

export function adminCookieName() { return ADMIN_COOKIE; }

export function ensureIdentitySchema() {
  if (!sql) return Promise.resolve();
  if (!schemaReady) schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'inactive'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at timestamptz`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version text`;
    await sql`UPDATE users SET plan = 'premium', subscription_status = 'active', subscription_expires_at = NULL WHERE role = 'admin'`;
    await sql`CREATE TABLE IF NOT EXISTS auth_accounts (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider text NOT NULL, provider_account_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, provider_account_id))`;
    await sql`CREATE TABLE IF NOT EXISTS admin_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS user_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at)`;
    await sql`CREATE TABLE IF NOT EXISTS ai_usage (scope text NOT NULL, scope_key text NOT NULL, window_start timestamptz NOT NULL, uses integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope, scope_key, window_start))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_usage_updated_at ON ai_usage(updated_at)`;
    await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id)`;
  })();
  return schemaReady;
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${process.env.AUTH_SESSION_SALT ?? "honto-auth"}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request) {
  const cookies = request.headers.get("cookie")?.split(";").map((part) => part.trim()) ?? [];
  return cookies.find((part) => part.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1) ?? "";
}

export async function getAdminUser(request: Request): Promise<AdminUser | null> {
  if (!sql) return null;
  const token = cookieValue(request);
  if (!token) return null;
  await ensureIdentitySchema();
  const rows = await sql`SELECT u.id, u.email, u.display_name AS "displayName", u.role FROM admin_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${await hash(token)} AND s.expires_at > now() AND u.role = 'admin' LIMIT 1`;
  return (rows[0] as AdminUser | undefined) ?? null;
}

export async function createUserSession(userId: string) {
  if (!sql) throw new Error("DATABASE_URL is not configured.");
  await ensureIdentitySchema();
  const token = crypto.randomUUID() + crypto.randomUUID();
  await sql`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (${await hash(token)}, ${userId}, now() + interval '30 days')`;
  return token;
}

export async function getCurrentUser(request: Request) {
  if (!sql) return null;
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${USER_COOKIE}=`))?.slice(USER_COOKIE.length + 1) ?? "";
  if (!token) return null;
  await ensureIdentitySchema();
  const rows = await sql`SELECT u.id, u.email, u.display_name AS "displayName", u.role, u.plan, u.subscription_status AS "subscriptionStatus", u.subscription_expires_at AS "subscriptionExpiresAt", u.trial_started_at AS "trialStartedAt", u.trial_ends_at AS "trialEndsAt", u.stripe_customer_id AS "stripeCustomerId", u.stripe_subscription_id AS "stripeSubscriptionId", u.terms_accepted_at AS "termsAcceptedAt", u.terms_version AS "termsVersion" FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${await hash(token)} AND s.expires_at > now() LIMIT 1`;
  return (rows[0] as CurrentUser | undefined) ?? null;
}

export function hasPremiumAccess(user: CurrentUser | null) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.plan === "premium" && user.subscriptionStatus === "active" && (!user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt).getTime() > Date.now())) return true;
  return Boolean(user.trialEndsAt && new Date(user.trialEndsAt).getTime() > Date.now());
}

export function userCookie(token: string) { return `${USER_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`; }
export function clearUserCookie() { return `${USER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

export async function createAdminSession(email: string, displayName: string) {
  if (!sql) throw new Error("DATABASE_URL is not configured.");
  await ensureIdentitySchema();
  const normalizedEmail = email.trim().toLowerCase();
  const userId = crypto.randomUUID();
  const users = await sql`INSERT INTO users (id, email, display_name, role) VALUES (${userId}, ${normalizedEmail}, ${displayName.trim().slice(0, 80) || normalizedEmail}, 'admin') ON CONFLICT (email) DO UPDATE SET role = 'admin', display_name = EXCLUDED.display_name, updated_at = now() RETURNING id, email, display_name AS "displayName", role`;
  const user = users[0] as AdminUser;
  const token = crypto.randomUUID() + crypto.randomUUID();
  await sql`INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (${await hash(token)}, ${user.id}, now() + interval '30 days')`;
  return { token, user };
}

export function adminCookie(token: string) {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function hasAdminBootstrapToken(requestToken: string) {
  const expected = process.env.HONTO_ADMIN_TOKEN;
  return Boolean(expected && requestToken && requestToken === expected);
}

export function database() { return sql; }
