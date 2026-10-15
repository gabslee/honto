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
  assert.equal(pointsLabel(2, "en", true), "♥ points");
  assert.equal(pointsLabel(1, "pt-BR", true), "ponto ♥");
  assert.equal(pointsLabel(2, "en", false), "sips");
  for (const locale of ["en", "pt-BR", "ja"]) assert.doesNotMatch(dateResultTitle({ loserName: "Ana", both: false, points: 2, locale }), /sip|drink|gole|シップ|飲/i);
});

test("lobby toggle, server persistence and UI wiring", async () => {
  const server = await readFile(new URL("../api/game.ts", import.meta.url), "utf8");
  assert.match(server, /drink_mode text NOT NULL DEFAULT 'sips'/);
  assert.match(server, /drink_mode = \$\{settings\.drinkMode\}/);
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  assert.match(client, /configure\(\{ drinkMode: mode \}\)/);
  assert.match(client, /dateResultTitle\(/);
  assert.match(client, /dateMode \? "💗" : "🍺"/);
});
