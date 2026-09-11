import { neon } from "@neondatabase/serverless";
import { ensureIdentitySchema } from "./server-auth";

export const stripeApi = "https://api.stripe.com/v1";
export const stripeSecret = () => process.env.STRIPE_SECRET_KEY ?? "";
export const stripeMonthlyPrice = () => process.env.STRIPE_MONTHLY_PRICE_ID ?? "price_1UEXCMEtqzZaLNKx6X0n1lj9";
export const stripeYearlyPrice = () => process.env.STRIPE_YEARLY_PRICE_ID ?? "price_1UEXDdEtqzZaLNKxLTk22kH8";
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
  await sql`UPDATE users SET plan = ${normalized === "active" ? "premium" : "free"}, subscription_status = ${normalized}, subscription_expires_at = ${periodEnd ? new Date(periodEnd * 1000).toISOString() : null}, trial_started_at = CASE WHEN ${trialEnd !== null} THEN COALESCE(trial_started_at, now()) ELSE trial_started_at END, trial_ends_at = ${trialEnd ? new Date(trialEnd * 1000).toISOString() : null}, stripe_customer_id = COALESCE(${customerId}, stripe_customer_id), stripe_subscription_id = COALESCE(${subscriptionId}, stripe_subscription_id), updated_at = now() WHERE id = ${userId}`;
}

export async function userByStripeId(customerId: string | null, subscriptionId: string | null) {
  if (!sql) return null;
  await ensureIdentitySchema();
  const rows = await sql`SELECT id FROM users WHERE (${customerId} IS NOT NULL AND stripe_customer_id = ${customerId}) OR (${subscriptionId} IS NOT NULL AND stripe_subscription_id = ${subscriptionId}) LIMIT 1`;
  return (rows[0] as { id?: string } | undefined)?.id ?? null;
}
