import { ensureIdentitySchema, getCurrentUser, database } from "../../../server-auth";

export const dynamic = "force-dynamic";
const TERMS_VERSION = "2026-09-11";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return Response.json({ error: "Sign in to accept the terms." }, { status: 401 });
  const sql = database();
  if (!sql) return Response.json({ error: "Database is not configured." }, { status: 503 });
  await ensureIdentitySchema();
  await sql`UPDATE users SET terms_accepted_at = now(), terms_version = ${TERMS_VERSION}, updated_at = now() WHERE id = ${user.id}`;
  return Response.json({ accepted: true, termsVersion: TERMS_VERSION });
}
