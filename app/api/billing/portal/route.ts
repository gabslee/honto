import { getCurrentUser } from "../../../server-auth";
import { stripeRequest, stripeSecret } from "../../../stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return Response.json({ error: "Sign in to manage Premium." }, { status: 401 });
  if (!stripeSecret() || !user.stripeCustomerId) return Response.json({ error: "No Stripe subscription found." }, { status: 404 });
  const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://repo-two-jet-78.vercel.app";
  const response = await stripeRequest("/billing_portal/sessions", new URLSearchParams({ customer: user.stripeCustomerId, return_url: origin }));
  const data = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !data.url) return Response.json({ error: data.error?.message || "Unable to open Stripe portal." }, { status: 502 });
  return Response.json({ url: data.url });
}
