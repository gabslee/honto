import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spicyDeckAccess } from "../app/deck-access.js";
import { LONG_DISTANCE_DECKS, deckPrompts } from "../data/long-distance-decks.ts";

test("Spicy deck stays Premium-locked for free hosts even after age confirmation", () => {
  assert.equal(spicyDeckAccess({ premium: false, ageConfirmed: true }), "premium-locked");
});

test("Spicy deck asks Premium hosts for 18+ confirmation before first use", () => {
  assert.equal(spicyDeckAccess({ premium: true, ageConfirmed: false }), "age-confirmation-required");
  assert.equal(spicyDeckAccess({ premium: true, ageConfirmed: true }), "allowed");
});

test("each long-distance deck has 40 curated cards in every supported language", () => {
  for (const [key, cards] of Object.entries(LONG_DISTANCE_DECKS)) {
    assert.equal(cards.length, 40, `${key} should contain 40 cards`);
    for (const locale of ["en", "pt-BR", "ja"]) {
      const prompts = deckPrompts(locale)[key];
      assert.equal(prompts.length, 40);
      assert.ok(prompts.every((prompt) => prompt.trim().length > 0));
      assert.equal(new Set(prompts).size, 40, `${key}/${locale} should not contain duplicates`);
    }
  }
});

test("the free-host Spicy lock points to pricing with the couple-wide Premium CTA", async () => {
  const source = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  assert.match(source, /href="\/pricing"/);
  assert.match(source, /Unlock with Premium, for both of you/);
  assert.match(source, /SPICY_AGE_STORAGE_KEY/);
});
