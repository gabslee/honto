import { listMilestonesResponse } from "../../../../api/v1/milestones";

export const dynamic = "force-dynamic";

/** GET /api/v1/milestones[?unseen=true]: couple milestones (Free) with my seenAt, for Memories. */
export async function GET(request: Request) {
  return listMilestonesResponse(request);
}
