export const SPICY_AGE_STORAGE_KEY = "honto-spicy-18-confirmed";

export function spicyDeckAccess({ premium, ageConfirmed }) {
  if (!premium) return "premium-locked";
  if (!ageConfirmed) return "age-confirmation-required";
  return "allowed";
}
