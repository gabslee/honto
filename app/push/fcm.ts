// FCM HTTP v1 (Android): high-priority data messages, OAuth access token minted from the service account.
// Never logs device tokens.
import { importPKCS8, SignJWT } from "jose";

export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };
export type FcmMessage = { token: string; data: Record<string, string> };
/** `prune` = the registration token is dead (404 / UNREGISTERED) and must be revoked. */
export type FcmResult = { status: number; reason: string | null; prune: boolean };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (PEM, `\n` escapes allowed); null while any is missing. */
export function fcmConfig(env: Record<string, string | undefined> = process.env): FcmConfig | null {
  const projectId = env.FCM_PROJECT_ID?.trim();
  const clientEmail = env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

let cachedToken: { id: string; accessToken: string; expiresAt: number } | null = null;

/** OAuth 2.0 access token (JWT bearer grant, RS256), cached until a minute before it expires. */
export async function fcmAccessToken(config: FcmConfig, now = Date.now()) {
  const id = `${config.projectId}:${config.clientEmail}`;
  if (cachedToken && cachedToken.id === id && now < cachedToken.expiresAt) return cachedToken.accessToken;
  const key = await importPKCS8(config.privateKey, "RS256");
  const issuedAt = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: SCOPE }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(config.clientEmail).setAudience(TOKEN_URL).setIssuedAt(issuedAt).setExpirationTime(issuedAt + 3600).sign(key);
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  if (!response.ok) throw new Error(`FCM OAuth token request failed with HTTP ${response.status}.`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("FCM OAuth token response has no access_token.");
  cachedToken = { id, accessToken: body.access_token, expiresAt: now + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 };
  return body.access_token;
}

/** Sends high-priority data messages (the app's FCM service updates the widget snapshot and notifies). */
export async function sendFcm(messages: FcmMessage[], config: FcmConfig): Promise<FcmResult[]> {
  if (!messages.length) return [];
  const accessToken = await fcmAccessToken(config);
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`;
  return Promise.all(messages.map(async (message): Promise<FcmResult> => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { token: message.token, data: message.data, android: { priority: "HIGH" } } }),
      });
      if (response.ok) return { status: response.status, reason: null, prune: false };
      const body = await response.json().catch(() => null) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
      const reason = body?.error?.details?.find((detail) => detail.errorCode)?.errorCode ?? body?.error?.status ?? null;
      return { status: response.status, reason, prune: response.status === 404 || reason === "UNREGISTERED" };
    } catch {
      return { status: 0, reason: "connection_error", prune: false };
    }
  }));
}
