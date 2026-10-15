import { saveStripeSubscription, stripeSecret, userByStripeId } from "../../../stripe";

export const dynamic = "force-dynamic";

async function signatureValid(payload: string, header: string, secret: string) {
  const pieces = Object.fromEntries(header.split(",").map((part) => part.split("=", 2) as [string, string]));
  if (!pieces.t || !pieces.v1) return false;
  const timestamp = Number(pieces.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const data = new TextEncoder().encode(`${pieces.t}.${payload}`);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return expected.length === pieces.v1.length && [...expected].every((char, index) => char === pieces.v1[index]);
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();
  if (!secret || !signature || !(await signatureValid(payload, signature, secret))) return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  const event = JSON.parse(payload) as { type?: string; data?: { object?: Record<string, any> } };
  const object = event.data?.object ?? {};
  const metadataUserId = String(object.metadata?.user_id ?? object.subscription_details?.metadata?.user_id ?? "");
  const customerId = typeof object.customer === "string" ? object.customer : null;
  const subscriptionId = typeof object.subscription === "string" ? object.subscription : (typeof object.id === "string" && object.id.startsWith("sub_") ? object.id : null);
  const userId = metadataUserId || await userByStripeId(customerId, subscriptionId);
  if (userId && (event.type === "checkout.session.completed" || event.type?.startsWith("customer.subscription."))) {
    const status = event.type === "checkout.session.completed" ? "active" : String(object.status ?? "active");
    await saveStripeSubscription(userId, customerId, subscriptionId, status, Number(object.current_period_end) || null, Number(object.trial_end) || null);
  } else if (userId && event.type === "invoice.payment_failed") {
    await saveStripeSubscription(userId, customerId, subscriptionId, "past_due", null);
  }
  return Response.json({ received: true });
}
