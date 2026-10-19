// Coarse weather per person (MVP feedback r1): the device reads a coarse location, asks a free weather
// source on the device and reports only this summary. No coordinates and no place names are stored.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { WeatherCondition, WeatherSummary } from "../../contracts/honto-api";
import { database } from "../../app/server-auth";
import { apiError, noStore, requireUser } from "./context";
import { ensureLifecycleSchema } from "./lifecycle";

type Sql = NeonQueryFunction<false, false>;

export const WEATHER_CONDITIONS: WeatherCondition[] = ["clear", "partly_cloudy", "cloudy", "fog", "drizzle", "rain", "snow", "thunderstorm"];
/** A summary older than this is not shown in `/today` (the person has not opened the app since). */
export const WEATHER_MAX_AGE_MS = 12 * 3_600_000;
/** `observedAt` may be at most this far in the past when reported... */
const MAX_REPORT_AGE_MS = 6 * 3_600_000;
/** ...and at most this far in the future (device clock skew). */
const MAX_SKEW_MS = 10 * 60_000;
const ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

let ready: Promise<void> | null = null;

/** Idempotent schema (mirrors drizzle/0014_weather_nudges.sql). One row per user, replaced on every report. */
export function ensureWeatherSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureLifecycleSchema(sql);
    await sql`CREATE TABLE IF NOT EXISTS user_weather (user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, condition text NOT NULL CHECK (condition IN ('clear', 'partly_cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunderstorm')), temperature_c integer NOT NULL, is_day boolean NOT NULL, observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

/** Validates a `WeatherSummary` body at `now`. */
export function parseWeather(body: unknown, now: number): WeatherSummary | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send a JSON object." };
  const input = body as Record<string, unknown>;
  if (typeof input.condition !== "string" || !WEATHER_CONDITIONS.includes(input.condition as WeatherCondition)) return { error: `condition must be one of ${WEATHER_CONDITIONS.join(", ")}.` };
  if (typeof input.temperatureC !== "number" || !Number.isInteger(input.temperatureC) || input.temperatureC < -90 || input.temperatureC > 60) return { error: "temperatureC must be an integer between -90 and 60." };
  if (typeof input.isDay !== "boolean") return { error: "isDay must be a boolean." };
  const observed = typeof input.observedAt === "string" && RFC3339.test(input.observedAt) ? Date.parse(input.observedAt) : NaN;
  if (!Number.isFinite(observed)) return { error: "observedAt must be an RFC 3339 timestamp." };
  if (observed < now - MAX_REPORT_AGE_MS || observed > now + MAX_SKEW_MS) return { error: "observedAt must be within the last 6 hours." };
  return { condition: input.condition as WeatherCondition, temperatureC: input.temperatureC, isDay: input.isDay, observedAt: toIso(Math.min(Math.floor(observed / 1000) * 1000, now)) };
}

/** Fresh summaries (younger than 12 h at `now`) for the given users, keyed by user id. */
export async function weatherFor(sql: Sql, userIds: string[], now: Date): Promise<Map<string, WeatherSummary>> {
  await ensureWeatherSchema(sql);
  const since = new Date(now.getTime() - WEATHER_MAX_AGE_MS).toISOString();
  const rows = await sql`SELECT user_id AS "userId", condition, temperature_c AS "temperatureC", is_day AS "isDay", to_char(observed_at AT TIME ZONE 'UTC', ${ISO}) AS "observedAt"
    FROM user_weather WHERE user_id = ANY(${userIds}) AND observed_at > ${since}::timestamptz`;
  return new Map(rows.map((row) => [String(row.userId), { condition: row.condition as WeatherCondition, temperatureC: Number(row.temperatureC), isDay: Boolean(row.isDay), observedAt: String(row.observedAt) }]));
}

/** PUT /api/v1/me/weather. */
export async function reportWeatherResponse(request: Request, now = Date.now()) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const weather = parseWeather(await request.json().catch(() => null), now);
  if ("error" in weather) return apiError(400, "bad_request", weather.error);
  const sql = database()!;
  await ensureWeatherSchema(sql);
  await sql`INSERT INTO user_weather (user_id, condition, temperature_c, is_day, observed_at) VALUES (${auth.user.id}, ${weather.condition}, ${weather.temperatureC}, ${weather.isDay}, ${weather.observedAt}::timestamptz)
    ON CONFLICT (user_id) DO UPDATE SET condition = EXCLUDED.condition, temperature_c = EXCLUDED.temperature_c, is_day = EXCLUDED.is_day, observed_at = EXCLUDED.observed_at, updated_at = now()`;
  return Response.json(weather, { headers: noStore });
}

/** DELETE /api/v1/me/weather (location turned off). */
export async function clearWeatherResponse(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sql = database()!;
  await ensureWeatherSchema(sql);
  await sql`DELETE FROM user_weather WHERE user_id = ${auth.user.id}`;
  return new Response(null, { status: 204, headers: noStore });
}
