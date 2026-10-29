import { deleteAvatarResponse } from "../../../../../server/v1/profile";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/me/avatar: removes my profile photo (rows now, objects right away or via the retention cron). 204. */
export async function DELETE(request: Request) {
  return deleteAvatarResponse(request);
}
