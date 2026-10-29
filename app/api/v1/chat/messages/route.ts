import { listChatResponse, sendChatResponse } from "../../../../../api/v1/chat";

export const dynamic = "force-dynamic";
// APNs uses node:http2.
export const runtime = "nodejs";

/** GET /api/v1/chat/messages: couple chat history, newest first (`before` cursor, `limit`). */
export async function GET(request: Request) {
  return listChatResponse(request);
}

/** POST /api/v1/chat/messages: text or a comment on the partner's photo / daily video (Free). */
export async function POST(request: Request) {
  return sendChatResponse(request);
}
