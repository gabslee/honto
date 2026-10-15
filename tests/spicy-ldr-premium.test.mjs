import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spicyDeckAccess, deckRequiresPremium } from "../app/deck-access.js";
import { deckAllowsAdultContent, allowedCategories, anySexualContent } from "../app/content-safety.js";
import { deckPrompts } from "../data/long-distance-decks.ts";

test("server requires Premium for both Spicy 18+ decks only", () => {
  assert.equal(deckRequiresPremium("acrossMiles,futureUs,deepTalk,playful,videoCall,reunion"), false);
  assert.equal(deckRequiresPremium("spicy"), true);
  assert.equal(deckRequiresPremium("acrossMiles,spicyLdr"), true);
  assert.equal(deckRequiresPremium(null), false);
});

test("spicyLdr uses the same Premium + 18+ gate as spicy", () => {
  assert.equal(spicyDeckAccess({ premium: false, ageConfirmed: true }), "premium-locked");
  assert.equal(spicyDeckAccess({ premium: true, ageConfirmed: false }), "age-confirmation-required");
  assert.equal(spicyDeckAccess({ premium: true, ageConfirmed: true }), "allowed");
});

test("game server and lobby gate spicyLdr through the shared Premium check", async () => {
  const server = await readFile(new URL("../api/game.ts", import.meta.url), "utf8");
  assert.match(server, /deckRequiresPremium\(settings\.themeCategory\) && !hasPremiumAccess\(currentUser\)\) throw/);
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  assert.match(client, /key === "spicy" \|\| key === "spicyLdr"/);
  assert.match(client, /setPendingAdultDeck\(key\)/);
  assert.doesNotMatch(client, /spicy-addon|add-on/i);
});

test("no separate add-on purchase flow remains", async () => {
  const webhook = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(webhook, /addon/i);
  const auth = await readFile(new URL("../app/server-auth.ts", import.meta.url), "utf8");
  assert.doesNotMatch(auth, /spicy_addon/);
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
