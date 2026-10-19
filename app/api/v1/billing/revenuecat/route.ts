import { createHash, timingSafeEqual } from "node:crypto";
import type { RevenueCatEvent, WebhookAck } from "../../../../../contracts/honto-api";
import { apiError, noStore } from "../../../../../api/v1/context";
import { applyRevenueCatEvent } from "../../../../entitlements";
import { database } from "../../../../server-auth";

export const dynamic = "force-dynamic";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** The `Authorization` header must equal `REVENUECAT_WEBHOOK_SECRET` exactly; unset means nothing passes. */
function authorized(request: Request) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET ?? "";
  const header = request.headers.get("authorization");
  if (!secret || header === null) return false;
  return timingSafeEqual(digest(header), digest(secret));
}

/**
 * POST /api/v1/billing/revenuecat: RevenueCat webhook to `entitlements`. Idempotent by `event.id`; unknown
 * types, other entitlements and unknown users are acknowledged (200) so RevenueCat stops retrying.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return apiError(401, "unauthorized", "Invalid webhook authorization.");
  const sql = database();
  if (!sql) return apiError(500, "missing_config", "Database is not configured.");
  const body = await request.json().catch(() => null) as { event?: Partial<RevenueCatEvent> } | null;
  const event = body && typeof body === "object" ? body.event : null;
  const valid = event && typeof event === "object" && typeof event.id === "string" && event.id && event.id.length <= 200 && typeof event.type === "string" && event.type
    && (event.type === "TRANSFER" || (typeof event.app_user_id === "string" && event.app_user_id));
  if (!valid) return apiError(400, "bad_request", "Expected a RevenueCat webhook body with event.id, event.type and event.app_user_id.");
  await applyRevenueCatEvent(sql, event as RevenueCatEvent, body);
  const ack: WebhookAck = { ok: true };
  return Response.json(ack, { headers: noStore });
}
