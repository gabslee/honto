import { verifyEmailSignIn } from "../../../../../../api/v1/email-login";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/email/verify `{ token }` or `{ email, code }`: same session response as Google sign-in. */
export async function POST(request: Request) {
  return verifyEmailSignIn(request);
}
