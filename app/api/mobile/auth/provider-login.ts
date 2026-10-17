import { findOrCreateProviderUser, type ProviderIdentity } from "../../../mobile-auth";
import { createMobileToken, database, hasPremiumAccess, type CurrentUser } from "../../../server-auth";

const noStore = { "Cache-Control": "no-store" };

export async function providerLogin(request: Request, verify: (idToken: string, nonce: unknown) => Promise<ProviderIdentity>) {
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* validated below */ }
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) return Response.json({ error: "idToken is required." }, { status: 400, headers: noStore });
  if (!database()) return Response.json({ error: "Server is not configured." }, { status: 503, headers: noStore });
  let identity: ProviderIdentity;
  try { identity = await verify(idToken, body.nonce); } catch (cause) {
    if (cause instanceof Error && cause.message === "missing_config") return Response.json({ error: "Sign-in is not configured.", code: "missing_config" }, { status: 503, headers: noStore });
    return Response.json({ error: "Invalid sign-in token.", code: "invalid_token" }, { status: 401, headers: noStore });
  }
  try {
    const name = typeof body.name === "string" ? body.name : null;
    const { userId, created } = await findOrCreateProviderUser(identity, name);
    const platform = body.platform === "android" ? "android" : "ios";
    const token = await createMobileToken({ kind: "user", userId, platform });
    const sql = database()!;
    const user = (await sql`SELECT id, email, display_name AS "displayName", role, plan, subscription_status AS "subscriptionStatus", subscription_expires_at AS "subscriptionExpiresAt", trial_ends_at AS "trialEndsAt" FROM users WHERE id = ${userId}`)[0] as CurrentUser;
    return Response.json({ token, tokenType: "Bearer", expiresInDays: 365, created, user: { id: user.id, email: user.email, displayName: user.displayName, plan: user.plan, premium: hasPremiumAccess(user) } }, { status: created ? 201 : 200, headers: noStore });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "email_not_verified") return Response.json({ error: "Your account email must be verified (or shared) the first time you sign in.", code: "email_required" }, { status: 400, headers: noStore });
    console.error("[mobile/auth] login failed", cause);
    return Response.json({ error: "Sign-in failed." }, { status: 500, headers: noStore });
  }
}
