import { randomBytes } from "node:crypto";
import type { Device } from "../../../../contracts/honto-api";
import { apiError, noStore, requireUser } from "../../../../server/v1/context";
import { ensurePhotosSchema } from "../../../../server/v1/photos-schema";
import { database } from "../../../server-auth";

export const dynamic = "force-dynamic";

const KINDS = ["fcm", "apns_alert", "apns_widget"];
const ENVS = ["sandbox", "production"];
const PLATFORMS = ["ios", "android"];
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optional = (value: unknown, max: number) => value === undefined || value === null || text(value, max);

/**
 * POST /api/v1/devices: registers or refreshes a push token (upsert by kind + token; a token that moves to
 * another account follows it). Re-registering the same installationId + kind revokes the previous token.
 * APNs kinds need `env` (sandbox for debug builds, production for TestFlight / App Store).
 */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "bad_request", "Send a JSON body.");
  const { installationId, kind, token, env, platform, appVersion, osVersion, locale } = body;
  if (!text(installationId, 64)) return apiError(400, "bad_request", "installationId is required (max 64 characters).");
  if (typeof kind !== "string" || !KINDS.includes(kind)) return apiError(400, "bad_request", "kind must be fcm, apns_alert or apns_widget.");
  if (!text(token, 4096)) return apiError(400, "bad_request", "token is required (max 4096 characters).");
  if (typeof platform !== "string" || !PLATFORMS.includes(platform)) return apiError(400, "bad_request", "platform must be ios or android.");
  if ((kind === "fcm") !== (platform === "android")) return apiError(400, "bad_request", "fcm tokens come from android, APNs tokens from ios.");
  if (env !== undefined && env !== null && (typeof env !== "string" || !ENVS.includes(env))) return apiError(400, "bad_request", "env must be sandbox or production.");
  if (kind !== "fcm" && !env) return apiError(400, "bad_request", "APNs tokens need env.");
  if (!text(appVersion, 32) || !optional(osVersion, 32) || !optional(locale, 16)) return apiError(400, "bad_request", "appVersion is required; appVersion and osVersion max 32, locale max 16 characters.");

  const sql = database()!;
  await ensurePhotosSchema(sql);
  const userId = auth.user.id;
  const pushEnv = kind === "fcm" ? null : env as string;
  const upsert = async () => {
    await sql`UPDATE push_devices SET revoked_at = now() WHERE user_id = ${userId} AND installation_id = ${installationId} AND kind = ${kind} AND token <> ${token} AND revoked_at IS NULL`;
    return await sql`INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token, env, app_version, os_version, locale)
    VALUES (${`dev_${randomBytes(10).toString("hex")}`}, ${userId}, ${installationId}, ${platform}, ${kind}, ${token}, ${pushEnv}, ${appVersion}, ${osVersion ?? null}, ${locale ?? null})
    ON CONFLICT (kind, token) DO UPDATE SET user_id = EXCLUDED.user_id, installation_id = EXCLUDED.installation_id, platform = EXCLUDED.platform, env = EXCLUDED.env, app_version = EXCLUDED.app_version, os_version = EXCLUDED.os_version, locale = EXCLUDED.locale, last_seen_at = now(), revoked_at = NULL
    RETURNING id, kind, platform, env, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt", to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSeenAt"`;
  };
  let rows;
  try {
    rows = await upsert();
  } catch (error) {
    // Two registrations of the same installation racing (app launch + foreground) can trip the partial
    // unique index idx_push_devices_install: the loser revokes again and retries once.
    if ((error as { code?: string })?.code !== "23505") throw error;
    rows = await upsert();
  }
  const device = rows[0] as Device;
  return Response.json(device, { status: 201, headers: noStore });
}
