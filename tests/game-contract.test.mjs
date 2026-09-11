import assert from "node:assert/strict";
import test from "node:test";
import { makeRoomCode, normalizeRoomSettings } from "../api/game-contract.js";

const themeMap = { general: "general", life: "life", relationships: "relationships", spicy: "spicy" };
const room = { round_count: 12, theme_category: "general,life", custom_theme: "travel", locale: "en" };

test("partial room settings never overwrite unrelated host choices", () => {
  assert.deepEqual(normalizeRoomSettings(room, { roundCount: 24 }, themeMap), {
    roundCount: 24,
    themeCategory: "general,life",
    customTheme: "travel",
    locale: "en",
  });
  assert.deepEqual(normalizeRoomSettings(room, { themeCategory: "general,life,relationships,spicy" }, themeMap), {
    roundCount: 12,
    themeCategory: "general,life,relationships,spicy",
    customTheme: "travel",
    locale: "en",
  });
});

test("room codes use two words and a three-digit suffix", () => {
  const values = [0, 0.51, 0.999];
  assert.equal(makeRoomCode(["MOON", "WAVE"], () => values.shift()), "MOON-WAVE-999");
});
