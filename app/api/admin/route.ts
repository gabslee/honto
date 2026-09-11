import { adminCookie, clearAdminCookie, createAdminSession, database, ensureIdentitySchema, getAdminUser, getCurrentUser, hasAdminBootstrapToken } from "../../server-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(request: Request) {
  let body: { action?: string; token?: string } = {};
  try { body = await request.json(); } catch { /* invalid body */ }
  if (body.action === "logout") return json({ ok: true }, 200, { "Set-Cookie": clearAdminCookie() });
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
      sql`SELECT COALESCE(SUM(uses), 0)::int AS total FROM ai_usage`,
      sql`SELECT id, email, display_name AS "displayName", role, created_at AS "createdAt" FROM users ORDER BY created_at DESC LIMIT 200`,
      sql`SELECT id, code, status, round_count AS "roundCount", current_round AS "currentRound", created_at AS "createdAt", updated_at AS "updatedAt" FROM rooms ORDER BY created_at DESC LIMIT 200`,
      sql`SELECT p.id, p.name, p.is_host AS "isHost", p.sips, p.joined_at AS "joinedAt", p.user_id AS "userId", r.code AS "roomCode" FROM players p JOIN rooms r ON r.id = p.room_id ORDER BY p.joined_at DESC LIMIT 300`,
      sql`SELECT scope, scope_key AS "scopeKey", window_start AS "windowStart", uses, updated_at AS "updatedAt" FROM ai_usage ORDER BY updated_at DESC LIMIT 300`,
    ]);
    return json({ user, metrics: { users: users[0]?.total ?? 0, rooms: rooms[0]?.total ?? 0, activeRooms: activeRooms[0]?.total ?? 0, players: players[0]?.total ?? 0, aiUses: ai[0]?.total ?? 0 }, lists: { users: userRows, rooms: roomRows, activeRooms: roomRows.filter((room: any) => room.status === "playing"), players: playerRows, aiUses: aiRows } });
  } catch (error) {
    console.error("[admin] metrics failed", error);
    return json({ error: "Unable to load admin metrics." }, 503);
  }
}
