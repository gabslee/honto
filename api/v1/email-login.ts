import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { AuthSession, EmailStartResponse, Platform, User } from "../../contracts/honto-api";
import { createMobileToken, createUserSession, database, userCookie } from "../../app/server-auth";
import { apiError, noStore } from "./context";
import { clientIp, ensureLifecycleSchema, hitRateLimit, saltedHash } from "./lifecycle";
import { issueRefreshToken, REFRESH_TTL_DAYS } from "./refresh-tokens";

type Sql = NeonQueryFunction<false, false>;
type Env = Record<string, string | undefined>;

export const EMAIL_TOKEN_MINUTES = 15;
export const EMAIL_RESEND_SECONDS = 60;
const MAX_CODE_ATTEMPTS = 5;
const PRODUCTION_ORIGIN = "https://hontogame.com";
const PLATFORMS: Platform[] = ["ios", "android", "web"];

// ---------------------------------------------------------------------------------------------------
// Email sending. Resend over plain fetch when RESEND_API_KEY is set; otherwise a console sender in dev and
// Preview, and no sender at all in Production (start answers 503 email_unavailable, tokens are never logged).
// ---------------------------------------------------------------------------------------------------
export type EmailMessage = { to: string; subject: string; text: string; html: string; link: string; code: string };
export interface EmailSender {
  readonly name: "resend" | "console" | "test";
  send(message: EmailMessage): Promise<void>;
}

export function resendSender(apiKey: string, from: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): EmailSender {
  return {
    name: "resend",
    async send(message) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      });
      if (!response.ok) throw new Error(`Resend answered ${response.status}`);
    },
  };
}

export function consoleSender(log: (line: string) => void = (line) => console.info(line)): EmailSender {
  return { name: "console", async send(message) { log(`[v1/email] sign-in for ${message.to}: ${message.link} code ${message.code}`); } };
}

let senderOverride: EmailSender | null | undefined;
/** Tests: force a sender (`null` = unavailable); `undefined` restores the env-based choice. */
export function setEmailSender(sender: EmailSender | null | undefined) { senderOverride = sender; }

