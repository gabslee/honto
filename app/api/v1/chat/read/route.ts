import { markChatReadResponse } from "../../../../../server/v1/chat";

export const dynamic = "force-dynamic";

/** POST /api/v1/chat/read: moves my read marker forward. */
export async function POST(request: Request) {
  return markChatReadResponse(request);
}
