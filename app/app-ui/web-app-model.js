// hontogame.com/app: pure view-model helpers (no React, no fetch), shared by the pages and tests.
// Local days ("YYYY-MM-DD") are calendar days in someone's time zone; they are never converted, so all
// day math below runs in UTC on purpose.
import { JAPANESE_PHRASES } from "../photo-moments.js";

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const KANJI_MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const LOCALE = "en-US";

export const isLocalDay = (value) => typeof value === "string" && DAY_RE.test(value) && toDate(value).toISOString().slice(0, 10) === value;
export const isYearMonth = (value) => typeof value === "string" && MONTH_RE.test(value);

function toDate(day) { return new Date(`${day}T00:00:00Z`); }
const iso = (date) => date.toISOString().slice(0, 10);

export function addDays(day, amount) {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return iso(date);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from, to) { return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000); }

export const monthOf = (day) => day.slice(0, 7);

export function shiftMonth(month, delta) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return iso(date).slice(0, 7);
}

export function monthTitle(month) {
  return new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }).format(toDate(`${month}-01`));
}

export const kanjiMonth = (month) => KANJI_MONTHS[Number(month.slice(5, 7)) - 1];

/** Monday-first weeks for a month; `null` pads the first and last week. */
export function monthGrid(month) {
  const first = `${month}-01`;
  const lead = (toDate(first).getUTCDay() + 6) % 7;
  const length = daysBetween(first, `${shiftMonth(month, 1)}-01`);
  const cells = [...Array(lead).fill(null), ...Array.from({ length }, (_, index) => addDays(first, index))];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/** First day Free can open: today and the 6 days before (contract: `historyLimitDays` = 7). */
export const freeWindowStart = (today, historyLimitDays) => addDays(today, -(historyLimitDays - 1));

/**
 * What a calendar cell shows. The server's `locked` flag wins; the window check also greys out days without
 * photos so the 7-day gate reads the same everywhere.
 * @returns {"future" | "locked" | "photos" | "empty"}
 */
export function dayCellState({ day, summary, today, historyLimitDays }) {
  if (day > today) return "future";
  if (summary?.locked) return "locked";
  if (historyLimitDays != null && day < freeWindowStart(today, historyLimitDays)) return "locked";
  if (summary && summary.photoCount > 0) return "photos";
  return "empty";
}

/** Day opened in the side panel: the requested one, else today, else the latest open day with photos. */
export function pickSelectedDay({ requested, month, days, today }) {
  if (isLocalDay(requested) && monthOf(requested) === month && requested <= today) return requested;
  if (monthOf(today) === month) return today;
  const open = days.filter((entry) => !entry.locked && entry.photoCount > 0 && entry.day <= today);
  return open.length ? open[open.length - 1].day : null;
}

/** "Day 412" counts like `daysTogether` (days since `startedOn`). */
export function dayNumber(startedOn, day) {
  if (!isLocalDay(startedOn) || !isLocalDay(day)) return null;
  const value = daysBetween(startedOn, day);
  return value >= 0 ? value : null;
}

export function formatLongDay(day) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(toDate(day));
}

export function formatShortDay(day) {
  return new Intl.DateTimeFormat(LOCALE, { month: "long", day: "numeric", timeZone: "UTC" }).format(toDate(day));
}

export function formatCalendarDate(day) {
  return new Intl.DateTimeFormat(LOCALE, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(toDate(day));
}

function safeZone(timeZone) {
  if (!timeZone) return "UTC";
  try { new Intl.DateTimeFormat(LOCALE, { timeZone }); return timeZone; } catch { return "UTC"; }
}

/** "1:41 PM" in a time zone. */
export function formatTime(instant, timeZone) {
  return new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit", timeZone: safeZone(timeZone) }).format(new Date(instant));
}

/** "3 PM", or "3:30 PM" when the minutes matter. */
export function formatHour(instant, timeZone) {
  const zone = safeZone(timeZone);
  const date = new Date(instant);
  const minutes = new Intl.DateTimeFormat(LOCALE, { minute: "numeric", timeZone: zone }).format(date);
  return new Intl.DateTimeFormat(LOCALE, Number(minutes) ? { hour: "numeric", minute: "2-digit", timeZone: zone } : { hour: "numeric", timeZone: zone }).format(date);
}

export function formatDateInZone(instant, timeZone, withYear = false) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: safeZone(timeZone) }).format(new Date(instant));
}

