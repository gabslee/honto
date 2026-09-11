import { clearUserCookie } from "../../../server-auth";

export async function POST() { return Response.json({ ok: true }, { headers: { "Set-Cookie": clearUserCookie(), "Cache-Control": "no-store" } }); }
