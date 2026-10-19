// Premium pricing by currency. Brazil (by Vercel IP country) pays in BRL by card; everyone else in USD. No Pix yet.
export const PRICE_IDS = {
  USD: { month: "price_1UEbQpRQHXAQ6ftMKfSBbsdS", year: "price_1UQi29RQHXAQ6ftM65UMcRaC" },
  BRL: { month: "price_1UQi29RQHXAQ6ftMqs81fLlp", year: "price_1UQi29RQHXAQ6ftMyuc6hJxs" },
};

// What the visitor sees (decision of 19/10): Brazil sees only BRL, everyone else only USD, with the same labels in
// every locale and on every page (landing, pricing, subscriptions, legal). Must match the Stripe prices above.
export const PRICE_DISPLAY = {
  USD: { month: "US$4.99", year: "US$29.99", yearlySavings: "US$29.89" },
  BRL: { month: "R$14,90", year: "R$99", yearlySavings: "R$79,80" },
};

export function currencyForCountry(country) {
  return String(country ?? "").trim().toUpperCase() === "BR" ? "BRL" : "USD";
}

export function resolvePriceId(interval, currency, env = {}) {
  const yearly = interval === "year";
  if (currency === "BRL") return yearly ? env.STRIPE_YEARLY_PRICE_ID_BRL || PRICE_IDS.BRL.year : env.STRIPE_MONTHLY_PRICE_ID_BRL || PRICE_IDS.BRL.month;
  return yearly ? env.STRIPE_YEARLY_PRICE_ID || env.STRIPE_ANNUAL_PRICE_ID || PRICE_IDS.USD.year : env.STRIPE_MONTHLY_PRICE_ID || PRICE_IDS.USD.month;
}

/**
 * Checkout charges the currency the page showed. A mismatch (the visitor's country changed) asks for a reload.
 * @returns {{ currency: "BRL" | "USD"; matches: boolean }}
 */
export function checkoutCurrency(country, shownCurrency) {
  const currency = currencyForCountry(country);
  return { currency, matches: !shownCurrency || shownCurrency === currency };
}

/** Price labels for a currency. The locale no longer changes the format, so a page never shows two styles. */
export function priceLabels(currency) {
  return PRICE_DISPLAY[currency === "BRL" ? "BRL" : "USD"];
}

