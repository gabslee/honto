// Private S3-compatible object storage (Railway Storage Buckets today), signed with SigV4 by aws4fetch.
// Object URLs are virtual-host style on the configured endpoint: https://<S3_BUCKET>.<S3_ENDPOINT host>/<key>.
// Photo bytes never pass through the Function: devices PUT/GET with presigned URLs, the server only HEADs,
// deletes and lists. The bucket has no lifecycle rules; expiry is done by the retention cron with these helpers.
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

export type StorageConfig = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
/** Per-call overrides; `now` pins the signing clock (tests, snapshots). */
export type StorageOptions = { config?: StorageConfig | null; now?: Date };
export type PresignedPut = { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string };
export type PresignedGet = { url: string; expiresAt: string };
export type ObjectHead = { size: number; contentType: string | null; etag: string | null };
export type ListedObject = { key: string; size: number; lastModified: string | null };

export const PUT_TTL_SECONDS = 600;
export const GET_TTL_SECONDS = 86400;

/** Thrown when the S3_* settings (in practice the pending bucket keys) are missing. Routes answer 503. */
export class StorageNotConfiguredError extends Error {
  constructor() { super("Object storage is not configured."); }
}

/** Non-2xx answer from the bucket (status only; never carries credentials or signed URLs). */
export class StorageError extends Error {
  status: number;
  constructor(operation: string, status: number) { super(`Object storage ${operation} failed with HTTP ${status}.`); this.status = status; }
}

/** S3_ENDPOINT, S3_REGION (default `auto`), S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY; null while any is missing. */
export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const endpoint = env.S3_ENDPOINT?.trim();
  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  try {
    if (!/^https?:$/.test(new URL(endpoint).protocol)) return null;
  } catch {
    return null;
  }
  return { endpoint, region: env.S3_REGION?.trim() || "auto", bucket, accessKeyId, secretAccessKey };
}

function resolve(options: StorageOptions = {}) {
  const config = options.config === undefined ? storageConfig() : options.config;
  if (!config) throw new StorageNotConfiguredError();
  return config;
}

const clients = new Map<string, AwsClient>();
function client(config: StorageConfig) {
  const id = `${config.accessKeyId}:${config.region}`;
  let found = clients.get(id);
  if (!found) {
    found = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: config.region, retries: 2 });
    clients.set(id, found);
  }
  return found;
}

/** `https://<bucket>.<endpoint host>/` (virtual-host style, host derived from S3_ENDPOINT). */
export function bucketUrl(config: StorageConfig) {
  const endpoint = new URL(config.endpoint);
  return `${endpoint.protocol}//${config.bucket}.${endpoint.host}/`;
}

/** Unsigned virtual-host URL of an object key (each path segment percent-encoded). */
export function objectUrl(config: StorageConfig, key: string) {
  return bucketUrl(config) + key.split("/").map(encodeURIComponent).join("/");
}

