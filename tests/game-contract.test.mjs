import assert from "node:assert/strict";
import test from "node:test";
import { makeRoomCode, normalizeRoomSettings, replaceEstimateQuestion } from "../server/game-contract.js";

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

test("changing an estimate question removes the original localized override", () => {
  const original = {
    question: "Default question",
    localized: {
      en: { question: "Default question" },
      ja: { question: "既定の質問" },
    },
    options: [1, 2, 3, 4, 5],
    wrongGuesses: [1],
  };

  const changed = replaceEstimateQuestion(original, "How many concerts have you attended?");

  assert.deepEqual(changed, {
    question: "How many concerts have you attended?",
    wrongGuesses: [],
  });
  assert.equal(original.localized.en.question, "Default question");
});
