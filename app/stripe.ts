import { neon } from "@neondatabase/serverless";
import { ensureIdentitySchema } from "./server-auth";

export const stripeApi = "https://api.stripe.com/v1";
export const stripeSecret = () => process.env.STRIPE_SECRET_KEY ?? "";
import { resolvePriceId } from "./pricing-config.js";
export const stripeMonthlyPrice = () => resolvePriceId("month", "USD", process.env);
export const stripeYearlyPrice = () => resolvePriceId("year", "USD", process.env);
// BRL: STRIPE_MONTHLY_PRICE_ID_BRL / STRIPE_YEARLY_PRICE_ID_BRL, defaulting to the live BRL prices.
export const stripeMonthlyPriceBrl = () => resolvePriceId("month", "BRL", process.env);
export const stripeYearlyPriceBrl = () => resolvePriceId("year", "BRL", process.env);
export const priceFor = (interval: "month" | "year", currency: "USD" | "BRL") => resolvePriceId(interval, currency, process.env);
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

export function stripeHeaders() {
  return { authorization: `Bearer ${stripeSecret()}`, "content-type": "application/x-www-form-urlencoded" };
}

export async function stripeRequest(path: string, params: URLSearchParams) {
  return fetch(`${stripeApi}${path}`, { method: "POST", headers: stripeHeaders(), body: params });
}

export async function saveStripeSubscription(userId: string, customerId: string | null, subscriptionId: string | null, status: string, periodEnd: number | null, trialEnd: number | null = null) {
  if (!sql) return;
  await ensureIdentitySchema();
  const normalized = status === "active" || status === "trialing" ? "active" : status === "past_due" || status === "incomplete" ? "past_due" : "canceled";
  await sql`UPDATE users SET plan = ${normalized === "active" ? "premium" : "free"}, subscription_status = ${normalized}, subscription_expires_at = ${periodEnd ? new Date(periodEnd * 1000).toISOString() : null}::timestamptz, trial_started_at = CASE WHEN ${trialEnd !== null}::boolean THEN COALESCE(trial_started_at, now()) ELSE trial_started_at END, trial_ends_at = ${trialEnd ? new Date(trialEnd * 1000).toISOString() : null}::timestamptz, stripe_customer_id = COALESCE(${customerId}::text, stripe_customer_id), stripe_subscription_id = COALESCE(${subscriptionId}::text, stripe_subscription_id), updated_at = now() WHERE id = ${userId}`;
}

export async function userByStripeId(customerId: string | null, subscriptionId: string | null) {
  if (!sql) return null;
  await ensureIdentitySchema();
  const rows = await sql`SELECT id FROM users WHERE (${customerId}::text IS NOT NULL AND stripe_customer_id = ${customerId}::text) OR (${subscriptionId}::text IS NOT NULL AND stripe_subscription_id = ${subscriptionId}::text) LIMIT 1`;
  return (rows[0] as { id?: string } | undefined)?.id ?? null;
}
