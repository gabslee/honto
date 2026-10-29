// Couple chat ("Just between you", Free): GET/POST /api/v1/chat/messages, POST /api/v1/chat/read,
// GET /api/v1/chat/summary. Comments reference the partner's photo or daily video; view-once messages are created
// by the private-media flow (Premium) and keep only a status here, never a URL or bytes.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { ChatMessage, ChatMessageKind, ChatPhotoRef, ChatSummary, ViewOnceStatus } from "../../contracts/honto-api";
import { notifyPartner, type NotifySummary, type PushEvent } from "../../app/push/index";
import { database } from "../../app/server-auth";
import { freeWindowStart, photoUrls, type PhotoRow } from "../../app/api/v1/photos/photo-rows";
import { apiError, noStore, requireCouple, type V1Partner, type V1User } from "./context";
import { resolveEntitlement } from "./couple";
import { ensureLaunchSchema } from "./launch-schema";
import { hitRateLimit, randomId } from "./lifecycle";

type Sql = NeonQueryFunction<false, false>;

export const CHAT_BODY_MAX = 2000;
export const CHAT_PAGE_DEFAULT = 30;
export const CHAT_PAGE_MAX = 100;
export const CHAT_PER_MINUTE = 60;
const PUSH_PREVIEW_MAX = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';

/** Sends a chat push to the partner. Overridable for tests (`setChatNotifier`). */
export type ChatNotifier = (coupleId: string, fromUserId: string, event: PushEvent) => Promise<NotifySummary | void>;
let chatNotifier: ChatNotifier = notifyPartner;
export function setChatNotifier(notifier: ChatNotifier | null | undefined) { chatNotifier = notifier ?? notifyPartner; }

type MessageRow = {
  id: string; clientId: string; authorUserId: string; kind: ChatMessageKind; body: string | null; createdAt: string;
  photoId: string | null; photoReady: boolean | null; photoLocalDay: string | null; storage: string | null; url: string | null; objectKey: string | null; thumbKey: string | null;
  mediaId: string | null; mediaKind: string | null; mediaStatus: string | null; mediaLive: boolean | null;
  mediaExpiresAt: string | null; mediaOpenedAt: string | null;
};

/**
 * Messages of a couple, newest first, with their photo (`p`) and private media (`pm`) joined. `id` reads one
 * message; `before` pages strictly older than that message (same couple).
 */
async function readMessages(sql: Sql, coupleId: string, options: { id?: string; before?: string; limit: number }) {
  return await sql`SELECT m.id, m.client_id AS "clientId", m.author_user_id AS "authorUserId", m.kind, m.body, to_char(m.created_at AT TIME ZONE 'UTC', ${ISO}) AS "createdAt",
      p.id AS "photoId", (p.status = 'ready' AND (p.delete_after IS NULL OR p.delete_after > now())) AS "photoReady", to_char(p.local_day, 'YYYY-MM-DD') AS "photoLocalDay", p.storage, p.url, p.object_key AS "objectKey", p.thumb_key AS "thumbKey",
      pm.id AS "mediaId", pm.kind AS "mediaKind", pm.status AS "mediaStatus", (pm.expires_at IS NULL OR pm.expires_at > now()) AS "mediaLive",
      to_char(m.media_expires_at AT TIME ZONE 'UTC', ${ISO}) AS "mediaExpiresAt", m.media_opened_at AS "mediaOpenedAt"
    FROM couple_messages m LEFT JOIN couple_photos p ON p.id = m.photo_id LEFT JOIN private_media pm ON pm.id = m.private_media_id
    WHERE m.couple_id = ${coupleId} AND (${options.id ?? null}::text IS NULL OR m.id = ${options.id ?? null})
      AND (${options.before ?? null}::text IS NULL OR (m.created_at, m.id) < (SELECT b.created_at, b.id FROM couple_messages b WHERE b.id = ${options.before ?? null} AND b.couple_id = ${coupleId}))
    ORDER BY m.created_at DESC, m.id DESC LIMIT ${options.limit}` as MessageRow[];
}

