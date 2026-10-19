// Compile-time check that representative fixtures are assignable to the generated TS types
// (runtime validation of every fixture lives in tests/contracts.test.mjs).
import type { CalendarView, Couple, Me, MemoriesMonth, PhotoCreateResponse, Today, Trip, WidgetSnapshot } from "../honto-api";
import { createHontoClient, HontoApiError } from "../honto-client";
import getMe from "../fixtures/getMe.200.json";
import getMeUnpaired from "../fixtures/getMe.200.unpaired.json";
import getCouple from "../fixtures/getCouple.200.json";
import getToday from "../fixtures/getToday.200.json";
import getTodayTrip from "../fixtures/getToday.200.trip_day.json";
import createPhoto from "../fixtures/createPhoto.201.json";
import memories from "../fixtures/getMemoriesMonth.200.free.json";
import calendar from "../fixtures/getCalendar.200.json";
import trip from "../fixtures/createTrip.201.json";
import snapshot from "../fixtures/schema.WidgetSnapshot.json";

// JSON imports widen string unions to string, so check structurally via `satisfies` on a re-typed copy.
type Widen<T> = T extends string ? string : T extends (infer U)[] ? Widen<U>[] : T extends object ? { [K in keyof T]: Widen<T[K]> } : T;
export const checks: Array<Widen<unknown>> = [
  getMe satisfies Widen<Me>, getMeUnpaired satisfies Widen<Me>, getCouple satisfies Widen<Couple>,
  getToday satisfies Widen<Today>, getTodayTrip satisfies Widen<Today>, createPhoto satisfies Widen<PhotoCreateResponse>,
  memories satisfies Widen<MemoriesMonth>, calendar satisfies Widen<CalendarView>, trip satisfies Widen<Trip>,
  snapshot satisfies Widen<WidgetSnapshot>,
];

// Client call sites type-check (path params, query, body, response type).
export async function clientUsage() {
  const api = createHontoClient({ baseUrl: "http://localhost:4010", token: "hm_u_x" });
  const today: Today = await api("getToday");
  const day = await api("getMemoryDay", { pathParams: { day: today.me.localDay } });
  const month = await api("getMemoriesMonth", { query: { month: "2026-10" } });
  const couple = await api("joinCouple", { body: { code: "K7Q2XM" } });
  await api("deletePhoto", { pathParams: { photoId: day.photos[0]!.id } });
  // @ts-expect-error body is required for joinCouple
  await api("joinCouple", {});
  try { await api("sendNudge", { body: { source: "app" } }); } catch (e) { if (e instanceof HontoApiError && e.code === "rate_limited") return null; }
  return { month, couple };
}
