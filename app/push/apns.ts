// Direct APNs over HTTP/2 (node:http2, Node runtime only) with a token-based (ES256 .p8) JWT.
// Never logs device tokens.
import { connect, type ClientHttp2Session } from "node:http2";
import { importPKCS8, SignJWT } from "jose";

export type ApnsEnv = "sandbox" | "production";
export type ApnsConfig = { keyP8: string; keyId: string; teamId: string; bundleId: string };
/** One push. `pushType: "widgets"` is the iOS 26 widget push (topic `<bundle>.push-type.widgets`). */
export type ApnsMessage = { token: string; env: ApnsEnv; pushType: "alert" | "widgets"; payload: unknown; collapseId?: string };
/** `prune` = the token is dead (410 Unregistered or 400 BadDeviceToken) and must be revoked. */
/** `env` is set when the token only worked on the other APNs host (the stored env was wrong): update the row. */
export type ApnsResult = { status: number; reason: string | null; prune: boolean; env?: ApnsEnv };

export const APNS_HOSTS: Record<ApnsEnv, string> = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };
const JWT_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

/** APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID (default com.hontogame.app); null while any key part is missing. */
export function apnsConfig(env: Record<string, string | undefined> = process.env): ApnsConfig | null {
  const keyP8 = env.APNS_KEY_P8?.replace(/\\n/g, "\n").trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  if (!keyP8 || !keyId || !teamId) return null;
  return { keyP8, keyId, teamId, bundleId: env.APNS_BUNDLE_ID?.trim() || "com.hontogame.app" };
}

export const apnsTopic = (config: ApnsConfig, pushType: ApnsMessage["pushType"]) => pushType === "widgets" ? `${config.bundleId}.push-type.widgets` : config.bundleId;

let cachedJwt: { id: string; token: string; issuedAt: number } | null = null;

/** Provider JWT (ES256, kid = key id, iss = team id), reused for ~50 min (APNs wants 20-60 min). */
export async function apnsJwt(config: ApnsConfig, now = Date.now()) {
  const id = `${config.teamId}:${config.keyId}`;
  if (cachedJwt && cachedJwt.id === id && now - cachedJwt.issuedAt < JWT_TTL_MS) return cachedJwt.token;
  const key = await importPKCS8(config.keyP8, "ES256");
  const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: config.keyId }).setIssuer(config.teamId).setIssuedAt(Math.floor(now / 1000)).sign(key);
  cachedJwt = { id, token, issuedAt: now };
  return token;
}

function post(session: ClientHttp2Session, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const stream = session.request({ ":method": "POST", ...headers });
    let status = 0;
    let data = "";
    stream.setEncoding("utf8");
    stream.setTimeout(REQUEST_TIMEOUT_MS, () => { stream.close(); reject(new Error("APNs request timed out")); });
    stream.on("response", (responseHeaders) => { status = Number(responseHeaders[":status"]); });
    stream.on("data", (chunk: string) => { data += chunk; });
    stream.on("end", () => resolve({ status, body: data }));
    stream.on("error", reject);
    stream.end(body);
  });
}

/** Sends a batch: one HTTP/2 session per APNs host (sandbox / production per token), closed afterwards. */
export async function sendApns(messages: ApnsMessage[], config: ApnsConfig): Promise<ApnsResult[]> {
  if (!messages.length) return [];
  const jwt = await apnsJwt(config);
  const sessions = new Map<ApnsEnv, ClientHttp2Session>();
  const session = (env: ApnsEnv) => {
    let found = sessions.get(env);
    if (!found) {
      found = connect(APNS_HOSTS[env]);
      found.on("error", () => {});
      sessions.set(env, found);
    }
    return found;
  };
  try {
    return await Promise.all(messages.map(async (message): Promise<ApnsResult> => {
      const headers: Record<string, string> = {
        ":path": `/3/device/${encodeURIComponent(message.token)}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": apnsTopic(config, message.pushType),
        "apns-push-type": message.pushType,
        "apns-priority": "10",
        "content-type": "application/json",
      };
      if (message.collapseId) headers["apns-collapse-id"] = message.collapseId;
      const attempt = async (env: ApnsEnv) => {
        const response = await post(session(env), headers, JSON.stringify(message.payload));
        let reason: string | null = null;
        try { reason = response.body ? (JSON.parse(response.body) as { reason?: string }).reason ?? null : null; } catch { reason = null; }
        return { status: response.status, reason };
      };
      try {
        const first = await attempt(message.env);
        if (first.status === 400 && first.reason === "BadDeviceToken") {
          // APNs also answers BadDeviceToken when a token goes to the wrong host (e.g. a TestFlight build that
          // registered as sandbox). Try the other host once before pruning; on success report the right env.
          const other: ApnsEnv = message.env === "production" ? "sandbox" : "production";
          const second = await attempt(other).catch(() => null);
          if (second && second.status >= 200 && second.status < 300) return { status: second.status, reason: null, prune: false, env: other };
          return { status: first.status, reason: first.reason, prune: true };
        }
        return { status: first.status, reason: first.reason, prune: first.status === 410 };
      } catch {
        return { status: 0, reason: "connection_error", prune: false };
      }
    }));
  } finally {
    for (const open of sessions.values()) open.close();
  }
}
