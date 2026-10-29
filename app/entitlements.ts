import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { RevenueCatEvent } from "../contracts/honto-api";
import { ensureIdentitySchema } from "./server-auth";

type Sql = NeonQueryFunction<false, false>;
let ready: Promise<void> | null = null;

/** The only entitlement Honto sells (RevenueCat entitlement id). */
export const PREMIUM_ENTITLEMENT = "premium";

/**
 * Idempotent entitlements schema (mirrors the billing part of drizzle/0010_calendar_entitlements.sql).
 * `entitlements` is per user and source; the couple is Premium when either active member has an active row
 * (see `isCouplePremium` in server/v1/context.ts). Stripe subscribers keep counting through `users.plan`.
 * `revenuecat_events` makes the webhook idempotent by `event.id` and keeps the raw payload.
 */
export function ensureEntitlementsSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureIdentitySchema();
    await sql`CREATE TABLE IF NOT EXISTS entitlements (user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, source text NOT NULL CHECK (source IN ('revenuecat', 'stripe', 'admin')), entitlement text NOT NULL DEFAULT 'premium', product_id text, period_type text CHECK (period_type IN ('trial', 'intro', 'normal')), store text, environment text, expires_at timestamptz, will_renew boolean, had_trial boolean NOT NULL DEFAULT false, last_event_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, source, entitlement))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_entitlements_expiry ON entitlements(expires_at)`;
    await sql`CREATE TABLE IF NOT EXISTS revenuecat_events (id text PRIMARY KEY, type text NOT NULL, app_user_id text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL)`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

/** True when the user has an unexpired `premium` row from any source (NULL `expires_at` = no expiry). */
export async function hasActiveEntitlement(sql: Sql, userId: string): Promise<boolean> {
  await ensureEntitlementsSchema(sql);
  const rows = await sql`SELECT EXISTS (SELECT 1 FROM entitlements WHERE user_id = ${userId} AND entitlement = ${PREMIUM_ENTITLEMENT} AND (expires_at IS NULL OR expires_at > now())) AS active`;
  return Boolean(rows[0]?.active);
}

