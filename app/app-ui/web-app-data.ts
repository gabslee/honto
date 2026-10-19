// Server-only data source for hontogame.com/app. Calls `/api/v1` with the visitor's `honto_session` cookie, or
// serves contracts/fixtures when HONTO_WEB_APP_FIXTURES=1 outside production (until W1b/W2a are on main).
import { cookies, headers } from "next/headers";
import { createHontoClient } from "../../contracts/honto-client";
import type { Me, MemoriesMonth, MemoryDay, Today } from "../../contracts/honto-api";
import { createFixtureSource, FIXTURE_VARIANTS } from "./web-app-loader.js";
import getMe from "../../contracts/fixtures/getMe.200.json";
import getMeUnpaired from "../../contracts/fixtures/getMe.200.unpaired.json";
import getMe401 from "../../contracts/fixtures/getMe.401.json";
import getToday from "../../contracts/fixtures/getToday.200.json";
import getTodayFree from "../../contracts/fixtures/getToday.200.free_no_photos.json";
import getToday409 from "../../contracts/fixtures/getToday.409.json";
import getMemoriesMonth from "../../contracts/fixtures/getMemoriesMonth.200.json";
import getMemoriesMonthFree from "../../contracts/fixtures/getMemoriesMonth.200.free.json";
import getMemoryDay from "../../contracts/fixtures/getMemoryDay.200.json";
import getMemoryDay403 from "../../contracts/fixtures/getMemoryDay.403.json";

export type HontoSource = {
  getMe(): Promise<Me>;
  getToday(): Promise<Today>;
  getMemoriesMonth(month: string): Promise<MemoriesMonth>;
  getMemoryDay(day: string): Promise<MemoryDay>;
};

const SESSION_COOKIE = "honto_session";
const FIXTURES = { getMe, getMeUnpaired, getMe401, getToday, getTodayFree, getToday409, getMemoriesMonth, getMemoriesMonthFree, getMemoryDay, getMemoryDay403 };

/** Dev/preview only: never honored on the production deployment. */
export function fixturesEnabled() {
  return process.env.HONTO_WEB_APP_FIXTURES === "1" && process.env.VERCEL_ENV !== "production";
}

export function fixtureVariant(value: unknown) {
  return typeof value === "string" && FIXTURE_VARIANTS.includes(value) ? value : "premium";
}

const signedOut: HontoSource = {
  getMe: () => Promise.reject({ status: 401 }),
  getToday: () => Promise.reject({ status: 401 }),
  getMemoriesMonth: () => Promise.reject({ status: 401 }),
  getMemoryDay: () => Promise.reject({ status: 401 }),
};

async function apiOrigin() {
  if (process.env.HONTO_API_BASE_URL) return process.env.HONTO_API_BASE_URL.replace(/\/$/, "");
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function hontoSource(variant?: unknown): Promise<HontoSource> {
  if (fixturesEnabled()) return createFixtureSource(FIXTURES, fixtureVariant(variant)) as HontoSource;
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return signedOut;
  const baseUrl = await apiOrigin();
  // Preview deployments behind Vercel protection need the automation bypass for server-to-server calls.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const call = createHontoClient({
    baseUrl,
    fetch: (input, init) => fetch(input, {
      ...init,
      credentials: undefined,
      cache: "no-store",
      headers: { ...(init?.headers as Record<string, string>), cookie: `${SESSION_COOKIE}=${session}`, ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) },
    }),
  });
  return {
    getMe: () => call("getMe"),
    getToday: () => call("getToday"),
    getMemoriesMonth: (month) => call("getMemoriesMonth", { query: { month } }),
    getMemoryDay: (day) => call("getMemoryDay", { pathParams: { day } }),
  };
}

export const appleSignInConfigured = () => Boolean(process.env.APPLE_CLIENT_ID);
