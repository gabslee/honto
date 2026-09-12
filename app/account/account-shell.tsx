import Link from "next/link";
import type { ReactNode } from "react";

export function AccountShell({ children }: { children: ReactNode }) {
  return <main className="account-page"><nav><Link className="brand" href="/"><span>HONTO?</span><b>!</b></Link><div><Link href="/account">ACCOUNT</Link><Link href="/account/history">MATCH HISTORY</Link></div></nav>{children}</main>;
}

export function SignInRequired() {
  return <AccountShell><section className="account-hero"><span className="eyebrow">HONTO · ACCOUNT</span><h1>Sign in to see your Honto.</h1><p>Your match history is attached to your Google account.</p><a className="primary-button account-cta" href="/api/auth/google/start">SIGN IN WITH GOOGLE →</a></section></AccountShell>;
}
