import type { ProfileCity } from '../../contracts/honto-api';
import { database } from '../../app/server-auth';
import { apiError, noStore, normalizeTimeZone, requireUser } from './context';
import { ensureLaunchSchema, type LaunchSql } from './launch-schema';

export function normalizeCity(input: unknown): ProfileCity | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > 100 || /[\p{Cc}\p{Cf}]/u.test(v.name)) return null;
  if (v.country != null && (typeof v.country !== 'string' || v.country.length > 100)) return null;
  if (typeof v.latitude !== 'number' || !Number.isFinite(v.latitude) || Math.abs(v.latitude) > 90 || typeof v.longitude !== 'number' || !Number.isFinite(v.longitude) || Math.abs(v.longitude) > 180) return null;
  const timeZone = v.timeZone == null ? null : normalizeTimeZone(v.timeZone);
  if (v.timeZone != null && !timeZone) return null;
  return { name: v.name.trim(), country: typeof v.country === 'string' ? v.country.trim() || null : null, latitude: v.latitude, longitude: v.longitude, timeZone };
}
/** City centroids selected by the user; never location samples from a device. */
export function cityDistanceKm(a: Pick<ProfileCity,'latitude'|'longitude'>, b: Pick<ProfileCity,'latitude'|'longitude'>) {
  const rad = (v: number) => v * Math.PI / 180;
  const dLat = rad(b.latitude-a.latitude), dLon = rad(b.longitude-a.longitude);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
  return Math.round(6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1,Math.max(0,h)))));
}
export async function citiesFor(sql: LaunchSql, ids: string[]) {
  await ensureLaunchSchema(sql);
  const rows = await sql`SELECT user_id AS "userId", name, country, latitude, longitude, time_zone AS "timeZone" FROM user_cities WHERE user_id = ANY(${ids}::text[])`;
  return new Map(rows.map(row => [String(row.userId), { name: String(row.name), country: row.country == null ? null : String(row.country), latitude: Number(row.latitude), longitude: Number(row.longitude), timeZone: row.timeZone == null ? null : String(row.timeZone) } satisfies ProfileCity]));
}
export async function updateCityResponse(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  const sql = database()!; await ensureLaunchSchema(sql);
  if (request.method === 'DELETE') {
    await sql`DELETE FROM user_cities WHERE user_id = ${auth.user.id}`;
    return new Response(null,{status:204,headers:noStore});
  }
  const city = normalizeCity(await request.json().catch(()=>null));
  if (!city) return apiError(400,'bad_request','Choose a valid city from search.');
  await sql`INSERT INTO user_cities (user_id,name,country,latitude,longitude,time_zone) VALUES (${auth.user.id},${city.name},${city.country},${city.latitude},${city.longitude},${city.timeZone}) ON CONFLICT (user_id) DO UPDATE SET name=excluded.name,country=excluded.country,latitude=excluded.latitude,longitude=excluded.longitude,time_zone=excluded.time_zone,updated_at=now()`;
  return Response.json(city,{headers:noStore});
}
