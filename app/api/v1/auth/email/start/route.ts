import { startEmailSignIn } from "../../../../../../api/v1/email-login";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/email/start `{ email, platform }`: magic link + 6-digit code by email. */
export async function POST(request: Request) {
  return startEmailSignIn(request);
}
