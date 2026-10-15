import { ensureCoupleSchema } from "../../../api/couple";
import { database, getCurrentUser, getMobileToken } from "../../server-auth";

/**
 * Fills in { code, token, partnerKey } for a mobile request when the app did not pass a room:
 * - device token (account-free partner): the couple's latest room joined with that partner key;
 * - user token / web cookie: the latest 2-player room this account hosts.
 */
export async function resolveMobileRoom(request: Request, body: Record<string, unknown>) {
  const sql = database();
  if (!sql) return body;
  const device = await getMobileToken(request);
  if (device?.kind === "device" && device.partnerKey) {
    body.partnerKey = device.partnerKey;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared Neon client
    await ensureCoupleSchema(sql as any);
    if (!body.code || !body.token) {
      const rows = await sql`SELECT r.code, p.token FROM players p JOIN rooms r ON r.id = p.room_id WHERE p.partner_key = ${device.partnerKey} AND p.is_host = false AND NOT r.multiplayer ORDER BY p.joined_at DESC LIMIT 1`;
      if (rows[0]) { body.code = rows[0].code; body.token = rows[0].token; }
    }
    return body;
  }
  if (!body.code || !body.token) {
    const user = await getCurrentUser(request);
    if (user) {
      const rows = await sql`SELECT r.code, p.token FROM players p JOIN rooms r ON r.id = p.room_id WHERE p.user_id = ${user.id} AND p.is_host AND NOT r.multiplayer ORDER BY p.joined_at DESC LIMIT 1`;
      if (rows[0]) { body.code = rows[0].code; body.token = rows[0].token; }
    }
  }
  return body;
}
