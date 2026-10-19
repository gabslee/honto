import type { TimeZoneResult } from "../../../../../contracts/honto-api";
import { apiError, noStore, normalizeTimeZone, requireUser } from "../../../../../api/v1/context";
import { database } from "../../../../server-auth";

export const dynamic = "force-dynamic";

/** PUT /api/v1/me/timezone: the device's IANA zone, sent on every app open/foreground. */
export async function PUT(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as { timeZone?: unknown } | null;
  const timeZone = normalizeTimeZone(body?.timeZone);
  if (!timeZone) return apiError(400, "bad_request", "timeZone must be an IANA time zone id.");
  const sql = database()!;
  const rows = await sql`UPDATE users SET time_zone = ${timeZone}, time_zone_updated_at = now() WHERE id = ${auth.user.id} RETURNING time_zone AS "timeZone", to_char(time_zone_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"`;
  const result: TimeZoneResult = { timeZone: rows[0].timeZone, updatedAt: rows[0].updatedAt };
  return Response.json(result, { headers: noStore });
}
