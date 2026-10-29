import { chatSummaryResponse } from "../../../../../api/v1/chat";

export const dynamic = "force-dynamic";

/** GET /api/v1/chat/summary: unread count and latest message for the Today card. */
export async function GET(request: Request) {
  return chatSummaryResponse(request);
}
