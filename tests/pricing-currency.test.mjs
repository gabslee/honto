import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRICE_DISPLAY, currencyForCountry, resolvePriceId } from "../app/pricing-config.js";

// One currency per page: Brazil sees only R$14,90 / R$99, everyone else only US$4.99 / US$29.99.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const otherCurrency = (text, currency) => (currency === "BRL" ? /US\$|USD|(?<![R\w])\$\s?\d/.test(text) : /R\$|BRL|reais/.test(text));
const VISITORS = [{ country: "BR", currency: "BRL" }, { country: "US", currency: "USD" }, { country: "PT", currency: "USD" }, { country: null, currency: "USD" }];

let country = null;
const nodeRequire = createRequire(import.meta.url);
const STUBS = {
  "next/link": { __esModule: true, default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
  "next/headers": { headers: async () => new Map(country ? [["x-vercel-ip-country", country]] : []) },
};
const cache = new Map();
function load(file) {
  const path = [file, `${file}.tsx`, `${file}.ts`, `${file}.js`].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (cache.has(path)) return cache.get(path).exports;
  const mod = { exports: {} };
  cache.set(path, mod);
  const output = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = (id) => STUBS[id] ?? (id.startsWith(".") ? load(resolve(dirname(path), id)) : nodeRequire(id));
  new Function("require", "module", "exports", output)(localRequire, mod, mod.exports);
  return mod.exports;
}

test("currency follows the Vercel IP country", () => {
  for (const visitor of VISITORS) assert.equal(currencyForCountry(visitor.country), visitor.currency);
});

test("/pricing renders only the visitor's currency, in every locale", () => {
  const PricingClient = load(join(root, "app/pricing/pricing-client")).default;
  for (const visitor of VISITORS) {
    const html = renderToStaticMarkup(React.createElement(PricingClient, { currency: visitor.currency }));
    const labels = PRICE_DISPLAY[visitor.currency];
    for (const label of [labels.month, labels.year, labels.yearlySavings]) assert.ok(html.includes(label), `${visitor.country}: ${label}`);
    assert.ok(!otherCurrency(html, visitor.currency), `${visitor.country} sees another currency`);
  }
});

test("/subscriptions renders only the visitor's currency", async () => {
  const SubscriptionsPage = load(join(root, "app/subscriptions/page")).default;
  for (const visitor of VISITORS) {
    country = visitor.country;
    const html = renderToStaticMarkup(await SubscriptionsPage());
    const labels = PRICE_DISPLAY[visitor.currency];
    assert.ok(html.includes(`${labels.month} per month or ${labels.year} per year`), `${visitor.country}: plan line`);
    assert.ok(!otherCurrency(html, visitor.currency), `${visitor.country} sees another currency`);
  }
  country = null;
});

test("landing price line (signup card) uses the same labels as /pricing in en, ja and pt-BR", () => {
  const { getMessages } = load(join(root, "app/i18n"));
  for (const locale of ["en", "ja", "pt-BR"]) {
    const { price, priceBRL } = getMessages(locale).landing;
    for (const label of [PRICE_DISPLAY.USD.month, PRICE_DISPLAY.USD.year]) assert.ok(price.includes(label), `${locale} price: ${label}`);
    for (const label of [PRICE_DISPLAY.BRL.month, PRICE_DISPLAY.BRL.year]) assert.ok(priceBRL.includes(label), `${locale} priceBRL: ${label}`);
    assert.ok(!otherCurrency(price, "USD"), `${locale} price`);
    assert.ok(!otherCurrency(priceBRL, "BRL"), `${locale} priceBRL`);
  }
  const game = readFileSync(join(root, "app/game-client.tsx"), "utf8");
  assert.match(game, /<p className="hero-price">\{props\.currency === "BRL" \? copy\.priceBRL : copy\.price\}<\/p>/);
  assert.match(game, /<Landing currency=\{currency\}/);
  assert.match(readFileSync(join(root, "app/page.tsx"), "utf8"), /currencyForCountry\(\(await headers\(\)\)\.get\("x-vercel-ip-country"\)\)/);
});

test("no hardcoded price outside pricing-config, i18n and the subscriptions page", () => {
  for (const file of ["app/game-client.tsx", "app/pricing/pricing-client.tsx", "app/legal-pages.tsx", "app/terms/page.tsx", "app/privacy/page.tsx", "app/account/page.tsx", "app/account/manage-premium.tsx"]) {
    assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /(US|R)\$\s?\d|\$\d|\d[.,]99\b|14[.,]90/, file);
  }
  for (const file of ["app/i18n.ts", "app/pricing-config.js", "app/subscriptions/page.tsx", "app/pricing/pricing-client.tsx"]) {
    assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /39[.,]99/, file);
  }
});

test("checkout charges the displayed currency: BRL price ids for Brazil, USD ids elsewhere", () => {
  assert.equal(resolvePriceId("month", currencyForCountry("BR"), {}), "price_1UQi29RQHXAQ6ftMqs81fLlp");
  assert.equal(resolvePriceId("year", currencyForCountry("BR"), {}), "price_1UQi29RQHXAQ6ftMyuc6hJxs");
  assert.equal(resolvePriceId("month", currencyForCountry("US"), {}), "price_1UEbQpRQHXAQ6ftMKfSBbsdS");
  assert.equal(resolvePriceId("year", currencyForCountry("US"), {}), "price_1UQi29RQHXAQ6ftM65UMcRaC");
  const route = readFileSync(join(root, "app/api/billing/checkout/route.ts"), "utf8");
  assert.match(route, /currencyForCountry\(request\.headers\.get\("x-vercel-ip-country"\)\)/);
});
