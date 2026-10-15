// Async "Card of the Day" for a 2-player room. Pure logic (no DB) so it can be unit tested.

// Cards per local day. Keep limits here.
export const DAILY_CARD_LIMITS = { free: 1, premium: 3 };
export const DAILY_ANSWER_MAX = 500;
// Safe-for-work long-distance decks; adult decks only for Premium couples with 18+ confirmed on the server.
export const DAILY_SFW_DECKS = ["acrossMiles", "futureUs", "deepTalk", "playful", "videoCall", "reunion"];
export const DAILY_ADULT_DECKS = ["spicyLdr", "spicy"];

export function dailyLimit(premium) {
  return premium ? DAILY_CARD_LIMITS.premium : DAILY_CARD_LIMITS.free;
}

export function dailyDecks({ premium, adultConfirmed }) {
  return premium && adultConfirmed ? [...DAILY_SFW_DECKS, ...DAILY_ADULT_DECKS] : [...DAILY_SFW_DECKS];
}

export function validTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone }); return true; } catch { return false; }
}

/** The player's local calendar day as YYYY-MM-DD (falls back to UTC for unknown zones). */
export function localDay(timeZone, now = new Date()) {
  const zone = validTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function previousDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

/**
 * Deterministic card for (room, day, slot) from the allowed decks. Both partners get the same card
 * for the same day key. `decks` is { key: cardCount }.
 */
export function pickDailyCard(roomId, day, slot, decks) {
  const pool = Object.entries(decks).filter(([, count]) => count > 0);
  const total = pool.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return null;
  let index = hash(`${roomId}:${day}:${slot}`) % total;
  for (const [deck, count] of pool) {
    if (index < count) return { deck, index };
    index -= count;
  }
  return null;
}

/** Hide the partner's answer until both have answered. */
export function publicDailyEntry({ answers, meId, partnerId }) {
  const mine = answers.find((answer) => answer.playerId === meId) ?? null;
  const theirs = partnerId ? answers.find((answer) => answer.playerId === partnerId) ?? null : null;
  const revealed = Boolean(mine && theirs);
  return {
    myAnswer: mine?.answer ?? null,
    partnerAnswered: Boolean(theirs),
    partnerAnswer: revealed ? theirs.answer : null,
    revealed,
  };
}

export function cleanDailyAnswer(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, DAILY_ANSWER_MAX);
}
