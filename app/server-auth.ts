import { neon } from "@neondatabase/serverless";

const ADMIN_COOKIE = "honto_admin_session";
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let schemaReady: Promise<void> | null = null;

export type AdminUser = { id: string; email: string; displayName: string; role: "admin" };

export function adminCookieName() { return ADMIN_COOKIE; }

export function ensureIdentitySchema() {
  if (!sql) return Promise.resolve();
  if (!schemaReady) schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS auth_accounts (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider text NOT NULL, provider_account_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, provider_account_id))`;
    await sql`CREATE TABLE IF NOT EXISTS admin_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at)`;
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
