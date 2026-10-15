import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("annual price is displayed as US$29.99 and monthly stays US$4.99", async () => {
  for (const file of ["app/i18n.ts", "app/pricing-config.js", "app/subscriptions/page.tsx"]) {
    const src = await read(file);
    assert.doesNotMatch(src, /39[.,]99/, file);
    assert.match(src, /29[.,]99/, file);
    assert.match(src, /4[.,]99/, file);
  }
});

test("multiplayer mode is hidden from the UI", async () => {
  const src = await read("app/game-client.tsx");
  assert.match(src, /const MULTIPLAYER_UI_ENABLED = false;/);
  assert.match(src, /\{MULTIPLAYER_UI_ENABLED && game\.room\.canHostMultiplayer && <section className="panel multiplayer-mode-panel"/);
});

test("cards are localized per viewer with English fallback, never the room locale", async () => {
  const src = await read("api/game.ts");
  assert.match(src, /const deckLocale = locale === "ja" \? "ja" : "en";/);
  assert.match(src, /payload\.localized\?\.\[deckLocale\] \?\? payload\.localized\?\.en/);
  assert.doesNotMatch(src, /room\.locale === "ja" \? (PREFERENCE|ESTIMATE)/);
});

test("stale reveal modal is hidden once the next card is drawn", async () => {
  const src = await read("app/game-client.tsx");
  assert.match(src, /nextCardStarted/);
  assert.match(src, /!nextCardStarted \? game\.lastCard : null/);
});
