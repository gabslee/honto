import { citiesFor, cityDistanceKm } from './city';
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Avatar, Couple, Entitlement, EntitlementSource, Features, Invite, Me, NudgeState, PartnerInfo, PartnerStatus, PeriodType, Photo, Reunion, Today, Trip } from "../../contracts/honto-api";
import { database } from "../../app/server-auth";
import { apiError, isCouplePremium, noStore, normalizeTimeZone, requireCouple, requireUser, toApiUser, type V1Couple, type V1Partner, type V1User } from "./context";
import { ensureLifecycleSchema, getObjectStore, hitRateLimit, latestUnpair, optionalTables, randomId, repairHalfCouples, type ObjectStore, type OptionalTables } from "./lifecycle";
import { todayMilestones } from "./milestones";
import { avatarsFor } from "./profile";
import { weatherFor } from "./weather";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;
type Paired = { user: V1User; couple: V1Couple; partner: V1Partner };

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
export const INVITE_TTL_HOURS = 48;
/** Crockford base32 without 0/O/1/I/L/U, so codes read aloud or typed by hand cannot be confused. */
export const INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_BASE_URL = "https://hontogame.com/j/";
const PHOTO_URL_SECONDS = 24 * 60 * 60;

// ---------------------------------------------------------------------------------------------------
// Days and zones. A local day is never converted between zones: each person's day is computed in their
// own zone (null zone = UTC for me, unknown for the partner).
// ---------------------------------------------------------------------------------------------------

