import { completeAvatarResponse } from "../../../../../../api/v1/profile";

export const dynamic = "force-dynamic";

/** POST /api/v1/me/avatar/complete `{ avatarId }`: checks both uploads and makes it my profile photo. */
export async function POST(request: Request) {
  return completeAvatarResponse(request);
}
