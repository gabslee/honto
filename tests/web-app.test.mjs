import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cityFromTimeZone, dayCellState, dayNumber, freeWindowStart, kanjiMonth, monthGrid, monthTitle, partnerStatusLine,
  photoPhrase, pickSelectedDay, premiumSummary, reunionLines, shiftMonth, splitDayPhotos, togetherLines,
} from "../app/app-ui/web-app-model.js";
import { createFixtureSource, loadMemoriesView, loadSettingsView, placeholderTile, withPlaceholders } from "../app/app-ui/web-app-loader.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => JSON.parse(readFileSync(join(root, "contracts/fixtures", `${name}.json`), "utf8"));
const FIXTURES = {
  getMe: fixture("getMe.200"), getMeUnpaired: fixture("getMe.200.unpaired"), getMe401: fixture("getMe.401"),
  getToday: fixture("getToday.200"), getTodayFree: fixture("getToday.200.free_no_photos"), getToday409: fixture("getToday.409"),
  getMemoriesMonth: fixture("getMemoriesMonth.200"), getMemoriesMonthFree: fixture("getMemoriesMonth.200.free"),
  getMemoryDay: fixture("getMemoryDay.200"), getMemoryDay403: fixture("getMemoryDay.403"),
};

// --- Minimal TSX loader: transpiles the real components (and their relative imports) to CommonJS. ---------
const nodeRequire = createRequire(import.meta.url);
const STUBS = {
  "next/link": { __esModule: true, default: ({ href, children, ...props }) => { delete props.scroll; return React.createElement("a", { href, ...props }, children); } },
  "next/navigation": { useRouter: () => ({ refresh() {}, push() {} }) },
};
const cache = new Map();
function load(file) {
  const path = [file, `${file}.tsx`, `${file}.ts`, `${file}.js`].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (cache.has(path)) return cache.get(path).exports;
  const mod = { exports: {} };
  cache.set(path, mod);
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = (id) => {
    if (STUBS[id]) return STUBS[id];
    if (id.startsWith(".")) return load(resolve(dirname(path), id));
    return nodeRequire(id);
  };
  new Function("require", "module", "exports", output)(localRequire, mod, mod.exports);
  return mod.exports;
}
const ui = (name) => load(join(root, "app/app-ui", name));
const html = (element) => renderToStaticMarkup(element);