/** Trimmed text, or null when empty or over 2000 characters (code points, same as Postgres char_length). */
export function chatBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const length = [...text].length;
  return length >= 1 && length <= CHAT_BODY_MAX ? text : null;
}

/** Lock-screen text for a message: never media, comments prefixed, long text cut with "...". */
export function chatPreview(kind: ChatMessageKind, body: string | null) {
  if (kind === "view_once") return "Sent you a disappearing photo";
  const prefix = kind === "photo_comment" ? "Commented on your photo: " : kind === "video_comment" ? "Commented on your video: " : "";
  const text = [...(body ?? "").replace(/\s+/g, " ").trim()];
  const room = PUSH_PREVIEW_MAX - prefix.length;
  return prefix + (text.length > room ? `${text.slice(0, room - 3).join("").trimEnd()}...` : text.join(""));
}

export function viewOnceStatus(row: Pick<MessageRow, "mediaOpenedAt" | "mediaId" | "mediaStatus" | "mediaLive">): ViewOnceStatus {
  if (row.mediaOpenedAt || row.mediaStatus === "opening") return "opened";
  return row.mediaId && row.mediaStatus === "ready" && row.mediaLive ? "unopened" : "expired";
}

type Viewer = { user: V1User; partner: V1Partner; premium: () => Promise<boolean> };

/** Lazily resolved once per request: only old photo comments need it (Free sees the last 7 days, like Memories). */
function viewer(sql: Sql, user: V1User, partner: V1Partner): Viewer {
  let premium: Promise<boolean> | null = null;
  return { user, partner, premium: () => (premium ??= resolveEntitlement(sql, user.id, partner.id).then((e) => e.premium)) };
}

async function photoRef(row: MessageRow, view: Viewer): Promise<ChatPhotoRef> {
  const none: ChatPhotoRef = { photoId: row.photoId, available: false, thumbUrl: null, expiresAt: null };
  if (!row.photoId || !row.photoReady) return none;
  const ref: ChatPhotoRef = { ...none, available: true };
  if (row.photoLocalDay && row.photoLocalDay < freeWindowStart(view.user.timeZone) && !(await view.premium())) return ref;
  try {
    const urls = await photoUrls({ storage: row.storage, url: row.url, objectKey: row.objectKey, thumbKey: row.thumbKey } as PhotoRow);
    return { ...ref, thumbUrl: urls.thumb, expiresAt: urls.expiresAt };
  } catch {
    // Storage not configured: the app shows the photo glyph.
    return ref;
  }
}

/** Contract `ChatMessage` as seen by the viewer. */
export async function toChatMessage(row: MessageRow, view: Viewer): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: row.id, clientId: row.clientId, author: row.authorUserId === view.user.id ? "me" : "partner", authorUserId: row.authorUserId,
    kind: row.kind, body: row.body, createdAt: row.createdAt, photo: null, video: null, viewOnce: null,
  };
  if (row.kind === "photo_comment") message.photo = await photoRef(row, view);
  if (row.kind === "video_comment") {
    const available = row.mediaKind === "daily_video" && row.mediaStatus === "ready";
    message.video = { mediaId: available ? row.mediaId : null, available, posterUrl: null };
  }
  if (row.kind === "view_once") {
    const status = viewOnceStatus(row);
    message.viewOnce = { mediaId: status === "unopened" ? row.mediaId : null, status, expiresAt: row.mediaExpiresAt, isRecipient: row.authorUserId !== view.user.id };
  }
  return message;
}

async function messageById(sql: Sql, coupleId: string, id: string) {
  return (await readMessages(sql, coupleId, { id, limit: 1 }))[0] ?? null;
}

