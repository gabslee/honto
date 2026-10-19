import { todayResponse } from "../../../../api/v1/couple";

export const dynamic = "force-dynamic";

/** GET /api/v1/today: Today screen and widgets in one call (ETag / If-None-Match). */
export async function GET(request: Request) {
  return todayResponse(request);
}
