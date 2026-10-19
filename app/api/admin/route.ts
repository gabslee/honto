import { deleteAccount } from "../../../api/v1/lifecycle";
import { ensureEntitlementsSchema, PREMIUM_ENTITLEMENT } from "../../entitlements";
import { adminCookie, clearAdminCookie, createAdminSession, database, ensureIdentitySchema, getAdminUser, getCurrentUser, hasAdminBootstrapToken } from "../../server-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(request: Request) {
  let body: { action?: string; token?: string; userId?: string; confirmEmail?: string; role?: string; plan?: string; subscriptionStatus?: string; subscriptionExpiresAt?: string | null; expiresAt?: string | null; revoke?: boolean } = {};
  try { body = await request.json(); } catch { /* invalid body */ }
  if (body.action === "logout") return json({ ok: true }, 200, { "Set-Cookie": clearAdminCookie() });
  if (body.action === "updateUser") {
    const admin = await getAdminUser(request) ?? await getCurrentUser(request);
    if (!admin || admin.role !== "admin") return json({ error: "Admin authentication required." }, 401);
    const update = body;
    if (!update.userId || !["user", "admin"].includes(String(update.role)) || !["free", "premium"].includes(String(update.plan)) || !["inactive", "active", "canceled", "past_due"].includes(String(update.subscriptionStatus))) return json({ error: "Invalid account settings." }, 400);
    const sql = database(); if (!sql) return json({ error: "DATABASE_URL is not configured." }, 503);
    await ensureIdentitySchema();
    await sql`UPDATE users SET role = ${update.role}, plan = ${update.plan}, subscription_status = ${update.subscriptionStatus}, subscription_expires_at = ${update.subscriptionExpiresAt || null}, updated_at = now() WHERE id = ${update.userId}`;
    return json({ ok: true });
  }
  if (body.action === "grantPremium") {
    // Complimentary Premium (App Review demo couple, support goodwill): an `entitlements` row with source
    // 'admin', counted by isCouplePremium / resolveEntitlement like any other source. No Stripe or store
    // purchase is created. `expiresAt` null = no expiry; `revoke: true` deletes the grant.
    const admin = await getAdminUser(request) ?? await getCurrentUser(request);
    if (!admin || admin.role !== "admin") return json({ error: "Admin authentication required." }, 401);
    const expiresAt = body.expiresAt ?? null;
    if (!body.userId || (expiresAt !== null && (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))))) return json({ error: "Send userId and an ISO expiresAt (or null)." }, 400);
    const sql = database(); if (!sql) return json({ error: "DATABASE_URL is not configured." }, 503);
    await ensureEntitlementsSchema(sql);
    if (body.revoke) {
      await sql`DELETE FROM entitlements WHERE user_id = ${body.userId} AND source = 'admin' AND entitlement = ${PREMIUM_ENTITLEMENT}`;
      return json({ ok: true, revoked: true });
    }
    const rows = await sql`INSERT INTO entitlements (user_id, source, entitlement, period_type, expires_at, will_renew, updated_at)
      SELECT id, 'admin', ${PREMIUM_ENTITLEMENT}, 'normal', ${expiresAt}::timestamptz, false, now() FROM users WHERE id = ${body.userId}
      ON CONFLICT (user_id, source, entitlement) DO UPDATE SET expires_at = EXCLUDED.expires_at, period_type = 'normal', will_renew = false, updated_at = now() RETURNING user_id`;
    if (!rows[0]) return json({ error: "User not found." }, 404);
    return json({ ok: true, userId: body.userId, expiresAt });
  }
  if (body.action === "deleteUser") {
    // Same deletion as DELETE /api/v1/me (one transaction, partner unpaired with reason partner_deleted, storage,
    // RevenueCat and Apple cleanup after the commit). `confirmEmail` must equal the account's email; an admin
    // cannot delete their own account here.
    const admin = await getAdminUser(request) ?? await getCurrentUser(request);
    if (!admin || admin.role !== "admin") return json({ error: "Admin authentication required." }, 401);
    if (typeof body.userId !== "string" || !body.userId || typeof body.confirmEmail !== "string" || !body.confirmEmail.trim()) return json({ error: "Send userId and confirmEmail." }, 400);
    if (body.userId === admin.id) return json({ error: "You cannot delete your own account from the admin." }, 403);
    const sql = database(); if (!sql) return json({ error: "DATABASE_URL is not configured." }, 503);
    await ensureIdentitySchema();
    const target = (await sql`SELECT email FROM users WHERE id = ${body.userId}`)[0];
    if (!target) return json({ error: "User not found." }, 404);
    if (String(target.email).trim().toLowerCase() !== body.confirmEmail.trim().toLowerCase()) return json({ error: "The confirmation email does not match this account." }, 400);
    const deleted = await deleteAccount(sql, body.userId);
    if (!deleted) return json({ error: "User not found." }, 404);
    console.info(`[admin] account ${body.userId} deleted by admin ${admin.id}`);
    return json({ ok: true, deleted: true, userId: body.userId });
  }
  if (body.action !== "login" || !hasAdminBootstrapToken(String(body.token ?? ""))) return json({ error: "Invalid admin credentials." }, 401);
  try {
    const email = process.env.HONTO_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
    if (!email) return json({ error: "HONTO_ADMIN_EMAIL is not configured." }, 503);
    const session = await createAdminSession(email, process.env.HONTO_ADMIN_NAME ?? "Honto Admin");
    return json({ user: session.user }, 200, { "Set-Cookie": adminCookie(session.token) });
  } catch (error) {
    console.error("[admin] login failed", error);
    return json({ error: "Admin storage is unavailable." }, 503);
  }
}

