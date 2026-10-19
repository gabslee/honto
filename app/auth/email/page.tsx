import type { Metadata } from "next";
import { headers } from "next/headers";
import { EmailSignIn } from "./email-sign-in";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Honto · Sign in", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Magic-link landing (`https://hontogame.com/auth/email?token=…`). With the app installed the universal link /
 * App Link opens the app and this page never loads. On a phone without that, it offers to open the app (the
 * token stays unused) or to sign in on this browser; on a computer it signs in right away (honto_session cookie).
 */
export default async function EmailSignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { token, web } = await searchParams;
  const agent = (await headers()).get("user-agent") ?? "";
  const device = /android/i.test(agent) ? "android" : /iphone|ipad|ipod/i.test(agent) ? "ios" : "desktop";
  return <EmailSignIn token={typeof token === "string" ? token : ""} device={web === "1" ? "desktop" : device}/>;
}
