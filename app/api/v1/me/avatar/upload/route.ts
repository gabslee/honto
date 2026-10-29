import { createAvatarUploadResponse } from "../../../../../../server/v1/profile";

export const dynamic = "force-dynamic";

/** POST /api/v1/me/avatar/upload: reserves a profile photo and returns presigned PUTs (full + thumb, 10 min). */
export async function POST(request: Request) {
  return createAvatarUploadResponse(request);
}