export async function GET(request: Request) {
  const user = await getAdminUser(request) ?? await getCurrentUser(request);
  if (!user || user.role !== "admin") return json({ error: "Admin authentication required." }, 401);
  const sql = database();
  if (!sql) return json({ error: "DATABASE_URL is not configured." }, 503);
  try {
    await ensureIdentitySchema();
    const [users, rooms, activeRooms, players, ai, userRows, roomRows, playerRows, aiRows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM users`,
      sql`SELECT COUNT(*)::int AS total FROM rooms`,
      sql`SELECT COUNT(*)::int AS total FROM rooms WHERE status = 'playing'`,
      sql`SELECT COUNT(*)::int AS total FROM players`,
      sql`SELECT COALESCE(SUM(uses), 0)::int AS total, COALESCE(SUM(uses), 0) * 0.002 AS "estimatedCostUsd" FROM ai_usage`,
      sql`SELECT id, email, display_name AS "displayName", role, plan, subscription_status AS "subscriptionStatus", subscription_expires_at AS "subscriptionExpiresAt", created_at AS "createdAt" FROM users ORDER BY created_at DESC LIMIT 200`,
      sql`SELECT id, code, status, round_count AS "roundCount", current_round AS "currentRound", created_at AS "createdAt", updated_at AS "updatedAt" FROM rooms ORDER BY created_at DESC LIMIT 200`,
      sql`SELECT p.id, p.name, p.is_host AS "isHost", p.sips, p.joined_at AS "joinedAt", p.user_id AS "userId", r.code AS "roomCode" FROM players p JOIN rooms r ON r.id = p.room_id ORDER BY p.joined_at DESC LIMIT 300`,
      sql`SELECT scope, scope_key AS "scopeKey", window_start AS "windowStart", uses, updated_at AS "updatedAt" FROM ai_usage ORDER BY updated_at DESC LIMIT 300`,
    ]);
    return json({ user, metrics: { users: users[0]?.total ?? 0, rooms: rooms[0]?.total ?? 0, activeRooms: activeRooms[0]?.total ?? 0, players: players[0]?.total ?? 0, aiUses: ai[0]?.total ?? 0, aiEstimatedCostUsd: Number(ai[0]?.estimatedCostUsd ?? 0).toFixed(2) }, lists: { users: userRows, rooms: roomRows, activeRooms: roomRows.filter((room: any) => room.status === "playing"), players: playerRows, aiUses: aiRows, aiEstimatedCostUsd: [] } });
  } catch (error) {
    console.error("[admin] metrics failed", error);
    return json({ error: "Unable to load admin metrics." }, 503);
  }
}
