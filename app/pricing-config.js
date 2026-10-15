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

const AMOUNTS = { USD: { month: 4.99, year: 29.99 }, BRL: { month: 14.9, year: 99 } };

/** Locale-consistent price labels: pt-BR uses "R$ 14,90", other locales use "R$14.90" / "US$4.99". */
export function priceLabels(currency, locale = "en") {
  const amounts = AMOUNTS[currency] ?? AMOUNTS.USD;
  const symbol = currency === "BRL" ? "R$" : "US$";
  const pt = locale === "pt-BR";
  const fmt = (value) => pt ? `${symbol} ${value.toFixed(2).replace(".", ",")}` : `${symbol}${value.toFixed(2)}`;
  const savings = Math.round((amounts.month * 12 - amounts.year) * 100) / 100;
  return { month: fmt(amounts.month), year: fmt(amounts.year), yearlySavings: fmt(savings) };
}
