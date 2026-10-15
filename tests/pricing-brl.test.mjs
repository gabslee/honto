import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PRICE_IDS, PRICE_DISPLAY, currencyForCountry, resolvePriceId } from "../app/pricing-config.js";

test("Brazil pays in BRL, everyone else in USD", () => {
  assert.equal(currencyForCountry("BR"), "BRL");
  assert.equal(currencyForCountry("br"), "BRL");
  assert.equal(currencyForCountry("US"), "USD");
  assert.equal(currencyForCountry(null), "USD");
});

test("price ids: defaults to the live prices, env overrides win", () => {
  assert.equal(resolvePriceId("month", "USD", {}), "price_1UEbQpRQHXAQ6ftMKfSBbsdS");
  assert.equal(resolvePriceId("year", "USD", {}), "price_1UQi29RQHXAQ6ftM65UMcRaC");
  assert.equal(resolvePriceId("month", "BRL", {}), "price_1UQi29RQHXAQ6ftMqs81fLlp");
  assert.equal(resolvePriceId("year", "BRL", {}), "price_1UQi29RQHXAQ6ftMyuc6hJxs");
  assert.equal(resolvePriceId("month", "BRL", { STRIPE_MONTHLY_PRICE_ID_BRL: "price_m" }), "price_m");
  assert.equal(resolvePriceId("year", "BRL", { STRIPE_YEARLY_PRICE_ID_BRL: "price_y" }), "price_y");
  assert.equal(resolvePriceId("year", "USD", { STRIPE_YEARLY_PRICE_ID: "price_u" }), "price_u");
  assert.notEqual(PRICE_IDS.USD.year, "price_1UEbQnRQHXAQ6ftMIfFeBVd9");
});

test("BRL display and savings math", () => {
  assert.deepEqual(PRICE_DISPLAY.BRL, { month: "R$ 14,90", year: "R$ 99,00", yearlySavings: "R$ 79,80" });
  assert.equal((14.9 * 12 - 99).toFixed(2), "79.80");
});

test("checkout uses the Vercel IP country; pages and legal text show BRL", async () => {
  const route = await readFile(new URL("../app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /currencyForCountry\(request\.headers\.get\("x-vercel-ip-country"\)\)/);
  assert.match(route, /priceFor\(/);
  const subs = await readFile(new URL("../app/subscriptions/page.tsx", import.meta.url), "utf8");
  assert.match(subs, /R\$ 14,90 per month or R\$ 99,00 per year/);
  assert.doesNotMatch(subs, /displayed in US dollars/);
  const i18n = await readFile(new URL("../app/i18n.ts", import.meta.url), "utf8");
  assert.match(i18n, /R\$14,90\/mês ou R\$99\/ano/);
  const pricing = await readFile(new URL("../app/pricing/page.tsx", import.meta.url), "utf8");
  assert.match(pricing, /x-vercel-ip-country/);
});

import { priceLabels } from "../app/pricing-config.js";
test("price labels stay consistent with the page locale", () => {
  assert.deepEqual(priceLabels("BRL", "pt-BR"), { month: "R$ 14,90", year: "R$ 99,00", yearlySavings: "R$ 79,80" });
  assert.deepEqual(priceLabels("BRL", "en"), { month: "R$14.90", year: "R$99.00", yearlySavings: "R$79.80" });
  assert.deepEqual(priceLabels("USD", "en"), { month: "US$4.99", year: "US$29.99", yearlySavings: "US$29.89" });
});

test("pricing page is localized for en, pt-BR and ja", async () => {
  const src = await readFile(new URL("../app/pricing/pricing-client.tsx", import.meta.url), "utf8");
  for (const text of ["START YEARLY →", "ASSINAR ANUAL →", "年額で始める →", "Pagamento somente com cartão."]) assert.ok(src.includes(text), text);
  assert.doesNotMatch(src, /"\/ mês" : "\/ month"/);
});
