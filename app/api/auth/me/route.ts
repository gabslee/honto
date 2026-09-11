import { getCurrentUser } from "../../../server-auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
}
