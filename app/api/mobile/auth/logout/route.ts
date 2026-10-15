import { revokeMobileToken } from "../../../../server-auth";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const revoked = await revokeMobileToken(request);
  return Response.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
}
