import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DATE_TASKS, dateTaskFor, normalizeDrinkMode, pointsLabel, dateResultTitle } from "../app/date-mode.js";
import { anySexualContent } from "../app/content-safety.js";

test("drink mode defaults to sips and only accepts known modes", () => {
  assert.equal(normalizeDrinkMode(undefined), "sips");
  assert.equal(normalizeDrinkMode("date"), "date");
  assert.equal(normalizeDrinkMode("beer", "date"), "date");
  assert.equal(normalizeDrinkMode("beer", "nope"), "sips");
});

test("date tasks are localized, SFW, alcohol-free and stable per card", () => {
  for (const task of DATE_TASKS) for (const locale of ["en", "pt-BR", "ja"]) {
    assert.ok(task[locale]?.trim());
    assert.equal(anySexualContent([task[locale]]), false);
    assert.doesNotMatch(task[locale], /drink|sip|beber|gole|飲/i);
  }
  assert.equal(dateTaskFor("card-1", "pt-BR"), dateTaskFor("card-1", "pt-BR"));
});

test("date mode labels points, never sips", () => {
  assert.equal(pointsLabel(2, "en", true), "points");
  assert.equal(pointsLabel(1, "pt-BR", true), "ponto");
  assert.equal(pointsLabel(2, "en", false), "sips");
  for (const locale of ["en", "pt-BR", "ja"]) assert.doesNotMatch(dateResultTitle({ loserName: "Ana", both: false, points: 2, locale }), /sip|drink|gole|シップ|飲/i);
});

test("lobby toggle, server persistence and UI wiring", async () => {
  const server = await readFile(new URL("../server/game.ts", import.meta.url), "utf8");
  assert.match(server, /drink_mode text NOT NULL DEFAULT 'sips'/);
  assert.match(server, /drink_mode = \$\{settings\.drinkMode\}/);
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  assert.match(client, /configure\(\{ drinkMode: mode \}\)/);
  assert.match(client, /dateResultTitle\(/);
  assert.match(client, /<Icon name=\{dateMode \? "heart" : "mug"\}\/>/);
});

import { dateify } from "../app/date-mode.js";
test("dateify removes every drinking word in en, pt-BR and ja", () => {
  const samples = ["Ana takes 2 sips.", "BOTH DRINK", "QUESTION OR SIPS", "Answer honestly or take the sips.", "TAKE 3 SIPS", "Skip this mini game · spin for 2, 3 or 4 sips", "Both of you drink.", "You will both drink the result.", "EVERYONE DRINKS", "Skip & sip!", "Ana, Ben, cheers!", "2–4 SIP WHEEL", "\u{1F37B}", "Cheers \u{1F942}", "Ana bebe 2 goles.", "2人とも飲む", "1シップ飲んで、もう一度。", "みんなで乾杯！", "シップルーレット"];
  for (const text of samples) assert.doesNotMatch(dateify(text), /sip|drink|cheers|gole|beb|シップ|飲|乾杯|\u{1F37B}|\u{1F37A}|\u{1F943}|\u{1F942}/iu, text);
});

test("every drinking string literal in the game UI goes through w()", async () => {
  const src = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  const literal = /"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  const offenders = [];
  for (const line of src.split("\n")) {
    if (/^\s*(import|type) |drinkMode|date-mode-banner|dateResultTitle|^\s*(honto|question|wouldrather|preference|estimate|rps|both): \{|CARD_META_JA: Record|^\s*honto: \{ label/.test(line)) continue;
    for (const match of line.matchAll(literal)) {
      const text = match[0];
      if (!/sip|drink|シップ|飲|cheers|乾杯|\u{1F37A}|\u{1F943}|\u{1F37B}/iu.test(text) || /^["`][a-z0-9 -]+["`]$/.test(text) || /sip-wheel|reveal-card/.test(text)) continue;
      const before = line.slice(Math.max(0, match.index - 2), match.index);
      if (before !== "w(") offenders.push(text.slice(0, 60));
    }
  }
  assert.deepEqual(offenders, []);
});
