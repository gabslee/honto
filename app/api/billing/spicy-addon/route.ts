import { getCurrentUser } from "../../../server-auth";
import { stripeRequest, stripeSecret } from "../../../stripe";
import { ownsSpicyAddon, spicyAddonCheckoutParams, spicyAddonConfig } from "../../../spicy-addon.js";

export const dynamic = "force-dynamic";

// One-time checkout for the Spicy 18+ long-distance add-on (separate from Premium).
// Disabled (404) until FEATURE_SPICY_ADDON and STRIPE_SPICY_ADDON_PRICE_ID are both set.
export async function POST(request: Request) {
  const config = spicyAddonConfig(process.env);
  if (!config.enabled || !config.priceId) return Response.json({ error: "This add-on is not available yet." }, { status: 404 });
  const user = await getCurrentUser(request);
  if (!user) return Response.json({ error: "Sign in to unlock the add-on." }, { status: 401 });
  if (!user.termsAcceptedAt) return Response.json({ error: "Accept the Terms of Use and Privacy Policy first." }, { status: 428 });
  if (ownsSpicyAddon(user)) return Response.json({ error: "You already own this add-on." }, { status: 409 });
  if (!stripeSecret()) return Response.json({ error: "Stripe is not configured yet." }, { status: 503 });
  const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://hontogame.com";
  const response = await stripeRequest("/checkout/sessions", spicyAddonCheckoutParams({ priceId: config.priceId, userId: user.id, email: user.email, origin }));
  const data = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !data.url) return Response.json({ error: data.error?.message || "Unable to create Stripe checkout." }, { status: 502 });
  return Response.json({ url: data.url });
}
