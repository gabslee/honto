// Spicy 18+ long-distance add-on: a one-time purchase, separate from Premium.
// It stays hidden until BOTH are set:
//   FEATURE_SPICY_ADDON=1                 (feature flag)
//   STRIPE_SPICY_ADDON_PRICE_ID=price_... (one-time Stripe price; TODO: price/product pending Gabriel's approval)
// No default price id exists on purpose: without it the add-on is hidden and checkout returns 503.

export const SPICY_ADDON_DECK = "spicyLdr";
export const SPICY_ADDON_PRODUCT = "spicy_ldr_addon";
// Adult deck keys. Adult AI content is only allowed when the server-side room deck contains one of these.
export const ADULT_DECKS = ["spicy", SPICY_ADDON_DECK];

export function spicyAddonConfig(env = {}) {
  const flag = String(env.FEATURE_SPICY_ADDON ?? "").trim().toLowerCase();
  const priceId = String(env.STRIPE_SPICY_ADDON_PRICE_ID ?? "").trim();
  const flagOn = flag === "1" || flag === "true" || flag === "on";
  const validPrice = /^price_[A-Za-z0-9]+$/.test(priceId);
  return { enabled: flagOn && validPrice, priceId: flagOn && validPrice ? priceId : null };
}

/** Admins always own it; otherwise only a recorded one-time purchase counts. Premium does NOT include it. */
export function ownsSpicyAddon(user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return Boolean(user.spicyAddonPurchasedAt);
}

/** "hidden" | "addon-locked" | "age-confirmation-required" | "allowed" */
export function spicyAddonAccess({ enabled, owned, ageConfirmed }) {
  if (!enabled) return "hidden";
  if (!owned) return "addon-locked";
  if (!ageConfirmed) return "age-confirmation-required";
  return "allowed";
}

/** Server check used when the host saves the room deck. Returns an error message or null. */
export function spicyAddonDeckError(themeCategory, { enabled, owned }) {
  const keys = String(themeCategory ?? "").split(",").map((key) => key.trim());
  if (!keys.includes(SPICY_ADDON_DECK)) return null;
  if (!enabled) return "This deck is not available yet.";
  if (!owned) return "Spicy 18+ long-distance is a separate add-on.";
  return null;
}

/** Is a Stripe checkout.session.completed event a paid spicy add-on purchase? */
export function isSpicyAddonPurchase(session) {
  return Boolean(session && session.mode === "payment" && session.metadata?.product === SPICY_ADDON_PRODUCT && session.payment_status === "paid");
}

export function spicyAddonCheckoutParams({ priceId, userId, email, origin }) {
  return new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    customer_email: email,
    success_url: `${origin}/?billing=addon-success`,
    cancel_url: `${origin}/?billing=cancelled`,
    "metadata[user_id]": userId,
    "metadata[product]": SPICY_ADDON_PRODUCT,
    "payment_intent_data[metadata][user_id]": userId,
    "payment_intent_data[metadata][product]": SPICY_ADDON_PRODUCT,
  });
}
