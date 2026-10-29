import { after } from "next/server";
import { apiError, noStore, requireUser } from "../../../../../server/v1/context";
import { exportStatus, requestExport } from "../../../../../server/v1/lifecycle";
import { database } from "../../../../server-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/v1/me/export: status of the ZIP of my own photos (`url` = signed GET, 24h). */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  return Response.json(await exportStatus(database()!, auth.user.id), { headers: noStore });
}

/** POST /api/v1/me/export: queue a ZIP of my own photos; poll GET until `status: ready`. */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const result = await requestExport(database()!, auth.user.id);
  if (result.status !== 202) {
    const retry = result.status === 429 && result.retryAfter ? { "Retry-After": String(result.retryAfter) } : undefined;
    return result.status === 429
      ? Response.json({ error: result.error, code: result.code, retryAfterSeconds: result.retryAfter ?? null }, { status: 429, headers: { ...noStore, ...retry } })
      : apiError(result.status, result.code, result.error);
  }
  const build = result.build;
  if (build) {
    // Build after the response when the runtime supports it; otherwise (outside a request scope) inline.
    try { after(build); } catch { await build(); }
  }
  return Response.json(result.body, { status: 202, headers: noStore });
}
