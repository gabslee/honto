import { put } from "@vercel/blob";

/** Stores a validated photo in Vercel Blob under an unguessable path. Needs BLOB_READ_WRITE_TOKEN. */
export async function storePhoto(coupleId: string, bytes: Uint8Array, contentType: string, ext: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Photo storage is not configured yet.");
  const safeCouple = coupleId.replace(/[^A-Za-z0-9-]/g, "_");
  const blob = await put(`moments/${safeCouple}/${crypto.randomUUID()}.${ext}`, Buffer.from(bytes), { access: "public", contentType, addRandomSuffix: true, cacheControlMaxAge: 31536000 });
  return { url: blob.url, pathname: blob.pathname };
}
