import type { NeonQueryFunction } from "@neondatabase/serverless";
import { roleFor } from "../app/couple-identity.js";
import { JAPANESE_PHRASES } from "../app/photo-moments.js";
import { resolveCouple } from "./couple";

type Sql = NeonQueryFunction<false, false>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic SQL rows
type Row = Record<string, any>;

/** Server-validated upload handed in by the mobile route (never from the request body). */
export type PhotoUpload = { phraseKey: string | null; phrase: string; contentType: string; size: number; store: (coupleId: string) => Promise<{ url: string; pathname: string }> };

const phraseInfo = (key: string | null) => JAPANESE_PHRASES.find((p) => p.key === key) ?? null;
export function publicPhoto(row: Row, myRole: string) {
  const info = phraseInfo(row.phraseKey);
  return { id: row.id, url: row.url, phrase: row.phrase, phraseKey: row.phraseKey ?? null, romaji: info?.romaji ?? null, translation: info ? { en: info.en, pt: info.pt } : null, author: row.authorName, mine: row.role === myRole, createdAt: row.createdAt };
}

export async function couplePhotos(sql: Sql, coupleId: string, limit = 30) {
  return await sql`SELECT id, url, phrase, phrase_key AS "phraseKey", author_name AS "authorName", role, created_at AS "createdAt" FROM couple_photos WHERE couple_id = ${coupleId} ORDER BY created_at DESC LIMIT ${limit}` as Row[];
}

export async function handlePhoto(sql: Sql, room: Row, me: Row, body: Row, upload: PhotoUpload | undefined) {
  if (room.multiplayer) throw new Error("Photo moments are for two-player rooms.");
  const couple = await resolveCouple(sql, room);
  const myRole = roleFor(me);
  if (body.action === "photoUpload") {
    if (!upload) throw new Error("Upload photos through /api/mobile/moments/photo.");
    const stored = await upload.store(couple.id);
    const id = crypto.randomUUID();
    await sql`INSERT INTO couple_photos (id, couple_id, room_id, role, author_name, url, pathname, phrase_key, phrase, content_type, size_bytes) VALUES (${id}, ${couple.id}, ${room.id}, ${myRole}, ${me.name}, ${stored.url}, ${stored.pathname}, ${upload.phraseKey}, ${upload.phrase}, ${upload.contentType}, ${upload.size})`;
    const row = (await sql`SELECT id, url, phrase, phrase_key AS "phraseKey", author_name AS "authorName", role, created_at AS "createdAt" FROM couple_photos WHERE id = ${id}`)[0] as Row;
    return { photo: publicPhoto(row, myRole) };
  }
  // photoLatest: the newest photo from the other partner (for the home-screen widget).
  const rows = await sql`SELECT id, url, phrase, phrase_key AS "phraseKey", author_name AS "authorName", role, created_at AS "createdAt" FROM couple_photos WHERE couple_id = ${couple.id} AND role <> ${myRole} ORDER BY created_at DESC LIMIT 1` as Row[];
  return { photo: rows[0] ? publicPhoto(rows[0], myRole) : null };
}
