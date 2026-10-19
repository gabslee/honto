import type { Metadata } from "next";
import "../../../app-ui/tokens.css";
import "../../../app-ui/web-app.css";
import { EmailLinkVerify } from "../../../app-ui/email-link-verify";
import { Brand, Page } from "../../../app-ui/shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Honto · Sign in", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Magic-link landing on the web (contract: `https://hontogame.com/auth/email?token=…`). */
export default async function EmailSignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams;
  return <div className="ha-root"><Page narrow><Brand/><EmailLinkVerify token={typeof token === "string" ? token : ""}/></Page></div>;
}