// --- View model ---------------------------------------------------------------------------------------------
test("month grid is Monday-first and padded to whole weeks", () => {
  const weeks = monthGrid("2026-10");
  assert.equal(weeks.length, 5);
  assert.deepEqual(weeks[0], [null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(weeks[4].slice(0, 6), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.equal(monthGrid("2026-02").flat().filter(Boolean).length, 28);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(monthTitle("2026-10"), "October 2026");
  assert.equal(kanjiMonth("2026-10"), "十月");
});

test("7-day gate: Free opens today and the 6 days before, everything older is locked", () => {
  const today = "2026-10-19";
  assert.equal(freeWindowStart(today, 7), "2026-10-13");
  const photos = { day: "x", locked: false, photoCount: 2, me: null, partner: null };
  assert.equal(dayCellState({ day: "2026-10-13", summary: photos, today, historyLimitDays: 7 }), "photos");
  assert.equal(dayCellState({ day: "2026-10-12", summary: photos, today, historyLimitDays: 7 }), "locked");
  assert.equal(dayCellState({ day: "2026-10-12", summary: null, today, historyLimitDays: 7 }), "locked");
  assert.equal(dayCellState({ day: "2026-10-12", summary: photos, today, historyLimitDays: null }), "photos");
  assert.equal(dayCellState({ day: "2026-10-18", summary: { ...photos, locked: true }, today, historyLimitDays: null }), "locked");
  assert.equal(dayCellState({ day: "2026-10-16", summary: null, today, historyLimitDays: 7 }), "empty");
  assert.equal(dayCellState({ day: "2026-10-20", summary: null, today, historyLimitDays: null }), "future");
});

test("selected day: requested day in the month, else today, else the latest open day", () => {
  const days = FIXTURES.getMemoriesMonth.days;
  assert.equal(pickSelectedDay({ requested: "2026-10-03", month: "2026-10", days, today: "2026-10-19" }), "2026-10-03");
  assert.equal(pickSelectedDay({ requested: "2026-10-25", month: "2026-10", days, today: "2026-10-19" }), "2026-10-19");
  assert.equal(pickSelectedDay({ requested: "nope", month: "2026-10", days, today: "2026-11-02" }), "2026-10-19");
  assert.equal(pickSelectedDay({ requested: undefined, month: "2026-09", days: [], today: "2026-10-19" }), null);
});

test("top bar lines: partner status, countdown and days together", () => {
  const today = FIXTURES.getToday;
  assert.equal(partnerStatusLine(today.partner.status, "Asia/Tokyo"), "Busy until 10 PM");
  assert.equal(partnerStatusLine({ state: "busy", busyUntil: "2026-10-19T06:30:00Z" }, "Asia/Tokyo"), "Busy until 3:30 PM");
  assert.equal(partnerStatusLine({ state: "free", freeUntil: "2026-10-19T09:00:00Z" }, "Asia/Tokyo"), "Free until 6 PM");
  assert.equal(partnerStatusLine({ state: "unknown" }, "Asia/Tokyo"), null);
  assert.equal(partnerStatusLine(null, "Asia/Tokyo"), null);
  assert.deepEqual(reunionLines(today.reunion), { title: "26 days until Tokyo", detail: "Saturday, November 14" });
  assert.equal(reunionLines({ ...today.reunion, daysUntil: 0 }).title, "Together in Tokyo today");
  assert.equal(reunionLines({ ...today.reunion, city: null, daysUntil: 1 }).title, "1 day until you meet");
  assert.equal(reunionLines({ ...today.reunion, daysUntil: -3 }).title, "No meeting planned");
  assert.equal(reunionLines(null).title, "No meeting planned");
  assert.deepEqual(togetherLines(961, "2024-03-02"), { title: "961 days together", detail: "Since March 2, 2024" });
  assert.equal(dayNumber("2024-03-02", "2026-10-19"), 961);
  assert.equal(cityFromTimeZone("America/Sao_Paulo"), "São Paulo");
  assert.equal(cityFromTimeZone("Asia/Tokyo"), "Tokyo");
});

test("day photos: Japanese phrase with romaji and translation, custom phrase as text", () => {
  const { partner, me, extras } = splitDayPhotos(FIXTURES.getMemoryDay.photos);
  assert.equal(partner.id, "ph_kenji_1019");
  assert.equal(me.id, "ph_ana_1019");
  assert.deepEqual(extras.map((photo) => photo.id), ["ph_ana_1019b"]);
  assert.deepEqual(photoPhrase(partner), { ja: "会いたい", romaji: "aitai", translation: "I miss you" });
  assert.deepEqual(photoPhrase(me), { text: "Morning coffee for two" });
  assert.equal(photoPhrase(extras[0]), null);
});

test("premium status is read-only text (no prices, no checkout)", () => {
  assert.equal(premiumSummary(FIXTURES.getMe.entitlement).label, "Premium · trial");
  assert.match(premiumSummary(FIXTURES.getMe.entitlement).detail, /Trial ends October 26, 2026/);
  assert.equal(premiumSummary({ ...FIXTURES.getMe.entitlement, periodType: "normal" }).label, "Premium · active");
  assert.equal(premiumSummary(FIXTURES.getTodayFree.entitlement).label, "Free");
  for (const summary of [premiumSummary(FIXTURES.getMe.entitlement), premiumSummary(FIXTURES.getTodayFree.entitlement)]) {
    assert.doesNotMatch(summary.detail, /\$|R\$|checkout/i);
  }
});

// --- Loader (fixtures stand in for /api/v1) -----------------------------------------------------------------
function spySource(variant) {
  const source = createFixtureSource(FIXTURES, variant);
  const calls = [];
  return { calls, source: Object.fromEntries(Object.entries(source).map(([name, fn]) => [name, (...args) => { calls.push([name, ...args]); return fn(...args); }])) };
}

test("premium: ready view opens today with both photos", async () => {
  const view = await loadMemoriesView(createFixtureSource(FIXTURES, "premium"), {});
  assert.equal(view.kind, "ready");
  assert.equal(view.month, "2026-10");
  assert.equal(view.selectedDay, "2026-10-19");
  assert.equal(view.day.kind, "photos");
  assert.equal(view.nextMonth, null);
  assert.equal(view.previousMonth, "2026-09");
  const older = await loadMemoriesView(createFixtureSource(FIXTURES, "premium"), { month: "2026-09", day: "2026-09-12" });
  assert.equal(older.nextMonth, "2026-10");
  assert.ok(older.memories.days.length > 0);
});

test("free: a day older than 7 days shows the upgrade card without fetching it", async () => {
  const { source, calls } = spySource("free");
  const view = await loadMemoriesView(source, { month: "2026-10", day: "2026-10-03" });
  assert.equal(view.kind, "ready");
  assert.equal(view.memories.historyLimitDays, 7);
  assert.deepEqual(view.day, { kind: "locked", day: "2026-10-03" });
  assert.ok(!calls.some(([name]) => name === "getMemoryDay"));
  const inWindow = await loadMemoriesView(createFixtureSource(FIXTURES, "free"), { month: "2026-10", day: "2026-10-18" });
  assert.equal(inWindow.day.kind, "photos");
  const emptyDay = await loadMemoriesView(createFixtureSource(FIXTURES, "free"), { month: "2026-10", day: "2026-10-15" });
  assert.equal(emptyDay.day.kind, "empty");
});

test("a 403 premium_required from /memories/{day} also shows the upgrade card", async () => {
  const source = { ...createFixtureSource(FIXTURES, "premium"), getMemoryDay: () => Promise.reject({ status: 403, body: FIXTURES.getMemoryDay403 }) };
  const view = await loadMemoriesView(source, { day: "2026-10-18" });
  assert.equal(view.day.kind, "locked");
});

test("signed-out, unpaired and failing API states", async () => {
  assert.deepEqual(await loadMemoriesView(createFixtureSource(FIXTURES, "signed-out"), {}), { kind: "signed-out" });
  assert.deepEqual(await loadSettingsView(createFixtureSource(FIXTURES, "signed-out")), { kind: "signed-out" });
  const unpaired = await loadMemoriesView(createFixtureSource(FIXTURES, "unpaired"), {});
  assert.equal(unpaired.kind, "unpaired");
  assert.equal(unpaired.me.couple, null);
  const broken = { ...createFixtureSource(FIXTURES, "premium"), getMemoriesMonth: () => Promise.reject(new TypeError("fetch failed")) };
  assert.equal((await loadMemoriesView(broken, {})).kind, "unavailable");
  const future = await loadMemoriesView(createFixtureSource(FIXTURES, "premium"), { month: "2027-01" });
  assert.equal(future.month, "2026-10");
});

test("fixture photos are generated SVG tiles, never the fake bucket URLs", () => {
  const replaced = JSON.stringify(withPlaceholders(FIXTURES));
  assert.doesNotMatch(replaced, /storageapi\.dev/);
  assert.match(placeholderTile("ph_1"), /^data:image\/svg\+xml,/);
});

// --- Rendering -------------------------------------------------------------------------------------------------
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{200D}|\u{20E3}/u;

test("signed-out: Google, Apple (when configured) and the email magic link", () => {
  const { SignInCard } = ui("sign-in");
  const withApple = html(React.createElement(SignInCard, { appleConfigured: true }));
  assert.match(withApple, /href="\/api\/auth\/google\/start\?return_to=\/app"/);
  assert.match(withApple, /href="\/api\/auth\/apple\/start\?return_to=\/app"/);
  assert.match(withApple, /Email me a sign-in link/);
  assert.match(withApple, /type="email"/);
  assert.doesNotMatch(html(React.createElement(SignInCard, { appleConfigured: false })), /apple\/start/);
  assert.doesNotMatch(withApple, EMOJI);
});

test("email sign-in errors map the W1b responses", () => {
  const { emailErrorMessage } = ui("sign-in");
  const { HontoApiError } = load(join(root, "contracts/honto-client"));
  assert.equal(emailErrorMessage(new HontoApiError(429, { error: "x", code: "rate_limited", retryAfterSeconds: 30 }), "start"), "Too many tries. Try again in 30 seconds.");
  assert.equal(emailErrorMessage(new HontoApiError(401, { error: "x", code: "invalid_code" }), "verify"), "That code is not right or has expired.");
  assert.match(emailErrorMessage(new HontoApiError(503, { error: "x", code: "email_unavailable" }), "start"), /not available right now/);
  assert.match(emailErrorMessage(new SyntaxError("Unexpected token <"), "start"), /not available right now/);
});

async function renderMemories(variant, params) {
  const { TopBar, MemoriesCalendar, DayPanel } = ui("memories");
  const view = await loadMemoriesView(createFixtureSource(FIXTURES, variant), params);
  return { view, top: html(React.createElement(TopBar, { today: view.today })), calendar: html(React.createElement(MemoriesCalendar, { view })), day: html(React.createElement(DayPanel, { view })) };
}

test("premium render: top bar, calendar thumbnails (lazy and sized) and the open day", async () => {
  const { top, calendar, day } = await renderMemories("premium", {});
  assert.match(top, /Kenji · Tokyo/);
  assert.match(top, /Busy until 10 PM/);
  assert.match(top, /26 days until Tokyo/);
  assert.match(top, /961 days together/);
  assert.match(calendar, /October 2026/);
  assert.match(calendar, /十月/);
  assert.doesNotMatch(calendar, /Free shows the last 7 days/);
  const thumbs = calendar.match(/<img [^>]*>/g) ?? [];
  assert.equal(thumbs.length, 5, "3 days: partner + my inset, partner only, partner + my inset");
  for (const img of thumbs) {
    assert.match(img, /loading="lazy"/);
    assert.match(img, /width="256"/);
    assert.match(img, /height="256"/);
  }
  assert.match(calendar, /aria-current="date"/);
  assert.match(day, /Monday, October 19/);
  assert.match(day, /Day 961/);
  assert.match(day, /会いたい/);
  assert.match(day, /aitai/);
  assert.match(day, /I miss you/);
  assert.match(day, /Morning coffee for two/);
  assert.match(day, /1 more from this day/);
  for (const img of day.match(/<img [^>]*>/g)) {
    assert.match(img, /loading="lazy"/);
    assert.match(img, /width="\d+"/);
    assert.match(img, /height="\d+"/);
  }
  for (const part of [top, calendar, day]) assert.doesNotMatch(part, EMOJI);
});

test("free render: locked cells, gate note and the upgrade card pointing to the app", async () => {
  const { calendar, day } = await renderMemories("free", { day: "2026-10-03" });
  assert.match(calendar, /Free shows the last 7 days/);
  assert.equal((calendar.match(/is-locked/g) ?? []).length, 12, "Oct 1 to Oct 12 are outside the 7-day window");
  assert.match(calendar, /aria-label="October 3, Premium"/);
  assert.match(day, /Older memories are part of Premium/);
  assert.match(day, /Honto app/);
  assert.doesNotMatch(day, /<img/);
  assert.doesNotMatch(day, /checkout|pricing|\$/i);
});

test("settings render: account, read-only Premium status, couple and sign out", async () => {
  const { SettingsView } = ui("settings");
  const premium = html(React.createElement(SettingsView, { me: FIXTURES.getMe }));
  assert.match(premium, /ana@example\.com/);
  assert.match(premium, /Premium · trial/);
  assert.match(premium, /Kenji/);
  assert.match(premium, /Sign out/);
  const free = html(React.createElement(SettingsView, { me: { ...FIXTURES.getMe, entitlement: FIXTURES.getTodayFree.entitlement } }));
  assert.match(free, />Free</);
  const unpaired = html(React.createElement(SettingsView, { me: FIXTURES.getMeUnpaired }));
  assert.match(unpaired, /Not paired yet/);
  assert.doesNotMatch(premium + free, /\$|R\$|<form/);
});

// --- Product rules on the new files ------------------------------------------------------------------------------
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const NEW_FILES = [
  ...walk(join(root, "app/app-ui")), ...walk(join(root, "app/(couple)")), ...walk(join(root, "public/icons")),
  ...walk(join(root, "tests")).filter((path) => /web-app.*\.test\.mjs$/.test(path)),
];

test("no emoji and no Fraunces in the new web app files", () => {
  assert.ok(NEW_FILES.length > 10);
  for (const file of NEW_FILES) {
    const source = readFileSync(file, "utf8");
    if (file.endsWith("web-app.test.mjs")) continue; // holds the emoji regex itself
    assert.doesNotMatch(source, EMOJI, relative(root, file));
    assert.doesNotMatch(source, /fraunces/i, relative(root, file));
  }
  assert.doesNotMatch(readFileSync(join(root, "app/app-ui/web-app.css"), "utf8"), /@import|fonts\.googleapis/);
});

test("tokens.css defines exactly the agreed variable names, light and dark, with reduced transparency and motion", () => {
  const css = readFileSync(join(root, "app/app-ui/tokens.css"), "utf8");
  const expected = [
    ...["bg", "surface", "surface-opaque", "text", "text-muted", "accent", "accent-contrast", "border", "danger", "partner", "me", "free", "busy"].map((name) => `--honto-color-${name}`),
    ...["blur", "tint", "opacity", "stroke"].map((name) => `--honto-glass-${name}`),
    ...["sm", "md", "lg", "pill"].map((name) => `--honto-radius-${name}`),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((step) => `--honto-space-${step}`),
    "--honto-font-family",
    ...["xs", "sm", "md", "lg", "xl", "2xl"].map((size) => `--honto-font-size-${size}`),
    ...["fast", "base", "slow", "curve"].map((name) => `--honto-motion-${name}`),
  ];
  const defined = new Set([...css.matchAll(/(--honto-[\w-]+)\s*:/g)].map((match) => match[1]));
  assert.deepEqual([...defined].sort(), [...expected].sort());
  // Values from design/produto/README.md: paper, card, ink, ink-2, shu (light and dark).
  for (const value of ["#F7F2E9", "#FFFCF7", "#17243D", "#55607A", "#D2483A", "#0F141E", "#1A2130", "#F1ECE3", "#B5BAC5", "#E5604E"]) assert.ok(css.includes(value), value);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /fraunces/i);
});

test("glass (backdrop-filter) is only used over the banner photo", () => {
  const css = readFileSync(join(root, "app/app-ui/web-app.css"), "utf8");
  const rules = css.split("}").filter((rule) => rule.includes("backdrop-filter"));
  assert.ok(rules.length > 0);
  for (const rule of rules) assert.match(rule, /\.ha-banner\.has-photo \.ha-chip/);
});

test("no placeholder photo from the design reference is committed under public/", () => {
  const files = walk(join(root, "public")).map((path) => relative(join(root, "public"), path));
  const designPhotos = ["alcantara", "alfama", "azulejo", "beach", "belem", "ibira", "leaf", "miradouro", "nata", "piccolo", "spdusk", "tram"];
  for (const file of files) {
    assert.ok(!designPhotos.some((name) => file.toLowerCase().includes(name)), file);
    assert.ok(!/\.(jpe?g|webp|avif|heic)$/i.test(file), file);
    if (extname(file) === ".png") assert.equal(file, "og.png");
  }
});

test("the magic link lands on W1b's /auth/email page, which sends the visitor to /app", () => {
  assert.ok(!existsSync(join(root, "app/(couple)/auth")), "only one page may resolve to /auth/email");
  assert.ok(!existsSync(join(root, "app/app-ui/email-link-verify.tsx")));
  const landing = readFileSync(join(root, "app/auth/email/email-sign-in.tsx"), "utf8");
  assert.match(landing, /\/api\/v1\/auth\/email\/verify/);
  assert.match(landing, /window\.location\.replace\("\/app"\)/);
  assert.match(landing, /href="\/app">Back to sign in/);
});

test("dev fixtures are never served on the production deployment", () => {
  const data = readFileSync(join(root, "app/app-ui/web-app-data.ts"), "utf8");
  assert.match(data, /process\.env\.HONTO_WEB_APP_FIXTURES === "1" && process\.env\.VERCEL_ENV !== "production"/);
  assert.match(data, /honto_session/);
});

test("match history: trophy is an inline SVG icon, the text stays", () => {
  const source = readFileSync(join(root, "app/account/history/page.tsx"), "utf8");
  assert.doesNotMatch(source, /🏆/u);
  assert.match(source, /<Icon name="trophy"\/> You won<\/>/);
  assert.match(readFileSync(join(root, "app/icons.tsx"), "utf8"), /aria-hidden="true"/);
});
