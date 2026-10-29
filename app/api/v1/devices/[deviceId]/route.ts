import { apiError, noStore, requireUser } from "../../../../../server/v1/context";
import { ensurePhotosSchema } from "../../../../../server/v1/photos-schema";
import { database } from "../../../../server-auth";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/devices/{deviceId}: revokes one of my push tokens (logout, notifications turned off). */
export async function DELETE(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { deviceId } = await params;
  const sql = database()!;
  await ensurePhotosSchema(sql);
  const rows = await sql`UPDATE push_devices SET revoked_at = now() WHERE id = ${deviceId} AND user_id = ${auth.user.id} AND revoked_at IS NULL RETURNING id`;
  if (!rows.length) return apiError(404, "not_found", "Device not found.");
  return new Response(null, { status: 204, headers: noStore });
}
