import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spicyAddonConfig, spicyAddonAccess, ownsSpicyAddon, spicyAddonDeckError, isSpicyAddonPurchase, spicyAddonCheckoutParams, SPICY_ADDON_PRODUCT } from "../app/spicy-addon.js";
import { deckAllowsAdultContent, allowedCategories, anySexualContent } from "../app/content-safety.js";
import { deckPrompts } from "../data/long-distance-decks.ts";

test("add-on is hidden unless the flag AND a Stripe price id are both set", () => {
  assert.deepEqual(spicyAddonConfig({}), { enabled: false, priceId: null });
  assert.equal(spicyAddonConfig({ FEATURE_SPICY_ADDON: "1" }).enabled, false);
  assert.equal(spicyAddonConfig({ STRIPE_SPICY_ADDON_PRICE_ID: "price_abc123" }).enabled, false);
  assert.equal(spicyAddonConfig({ FEATURE_SPICY_ADDON: "1", STRIPE_SPICY_ADDON_PRICE_ID: "not-a-price" }).enabled, false);
  assert.deepEqual(spicyAddonConfig({ FEATURE_SPICY_ADDON: "true", STRIPE_SPICY_ADDON_PRICE_ID: "price_abc123" }), { enabled: true, priceId: "price_abc123" });
});

test("Premium does not include the add-on; only a purchase (or admin) owns it", () => {
  assert.equal(ownsSpicyAddon(null), false);
  assert.equal(ownsSpicyAddon({ role: "user", plan: "premium", subscriptionStatus: "active" }), false);
  assert.equal(ownsSpicyAddon({ role: "user", spicyAddonPurchasedAt: "2026-10-15T00:00:00Z" }), true);
  assert.equal(ownsSpicyAddon({ role: "admin" }), true);
});

test("client access states: hidden → locked → 18+ confirmation → allowed", () => {
  assert.equal(spicyAddonAccess({ enabled: false, owned: true, ageConfirmed: true }), "hidden");
  assert.equal(spicyAddonAccess({ enabled: true, owned: false, ageConfirmed: true }), "addon-locked");
  assert.equal(spicyAddonAccess({ enabled: true, owned: true, ageConfirmed: false }), "age-confirmation-required");
  assert.equal(spicyAddonAccess({ enabled: true, owned: true, ageConfirmed: true }), "allowed");
});

test("server rejects saving the add-on deck unless enabled and owned", () => {
  assert.equal(spicyAddonDeckError("acrossMiles,playful", { enabled: false, owned: false }), null);
  assert.ok(spicyAddonDeckError("acrossMiles,spicyLdr", { enabled: false, owned: true }));
  assert.ok(spicyAddonDeckError("spicyLdr", { enabled: true, owned: false }));
  assert.equal(spicyAddonDeckError("spicyLdr", { enabled: true, owned: true }), null);
});

test("only a paid one-time add-on checkout counts as a purchase", () => {
  const base = { mode: "payment", payment_status: "paid", metadata: { product: SPICY_ADDON_PRODUCT, user_id: "u1" } };
  assert.equal(isSpicyAddonPurchase(base), true);
  assert.equal(isSpicyAddonPurchase({ ...base, payment_status: "unpaid" }), false);
  assert.equal(isSpicyAddonPurchase({ ...base, mode: "subscription" }), false);
  assert.equal(isSpicyAddonPurchase({ ...base, metadata: { user_id: "u1" } }), false);
  const params = spicyAddonCheckoutParams({ priceId: "price_x1", userId: "u1", email: "a@b.c", origin: "https://hontogame.com" });
  assert.equal(params.get("mode"), "payment");
  assert.equal(params.get("line_items[0][price]"), "price_x1");
  assert.equal(params.get("metadata[product]"), SPICY_ADDON_PRODUCT);
});

test("webhook handles add-on payments before the subscription path", async () => {
  const source = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("isSpicyAddonPurchase") < source.indexOf("saveStripeSubscription(userId"));
});

test("adult AI content only when the server-side deck includes a Spicy 18+ deck", () => {
  assert.equal(deckAllowsAdultContent("acrossMiles,futureUs,deepTalk,playful"), false);
  assert.equal(deckAllowsAdultContent("acrossMiles,spicyLdr"), true);
  assert.deepEqual(allowedCategories(["spicyLdr"], false), ["general"]);
  assert.deepEqual(allowedCategories(["spicyLdr"], true), ["spicyLdr"]);
});

test("the four free long-distance decks are safe for work and 2-player only", () => {
  for (const locale of ["en", "pt-BR", "ja"]) {
    for (const key of ["acrossMiles", "futureUs", "deepTalk", "playful"]) {
      const prompts = deckPrompts(locale)[key];
      assert.equal(anySexualContent(prompts), false, `${key}/${locale}`);
      assert.ok(prompts.every((p) => !/multiplayer|everyone|group|マルチ|todos vocês/i.test(p)), `${key}/${locale}`);
    }
  }
});

test("lobby hides the add-on unless enabled and requires age confirmation for it", async () => {
  const source = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  assert.match(source, /key !== "spicyLdr" \|\| addonEnabled/);
  assert.match(source, /setPendingAdultDeck\("spicyLdr"\)/);
  assert.match(source, /\/api\/billing\/spicy-addon/);
});
