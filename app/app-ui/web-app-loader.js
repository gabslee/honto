// hontogame.com/app: turns `/api/v1` responses into what a page renders. `source` is either the real API
// (cookie-forwarding client, see web-app-data.ts) or the fixture source below, so this file stays testable.
import { dayCellState, isYearMonth, monthOf, pickSelectedDay, shiftMonth } from "./web-app-model.js";

const status = (error) => (error && typeof error === "object" && "status" in error ? error.status : 0);

function failure(error) {
  if (status(error) === 401) return { kind: "signed-out" };
  return { kind: "unavailable", message: "Your memories are not available right now. Try again in a moment." };
}

/** Settings only needs `/api/v1/me`. */
export async function loadSettingsView(source) {
  try {
    return { kind: "ready", me: await source.getMe() };
  } catch (error) {
    return failure(error);
  }
}

async function loadDay(source, memories, selectedDay, today) {
  const summary = memories.days.find((entry) => entry.day === selectedDay) ?? null;
  const state = dayCellState({ day: selectedDay, summary, today, historyLimitDays: memories.historyLimitDays });
  if (state === "locked") return { kind: "locked", day: selectedDay };
  if (state !== "photos") return { kind: "empty", day: selectedDay };
  try {
    return { kind: "photos", day: selectedDay, detail: await source.getMemoryDay(selectedDay) };
  } catch (error) {
    if (status(error) === 403) return { kind: "locked", day: selectedDay };
    if (status(error) === 401) throw error;
    return { kind: "error", day: selectedDay };
  }
}

/** Memories page: `/me` + `/today` (top bar), `/memories?month` (calendar) and `/memories/{day}` (open day). */
export async function loadMemoriesView(source, { month: requestedMonth, day: requestedDay } = {}) {
  let me;
  let today;
  try {
    [me, today] = await Promise.all([
      source.getMe(),
      source.getToday().catch((error) => (status(error) === 409 ? null : Promise.reject(error))),
    ]);
  } catch (error) {
    return failure(error);
  }
  if (!me.couple || !today) return { kind: "unpaired", me };
  const todayDay = today.me.localDay;
  const currentMonth = monthOf(todayDay);
  const month = isYearMonth(requestedMonth) && requestedMonth <= currentMonth ? requestedMonth : currentMonth;
  try {
    const memories = await source.getMemoriesMonth(month);
    const selectedDay = pickSelectedDay({ requested: requestedDay, month, days: memories.days, today: todayDay });
    const day = selectedDay ? await loadDay(source, memories, selectedDay, todayDay) : null;
    return {
      kind: "ready",
      me,
      today,
      memories,
      month,
      todayDay,
      selectedDay,
      day,
      previousMonth: shiftMonth(month, -1),
      nextMonth: month < currentMonth ? shiftMonth(month, 1) : null,
    };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Fixture source (dev and preview only, behind HONTO_WEB_APP_FIXTURES=1): serves contracts/fixtures/*.json
// until W1b/W2a ship `/api/v1` on main. Photo URLs in the fixtures are fake, so they are swapped for generated
// SVG tiles (no real photos are bundled or committed).

export const FIXTURE_VARIANTS = ["premium", "free", "unpaired", "signed-out"];

const TILE_COLORS = [["#C8D4EA", "#34507F"], ["#F0C7CE", "#9C4A5A"], ["#E3D6BE", "#8F6A3A"], ["#C9DBC0", "#5E7A4D"], ["#D9D2E9", "#5B4E80"], ["#F2D4B8", "#B0612E"]];

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}

/** Generated placeholder tile, as an inline SVG data URI. */
export function placeholderTile(seed, width = 300, height = 400) {
  const [light, dark] = TILE_COLORS[hash(seed) % TILE_COLORS.length];
  const angle = hash(`${seed}a`) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.72}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.12}" fill="#fff" fill-opacity=".35"/><path d="M0 ${height * 0.78} L${width * 0.35} ${height * 0.55} L${width * 0.6} ${height * 0.7} L${width} ${height * 0.5} V${height} H0Z" fill="#000" fill-opacity=".12"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const URL_KEYS = new Set(["thumbUrl", "full", "thumb"]);

/** Deep copy with every photo URL replaced by a placeholder tile seeded by the photo id. */
export function withPlaceholders(value) {
  if (Array.isArray(value)) return value.map(withPlaceholders);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (URL_KEYS.has(key) && typeof entry === "string" && /^https?:/.test(entry)) {
      const seed = entry.match(/photos\/([^/]+)\//)?.[1] ?? entry;
      return [key, key === "thumbUrl" || key === "thumb" ? placeholderTile(seed, 256, 256) : placeholderTile(seed)];
    }
    return [key, withPlaceholders(entry)];
  }));
}

