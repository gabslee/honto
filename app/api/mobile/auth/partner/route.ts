import gameHandler from "../../../../../server/game";
import { ensureCoupleSchema } from "../../../../../server/couple";
import { validPartnerKey } from "../../../../couple-identity.js";
import { createMobileToken, database, getMobileToken } from "../../../../server-auth";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- internal handler shape
async function call(body: Record<string, unknown>, headers: Headers): Promise<{ status: number; payload: any }> {
  let status = 200; let payload: unknown = null;
  const response = { setHeader() { return response; }, status(next: number) { status = next; return response; }, json(next: unknown) { payload = next; return next; } };
  await gameHandler({ method: "POST", body, query: {}, headers }, response);
  return { status, payload };
}

/**
 * Account-free partner: join the couple through the invite code and get a couple-scoped device token.
 * Body: { code, name, partnerKey? }. Re-joining with the same partnerKey reuses the existing seat.
 */
export async function POST(request: Request) {
  const sql = database();
  if (!sql) return Response.json({ error: "Server is not configured." }, { status: 503, headers: noStore });
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* validated below */ }
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) return Response.json({ error: "Enter the invite code." }, { status: 400, headers: noStore });
  const existing = await getMobileToken(request);
  const partnerKey = existing?.kind === "device" && existing.partnerKey ? existing.partnerKey : validPartnerKey(body.partnerKey) ? String(body.partnerKey) : crypto.randomUUID();
  const headers = new Headers(); // never forward a host account into the partner seat
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared Neon client
  await ensureCoupleSchema(sql as any);
  const room = (await sql`SELECT id, multiplayer FROM rooms WHERE code = ${code}`)[0];
  if (!room) return Response.json({ error: "That room does not exist." }, { status: 404, headers: noStore });
  if (room.multiplayer) return Response.json({ error: "Honto rooms are for two players." }, { status: 400, headers: noStore });
  let seat = (await sql`SELECT token FROM players WHERE room_id = ${room.id} AND is_host = false AND partner_key = ${partnerKey} LIMIT 1`)[0];
  if (!seat) {
    const joined = await call({ action: "join", code, name: body.name, locale: body.locale }, headers);
    if (joined.status >= 400) return Response.json(joined.payload, { status: joined.status, headers: noStore });
    seat = { token: joined.payload.token };
    // Records the partner key on the new seat, which links this room to the couple.
    await call({ action: "history", code, token: seat.token, partnerKey }, headers);
  }
  const token = existing?.kind === "device" ? null : await createMobileToken({ kind: "device", partnerKey, roomId: String(room.id), platform: body.platform === "android" ? "android" : "ios" });
  return Response.json({ token: token ?? undefined, tokenType: token ? "Bearer" : undefined, reusedToken: !token, partnerKey, room: { code, token: seat.token } }, { status: 201, headers: noStore });
}
