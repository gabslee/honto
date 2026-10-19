// Push fan-out to the partner's devices: APNs alert + APNs widget (iOS) and FCM data (Android).
// Payloads follow the contract (`PushData` in contracts/openapi.yaml). Sending never throws and never logs
// device tokens; with the APNs / FCM settings unset it is a logged no-op so the endpoints keep working.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { PushData } from "../../contracts/honto-api";
import { ensurePhotosSchema } from "../../api/v1/photos-schema";
import { database } from "../server-auth";
import { apnsConfig, sendApns, type ApnsEnv, type ApnsMessage, type ApnsResult } from "./apns";
import { fcmConfig, sendFcm, type FcmResult } from "./fcm";

type Sql = NeonQueryFunction<false, false>;

/** Events W2a sends (plus `nudge.new`, feedback r1). `reunion.changed` is a widget refresh only (no visible alert). */
export type PushEvent =
  | { type: "photo.new"; photoId: string; thumbUrl?: string | null; fromName?: string | null }
  | { type: "nudge.new"; nudgeId: string; createdAt?: string | null; fromName?: string | null }
  | { type: "couple.joined"; fromName?: string | null }
  | { type: "reunion.changed" };

export type NotifySummary = { devices: number; sent: number; failed: number; pruned: number; skipped: number };

/** APNs widget push body (iOS 26 `WidgetPushHandler`): nothing but `content-changed`. */
export const WIDGET_PAYLOAD = { aps: { "content-changed": true } } as const;

const rfc3339 = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Contract `PushData` for an event (unset optional fields are omitted). */
export function pushData(coupleId: string, event: PushEvent, now = new Date()): PushData {
  const data: PushData = { type: event.type, coupleId, sentAt: rfc3339(now) };
  if (event.type === "photo.new") {
    data.photoId = event.photoId;
    if (event.thumbUrl) data.thumbUrl = event.thumbUrl;
  }
  if (event.type === "nudge.new") {
    data.nudgeId = event.nudgeId;
    if (event.createdAt) data.createdAt = event.createdAt;
  }
  if (event.type !== "reunion.changed" && event.fromName) data.fromName = event.fromName;
  return data;
}

/** APNs alert body: the visible text (English, no emoji) plus `honto` = PushData. Null for widget-only events. */
export function apnsAlertPayload(data: PushData) {
  const from = data.fromName || "Your partner";
  if (data.type === "photo.new") return { aps: { alert: { title: from, body: "Sent you a photo" }, sound: "default", "mutable-content": 1, "thread-id": data.coupleId }, honto: data };
  // "Thinking of you": short and silent (no sound); the NSE refreshes the widget snapshot and records the sender.
  if (data.type === "nudge.new") return { aps: { alert: { title: "Honto", body: `${from} is thinking of you` }, "mutable-content": 1, "thread-id": data.coupleId }, honto: data };
  if (data.type === "couple.joined") return { aps: { alert: { title: "Honto", body: `You are now paired with ${from}` }, sound: "default", "thread-id": data.coupleId }, honto: data };
  return null;
}

/** FCM `data`: every value a string, nulls omitted. */
export function fcmData(data: PushData): Record<string, string> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => [key, String(value)]));
}

type DeviceRow = { id: string; kind: "fcm" | "apns_alert" | "apns_widget"; token: string; env: ApnsEnv | null };

async function prune(sql: Sql, ids: string[]) {
  for (const id of ids) await sql`UPDATE push_devices SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL`;
}

/**
 * Sends `event` to every active device of the other active member of `coupleId`: an APNs alert (photo.new,
 * couple.joined), an APNs widget push and an FCM data message. Dead tokens (APNs 410 / BadDeviceToken,
 * FCM 404 / UNREGISTERED) are revoked. Resolves with counts only; errors are logged, never thrown.
 */
export async function notifyPartner(coupleId: string, fromUserId: string, event: PushEvent, options: { now?: Date } = {}): Promise<NotifySummary> {
  const summary: NotifySummary = { devices: 0, sent: 0, failed: 0, pruned: 0, skipped: 0 };
  const sql = database() as Sql | null;
  if (!sql) return summary;
  try {
    await ensurePhotosSchema(sql);
    const devices = await sql`SELECT d.id, d.kind, d.token, d.env FROM couple_members m JOIN push_devices d ON d.user_id = m.user_id AND d.revoked_at IS NULL WHERE m.couple_id = ${coupleId} AND m.left_at IS NULL AND m.user_id <> ${fromUserId} ORDER BY d.created_at` as DeviceRow[];
    summary.devices = devices.length;
    if (!devices.length) return summary;
    const data = pushData(coupleId, event, options.now);
    const alert = apnsAlertPayload(data);

    const apnsDevices: { device: DeviceRow; message: ApnsMessage }[] = [];
    for (const device of devices) {
      if (device.kind === "fcm") continue;
      const env = device.env ?? "production";
      if (device.kind === "apns_widget") apnsDevices.push({ device, message: { token: device.token, env, pushType: "widgets", payload: WIDGET_PAYLOAD } });
      else if (alert) apnsDevices.push({ device, message: { token: device.token, env, pushType: "alert", payload: alert } });
    }
    const fcmDevices = devices.filter((device) => device.kind === "fcm");
    summary.skipped = devices.length - apnsDevices.length - fcmDevices.length;

    const apns = apnsConfig();
    const fcm = fcmConfig();
    const tally = (sent: { device: DeviceRow }[], results: (ApnsResult | FcmResult)[], dead: string[]) => results.forEach((result, i) => {
      if (result.status >= 200 && result.status < 300) summary.sent += 1; else summary.failed += 1;
      if (result.prune) dead.push(sent[i].device.id);
    });
    const dead: string[] = [];
    const [apnsResults, fcmResults] = await Promise.all([
      apnsDevices.length && apns ? sendApns(apnsDevices.map((d) => d.message), apns).catch((error: Error) => { console.error(`[push] APNs send failed: ${error.message}`); return null; }) : Promise.resolve([]),
      fcmDevices.length && fcm ? sendFcm(fcmDevices.map((device) => ({ token: device.token, data: fcmData(data) })), fcm).catch((error: Error) => { console.error(`[push] FCM send failed: ${error.message}`); return null; }) : Promise.resolve([]),
    ]);
    if (apnsDevices.length && !apns) { summary.skipped += apnsDevices.length; console.info(`[push] ${event.type}: APNs not configured, skipped ${apnsDevices.length} device(s)`); }
    if (fcmDevices.length && !fcm) { summary.skipped += fcmDevices.length; console.info(`[push] ${event.type}: FCM not configured, skipped ${fcmDevices.length} device(s)`); }
    if (apnsResults) tally(apnsDevices, apnsResults, dead); else summary.failed += apnsDevices.length;
    if (fcmResults) tally(fcmDevices.map((device) => ({ device })), fcmResults, dead); else summary.failed += fcmDevices.length;
    await prune(sql, dead);
    summary.pruned = dead.length;
    console.info(`[push] ${event.type}: ${summary.sent} sent, ${summary.failed} failed, ${summary.pruned} pruned, ${summary.skipped} skipped`);
  } catch (error) {
    console.error(`[push] ${event.type} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return summary;
}
