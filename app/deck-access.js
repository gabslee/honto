export const SPICY_AGE_STORAGE_KEY = "honto-spicy-18-confirmed";

export function spicyDeckAccess({ premium, ageConfirmed }) {
  if (!premium) return "premium-locked";
  if (!ageConfirmed) return "age-confirmation-required";
  return "allowed";
}

// Premium-only 18+ decks. Both use the same Premium + 18+ confirmation gate.
export const PREMIUM_ADULT_DECKS = ["spicy", "spicyLdr"];

/** Server check: does this saved room deck need Premium? */
export function deckRequiresPremium(themeCategory) {
  return String(themeCategory ?? "").split(",").map((key) => key.trim()).some((key) => PREMIUM_ADULT_DECKS.includes(key));
}
