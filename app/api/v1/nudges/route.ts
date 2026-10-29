import { sendNudgeResponse } from "../../../../server/v1/nudges";

export const dynamic = "force-dynamic";
// APNs uses node:http2.
export const runtime = "nodejs";

/** POST /api/v1/nudges: "Thinking of you" (Free), 1 per 60 s and 30 per day. */
export async function POST(request: Request) {
  return sendNudgeResponse(request);
}
