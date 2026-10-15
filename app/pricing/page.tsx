"use client";

import { useEffect, useState } from "react";

export default function PricingPage() {
  const [loading, setLoading] = useState<"month" | "year" | null>(null);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => { setSignedIn(Boolean(data.user)); setAccepted(false); }).catch(() => setSignedIn(false)); }, []);
  const checkout = async (interval: "month" | "year") => {
    setLoading(interval);
    setError("");
    try {
      if (signedIn === null) return;
      if (signedIn === false) { window.location.href = "/api/auth/google/start"; return; }
      if (!accepted) throw new Error("Please check the Terms of Use and Privacy Policy before continuing.");
      const consent = await fetch("/api/account/consent", { method: "POST" });
      if (!consent.ok) throw new Error("Please accept the Terms of Use and Privacy Policy first.");
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ interval }) });
      const data = await response.json();
      if (response.status === 401) { window.location.href = "/api/auth/google/start"; return; }
      if (!response.ok || !data.url) throw new Error(data.error ?? "Unable to open checkout.");
      window.location.href = data.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open checkout.");
      setLoading(null);
    }
  };
  const disabled = Boolean(loading) || signedIn === null;
  return <main className="pricing-page"><a className="pricing-back" href="/">← Back to Honto</a><div className="pricing-brand">HONTO?<b>!</b></div><span className="eyebrow">PREMIUM · ONE PLAN FOR BOTH OF YOU</span><h1>Make every date<br/><em>more personal.</em></h1><p className="pricing-lead">One Premium plan unlocks more ways for you and your partner to connect.</p>{signedIn === false ? <p className="pricing-signin pricing-auth-slot">Sign in with Google to start your Premium trial. <a href="/api/auth/google/start">SIGN IN →</a></p> : <label className="terms-consent pricing-auth-slot"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>}<section className="pricing-benefits" aria-labelledby="premium-benefits-title"><div><span className="pricing-tag">PREMIUM FOR YOUR COUPLE</span><h2 id="premium-benefits-title">More ways to feel close.</h2></div><ul><li><strong>AI ideas</strong><span>More questions and prompts for the two of you.</span></li><li><strong>Your own decks</strong><span>Custom questions made for your relationship.</span></li><li><strong>New date-night games</strong><span>New couples formats as they launch.</span></li><li><strong>One shared room</strong><span>Your partner enjoys your Premium features too.</span></li></ul><p className="trial-note">7-day free trial for both of you. Cancel anytime.</p></section><div className="billing-heading"><span className="pricing-tag">CHOOSE HOW TO PAY</span><p>One price per couple. Monthly or yearly billing.</p></div><section className="pricing-grid billing-options" aria-label="Premium billing frequency"><article className="pricing-card billing-card"><span className="pricing-tag">MONTHLY · PER COUPLE</span><div className="pricing-amount"><strong>US$ 4.99</strong><span>/ month</span></div><p>Covers both of you after the free trial.</p><button className="primary-button" disabled={disabled} onClick={() => void checkout("month")}>{loading === "month" ? "OPENING CHECKOUT…" : "START MONTHLY →"}</button></article><article className="pricing-card pricing-card-featured billing-card"><span className="pricing-tag">YEARLY · PER COUPLE</span><div className="pricing-amount"><strong>US$ 29.99</strong><span>/ year</span></div><p>Covers both of you and saves US$ 29.89 per year.</p><button className="primary-button" disabled={disabled} onClick={() => void checkout("year")}>{loading === "year" ? "OPENING CHECKOUT…" : "START YEARLY →"}</button></article></section>{error && <p className="form-error pricing-error" role="alert">{error}</p>}<p className="pricing-footnote">Renews automatically after the trial unless canceled. Manage or cancel in the Stripe customer portal.</p><footer className="legal-footer"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/subscriptions">Subscriptions</a><a href="/responsible-play">Responsible play</a></footer></main>;
}
