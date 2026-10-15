import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deckAllowsAdultContent, containsSexualContent, anySexualContent, allowedCategories } from "../app/content-safety.js";

test("adult content is only allowed when the saved deck includes Spicy 18+", () => {
  assert.equal(deckAllowsAdultContent("spicy"), true);
  assert.equal(deckAllowsAdultContent("general,spicy"), true);
  assert.equal(deckAllowsAdultContent("general,relationships"), false);
  assert.equal(deckAllowsAdultContent("videoCall,reunion"), false);
  assert.equal(deckAllowsAdultContent(""), false);
  assert.equal(deckAllowsAdultContent(undefined), false);
});

test("sexual terms are detected in generated lies", () => {
  assert.equal(containsSexualContent("I once had sex on a plane."), true);
  assert.equal(containsSexualContent("I sent nudes to the wrong person."), true);
  assert.equal(containsSexualContent("We made out in a cinema."), true);
  assert.equal(containsSexualContent("I hooked up with my neighbour."), true);
  assert.equal(anySexualContent(["I baked bread.", "I slept with my boss."]), true);
});

test("ordinary lies are not flagged", () => {
  for (const lie of ["I once missed a flight because I followed the wrong stranger.", "I can fold a fitted sheet perfectly every time.", "I had a crush on my teacher in school.", "We went on a date to a sushi bar.", "I essex grew up in Sussex"]) {
    assert.equal(containsSexualContent(lie), false, lie);
  }
});

test("client cannot request the spicy category unless the deck allows it", () => {
  assert.deepEqual(allowedCategories(["spicy"], false), ["general"]);
  assert.deepEqual(allowedCategories(["relationships", "spicy"], false), ["relationships"]);
  assert.deepEqual(allowedCategories(["spicy"], true), ["spicy"]);
});

test("suggest route reads the deck from server state and checks output", async () => {
  const source = await readFile(new URL("../app/api/suggest/route.ts", import.meta.url), "utf8");
  assert.match(source, /SELECT r\.theme_category/);
  assert.match(source, /SAFE_FOR_WORK_INSTRUCTION/);
  assert.match(source, /anySexualContent/);
  assert.doesNotMatch(source, /adults-only game between consenting adults\. Truth/);
});
