// Premium pricing by currency. Brazil (by Vercel IP country) pays in BRL by card; everyone else in USD. No Pix yet.
export const PRICE_IDS = {
  USD: { month: "price_1UEbQpRQHXAQ6ftMKfSBbsdS", year: "price_1UQi29RQHXAQ6ftM65UMcRaC" },
  BRL: { month: "price_1UQi29RQHXAQ6ftMqs81fLlp", year: "price_1UQi29RQHXAQ6ftMyuc6hJxs" },
};

export const PRICE_DISPLAY = {
  USD: { month: "US$ 4.99", year: "US$ 29.99", yearlySavings: "US$ 29.89" },
  BRL: { month: "R$ 14,90", year: "R$ 99,00", yearlySavings: "R$ 79,80" },
};

export function currencyForCountry(country) {
  return String(country ?? "").trim().toUpperCase() === "BR" ? "BRL" : "USD";
}

export function resolvePriceId(interval, currency, env = {}) {
  const yearly = interval === "year";
  if (currency === "BRL") return yearly ? env.STRIPE_YEARLY_PRICE_ID_BRL || PRICE_IDS.BRL.year : env.STRIPE_MONTHLY_PRICE_ID_BRL || PRICE_IDS.BRL.month;
  return yearly ? env.STRIPE_YEARLY_PRICE_ID || env.STRIPE_ANNUAL_PRICE_ID || PRICE_IDS.USD.year : env.STRIPE_MONTHLY_PRICE_ID || PRICE_IDS.USD.month;
}
