import { authorized } from '../../../../api/v1/cron-auth';
import { apiError, noStore } from "../../../../api/v1/context";
import { runRetention } from "../../../../api/v1/lifecycle";
import { database } from "../../../server-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;


/**
 * GET /api/cron/retention, daily from the Cloudflare Worker (`Bearer CRON_SECRET`). Deletes unpaired data
 * older than 30 days, expired exports, unused expired invites, stale sign-in tokens and old calendar blocks,
 * then drains the object-storage deletion queue. The bucket has no lifecycle rules; this is the only expiry.
 */
export async function GET(request: Request) {
  if (!(await authorized(request))) return apiError(401, "unauthorized", "Missing or wrong cron secret.");
  const sql = database();
  if (!sql) return apiError(500, "missing_config", "Database is not configured.");
  return Response.json(await runRetention(sql), { headers: noStore });
}
