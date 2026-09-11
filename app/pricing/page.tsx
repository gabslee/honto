"use client";

import { useEffect, useState } from "react";

export default function PricingPage() {
  const [loading, setLoading] = useState<"month" | "year" | null>(null);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => { setSignedIn(Boolean(data.user)); setAccepted(Boolean(data.user?.termsAcceptedAt)); }).catch(() => setSignedIn(false)); }, []);
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
  return <main className="pricing-page"><a className="pricing-back" href="/">← Back to Honto</a><div className="pricing-brand">HONTO?<b>!</b></div><span className="eyebrow">PREMIUM · ONE PLAN, YOUR CHOICE</span><h1>Make every game<br/><em>more personal.</em></h1><p className="pricing-lead">Honto Premium is one plan with every premium feature. Choose whether you prefer monthly flexibility or the lower yearly price.</p>{signedIn === false && <p className="pricing-signin">Sign in with Google to start your Premium trial. <a href="/api/auth/google/start">SIGN IN →</a></p>}{signedIn && <label className="terms-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>}<section className="pricing-benefits" aria-labelledby="premium-benefits-title"><div><span className="pricing-tag">HONTO PREMIUM INCLUDES</span><h2 id="premium-benefits-title">Everything that makes the table yours.</h2></div><ul><li><strong>More AI generations</strong><span>Create more custom questions, prompts and ideas.</span></li><li><strong>Custom questions and decks</strong><span>Shape the game around your friends, partner or theme.</span></li><li><strong>Premium content and new games</strong><span>Get new formats and features as they arrive.</span></li><li><strong>Shared-room access</strong><span>Premium features work for everyone in your room.</span></li></ul><p className="trial-note">Every option starts with a 7-day free trial. Cancel anytime from the Stripe customer portal.</p></section><div className="billing-heading"><span className="pricing-tag">CHOOSE YOUR BILLING FREQUENCY</span><p>Same Premium benefits. Only the payment schedule changes.</p></div><section className="pricing-grid billing-options" aria-label="Premium billing frequency"><article className="pricing-card billing-card"><span className="pricing-tag">MONTHLY · FLEXIBLE</span><div className="pricing-amount"><strong>US$ 4.99</strong><span>/ month</span></div><p>Pay month to month after your 7-day trial.</p><button className="primary-button" disabled={disabled} onClick={() => void checkout("month")}>{loading === "month" ? "OPENING CHECKOUT…" : "START MONTHLY →"}</button></article><article className="pricing-card pricing-card-featured billing-card"><span className="pricing-tag">YEARLY · SAVE 33%</span><div className="pricing-amount"><strong>US$ 39.99</strong><span>/ year</span></div><p>Save US$ 19.89 compared with twelve monthly payments.</p><button className="primary-button" disabled={disabled} onClick={() => void checkout("year")}>{loading === "year" ? "OPENING CHECKOUT…" : "START YEARLY →"}</button></article></section>{error && <p className="form-error pricing-error" role="alert">{error}</p>}<p className="pricing-footnote">Premium renews automatically after the trial unless canceled. You can manage or cancel it from the Stripe customer portal.</p><footer className="legal-footer"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/subscriptions">Subscriptions</a><a href="/responsible-play">Responsible play</a></footer></main>;
}
