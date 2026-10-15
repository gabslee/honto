import gameHandler from "../../../../api/game";
import { mobileAction } from "../mobile-routes.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const noStore = { "Cache-Control": "no-store, max-age=0" };

async function run(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.join("/") === "moments/photo") {
    return Response.json({ error: "Photo moments are not available yet.", code: "not_implemented" }, { status: 501, headers: noStore });
  }
  const action = mobileAction(request.method, path);
  if (!action) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  const url = new URL(request.url);
  let body: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (request.method !== "GET") {
    try { body = { ...body, ...(await request.json()) }; } catch { /* empty body */ }
  }
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Room ")) body.token = auth.slice(5).trim();
  body.action = action;
  let status = 200;
  let payload: unknown = null;
  const response = {
    setHeader() { return response; },
    status(next: number) { status = next; return response; },
    json(next: unknown) { payload = next; return next; },
  };
  await gameHandler({ method: "POST", body, query: {}, headers: request.headers }, response);
  return Response.json(payload, { status, headers: noStore });
}

export const GET = run;
export const POST = run;
export const PUT = run;
