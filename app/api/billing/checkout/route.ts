import { getCurrentUser, hasPremiumAccess } from "../../../server-auth";
import { stripeMonthlyPrice, stripeRequest, stripeSecret, stripeYearlyPrice } from "../../../stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return Response.json({ error: "Sign in to start Premium." }, { status: 401 });
  if (user.role === "admin" || hasPremiumAccess(user)) return Response.json({ error: "Premium is already active." }, { status: 409 });
  if (!stripeSecret()) return Response.json({ error: "Stripe is not configured yet." }, { status: 503 });
  let body: { interval?: string } = {};
  try { body = await request.json(); } catch { /* use monthly */ }
  const price = body.interval === "year" ? stripeYearlyPrice() : stripeMonthlyPrice();
  const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://repo-two-jet-78.vercel.app";
  const params = new URLSearchParams({ mode: "subscription", "line_items[0][price]": price, "line_items[0][quantity]": "1", customer_email: user.email, "subscription_data[trial_period_days]": "7", "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel", success_url: `${origin}/?billing=success`, cancel_url: `${origin}/?billing=cancelled`, "metadata[user_id]": user.id, "subscription_data[metadata][user_id]": user.id });
  const response = await stripeRequest("/checkout/sessions", params);
  const data = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !data.url) return Response.json({ error: data.error?.message || "Unable to create Stripe checkout." }, { status: 502 });
  return Response.json({ url: data.url });
}