export function emailSenderFromEnv(env: Env = process.env): EmailSender | null {
  if (senderOverride !== undefined) return senderOverride;
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) return resendSender(apiKey, env.EMAIL_FROM?.trim() || "Honto <hello@hontogame.com>");
  return env.VERCEL_ENV === "production" ? null : consoleSender();
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Plain, short English email: the link, the 6-digit code, nothing else. System font stack (Inter-like), no emoji. */
export function signInEmail(to: string, link: string, code: string): EmailMessage {
  const subject = `Your Honto sign-in code: ${code}`;
  const text = [
    "Sign in to Honto",
    "",
    "Open this link on your phone or computer to sign in:",
    link,
    "",
    `Or enter this code in the app: ${code}`,
    "",
    `The link and the code work once and expire in ${EMAIL_TOKEN_MINUTES} minutes. If you did not ask for this, you can ignore this email.`,
  ].join("\n");
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif";
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:0;background:#F7F2E9;">
<div style="max-width:480px;margin:0 auto;padding:40px 24px;font-family:${font};color:#17243D;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:30px;font-weight:650;">Sign in to Honto</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:23px;color:#55607A;">Open this link on your phone or computer to sign in.</p>
<p style="margin:0 0 32px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;border-radius:26px;background:#17243D;color:#FFFCF7;font-size:16px;font-weight:600;text-decoration:none;">Sign in</a></p>
<p style="margin:0 0 8px;font-size:15px;line-height:20px;color:#55607A;">Or enter this code in the app:</p>
<p style="margin:0 0 32px;font-size:32px;line-height:40px;font-weight:600;letter-spacing:6px;font-variant-numeric:tabular-nums;">${code}</p>
<p style="margin:0;font-size:13px;line-height:18px;color:#8F95A3;">The link and the code work once and expire in ${EMAIL_TOKEN_MINUTES} minutes. If you did not ask for this, you can ignore this email.</p>
</div></body></html>`;
  return { to, subject, text, html, link, code };
}

// ---------------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------------

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Uniform 6-digit code (rejection sampling over 32-bit values). */
export function newSignInCode() {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (;;) {
    const value = crypto.getRandomValues(new Uint32Array(1))[0];
    if (value < limit) return String(value % 1_000_000).padStart(6, "0");
  }
}

/** Link origin: always hontogame.com in Production (universal links); the request's own origin elsewhere, so Preview links work. */
function linkOrigin(request: Request, env: Env = process.env) {
  if (env.VERCEL_ENV === "production") return PRODUCTION_ORIGIN;
  try { return new URL(request.url).origin; } catch { return PRODUCTION_ORIGIN; }
}

// ---------------------------------------------------------------------------------------------------
// App Review demo login. Apple reviewers cannot read a mailbox, so a short allowlist of demo addresses
// (HONTO_REVIEW_EMAILS, comma separated) accepts one fixed 6-digit code (HONTO_REVIEW_CODE) instead of an
// emailed one. Both must be set or the feature is off. For these addresses start sends no email and stores
// no token (same 202 as everyone else); verify checks the code in constant time, limited to 10 tries per
// address per hour (on top of the per-IP limit). Never applies to any address outside the allowlist.
// ---------------------------------------------------------------------------------------------------
export const REVIEW_CODE_TRIES_PER_HOUR = 10;

export function reviewLogin(email: string | null, env: Env = process.env): { code: string } | null {
  if (!email) return null;
  const code = env.HONTO_REVIEW_CODE?.trim() ?? "";
  if (!/^\d{6}$/.test(code)) return null;
  const allowed = (env.HONTO_REVIEW_EMAILS ?? "").split(",").map(normalizeEmail).filter((value): value is string => Boolean(value));
  return allowed.includes(email) ? { code } : null;
}

function sameCode(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const rateLimited = (seconds: number, error: string) => Response.json({ error, code: "rate_limited", retryAfterSeconds: seconds }, { status: 429, headers: { ...noStore, "Retry-After": String(seconds) } });

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

/**
 * POST /api/v1/auth/email/start `{ email, platform }`. Always 202 for a well-formed address (accounts are
 * never revealed). Limits: one email per address per 60 s and 5 per hour; 20 per IP per hour.
 */
export async function startEmailSignIn(request: Request) {
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  if (!email) return apiError(400, "bad_request", "Enter a valid email address.");
  const platform = body?.platform as Platform;
  if (!PLATFORMS.includes(platform)) return apiError(400, "bad_request", "platform must be ios, android or web.");
  const sender = emailSenderFromEnv();
  if (!sender) return apiError(503, "email_unavailable", "Email sign-in is not available right now. Use Apple or Google.");
  const sql = database();
  if (!sql) return apiError(500, "missing_config", "Database is not configured.");
  await ensureLifecycleSchema(sql);

  const recent = (await sql`SELECT count(*)::int AS hour, COALESCE(max(extract(epoch FROM (created_at + make_interval(secs => ${EMAIL_RESEND_SECONDS}::int) - now()))), 0)::float AS wait, ceil(COALESCE(extract(epoch FROM (min(created_at) + interval '1 hour' - now())), 0))::int AS "hourWait"
    FROM email_login_tokens WHERE email = ${email} AND created_at > now() - interval '1 hour'`)[0];
  if (Number(recent.wait) > 0) return rateLimited(Math.ceil(Number(recent.wait)), "Wait a minute before asking for another email.");
  if (Number(recent.hour) >= 5) return rateLimited(Math.max(1, Number(recent.hourWait)), "Too many emails. Try again later.");
  const ipWait = await hitRateLimit(sql, "email_start_ip", await saltedHash("ip", clientIp(request)), 20, 60 * 60);
  if (ipWait) return rateLimited(ipWait, "Too many emails. Try again later.");
  if (reviewLogin(email)) {
    const review: EmailStartResponse = { sent: true, expiresInSeconds: EMAIL_TOKEN_MINUTES * 60, resendAfterSeconds: EMAIL_RESEND_SECONDS };
    return Response.json(review, { status: 202, headers: noStore });
  }

  const token = `ml_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
  const code = newSignInCode();
  const tokenHash = await saltedHash("email-link", token);
  await sql`INSERT INTO email_login_tokens (token_hash, email, code_hash, platform, expires_at) VALUES (${tokenHash}, ${email}, ${await saltedHash("email-code", `${email}:${code}`)}, ${platform}, now() + make_interval(mins => ${EMAIL_TOKEN_MINUTES}::int))`;
  const link = `${linkOrigin(request)}/auth/email?token=${encodeURIComponent(token)}`;
  try {
    await sender.send(signInEmail(email, link, code));
  } catch (cause) {
    console.error("[v1/email] send failed", cause instanceof Error ? cause.message : cause);
    await sql`UPDATE email_login_tokens SET used_at = now() WHERE token_hash = ${tokenHash}`;
    return apiError(503, "email_unavailable", "Email sign-in is not available right now. Use Apple or Google.");
  }
  const result: EmailStartResponse = { sent: true, expiresInSeconds: EMAIL_TOKEN_MINUTES * 60, resendAfterSeconds: EMAIL_RESEND_SECONDS };
  return Response.json(result, { status: 202, headers: noStore });
}