/** `YYYY-MM-DD` of `at` in `timeZone`. */
export function localDay(timeZone: string | null, at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** UTC offset of `timeZone` at `at`, in minutes (Tokyo 540, São Paulo -180). */
export function utcOffsetMinutes(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function validLocalDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toIso(date: Date) { return date.toISOString().replace(/\.\d{3}Z$/, "Z"); }
function isoOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : toIso(date);
}

// ---------------------------------------------------------------------------------------------------
// Entitlement (per couple: either active member)
// ---------------------------------------------------------------------------------------------------
const FREE_FEATURES: Features = { fullHistory: false, calendar: false, eventTitles: false, liveActivity: false, countdownWidget: false, nudge: true };
const PREMIUM_FEATURES: Features = { fullHistory: true, calendar: true, eventTitles: true, liveActivity: true, countdownWidget: true, nudge: true };
type Grant = { userId: string; source: EntitlementSource; productId: string | null; periodType: PeriodType | null; expiresAt: string | null; willRenew: boolean | null; rank: number };

/**
 * Resolves the contract `Entitlement` for me (+ my partner). Same rules as W1a's `isCouplePremium`:
 * an active `entitlements` row (W3's table, read when present), or the legacy web game access (admin,
 * active Stripe premium, running Stripe trial). My own grant wins over my partner's; RevenueCat over Stripe
 * over admin. `trialEligible` is false once either member had a trial.
 */
export async function resolveEntitlement(sql: Sql, userId: string, partnerId: string | null, tables?: OptionalTables, now = new Date()): Promise<Entitlement> {
  const ids = [userId, partnerId ?? userId];
  const grants: Grant[] = [];
  let hadTrial = false;
  const users = await sql`SELECT id, role, (plan = 'premium' AND subscription_status = 'active' AND (subscription_expires_at IS NULL OR subscription_expires_at > ${now.toISOString()}::timestamptz)) AS "stripeActive", to_char(subscription_expires_at AT TIME ZONE 'UTC', ${ISO}) AS "subscriptionExpiresAt", (trial_ends_at > ${now.toISOString()}::timestamptz) AS "trialActive", to_char(trial_ends_at AT TIME ZONE 'UTC', ${ISO}) AS "trialEndsAt", (trial_started_at IS NOT NULL OR trial_ends_at IS NOT NULL) AS "hadTrial" FROM users WHERE id IN (${ids[0]}, ${ids[1]})`;
  for (const user of users) {
    const id = String(user.id);
    if (user.hadTrial) hadTrial = true;
    if (user.stripeActive) grants.push({ userId: id, source: "stripe", productId: null, periodType: "normal", expiresAt: (user.subscriptionExpiresAt as string | null) ?? null, willRenew: null, rank: 1 });
    else if (user.trialActive) grants.push({ userId: id, source: "stripe", productId: null, periodType: "trial", expiresAt: (user.trialEndsAt as string | null) ?? null, willRenew: null, rank: 2 });
    if (user.role === "admin") grants.push({ userId: id, source: "admin", productId: null, periodType: null, expiresAt: null, willRenew: null, rank: 3 });
  }
  if ((tables ?? await optionalTables(sql)).entitlements) {
    try {
      const rows = await sql`SELECT user_id AS "userId", source, product_id AS "productId", period_type AS "periodType", to_char(expires_at AT TIME ZONE 'UTC', ${ISO}) AS "expiresAt", will_renew AS "willRenew", had_trial AS "hadTrial", (expires_at IS NULL OR expires_at > ${now.toISOString()}::timestamptz) AS active FROM entitlements WHERE entitlement = 'premium' AND user_id IN (${ids[0]}, ${ids[1]})`;
      for (const row of rows) {
        if (row.hadTrial || row.periodType === "trial") hadTrial = true;
        if (!row.active) continue;
        const source = (["revenuecat", "stripe", "admin"].includes(String(row.source)) ? row.source : "revenuecat") as EntitlementSource;
        const periodType = (["trial", "intro", "normal"].includes(String(row.periodType)) ? row.periodType : null) as PeriodType | null;
        grants.push({ userId: String(row.userId), source, productId: (row.productId as string | null) ?? null, periodType, expiresAt: (row.expiresAt as string | null) ?? null, willRenew: typeof row.willRenew === "boolean" ? row.willRenew : null, rank: source === "revenuecat" ? 0 : source === "stripe" ? 1 : 3 });
      }
    } catch (cause) {
      // W3 owns this table; a shape we do not expect must not take /me or /today down.
      console.error("[v1/entitlement] entitlements read failed", cause);
    }
  }
  grants.sort((a, b) => Number(a.userId !== userId) - Number(b.userId !== userId) || a.rank - b.rank);
  const grant = grants[0];
  if (!grant) return { premium: false, source: null, productId: null, periodType: null, expiresAt: null, willRenew: null, grantedBy: null, trialEligible: !hadTrial, features: FREE_FEATURES };
  return { premium: true, source: grant.source, productId: grant.productId, periodType: grant.periodType, expiresAt: grant.expiresAt, willRenew: grant.willRenew, grantedBy: grant.userId === userId ? "me" : "partner", trialEligible: !hadTrial, features: PREMIUM_FEATURES };
}

// ---------------------------------------------------------------------------------------------------
// Couple view
// ---------------------------------------------------------------------------------------------------
export function partnerInfo(partner: V1Partner, now: Date, avatar: Avatar | null = null): PartnerInfo {
  return { userId: partner.id, displayName: partner.displayName, timeZone: partner.timeZone, utcOffsetMinutes: partner.timeZone ? utcOffsetMinutes(partner.timeZone, now) : null, timeZoneUpdatedAt: partner.timeZoneUpdatedAt, avatar };
}

function reunionView(couple: V1Couple, viewerZone: string | null, now: Date): Reunion | null {
  if (!couple.reunionAt) return null;
  return { at: couple.reunionAt, city: couple.reunionCity, timeZone: couple.reunionTimeZone, daysUntil: daysBetween(localDay(viewerZone, now), localDay(viewerZone, new Date(couple.reunionAt))) };
}

function daysTogether(couple: V1Couple, viewerZone: string | null, now: Date) {
  return couple.startedOn ? Math.max(0, daysBetween(couple.startedOn, localDay(viewerZone, now))) : null;
}

/** `avatars` (from avatarsFor) supplies the partner's profile photo; without it the partner avatar is null. */
export function coupleView({ user, couple, partner }: Paired, premium: boolean, now: Date, avatars?: Map<string, Avatar>): Couple {
  return { id: couple.id, pairedAt: couple.pairedAt, startedOn: couple.startedOn, daysTogether: daysTogether(couple, user.timeZone, now), partner: partnerInfo(partner, now, avatars?.get(partner.id) ?? null), reunion: reunionView(couple, user.timeZone, now), premium };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...noStore, ...headers } });
const rateLimited = (seconds: number, error: string) => Response.json({ error, code: "rate_limited", retryAfterSeconds: seconds }, { status: 429, headers: { ...noStore, "Retry-After": String(seconds) } });

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

