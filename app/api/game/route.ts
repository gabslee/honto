import gameHandler from "../../../api/game";

async function run(request: Request) {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  if (request.method !== "GET") {
    try { body = await request.json(); } catch { /* handled by the game endpoint */ }
  }
  let status = 200;
  let payload: unknown = null;
  const response = {
    setHeader() { return response; },
    status(nextStatus: number) { status = nextStatus; return response; },
    json(nextPayload: unknown) { payload = nextPayload; return nextPayload; },
  };
  await gameHandler({ method: request.method, body, query: Object.fromEntries(url.searchParams) }, response);
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export const GET = run;
export const POST = run;