/** Existing account with this (verified, by the link or code) email, or a new one. */
async function findOrCreateEmailUser(sql: Sql, email: string, name: unknown) {
  const existing = await sql`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY created_at LIMIT 1`;
  if (existing[0]) return { userId: String(existing[0].id), created: false };
  const displayName = (typeof name === "string" && name.trim() ? name.trim() : email.split("@")[0]).slice(0, 80);
  const role = process.env.HONTO_ADMIN_EMAIL?.trim().toLowerCase() === email ? "admin" : "user";
  const inserted = await sql`INSERT INTO users (id, email, display_name, role, plan, subscription_status) VALUES (${crypto.randomUUID()}, ${email}, ${displayName}, ${role}, ${role === "admin" ? "premium" : "free"}, ${role === "admin" ? "active" : "inactive"}) ON CONFLICT (email) DO NOTHING RETURNING id`;
  if (inserted[0]) return { userId: String(inserted[0].id), created: true };
  const raced = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  return { userId: String(raced[0].id), created: false };
}

/**
 * POST /api/v1/auth/email/verify `{ token }` or `{ email, code }`, plus `platform`. Single use: the row is
 * consumed by the same statement that checks it. A wrong code counts against every open token of that
 * email (5 tries each). 30 verify calls per IP per 15 minutes. Same response as `/api/mobile/auth/google`
 * (`hm_u_` token, 365 days) plus a rotating `hm_r_` refresh token; `platform: web` sets the 30-day `honto_session` cookie and returns `token: null`.
 */
export async function verifyEmailSignIn(request: Request) {
  const body = await readJson(request);
  const platform = body?.platform as Platform;
  if (!body || !PLATFORMS.includes(platform)) return apiError(400, "bad_request", "platform must be ios, android or web.");
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!token && !(email && /^\d{6}$/.test(code))) return apiError(400, "bad_request", "Send token, or email and the 6-digit code.");
  const sql = database();
  if (!sql) return apiError(500, "missing_config", "Database is not configured.");
  await ensureLifecycleSchema(sql);
  const ipWait = await hitRateLimit(sql, "email_verify_ip", await saltedHash("ip", clientIp(request)), 30, 15 * 60);
  if (ipWait) return rateLimited(ipWait, "Too many tries. Try again in a few minutes.");

  const review = token ? null : reviewLogin(email);
  if (review && email) {
    const reviewWait = await hitRateLimit(sql, "review_code", await saltedHash("email", email), REVIEW_CODE_TRIES_PER_HOUR, 60 * 60);
    if (reviewWait) return rateLimited(reviewWait, "Too many tries. Try again in a few minutes.");
    if (!sameCode(code, review.code)) return apiError(401, "invalid_token", "That code is not right or has expired.");
    return emailSession(sql, email, body.name, platform);
  }

  const used = token
    ? await sql`UPDATE email_login_tokens SET used_at = now() WHERE token_hash = ${await saltedHash("email-link", token)} AND used_at IS NULL AND expires_at > now() AND attempts < ${MAX_CODE_ATTEMPTS}::int RETURNING email`
    : await sql`UPDATE email_login_tokens SET used_at = now() WHERE token_hash = (SELECT token_hash FROM email_login_tokens WHERE email = ${email} AND code_hash = ${await saltedHash("email-code", `${email}:${code}`)} AND used_at IS NULL AND expires_at > now() AND attempts < ${MAX_CODE_ATTEMPTS}::int ORDER BY created_at DESC LIMIT 1) AND used_at IS NULL RETURNING email`;
  if (!used[0]) {
    if (!token) await sql`UPDATE email_login_tokens SET attempts = attempts + 1 WHERE email = ${email} AND used_at IS NULL AND expires_at > now()`;
    return apiError(401, "invalid_token", token ? "This link has expired or was already used." : "That code is not right or has expired.");
  }
  return emailSession(sql, String(used[0].email), body.name, platform);
}

/** Account for a verified email plus the session response (bearer + refresh for the apps, cookie for the web). */
async function emailSession(sql: Sql, verifiedEmail: string, name: unknown, platform: Platform) {
  const { userId, created } = await findOrCreateEmailUser(sql, verifiedEmail, name);
  const users = await sql`SELECT id, email, display_name AS "displayName", time_zone AS "timeZone", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt" FROM users WHERE id = ${userId}`;
  const user = users[0] as User;
  const headers: Record<string, string> = { ...noStore };
  let bearer: string | null = null;
  let refreshToken: string | null = null;
  if (platform === "web") headers["Set-Cookie"] = userCookie(await createUserSession(userId));
  else {
    bearer = await createMobileToken({ kind: "user", userId, platform });
    refreshToken = await issueRefreshToken(sql, userId, platform, undefined, bearer);
  }
  const result: AuthSession = { token: bearer, tokenType: "Bearer", expiresInDays: platform === "web" ? 30 : 365, created, user: { id: user.id, email: user.email, displayName: user.displayName, timeZone: user.timeZone ?? null, createdAt: user.createdAt }, refreshToken, refreshExpiresInDays: refreshToken ? REFRESH_TTL_DAYS : null };
  return Response.json(result, { status: created ? 201 : 200, headers });
}