class FixtureError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Older months: a few made-up days so the calendar can be reviewed (Free sees them locked). */
function syntheticMonth(month, free) {
  const days = [];
  const last = Number(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate());
  for (let date = 1; date <= last; date += 1) {
    if (hash(`${month}-${date}`) % 4 === 0) continue;
    const day = `${month}-${String(date).padStart(2, "0")}`;
    const thumb = (who) => ({ photoId: `ph_${who}_${day}`, thumbUrl: placeholderTile(`${who}${day}`, 256, 256), expiresAt: "2026-10-20T12:00:00Z" });
    days.push({ day, locked: free, photoCount: 2, me: free ? null : thumb("ana"), partner: free ? null : thumb("kenji") });
  }
  return { month, historyLimitDays: free ? 7 : null, days };
}

function syntheticDay(summary) {
  const photo = (author, thumb) => ({
    id: thumb.photoId, author, authorUserId: author === "me" ? "usr_ana" : "usr_kenji", localDay: summary.day, isDaily: true, status: "ready",
    phraseKey: author === "partner" ? "omoide" : null, phrase: author === "partner" ? "思い出" : null, width: 1080, height: 1440,
    createdAt: `${summary.day}T${author === "me" ? "21" : "10"}:15:00Z`,
    urls: { full: placeholderTile(thumb.photoId), thumb: thumb.thumbUrl, expiresAt: thumb.expiresAt },
  });
  return { day: summary.day, photos: [summary.partner && photo("partner", summary.partner), summary.me && photo("me", summary.me)].filter(Boolean) };
}

/**
 * @param fixtures `{ getMe, getMeUnpaired, getMe401, getToday, getTodayFree, getToday409, getMemoriesMonth,
 *   getMemoriesMonthFree, getMemoryDay, getMemoryDay403 }` (contents of contracts/fixtures)
 */
export function createFixtureSource(fixtures, variant = "premium") {
  const fx = withPlaceholders(fixtures);
  const free = variant === "free";
  const me = free ? { ...fx.getMe, couple: { ...fx.getMe.couple, premium: false }, entitlement: fx.getTodayFree.entitlement } : fx.getMe;
  const today = free ? fx.getTodayFree : fx.getToday;
  const months = new Map([[fx.getMemoriesMonth.month, free ? fx.getMemoriesMonthFree : fx.getMemoriesMonth]]);
  const monthFor = (month) => months.get(month) ?? (month < fx.getMemoriesMonth.month ? syntheticMonth(month, free) : { month, historyLimitDays: free ? 7 : null, days: [] });
  return {
    async getMe() {
      if (variant === "signed-out") throw new FixtureError(401, fx.getMe401);
      return variant === "unpaired" ? fx.getMeUnpaired : me;
    },
    async getToday() {
      if (variant === "signed-out") throw new FixtureError(401, fx.getMe401);
      if (variant === "unpaired") throw new FixtureError(409, fx.getToday409);
      return today;
    },
    async getMemoriesMonth(month) { return monthFor(month); },
    async getMemoryDay(day) {
      const summary = monthFor(day.slice(0, 7)).days.find((entry) => entry.day === day);
      if (!summary || summary.locked) throw new FixtureError(summary ? 403 : 404, summary ? fx.getMemoryDay403 : { error: "Not found.", code: "not_found" });
      return day === fx.getMemoryDay.day ? fx.getMemoryDay : syntheticDay(summary);
    },
  };
}