export const REVENUECAT_EVENT_TYPES = ["INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "EXPIRATION", "UNCANCELLATION", "PRODUCT_CHANGE", "BILLING_ISSUE", "TRANSFER"] as const;
type HandledType = (typeof REVENUECAT_EVENT_TYPES)[number];

/**
 * How each handled type changes the `revenuecat` row:
 * - `willRenew`: new value, or null to keep the stored one.
 * - `keepExpiry`: a missing `expiration_at_ms` keeps the stored expiry (otherwise NULL = never expires,
 *   which only INITIAL_PURCHASE / RENEWAL of a non-subscription product legitimately send).
 * CANCELLATION keeps access until `expiration_at_ms` (for a refund RevenueCat sets it to the refund time);
 * BILLING_ISSUE keeps it until the grace period end RevenueCat reports; EXPIRATION ends it.
 */
const EFFECTS: Record<Exclude<HandledType, "TRANSFER">, { willRenew: boolean | null; keepExpiry: boolean }> = {
  INITIAL_PURCHASE: { willRenew: true, keepExpiry: false },
  RENEWAL: { willRenew: true, keepExpiry: false },
  UNCANCELLATION: { willRenew: true, keepExpiry: true },
  PRODUCT_CHANGE: { willRenew: true, keepExpiry: true },
  CANCELLATION: { willRenew: false, keepExpiry: true },
  BILLING_ISSUE: { willRenew: null, keepExpiry: true },
  EXPIRATION: { willRenew: false, keepExpiry: false },
};

const PERIOD_TYPES: Record<string, "trial" | "intro" | "normal"> = { TRIAL: "trial", INTRO: "intro", NORMAL: "normal", PREPAID: "normal" };

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const textOrNull = (value: unknown) => (isText(value) ? value.slice(0, 200) : null);
const ids = (value: unknown) => (Array.isArray(value) ? value.filter(isText) : []);
const msToIso = (ms: number) => new Date(ms).toISOString();
const validMs = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 8.64e15;

/** First of `candidates` (in order) that is a Honto user id, or null. RevenueCat anonymous ids never match. */
async function firstUser(sql: Sql, candidates: string[]) {
  const wanted = [...new Set(candidates.filter((id) => !id.startsWith("$RCAnonymousID:")))];
  if (!wanted.length) return null;
  const rows = await sql`SELECT u.id FROM jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb) WITH ORDINALITY AS c(id, n) JOIN users u ON u.id = c.id ORDER BY c.n LIMIT 1`;
  return (rows[0]?.id as string | undefined) ?? null;
}

export type RevenueCatOutcome = "applied" | "duplicate" | "ignored";

/**
 * Applies one webhook event (body already authenticated) and records it, in one transaction.
 * - Idempotent by `event.id`: a recorded id returns "duplicate" without touching entitlements. Replaying
 *   an event before it is recorded is harmless too (every write is an upsert/move to the same state).
 * - `app_user_id` is the Honto user id (`Purchases.logIn`); `original_app_user_id` and `aliases` are tried
 *   next. Events for unknown users, other entitlements and unhandled types are recorded and "ignored".
 * - Out-of-order deliveries: an event older than the last applied one (`event_timestamp_ms`) does not
 *   overwrite the row.
 * - Sandbox events are honored too (TestFlight and App Review buy in the sandbox); `environment` is stored.
 */
export async function applyRevenueCatEvent(sql: Sql, event: RevenueCatEvent, payload: unknown): Promise<RevenueCatOutcome> {
  await ensureEntitlementsSchema(sql);
  const seen = await sql`SELECT 1 FROM revenuecat_events WHERE id = ${event.id}`;
  if (seen.length) return "duplicate";
  const appUserId = event.app_user_id ?? ids(event.transferred_to)[0] ?? "";
  const record = sql`INSERT INTO revenuecat_events (id, type, app_user_id, payload) VALUES (${event.id}, ${event.type.slice(0, 64)}, ${appUserId.slice(0, 200)}, ${JSON.stringify(payload)}::jsonb) ON CONFLICT (id) DO NOTHING`;
  const forPremium = !Array.isArray(event.entitlement_ids) || event.entitlement_ids.includes(PREMIUM_ENTITLEMENT);
  const eventAt = validMs(event.event_timestamp_ms) ? event.event_timestamp_ms : Date.now();

  if (event.type === "TRANSFER") {
    // The purchase moved between app user ids: the newest-expiring row of the old owners goes to the first
    // known new owner (unless that user already has a later one), and the old owners lose theirs.
    const from = ids(event.transferred_from);
    const to = await firstUser(sql, ids(event.transferred_to));
    if (!from.length) {
      await sql.transaction([record]);
      return "ignored";
    }
    const fromJson = JSON.stringify(from);
    const statements = [];
    if (to) statements.push(sql`INSERT INTO entitlements (user_id, source, entitlement, product_id, period_type, store, environment, expires_at, will_renew, had_trial, last_event_at, updated_at)
      SELECT ${to}, source, entitlement, product_id, period_type, store, environment, expires_at, will_renew, had_trial, ${msToIso(eventAt)}::timestamptz, now() FROM entitlements
      WHERE source = 'revenuecat' AND entitlement = ${PREMIUM_ENTITLEMENT} AND user_id IN (SELECT jsonb_array_elements_text(${fromJson}::jsonb)) AND user_id <> ${to}
      ORDER BY expires_at DESC NULLS FIRST LIMIT 1
      ON CONFLICT (user_id, source, entitlement) DO UPDATE SET product_id = EXCLUDED.product_id, period_type = EXCLUDED.period_type, store = EXCLUDED.store, environment = EXCLUDED.environment, expires_at = EXCLUDED.expires_at, will_renew = EXCLUDED.will_renew, had_trial = entitlements.had_trial OR EXCLUDED.had_trial, last_event_at = EXCLUDED.last_event_at, updated_at = now()
      WHERE entitlements.expires_at IS NOT NULL AND (EXCLUDED.expires_at IS NULL OR EXCLUDED.expires_at > entitlements.expires_at)`);
    statements.push(sql`DELETE FROM entitlements WHERE source = 'revenuecat' AND entitlement = ${PREMIUM_ENTITLEMENT} AND user_id IN (SELECT jsonb_array_elements_text(${fromJson}::jsonb)) AND user_id <> ${to ?? ""}`);
    await sql.transaction([...statements, record]);
    return "applied";
  }

  const effect = EFFECTS[event.type as keyof typeof EFFECTS];
  const userId = effect && forPremium ? await firstUser(sql, [event.app_user_id, event.original_app_user_id, ...ids(event.aliases)].filter(isText)) : null;
  if (!effect || !userId) {
    await sql.transaction([record]);
    return "ignored";
  }
  const expirationMs = validMs(event.expiration_at_ms) ? event.expiration_at_ms : null;
  // EXPIRATION means access is over now, whatever the reported expiry says.
  const expiresMs = event.type === "EXPIRATION" ? Math.min(expirationMs ?? eventAt, eventAt) : expirationMs;
  const expiresAt = expiresMs === null ? null : msToIso(expiresMs);
  const periodType = PERIOD_TYPES[String(event.period_type ?? "").toUpperCase()] ?? null;
  const hadTrial = periodType === "trial";
  await sql.transaction([
    sql`INSERT INTO entitlements (user_id, source, entitlement, product_id, period_type, store, environment, expires_at, will_renew, had_trial, last_event_at, updated_at)
      VALUES (${userId}, 'revenuecat', ${PREMIUM_ENTITLEMENT}, ${textOrNull(event.product_id)}, ${periodType}, ${textOrNull(event.store)}, ${textOrNull(event.environment)}, ${expiresAt}::timestamptz, ${effect.willRenew}::boolean, ${hadTrial}, ${msToIso(eventAt)}::timestamptz, now())
      ON CONFLICT (user_id, source, entitlement) DO UPDATE SET
        product_id = COALESCE(EXCLUDED.product_id, entitlements.product_id),
        period_type = COALESCE(EXCLUDED.period_type, entitlements.period_type),
        store = COALESCE(EXCLUDED.store, entitlements.store),
        environment = COALESCE(EXCLUDED.environment, entitlements.environment),
        expires_at = CASE WHEN ${effect.keepExpiry}::boolean THEN COALESCE(EXCLUDED.expires_at, entitlements.expires_at) ELSE EXCLUDED.expires_at END,
        will_renew = COALESCE(EXCLUDED.will_renew, entitlements.will_renew),
        had_trial = entitlements.had_trial OR EXCLUDED.had_trial,
        last_event_at = EXCLUDED.last_event_at,
        updated_at = now()
      WHERE entitlements.last_event_at IS NULL OR entitlements.last_event_at <= EXCLUDED.last_event_at`,
    record,
  ]);
  return "applied";
}