const CITY_NAMES = { Sao_Paulo: "São Paulo", Mexico_City: "Mexico City", Ho_Chi_Minh: "Ho Chi Minh City" };

/** "Asia/Tokyo" → "Tokyo". */
export function cityFromTimeZone(timeZone) {
  if (!timeZone || !timeZone.includes("/")) return null;
  const last = timeZone.split("/").pop();
  return CITY_NAMES[last] ?? last.replace(/_/g, " ");
}

/** "Busy until 3 PM" from `partnerStatus`, formatted in the partner's zone. */
export function partnerStatusLine(status, timeZone) {
  if (!status) return null;
  if (status.state === "busy") return status.busyUntil ? `Busy until ${formatHour(status.busyUntil, timeZone)}` : "Busy";
  if (status.state === "free") return status.freeUntil ? `Free until ${formatHour(status.freeUntil, timeZone)}` : "Free";
  return null;
}

/** Countdown chip. Past meetings read as "none planned". */
export function reunionLines(reunion) {
  if (!reunion || reunion.daysUntil < 0) return { title: "No meeting planned", detail: "Add your next one in the app" };
  const place = reunion.city ?? null;
  const detail = formatDateInZone(reunion.at, reunion.timeZone);
  if (reunion.daysUntil === 0) return { title: place ? `Together in ${place} today` : "Together today", detail };
  const days = reunion.daysUntil === 1 ? "1 day" : `${reunion.daysUntil} days`;
  return { title: place ? `${days} until ${place}` : `${days} until you meet`, detail };
}

export function togetherLines(daysTogether, startedOn) {
  if (daysTogether == null || !isLocalDay(startedOn)) return { title: "Days together", detail: "Add your start date in the app" };
  return { title: daysTogether === 1 ? "1 day together" : `${daysTogether.toLocaleString(LOCALE)} days together`, detail: `Since ${formatCalendarDate(startedOn)}` };
}

/** Japanese phrase, romaji and translation for a photo; custom phrases come back as plain text. */
export function photoPhrase(photo) {
  if (!photo) return null;
  const known = JAPANESE_PHRASES.find((phrase) => phrase.key === photo.phraseKey);
  if (known) return { ja: known.ja, romaji: known.romaji, translation: known.en };
  const text = typeof photo.phrase === "string" ? photo.phrase.trim() : "";
  return text ? { text } : null;
}

/** Daily photo per person (falls back to their first photo), plus everything else from that day. */
export function splitDayPhotos(photos = []) {
  const ready = photos.filter((photo) => photo.status === "ready" && photo.urls);
  const pick = (author) => ready.find((photo) => photo.author === author && photo.isDaily) ?? ready.find((photo) => photo.author === author) ?? null;
  const partner = pick("partner");
  const me = pick("me");
  return { partner, me, extras: ready.filter((photo) => photo !== partner && photo !== me) };
}

export function initial(name) {
  const letter = String(name ?? "").trim().charAt(0);
  return letter ? letter.toLocaleUpperCase(LOCALE) : "?";
}

/** Read-only Premium status for the nav pill and Settings. The web never sells (no checkout here). */
export function premiumSummary(entitlement) {
  if (!entitlement?.premium) return { active: false, label: "Free", detail: "Free keeps the last 7 days of memories. Upgrade in the Honto app to see your whole story here too." };
  const until = entitlement.expiresAt ? formatCalendarDate(entitlement.expiresAt.slice(0, 10)) : null;
  const trial = entitlement.periodType === "trial";
  const label = trial ? "Premium · trial" : "Premium · active";
  const payer = entitlement.grantedBy === "partner" ? "Shared by your partner." : null;
  let renewal = null;
  if (until) renewal = trial ? `Trial ends ${until}.` : entitlement.willRenew === false ? `Ends ${until}.` : `Renews ${until}.`;
  const where = entitlement.source === "stripe" ? "Managed from your Honto web account." : entitlement.source === "admin" ? "Granted by Honto." : "Managed in the app store you subscribed with.";
  return { active: true, label, detail: [renewal, payer, where].filter(Boolean).join(" ") };
}
