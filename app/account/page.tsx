import { headers } from "next/headers";
import Link from "next/link";
import { getCurrentUser, hasPremiumAccess } from "../server-auth";
import { AccountShell, SignInRequired } from "./account-shell";
import { ManagePremiumButton } from "./manage-premium";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const incoming = await headers();
  const user = await getCurrentUser(new Request("http://honto.local/account", { headers: incoming }));
  if (!user) return <SignInRequired/>;
  const premium = hasPremiumAccess(user);
  return <AccountShell><section className="account-hero"><span className="eyebrow">YOUR HONTO</span><h1>{user.displayName}</h1><p>{user.email}</p><span className={`account-plan ${premium ? "premium" : ""}`}>{user.role === "admin" ? "ADMIN · UNLIMITED" : premium ? "PREMIUM ACTIVE" : "FREE PLAN"}</span></section><section className="account-grid"><article className="panel"><span className="eyebrow">MATCHES</span><h2>Your tables, remembered.</h2><p>See scores, players and results from completed games without saving private answers or card content.</p><Link className="primary-button account-cta" href="/account/history">VIEW MATCH HISTORY →</Link></article><article className="panel"><span className="eyebrow">SUBSCRIPTION</span><h2>{premium ? "Your Premium controls." : "Unlock more Honto."}</h2><p>{premium ? "Billing, invoices, payment methods and cancellation are securely managed by Stripe." : "Multiplayer and expanded customization are available with Premium."}</p><ManagePremiumButton enabled={Boolean(user.stripeCustomerId)}/></article></section></AccountShell>;
}