async function chatSummary(sql: Sql, coupleId: string, view: Viewer): Promise<ChatSummary> {
  const counts = (await sql`SELECT r.last_read_message_id AS "lastReadMessageId",
      (SELECT count(*)::int FROM couple_messages m WHERE m.couple_id = ${coupleId} AND m.author_user_id <> ${view.user.id} AND (r.last_read_created_at IS NULL OR (m.created_at, m.id) > (r.last_read_created_at, r.last_read_message_id))) AS "unreadCount"
    FROM (SELECT 1) AS one LEFT JOIN couple_chat_reads r ON r.couple_id = ${coupleId} AND r.user_id = ${view.user.id}`)[0];
  const latest = await readMessages(sql, coupleId, { limit: 1 });
  return {
    unreadCount: Number(counts?.unreadCount ?? 0),
    lastReadMessageId: (counts?.lastReadMessageId as string | null) ?? null,
    latest: latest[0] ? await toChatMessage(latest[0], view) : null,
  };
}

async function chatAuth(request: Request) {
  const auth = await requireCouple(request);
  if (auth instanceof Response) return auth;
  const sql = database() as Sql;
  await ensureLaunchSchema(sql);
  return { ...auth, sql, view: viewer(sql, auth.user, auth.partner) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** GET /api/v1/chat/messages?before=<message id>&limit=: newest first. */
export async function listChatResponse(request: Request) {
  const auth = await chatAuth(request);
  if (auth instanceof Response) return auth;
  const { sql, couple, view } = auth;
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? CHAT_PAGE_DEFAULT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > CHAT_PAGE_MAX) return apiError(400, "bad_request", `limit must be between 1 and ${CHAT_PAGE_MAX}.`);
  const before = params.get("before") || undefined;
  if (before && !(await sql`SELECT 1 FROM couple_messages WHERE id = ${before} AND couple_id = ${couple.id}`).length) return apiError(400, "bad_request", "Unknown before cursor.");
  const rows = await readMessages(sql, couple.id, { before, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const messages = await Promise.all(page.map((row) => toChatMessage(row, view)));
  return json({ messages, nextBefore: rows.length > limit ? page[page.length - 1].id : null });
}

/**
 * POST /api/v1/chat/messages: text, or a comment on the partner's ready photo (`photoId`) or daily video
 * (`privateMediaId`). Commenting on my own media is rejected. Idempotent per `clientId`. Free.
 */
export async function sendChatResponse(request: Request) {
  const auth = await chatAuth(request);
  if (auth instanceof Response) return auth;
  const { sql, user, partner, couple, view } = auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "bad_request", "Send a JSON object.");
  if (typeof body.clientId !== "string" || !UUID.test(body.clientId)) return apiError(400, "bad_request", "clientId must be a UUID.");
  const text = chatBody(body.body);
  if (!text) return apiError(400, "bad_request", `Write 1 to ${CHAT_BODY_MAX} characters.`);
  const photoId = body.photoId ?? null, mediaId = body.privateMediaId ?? null;
  if ((photoId !== null && typeof photoId !== "string") || (mediaId !== null && typeof mediaId !== "string")) return apiError(400, "bad_request", "photoId and privateMediaId must be strings.");
  if (photoId && mediaId) return apiError(400, "bad_request", "Comment on a photo or a video, not both.");
  const clientId = body.clientId.toLowerCase();

  const existing = (await sql`SELECT id FROM couple_messages WHERE author_user_id = ${user.id} AND client_id = ${clientId}`)[0];
  if (existing) {
    const row = await messageById(sql, couple.id, String(existing.id));
    if (!row) return apiError(409, "bad_request", "clientId already used.");
    return json(await toChatMessage(row, view), 201);
  }
  if (photoId && !(await sql`SELECT 1 FROM couple_photos WHERE id = ${photoId} AND couple_id = ${couple.id} AND author_user_id = ${partner.id} AND status = 'ready' AND (delete_after IS NULL OR delete_after > now())`).length) {
    return apiError(422, "media_unavailable", "You can comment on your partner's photos only.");
  }
  if (mediaId && !(await sql`SELECT 1 FROM private_media WHERE id = ${mediaId} AND couple_id = ${couple.id} AND author_user_id = ${partner.id} AND kind = 'daily_video' AND status = 'ready'`).length) {
    return apiError(422, "media_unavailable", "You can comment on your partner's videos only.");
  }
  const wait = await hitRateLimit(sql, "chat_message", user.id, CHAT_PER_MINUTE, 60);
  if (wait) return apiError(429, "rate_limited", "Slow down a little.", { "Retry-After": String(wait) });

  const kind: ChatMessageKind = photoId ? "photo_comment" : mediaId ? "video_comment" : "text";
  const inserted = await sql`INSERT INTO couple_messages (id, couple_id, author_user_id, client_id, kind, body, photo_id, private_media_id)
    VALUES (${randomId("msg_")}, ${couple.id}, ${user.id}, ${clientId}, ${kind}, ${text}, ${photoId}, ${mediaId})
    ON CONFLICT (author_user_id, client_id) DO NOTHING RETURNING id`;
  // A concurrent retry with the same clientId may have won the insert.
  const id = inserted.length ? String(inserted[0].id) : String((await sql`SELECT id FROM couple_messages WHERE author_user_id = ${user.id} AND client_id = ${clientId}`)[0].id);
  const row = (await messageById(sql, couple.id, id))!;
  if (inserted.length) await chatNotifier(couple.id, user.id, { type: "chat_message", messageId: id, preview: chatPreview(kind, text), fromName: user.displayName });
  return json(await toChatMessage(row, view), 201);
}

/** POST /api/v1/chat/read: moves my read marker forward to `messageId` (never backwards). */
export async function markChatReadResponse(request: Request) {
  const auth = await chatAuth(request);
  if (auth instanceof Response) return auth;
  const { sql, user, couple, view } = auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.messageId !== "string") return apiError(400, "bad_request", "messageId is required.");
  const target = (await sql`SELECT id, created_at FROM couple_messages WHERE id = ${body.messageId} AND couple_id = ${couple.id}`)[0];
  if (!target) return apiError(404, "not_found", "Message not found.");
  await sql`INSERT INTO couple_chat_reads (couple_id, user_id, last_read_message_id, last_read_created_at) VALUES (${couple.id}, ${user.id}, ${String(target.id)}, (SELECT created_at FROM couple_messages WHERE id = ${String(target.id)}))
    ON CONFLICT (couple_id, user_id) DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id, last_read_created_at = EXCLUDED.last_read_created_at, updated_at = now()
    WHERE (couple_chat_reads.last_read_created_at, couple_chat_reads.last_read_message_id) < (EXCLUDED.last_read_created_at, EXCLUDED.last_read_message_id)`;
  return json(await chatSummary(sql, couple.id, view));
}

/** GET /api/v1/chat/summary: unread count and latest message for the Today card. */
export async function chatSummaryResponse(request: Request) {
  const auth = await chatAuth(request);
  if (auth instanceof Response) return auth;
  return json(await chatSummary(auth.sql, auth.couple.id, auth.view));
}

/**
 * Called once a view-once photo becomes ready (private-media complete): creates its chat message (idempotent:
 * `client_id` = media id) and pushes the partner only when the message is new. Never throws for the push.
 */
export async function postViewOnceMessage(sql: Sql, media: { id: string; coupleId: string; authorUserId: string; fromName: string | null }) {
  await ensureLaunchSchema(sql);
  const inserted = await sql`INSERT INTO couple_messages (id, couple_id, author_user_id, client_id, kind, private_media_id, media_expires_at)
    SELECT ${randomId("msg_")}, couple_id, author_user_id, id, 'view_once', id, expires_at FROM private_media WHERE id = ${media.id} AND kind = 'view_once' AND status = 'ready'
    ON CONFLICT (author_user_id, client_id) DO NOTHING RETURNING id`;
  if (!inserted.length) return null;
  const messageId = String(inserted[0].id);
  try {
    await chatNotifier(media.coupleId, media.authorUserId, { type: "chat_message", messageId, preview: chatPreview("view_once", null), fromName: media.fromName });
  } catch (cause) {
    console.error(`[v1/chat] view-once push failed: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
  return messageId;
}