const amzDate = (now: Date) => now.toISOString().replace(/[:-]|\.\d{3}/g, "");
const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function presign(config: StorageConfig, method: "GET" | "PUT", key: string, expiresIn: number, now: Date, headers?: Record<string, string>) {
  const url = new URL(objectUrl(config, key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  // allHeaders also signs Content-Type / Content-Length, so the PUT must carry exactly the declared values.
  const signed = await client(config).sign(url.toString(), { method, headers, aws: { signQuery: true, allHeaders: Boolean(headers), datetime: amzDate(now) } });
  return { url: signed.url, expiresAt: rfc3339(now.getTime() + expiresIn * 1000) };
}

/** Presigned PUT (default 10 min) bound to the declared Content-Type and Content-Length. */
export async function presignPut(key: string, body: { contentType: string; bytes: number }, options: StorageOptions & { expiresIn?: number } = {}): Promise<PresignedPut> {
  const config = resolve(options);
  const headers = { "Content-Type": body.contentType, "Content-Length": String(body.bytes) };
  const signed = await presign(config, "PUT", key, options.expiresIn ?? PUT_TTL_SECONDS, options.now ?? new Date(), headers);
  return { method: "PUT", url: signed.url, headers, expiresAt: signed.expiresAt };
}

/** Presigned GET (default 24h). */
export async function presignGet(key: string, options: StorageOptions & { expiresIn?: number } = {}): Promise<PresignedGet> {
  const config = resolve(options);
  return presign(config, "GET", key, options.expiresIn ?? GET_TTL_SECONDS, options.now ?? new Date());
}

/** HEAD of an object: size and type, or null when it does not exist. */
export async function headObject(key: string, options: StorageOptions = {}): Promise<ObjectHead | null> {
  const config = resolve(options);
  const response = await client(config).fetch(objectUrl(config, key), { method: "HEAD" });
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageError("HEAD", response.status);
  const length = Number(response.headers.get("content-length"));
  return { size: Number.isFinite(length) ? length : -1, contentType: response.headers.get("content-type"), etag: response.headers.get("etag") };
}

const xmlEscape = (value: string) => value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
const xmlUnescape = (value: string) => value.replace(/&(lt|gt|amp|apos|quot|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
  const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };
  if (named[e.toLowerCase()]) return named[e.toLowerCase()];
  return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const xmlTag = (xml: string, tag: string) => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? xmlUnescape(match[1]) : null;
};
const xmlBlocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);

/**
 * Deletes keys (missing keys count as deleted, like S3). Uses DeleteObjects in batches of 1000 and falls
 * back to one DELETE per key when the provider does not implement it. Returns per-key failures.
 */
export async function deleteObjects(keys: string[], options: StorageOptions = {}): Promise<{ deleted: number; errors: { key: string; code: string }[] }> {
  const config = resolve(options);
  const aws = client(config);
  const unique = [...new Set(keys.filter(Boolean))];
  const errors: { key: string; code: string }[] = [];
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000);
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${batch.map((key) => `<Object><Key>${xmlEscape(key)}</Key></Object>`).join("")}</Delete>`;
    const md5 = createHash("md5").update(body).digest("base64");
    const response = await aws.fetch(`${bucketUrl(config)}?delete`, { method: "POST", body, headers: { "Content-Type": "application/xml", "Content-MD5": md5 } });
    if (response.status === 501) {
      for (const key of batch) {
        const single = await aws.fetch(objectUrl(config, key), { method: "DELETE" });
        if (!single.ok && single.status !== 404) errors.push({ key, code: `HTTP ${single.status}` });
      }
      continue;
    }
    if (!response.ok) throw new StorageError("DeleteObjects", response.status);
    for (const block of xmlBlocks(await response.text(), "Error")) errors.push({ key: xmlTag(block, "Key") ?? "", code: xmlTag(block, "Code") ?? "Error" });
  }
  return { deleted: unique.length - errors.length, errors };
}

/** Every object under a prefix (ListObjectsV2, follows continuation tokens). */
export async function listPrefix(prefix: string, options: StorageOptions & { limit?: number } = {}): Promise<ListedObject[]> {
  const config = resolve(options);
  const objects: ListedObject[] = [];
  let token: string | null = null;
  do {
    const url = new URL(bucketUrl(config));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const response = await client(config).fetch(url.toString(), { method: "GET" });
    if (!response.ok) throw new StorageError("ListObjectsV2", response.status);
    const xml = await response.text();
    for (const block of xmlBlocks(xml, "Contents")) {
      objects.push({ key: xmlTag(block, "Key") ?? "", size: Number(xmlTag(block, "Size") ?? 0), lastModified: xmlTag(block, "LastModified") });
      if (options.limit && objects.length >= options.limit) return objects;
    }
    token = xmlTag(xml, "IsTruncated") === "true" ? xmlTag(xml, "NextContinuationToken") : null;
  } while (token);
  return objects;
}
