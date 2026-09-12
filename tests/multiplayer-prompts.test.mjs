import assert from "node:assert/strict";
import test from "node:test";
import { multiplayerPrompts, WHO_PROMPTS, SURPRISE_PROMPTS } from "../data/multiplayer-prompts.ts";

test("multiplayer catalog follows the selected themes and has an English/Japanese version for every prompt", () => {
  const all = [...Object.values(WHO_PROMPTS).flat(), ...SURPRISE_PROMPTS];
  assert.equal(new Set(all.map((entry) => entry.id)).size, all.length);
  assert.ok(all.every((entry) => entry.en.length > 10 && entry.ja.length > 5));
  assert.deepEqual(multiplayerPrompts("en", ["life", "life"]).who, WHO_PROMPTS.life.map((entry) => entry.en));
  assert.deepEqual(multiplayerPrompts("ja", ["relationships"]).who, WHO_PROMPTS.relationships.map((entry) => entry.ja));
});
test("empty or unknown themes use general prompts and do not silently include spicy", () => {
  for (const themes of [[], ["unknown"]]) assert.deepEqual(multiplayerPrompts("en", themes).who, WHO_PROMPTS.general.map((entry) => entry.en));
  assert.ok(!multiplayerPrompts("en", ["general", "life"]).who.some((prompt) => WHO_PROMPTS.spicy.some((entry) => entry.en === prompt)));
});
