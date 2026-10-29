import { markMilestoneSeenResponse } from "../../../../../../server/v1/milestones";

export const dynamic = "force-dynamic";

/** POST /api/v1/milestones/{milestoneId}/seen: the CelebrationSheet was shown to me (idempotent). */
export async function POST(request: Request, { params }: { params: Promise<{ milestoneId: string }> }) {
  const { milestoneId } = await params;
  return markMilestoneSeenResponse(request, milestoneId);
}
