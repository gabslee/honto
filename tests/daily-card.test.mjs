import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DAILY_CARD_LIMITS, DAILY_SFW_DECKS, dailyLimit, dailyDecks, localDay, previousDay, pickDailyCard, publicDailyEntry, cleanDailyAnswer, validTimeZone } from "../app/daily-card.js";
import { deckPrompts, LONG_DISTANCE_DECKS } from "../data/long-distance-decks.ts";
import { anySexualContent } from "../app/content-safety.js";

test("free couples get 1 card a day, Premium couples get 3 (config)", () => {
  assert.deepEqual(DAILY_CARD_LIMITS, { free: 1, premium: 3 });
  assert.equal(dailyLimit(false), 1);
  assert.equal(dailyLimit(true), 3);
});

test("adult decks only for Premium couples with server-side 18+ confirmation", () => {
  for (const args of [{ premium: false, adultConfirmed: false }, { premium: false, adultConfirmed: true }, { premium: true, adultConfirmed: false }]) {
    const decks = dailyDecks(args);
    assert.ok(!decks.includes("spicy") && !decks.includes("spicyLdr"));
  }
  const decks = dailyDecks({ premium: true, adultConfirmed: true });
  assert.ok(decks.includes("spicyLdr") && decks.includes("spicy"));
});

test("SFW daily decks exist and contain no adult content", () => {
  for (const key of DAILY_SFW_DECKS) {
    assert.ok(LONG_DISTANCE_DECKS[key]?.length > 0, key);
    for (const locale of ["en", "pt-BR", "ja"]) assert.equal(anySexualContent(deckPrompts(locale)[key]), false, `${key}/${locale}`);
  }
});

test("local day follows each partner's time zone", () => {
  const now = new Date("2026-10-15T02:30:00Z");
  assert.equal(localDay("America/Sao_Paulo", now), "2026-10-14");
  assert.equal(localDay("Asia/Tokyo", now), "2026-10-15");
  assert.equal(localDay("Not/AZone", now), "2026-10-15");
  assert.equal(validTimeZone("Not/AZone"), false);
  assert.equal(previousDay("2026-03-01"), "2026-02-28");
});

test("the card is deterministic per room/day/slot and changes across days", () => {
  const sizes = { acrossMiles: 30, futureUs: 30 };
  const a = pickDailyCard("room1", "2026-10-15", 1, sizes);
  assert.deepEqual(a, pickDailyCard("room1", "2026-10-15", 1, sizes));
  assert.ok(Object.keys(sizes).includes(a.deck) && a.index >= 0 && a.index < 30);
  const days = new Set(Array.from({ length: 10 }, (_, i) => JSON.stringify(pickDailyCard("room1", `2026-10-${10 + i}`, 1, sizes))));
  assert.ok(days.size > 5);
  assert.equal(pickDailyCard("room1", "2026-10-15", 1, {}), null);
});

test("answers stay hidden until both partners answered", () => {
  const me = { playerId: "a", answer: "mine" }; const them = { playerId: "b", answer: "theirs" };
  assert.deepEqual(publicDailyEntry({ answers: [them], meId: "a", partnerId: "b" }), { myAnswer: null, partnerAnswered: true, partnerAnswer: null, revealed: false });
  assert.deepEqual(publicDailyEntry({ answers: [me], meId: "a", partnerId: "b" }), { myAnswer: "mine", partnerAnswered: false, partnerAnswer: null, revealed: false });
  assert.deepEqual(publicDailyEntry({ answers: [me, them], meId: "a", partnerId: "b" }), { myAnswer: "mine", partnerAnswered: true, partnerAnswer: "theirs", revealed: true });
  assert.equal(cleanDailyAnswer("  hi \n there "), "hi there");
  assert.equal(cleanDailyAnswer("x".repeat(900)).length, 500);
});

test("server: room token identity, 2 players only, limits and adult confirmation enforced", async () => {
  const source = await readFile(new URL("../api/daily-card.ts", import.meta.url), "utf8");
  assert.match(source, /room\.multiplayer\) throw/);
  assert.match(source, /count\) > 2\) throw/);
  assert.match(source, /slot > dailyLimit\(premium\)\) throw/);
  assert.match(source, /hasPremiumAccess\(currentUser\)\) throw new Error\("Spicy is a Premium theme\."\)/);
  assert.match(source, /body\.confirm18 !== true\) throw/);
  assert.match(source, /ON CONFLICT DO NOTHING`;\n {2}\}\n {2}return dailyState/);
  const game = await readFile(new URL("../api/game.ts", import.meta.url), "utf8");
  assert.ok(game.indexOf("handleDaily(sql, room, me") > game.indexOf("await getContext(roomCode, token)"));
});

test("entry points on the landing and the room", async () => {
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  assert.match(client, /id="card-of-the-day"/);
  assert.match(client, /<DailyCardPanel code=\{session\.code\} token=\{session\.token\}/);
});