/** GET /api/v1/couple */
export async function getCoupleResponse(request: Request, now = new Date()) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const sql = database()!;
  return json(coupleView(auth, await isCouplePremium(sql, auth.couple.id), now, await avatarsFor(sql, [auth.partner.id], now)));
}

/**
 * PATCH /api/v1/couple `{ startedOn?, reunion? }`: omitted keys are kept, `null` clears. `startedOn` cannot be
 * after today in my zone (one day of slack for zones ahead of mine). Reunions may be in the past (`daysUntil` < 0).
 */
export async function patchCoupleResponse(request: Request, now = new Date()) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const body = await readJson(request);
  if (!body) return apiError(400, "bad_request", "Send a JSON object.");
  const setStarted = "startedOn" in body;
  const setReunion = "reunion" in body;
  if (!setStarted && !setReunion) return apiError(400, "bad_request", "Send startedOn and/or reunion.");
  let startedOn: string | null = null;
  if (setStarted && body.startedOn !== null) {
    const tomorrow = toIso(new Date(Date.parse(`${localDay(auth.user.timeZone, now)}T00:00:00Z`) + 86_400_000)).slice(0, 10);
    if (!validLocalDay(body.startedOn) || body.startedOn < "1900-01-01" || body.startedOn > tomorrow) return apiError(400, "bad_request", "startedOn must be a past date (YYYY-MM-DD).");
    startedOn = body.startedOn;
  }
  let reunion: { at: string; city: string | null; timeZone: string | null } | null = null;
  if (setReunion && body.reunion !== null) {
    const input = body.reunion as Record<string, unknown> | undefined;
    if (!input || typeof input !== "object" || Array.isArray(input)) return apiError(400, "bad_request", "reunion must be an object or null.");
    const at = typeof input.at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(input.at) ? new Date(input.at) : null;
    if (!at || Number.isNaN(at.getTime())) return apiError(400, "bad_request", "reunion.at must be an RFC 3339 date-time.");
    const city = input.city === undefined || input.city === null ? null : typeof input.city === "string" ? input.city.trim() || null : undefined;
    if (city === undefined || (city && city.length > 80)) return apiError(400, "bad_request", "reunion.city must be at most 80 characters.");
    const timeZone = input.timeZone === undefined || input.timeZone === null ? null : normalizeTimeZone(input.timeZone);
    if (input.timeZone !== undefined && input.timeZone !== null && !timeZone) return apiError(400, "bad_request", "reunion.timeZone must be an IANA time zone id.");
    reunion = { at: toIso(at), city, timeZone };
  }
  const sql = database()!;
  const rows = await sql`UPDATE couples SET
      started_on = CASE WHEN ${setStarted}::boolean THEN ${startedOn}::date ELSE started_on END,
      reunion_at = CASE WHEN ${setReunion}::boolean THEN ${reunion?.at ?? null}::timestamptz ELSE reunion_at END,
      reunion_city = CASE WHEN ${setReunion}::boolean THEN ${reunion?.city ?? null}::text ELSE reunion_city END,
      reunion_time_zone = CASE WHEN ${setReunion}::boolean THEN ${reunion?.timeZone ?? null}::text ELSE reunion_time_zone END,
      updated_at = now()
    WHERE id = ${auth.couple.id} AND unpaired_at IS NULL
    RETURNING to_char(started_on, 'YYYY-MM-DD') AS "startedOn", to_char(reunion_at AT TIME ZONE 'UTC', ${ISO}) AS "reunionAt", reunion_city AS "reunionCity", reunion_time_zone AS "reunionTimeZone"`;
  if (!rows[0]) return apiError(409, "not_paired", "Pair with your partner first.");
  // TODO(W2a push): send reunion.changed (widget push) to the partner when the reunion changed.
  const couple = { ...auth.couple, ...(rows[0] as Pick<V1Couple, "startedOn" | "reunionAt" | "reunionCity" | "reunionTimeZone">) };
  return json(coupleView({ ...auth, couple }, await isCouplePremium(sql, couple.id), now, await avatarsFor(sql, [auth.partner.id], now)));
}

// ---------------------------------------------------------------------------------------------------
// Invites and join
// ---------------------------------------------------------------------------------------------------

/** 6 chars from INVITE_ALPHABET, uniform (rejection sampling). */
export function newInviteCode() {
  let code = "";
  while (code.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 240 && code.length < 6) code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
    }
  }
  return code;
}

