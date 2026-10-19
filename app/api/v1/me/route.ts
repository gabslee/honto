import { clearUserCookie, database } from "../../../server-auth";
import { apiError, noStore, requireUser } from "../../../../api/v1/context";
import { meResponse } from "../../../../api/v1/couple";
import { deleteAccount } from "../../../../api/v1/lifecycle";

export const dynamic = "force-dynamic";

/** GET /api/v1/me: user, couple (or null), entitlement, pending unpair and open invite flags. */
export async function GET(request: Request) {
  return meResponse(request);
}

/**
 * DELETE /api/v1/me: deletes the account (App Store 5.1.1(v)). Unpairs first (the partner keeps their account),
 * deletes my photos and exports from storage, then the user row (sessions, tokens, devices, calendar and the rest
 * cascade). 204; the web session cookie is cleared too.
 */
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sql = database();
  if (!sql) return apiError(500, "missing_config", "Database is not configured.");
  await deleteAccount(sql, auth.user.id);
  return new Response(null, { status: 204, headers: { ...noStore, "Set-Cookie": clearUserCookie() } });
}
