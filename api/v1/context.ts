import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { ApiError, ErrorCode, User } from "../../contracts/honto-api";
import { bearerToken, database, getCurrentUser, getMobileToken } from "../../app/server-auth";
import { ensureFoundationSchema } from "./foundation-schema";

type Sql = NeonQueryFunction<false, false>;

export const noStore = { "Cache-Control": "no-store" };

/** Contract error body `{ error, code }` with `Cache-Control: no-store`. */
export function apiError(status: number, code: ErrorCode, error: string, headers: Record<string, string> = {}) {
  const body: ApiError = { error, code };
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

/** Signed-in v1 account. Timestamps are RFC 3339 UTC (`2026-10-19T12:00:00Z`). */
export type V1User = {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  plan: "free" | "premium";
  subscriptionStatus: string;
  subscriptionExpiresAt: string | null;
  trialEndsAt: string | null;
  timeZone: string | null;
  timeZoneUpdatedAt: string | null;
  createdAt: string;
};
/** Active v1 couple of the caller. `role` is the caller's role ('a' = invite creator, 'b' = joiner). */
export type V1Couple = {
  id: string;
  role: "a" | "b";
  pairedAt: string;
  startedOn: string | null;
  reunionAt: string | null;
  reunionCity: string | null;
  reunionTimeZone: string | null;
};
/** The other active member of the couple. */
export type V1Partner = {
  id: string;
  email: string;
  displayName: string;
  role: "a" | "b";
  timeZone: string | null;
  timeZoneUpdatedAt: string | null;
  joinedAt: string;
};

const unauthorized = () => apiError(401, "unauthorized", "Sign in again.");

async function loadUser(sql: Sql, userId: string) {
  const rows = await sql`SELECT id, email, display_name AS "displayName", role, plan, subscription_status AS "subscriptionStatus", to_char(subscription_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "subscriptionExpiresAt", to_char(trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "trialEndsAt", time_zone AS "timeZone", to_char(time_zone_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "timeZoneUpdatedAt", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt" FROM users WHERE id = ${userId} LIMIT 1`;
  return (rows[0] as V1User | undefined) ?? null;
}

/**
 * Authenticates a `/api/v1` request.
 * - `Authorization: Bearer hm_u_…` (apps): must be an unrevoked, unexpired user token. When a bearer header
 *   is present it decides alone (no cookie fallback); device tokens (`hm_d_`) are rejected.
 * - otherwise the `honto_session` cookie (web).
 * Returns `{ user }`, or a ready 401 `Response` (`{ error, code: "unauthorized" }`) to return as is:
 * `const auth = await requireUser(request); if (auth instanceof Response) return auth;`
 * Also makes sure the v1 foundation schema exists.
 */
export async function requireUser(request: Request): Promise<{ user: V1User } | Response> {
  const sql = database();
  if (!sql) return apiError(500, "missing_config", "Database is not configured.");
  let userId: string | null = null;
  if (bearerToken(request)) {
    const token = await getMobileToken(request);
    if (token?.kind === "user") userId = token.userId;
  } else {
    userId = (await getCurrentUser(request))?.id ?? null;
  }
  if (!userId) return unauthorized();
  await ensureFoundationSchema(sql);
  const user = await loadUser(sql, userId);
  return user ? { user } : unauthorized();
}

/**
 * Like `requireUser`, plus the caller's active v1 couple (couple_members row with `left_at IS NULL`, couple
 * not unpaired) and the other active member. Legacy couples (host_user_id + partner_key) never match.
 * Returns `{ user, couple, partner }`, the 401 from `requireUser`, or a 409 `not_paired` `Response`.
 */
export async function requireCouple(request: Request): Promise<{ user: V1User; couple: V1Couple; partner: V1Partner } | Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sql = database() as Sql;
  const rows = await sql`SELECT c.id, m.role, to_char(COALESCE(c.paired_at, m.joined_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "pairedAt", to_char(c.started_on, 'YYYY-MM-DD') AS "startedOn", to_char(c.reunion_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "reunionAt", c.reunion_city AS "reunionCity", c.reunion_time_zone AS "reunionTimeZone",
      u.id AS "partnerId", u.email AS "partnerEmail", u.display_name AS "partnerDisplayName", pm.role AS "partnerRole", u.time_zone AS "partnerTimeZone", to_char(u.time_zone_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "partnerTimeZoneUpdatedAt", to_char(pm.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "partnerJoinedAt"
    FROM couple_members m
    JOIN couples c ON c.id = m.couple_id AND c.unpaired_at IS NULL
    JOIN couple_members pm ON pm.couple_id = m.couple_id AND pm.user_id <> m.user_id AND pm.left_at IS NULL
    JOIN users u ON u.id = pm.user_id
    WHERE m.user_id = ${auth.user.id} AND m.left_at IS NULL
    LIMIT 1`;
  const row = rows[0];
  if (!row) return apiError(409, "not_paired", "Pair with your partner first.");
  return {
    user: auth.user,
    couple: { id: row.id, role: row.role, pairedAt: row.pairedAt, startedOn: row.startedOn, reunionAt: row.reunionAt, reunionCity: row.reunionCity, reunionTimeZone: row.reunionTimeZone },
    partner: { id: row.partnerId, email: row.partnerEmail, displayName: row.partnerDisplayName, role: row.partnerRole, timeZone: row.partnerTimeZone, timeZoneUpdatedAt: row.partnerTimeZoneUpdatedAt, joinedAt: row.partnerJoinedAt },
  };
}

/**
 * Premium is per couple: true when either active member has
 * - an active row in `entitlements` (RevenueCat and other sources; table created by W3, skipped until it exists), or
 * - the legacy web game access of `hasPremiumAccess` (admin, active Stripe `plan = 'premium'` not past
 *   `subscription_expires_at`, or a running Stripe trial).
 */
export async function isCouplePremium(sql: Sql, coupleId: string): Promise<boolean> {
  const legacy = await sql`SELECT EXISTS (SELECT 1 FROM couple_members m JOIN users u ON u.id = m.user_id WHERE m.couple_id = ${coupleId} AND m.left_at IS NULL AND (u.role = 'admin' OR (u.plan = 'premium' AND u.subscription_status = 'active' AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > now())) OR u.trial_ends_at > now())) AS premium`;
  if (legacy[0]?.premium) return true;
  const table = await sql`SELECT to_regclass('entitlements') IS NOT NULL AS ready`;
  if (!table[0]?.ready) return false;
  const store = await sql`SELECT EXISTS (SELECT 1 FROM couple_members m JOIN entitlements e ON e.user_id = m.user_id WHERE m.couple_id = ${coupleId} AND m.left_at IS NULL AND e.entitlement = 'premium' AND (e.expires_at IS NULL OR e.expires_at > now())) AS premium`;
  return Boolean(store[0]?.premium);
}

/** Contract `User` of a `V1User`. */
export function toApiUser(user: V1User): User {
  return { id: user.id, email: user.email, displayName: user.displayName, timeZone: user.timeZone, createdAt: user.createdAt };
}

/**
 * Valid IANA zone id (per `Intl`) with canonical casing (`asia/tokyo` -> `Asia/Tokyo`), or null.
 * Offsets (`+05:00`) and anything over the contract's 64 chars are rejected.
 */
export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const zone = value.trim();
  if (!zone || zone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(zone)) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
    // Keep links such as Asia/Kolkata as sent (some ICU builds resolve them to the old name).
    return resolved.toLowerCase() === zone.toLowerCase() ? resolved : zone;
  } catch {
    return null;
  }
}