/** `k7q-2xm` -> `K7Q2XM` (case-insensitive; spaces and dashes ignored). */
export function normalizeInviteCode(value: unknown) {
  return typeof value === "string" ? value.toUpperCase().replace(/[\s-]+/g, "") : "";
}

const inviteBody = (row: Row): Invite => ({ code: String(row.code), url: INVITE_BASE_URL + String(row.code), expiresAt: String(row.expiresAt) });

/**
 * Paired by the same rule as requireCouple (active membership, couple not unpaired, an active partner). A
 * half-ended couple of this user (partner deleted outside deleteAccount) is unpaired first, so the user is
 * neither stuck on 409 already_paired nor blocked by the one-active-couple index when pairing again.
 */
async function activeMembership(sql: Sql, userId: string) {
  await repairHalfCouples(sql, userId);
  const rows = await sql`SELECT 1 FROM couple_members m JOIN couples c ON c.id = m.couple_id AND c.unpaired_at IS NULL JOIN couple_members pm ON pm.couple_id = m.couple_id AND pm.user_id <> m.user_id AND pm.left_at IS NULL WHERE m.user_id = ${userId} AND m.left_at IS NULL LIMIT 1`;
  return rows.length > 0;
}

async function openInvite(sql: Sql, userId: string) {
  const rows = await sql`SELECT code, to_char(expires_at AT TIME ZONE 'UTC', ${ISO}) AS "expiresAt" FROM couple_invites WHERE created_by = ${userId} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

/** GET /api/v1/couple/invite: my open code (404 none, 409 already paired). */
export async function getInviteResponse(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sql = database()!;
  await ensureLifecycleSchema(sql);
  if (await activeMembership(sql, auth.user.id)) return apiError(409, "already_paired", "You are already paired.");
  const invite = await openInvite(sql, auth.user.id);
  return invite ? json(inviteBody(invite)) : apiError(404, "not_found", "No open invite.");
}

/** POST /api/v1/couple/invite: new 48h code, revoking my previous open one (one open code per user). */
export async function createInviteResponse(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sql = database()!;
  await ensureLifecycleSchema(sql);
  if (await activeMembership(sql, auth.user.id)) return apiError(409, "already_paired", "You are already paired.");
  const wait = await hitRateLimit(sql, "invite", auth.user.id, 20, 60 * 60);
  if (wait) return rateLimited(wait, "Too many codes. Try again later.");
  for (let attempt = 0; attempt < 5; attempt++) {
    await sql`UPDATE couple_invites SET revoked_at = now() WHERE created_by = ${auth.user.id} AND used_at IS NULL AND revoked_at IS NULL`;
    try {
      const rows = await sql`INSERT INTO couple_invites (code, created_by, expires_at) VALUES (${newInviteCode()}, ${auth.user.id}, now() + make_interval(hours => ${INVITE_TTL_HOURS}::int)) ON CONFLICT (code) DO NOTHING RETURNING code, to_char(expires_at AT TIME ZONE 'UTC', ${ISO}) AS "expiresAt"`;
      if (rows[0]) return json(inviteBody(rows[0]), 201);
    } catch (cause) {
      // A concurrent request created the open code first (idx_couple_invites_open): revoke it and retry.
      if (!isUniqueViolation(cause)) throw cause;
    }
  }
  return apiError(500, "internal", "Could not create a code. Try again.");
}

function isUniqueViolation(cause: unknown) {
  return Boolean(cause && typeof cause === "object" && (cause as { code?: string }).code === "23505");
}

/**
 * POST /api/v1/couple/join `{ code }`. Errors: 404 invalid_code, 422 own_invite, 410 code_expired (expired,
 * used or replaced), 409 already_paired (either side), 429 after 10 tries in 10 minutes. Pairing is one
 * statement (invite used + couple + both members), guarded by the one-active-couple-per-user index.
 */
export async function joinCoupleResponse(request: Request, now = new Date()) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const body = await readJson(request);
  if (typeof body?.code !== "string") return apiError(400, "bad_request", "code is required.");
  const sql = database()!;
  await ensureLifecycleSchema(sql);
  const me = auth.user.id;
  const wait = await hitRateLimit(sql, "join", me, 10, 10 * 60);
  if (wait) return rateLimited(wait, "Too many tries. Try again in a few minutes.");
  if (await activeMembership(sql, me)) return apiError(409, "already_paired", "You are already paired.");
  const code = normalizeInviteCode(body.code);
  const invalid = () => apiError(404, "invalid_code", "That code does not exist.");
  if (!/^[0-9A-Z]{6}$/.test(code)) return invalid();
  const invite = (await sql`SELECT created_by AS "createdBy", (used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at <= now()) AS closed FROM couple_invites WHERE code = ${code}`)[0];
  if (!invite) return invalid();
  if (invite.createdBy === me) return apiError(422, "own_invite", "This is your own code.");
  if (invite.closed) return apiError(410, "code_expired", "That code has expired. Ask for a new one.");
  const alreadyPaired = () => apiError(409, "already_paired", "One of you is already paired.");
  if (await activeMembership(sql, String(invite.createdBy))) return alreadyPaired();
  const coupleId = randomId("cpl_");
  let paired = 0;
  try {
    const rows = await sql`WITH inv AS (
        UPDATE couple_invites SET used_by = ${me}, used_at = now(), couple_id = ${coupleId}
        WHERE code = ${code} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND created_by <> ${me}
          AND NOT EXISTS (SELECT 1 FROM couple_members a WHERE a.left_at IS NULL AND a.user_id IN (${me}, couple_invites.created_by))
        RETURNING created_by
      ), c AS (
        INSERT INTO couples (id, legacy, paired_at) SELECT ${coupleId}, false, now() FROM inv RETURNING id, paired_at
      ), m AS (
        INSERT INTO couple_members (couple_id, user_id, role, joined_at)
        SELECT c.id, inv.created_by, 'a', c.paired_at FROM inv, c
        UNION ALL SELECT c.id, ${me}, 'b', c.paired_at FROM c
        RETURNING user_id
      )
      SELECT (SELECT count(*)::int FROM m) AS members`;
    paired = Number(rows[0]?.members ?? 0);
  } catch (cause) {
    if (isUniqueViolation(cause)) return alreadyPaired();
    throw cause;
  }
  if (paired !== 2) {
    // Lost a race between the checks above and the statement: report what changed.
    const again = (await sql`SELECT (used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at <= now()) AS closed FROM couple_invites WHERE code = ${code}`)[0];
    return again?.closed ? apiError(410, "code_expired", "That code has expired. Ask for a new one.") : alreadyPaired();
  }
  await sql`UPDATE couple_invites SET revoked_at = now() WHERE created_by = ${me} AND used_at IS NULL AND revoked_at IS NULL`;
  // TODO(W2a push): send couple.joined to both members.
  const view = await requireCouple(request);
  if (view instanceof Response) return view;
  return json(coupleView(view, await isCouplePremium(sql, coupleId), now, await avatarsFor(sql, [view.partner.id], now)), 201);
}

// ---------------------------------------------------------------------------------------------------
// GET /api/v1/me
// ---------------------------------------------------------------------------------------------------
export async function meResponse(request: Request, now = new Date()) {
  const paired = await requireCouple(request);
  if (paired instanceof Response && paired.status !== 409) return paired;
  const auth = paired instanceof Response ? await requireUser(request) : paired;
  if (auth instanceof Response) return auth;
  const sql = database()!;
  await ensureLifecycleSchema(sql);
  const partnerId = paired instanceof Response ? null : paired.partner.id;
  // Not paired: a half-ended couple (partner deleted outside deleteAccount) is closed now, so pendingUnpair shows it.
  if (paired instanceof Response) await repairHalfCouples(sql, auth.user.id);
  const entitlement = await resolveEntitlement(sql, auth.user.id, partnerId, undefined, now);
  const avatars = await avatarsFor(sql, partnerId ? [auth.user.id, partnerId] : [auth.user.id], now);
  const body: Me = {
    user: { ...toApiUser(auth.user), avatar: avatars.get(auth.user.id) ?? null, city: (await citiesFor(sql,[auth.user.id])).get(auth.user.id) ?? null },
    couple: paired instanceof Response ? null : coupleView(paired, entitlement.premium, now, avatars),
    entitlement,
    pendingUnpair: paired instanceof Response ? await latestUnpair(sql, auth.user.id) : null,
    hasPendingInvite: paired instanceof Response ? Boolean(await openInvite(sql, auth.user.id)) : false,
  };
  return json(body);
}

// ---------------------------------------------------------------------------------------------------
// GET /api/v1/today
// ---------------------------------------------------------------------------------------------------
async function toApiPhoto(row: Row, viewerId: string, store: ObjectStore | null, now: Date): Promise<Photo> {
  const ready = row.status === "ready";
  const urls = ready && store && row.objectKey && row.thumbKey
    ? { full: await store.presignGet(String(row.objectKey), PHOTO_URL_SECONDS), thumb: await store.presignGet(String(row.thumbKey), PHOTO_URL_SECONDS), expiresAt: toIso(new Date(now.getTime() + PHOTO_URL_SECONDS * 1000)) }
    : null;
  const phrase = typeof row.phrase === "string" && row.phrase ? row.phrase.slice(0, 80) : null;
  return { id: String(row.id), author: row.authorUserId === viewerId ? "me" : "partner", authorUserId: String(row.authorUserId), localDay: String(row.localDay), isDaily: Boolean(row.isDaily), status: ready ? "ready" : "pending", phraseKey: (row.phraseKey as string | null) ?? null, phrase, width: Number(row.width), height: Number(row.height), createdAt: isoOrNull(row.createdAt) ?? toIso(now), urls };
}

/**
 * Ready photos of one author on their own local day. The photo of the day is the first one of that day:
 * W2a's `is_daily`, else the earliest to become ready.
 */
async function dayPhotos(sql: Sql, coupleId: string, authorId: string, day: string) {
  return await sql`SELECT id, author_user_id AS "authorUserId", to_char(local_day, 'YYYY-MM-DD') AS "localDay", is_daily AS "isDaily", status, phrase_key AS "phraseKey", phrase, COALESCE(width, 0) AS width, COALESCE(height, 0) AS height, created_at AS "createdAt", object_key AS "objectKey", thumb_key AS "thumbKey"
    FROM couple_photos WHERE couple_id = ${coupleId} AND author_user_id = ${authorId} AND status = 'ready' AND local_day = ${day}::date AND delete_after IS NULL
    ORDER BY is_daily DESC, COALESCE(ready_at, created_at), id`;
}

async function latestPhoto(sql: Sql, coupleId: string, authorId: string) {
  return (await sql`SELECT id, author_user_id AS "authorUserId", to_char(local_day, 'YYYY-MM-DD') AS "localDay", is_daily AS "isDaily", status, phrase_key AS "phraseKey", phrase, COALESCE(width, 0) AS width, COALESCE(height, 0) AS height, created_at AS "createdAt", object_key AS "objectKey", thumb_key AS "thumbKey"
    FROM couple_photos WHERE couple_id = ${coupleId} AND author_user_id = ${authorId} AND status = 'ready' AND delete_after IS NULL
    ORDER BY COALESCE(ready_at, created_at) DESC, id DESC LIMIT 1`)[0] ?? null;
}

/**
 * Partner's busy/free state at `now` from W3's mirror (calendar_busy + calendar_sync). Null when never synced.
 * Busy: a block covers now; busyUntil = end of the run of touching blocks. Free: freeUntil = next block start.
 * `unknown` once the uploaded window no longer covers now. Titles are only stored for opted-in calendars.
 */
export async function partnerStatus(sql: Sql, partnerId: string, now: Date): Promise<PartnerStatus | null> {
  const nowIso = now.toISOString();
  const sync = (await sql`SELECT synced_at AS "syncedAt", window_to AS "windowTo" FROM calendar_sync WHERE user_id = ${partnerId}`)[0];
  if (!sync) return null;
  const syncedAt = isoOrNull(sync.syncedAt);
  if (new Date(String(sync.windowTo instanceof Date ? sync.windowTo.toISOString() : sync.windowTo)).getTime() <= now.getTime()) return { state: "unknown", busyUntil: null, freeUntil: null, title: null, syncedAt };
  const blocks = (await sql`SELECT starts_at AS "startsAt", ends_at AS "endsAt", title FROM calendar_busy WHERE user_id = ${partnerId} AND ends_at > ${nowIso}::timestamptz AND starts_at < ${nowIso}::timestamptz + interval '14 days' ORDER BY starts_at, ends_at LIMIT 500`)
    .map((row) => ({ start: new Date(String(isoOrNull(row.startsAt))).getTime(), end: new Date(String(isoOrNull(row.endsAt))).getTime(), title: (row.title as string | null) ?? null }));
  const t = now.getTime();
  const current = blocks.filter((block) => block.start <= t);
  if (!current.length) return { state: "free", busyUntil: null, freeUntil: blocks[0] ? toIso(new Date(blocks[0].start)) : null, title: null, syncedAt };
  let until = Math.max(...current.map((block) => block.end));
  for (const block of blocks) if (block.start <= until && block.end > until) until = block.end;
  const title = current.find((block) => block.title)?.title ?? null;
  return { state: "busy", busyUntil: toIso(new Date(until)), freeUntil: null, title, syncedAt };
}

/** "Thinking of you" state from W2b's couple_nudges (1 per 60 s, 30 per rolling 24h). */
async function nudgeState(sql: Sql, coupleId: string, userId: string, now: Date): Promise<NudgeState> {
  const nowIso = now.toISOString();
  const row = (await sql`SELECT max(created_at) FILTER (WHERE from_user_id = ${userId}) AS "lastSentAt", max(created_at) FILTER (WHERE to_user_id = ${userId}) AS "lastReceivedAt",
      count(*) FILTER (WHERE from_user_id = ${userId} AND created_at > ${nowIso}::timestamptz - interval '24 hours')::int AS "dayCount",
      min(created_at) FILTER (WHERE from_user_id = ${userId} AND created_at > ${nowIso}::timestamptz - interval '24 hours') AS "oldestToday"
    FROM couple_nudges WHERE couple_id = ${coupleId}`)[0] ?? {};
  const lastSentAt = isoOrNull(row.lastSentAt);
  const candidates: number[] = [];
  if (lastSentAt && Date.parse(lastSentAt) + 60_000 > now.getTime()) candidates.push(Date.parse(lastSentAt) + 60_000);
  if (Number(row.dayCount) >= 30 && row.oldestToday) candidates.push(Date.parse(String(isoOrNull(row.oldestToday))) + 86_400_000);
  return { lastSentAt, lastReceivedAt: isoOrNull(row.lastReceivedAt), nextAllowedAt: candidates.length ? toIso(new Date(Math.max(...candidates))) : null };
}

/** W2b's next trip whose Live Activity window is open or opens within 24h. */
async function activeTrip(sql: Sql, coupleId: string, userId: string, premium: boolean, now: Date): Promise<Trip | null> {
  const nowIso = now.toISOString();
  const row = (await sql`SELECT id, traveler_user_id AS "travelerUserId", departs_at AS "departsAt", arrives_at AS "arrivesAt", from_city AS "fromCity", to_city AS "toCity", la_starts_at AS "laStartsAt", la_ends_at AS "laEndsAt", la_started_at AS "laStartedAt", la_ended_at AS "laEndedAt", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM trips WHERE couple_id = ${coupleId} AND canceled_at IS NULL AND la_ends_at > ${nowIso}::timestamptz AND la_starts_at <= ${nowIso}::timestamptz + interval '24 hours' ORDER BY la_starts_at LIMIT 1`)[0];
  if (!row) return null;
  const at = (value: unknown) => String(isoOrNull(value));
  const t = now.getTime();
  const phase = t < Date.parse(at(row.laStartsAt)) ? "scheduled" : t < Date.parse(at(row.departsAt)) ? "before" : t < Date.parse(at(row.arrivesAt)) ? "inTransit" : t < Date.parse(at(row.laEndsAt)) ? "landed" : "ended";
  return { id: String(row.id), traveler: row.travelerUserId === userId ? "me" : "partner", travelerUserId: String(row.travelerUserId), departsAt: at(row.departsAt), arrivesAt: at(row.arrivesAt), fromCity: (row.fromCity as string | null) ?? null, toCity: (row.toCity as string | null) ?? null, phase, liveActivity: { eligible: premium, startsAt: at(row.laStartsAt), endsAt: at(row.laEndsAt), startedAt: isoOrNull(row.laStartedAt), endedAt: isoOrNull(row.laEndedAt) }, createdAt: at(row.createdAt), updatedAt: at(row.updatedAt) };
}

/** Reads another workstream's table; a missing or reshaped table degrades to `fallback` instead of a 500. */
async function optional<T>(label: string, enabled: boolean, read: () => Promise<T>, fallback: T): Promise<T> {
  if (!enabled) return fallback;
  try { return await read(); } catch (cause) { console.error(`[v1/today] ${label} read failed`, cause); return fallback; }
}

/** Builds the contract `Today` for a paired user at `now`. */
export async function buildToday(sql: Sql, { user, couple, partner }: Paired, now: Date, store = getObjectStore()): Promise<Today> {
  await ensureLifecycleSchema(sql);
  const tables = await optionalTables(sql);
  const entitlement = await resolveEntitlement(sql, user.id, partner.id, tables, now);
  const myZone = user.timeZone ?? "UTC";
  const myDay = localDay(myZone, now);
  const partnerDay = partner.timeZone ? localDay(partner.timeZone, now) : null;
  const mine = await optional("photos", tables.photos, () => dayPhotos(sql, couple.id, user.id, myDay), []);
  const theirs = await optional("photos", tables.photos && Boolean(partnerDay), () => dayPhotos(sql, couple.id, partner.id, partnerDay!), []);
  const latest = await optional("photos", tables.photos, () => latestPhoto(sql, couple.id, partner.id), null);
  const photo = (row: Row | null | undefined) => row ? toApiPhoto(row, user.id, store, now) : Promise.resolve(null);
  const { streak, unseenMilestones } = await todayMilestones(sql, { user, couple, partner }, now);
  const weather = await optional("weather", true, () => weatherFor(sql, [user.id, partner.id], now), new Map());
  const avatars = await avatarsFor(sql, [user.id, partner.id], now, store);
  const cities = await citiesFor(sql,[user.id,partner.id]);
  const myCity=cities.get(user.id), partnerCity=cities.get(partner.id);
  return {
    distanceKm: myCity && partnerCity ? cityDistanceKm(myCity,partnerCity) : null,
    generatedAt: toIso(now),
    me: { displayName: user.displayName, localDay: myDay, timeZone: myZone, dailyPhoto: await photo(mine[0]), photoCount: mine.length, weather: weather.get(user.id) ?? null, avatar: avatars.get(user.id) ?? null },
    partner: {
      userId: partner.id, displayName: partner.displayName, timeZone: partner.timeZone, utcOffsetMinutes: partner.timeZone ? utcOffsetMinutes(partner.timeZone, now) : null, localDay: partnerDay,
      dailyPhoto: await photo(theirs[0]), latestPhoto: await photo(latest), photoCount: theirs.length,
      status: await optional("calendar", tables.calendar && entitlement.premium, () => partnerStatus(sql, partner.id, now), null),
      weather: weather.get(partner.id) ?? null,
      avatar: avatars.get(partner.id) ?? null,
    },
    startedOn: couple.startedOn,
    daysTogether: daysTogether(couple, user.timeZone, now),
    reunion: reunionView(couple, user.timeZone, now),
    activeTrip: await optional("trips", tables.trips, () => activeTrip(sql, couple.id, user.id, entitlement.premium, now), null),
    nudges: await optional("nudges", tables.nudges, () => nudgeState(sql, couple.id, user.id, now), { lastSentAt: null, lastReceivedAt: null, nextAllowedAt: null }),
    entitlement,
    streak,
    unseenMilestones,
  };
}

/**
 * Weak ETag over everything but `generatedAt` and the signed URLs (re-signed on every call), plus the hour,
 * so a widget polling with If-None-Match gets 304 until something changes and fresh URLs at least hourly.
 */
export async function todayEtag(today: Today, now: Date) {
  const stable = JSON.stringify(today, (key, value) => key === "generatedAt" || key === "urls" ? undefined : value) + `|${Math.floor(now.getTime() / 3_600_000)}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable)));
  return `W/"${[...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

/** GET /api/v1/today (ETag / If-None-Match -> 304). */
export async function todayResponse(request: Request, now = new Date()) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const today = await buildToday(database()!, auth, now);
  const etag = await todayEtag(today, now);
  const match = request.headers.get("if-none-match");
  if (match && match.split(",").map((tag) => tag.trim()).some((tag) => tag === etag || tag === "*" || tag.replace(/^W\//, "") === etag.replace(/^W\//, ""))) {
    return new Response(null, { status: 304, headers: { ...noStore, ETag: etag } });
  }
  return json(today, 200, { ETag: etag });
}
