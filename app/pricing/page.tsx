"use client";

import { useState } from "react";

export default function PricingPage() {
  const [loading, setLoading] = useState<"month" | "year" | null>(null);
  const [error, setError] = useState("");
  const checkout = async (interval: "month" | "year") => {
    setLoading(interval);
    setError("");
    try {
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
  return <main className="pricing-page"><a className="pricing-back" href="/">← Back to Honto</a><div className="pricing-brand">HONTO?<b>!</b></div><span className="eyebrow">PREMIUM · PLAY MORE YOUR WAY</span><h1>Make every game<br/><em>more personal.</em></h1><p className="pricing-lead">Unlock more AI ideas, custom questions and the tools that make Honto yours.</p><section className="pricing-grid" aria-label="Premium plans"><article className="pricing-card"><span className="pricing-tag">MONTHLY</span><h2>Honto Premium</h2><div className="pricing-amount"><strong>US$ 4.99</strong><span>/ month</span></div><p>Try Premium free for 7 days. No card is required to start the trial.</p><ul><li>More AI generations</li><li>Custom questions and decks</li><li>Premium content and new games</li><li>Play Premium features together in a room</li></ul><button className="primary-button" disabled={Boolean(loading)} onClick={() => void checkout("month")}>{loading === "month" ? "OPENING CHECKOUT…" : "START 7-DAY TRIAL →"}</button></article><article className="pricing-card pricing-card-featured"><span className="pricing-tag">BEST VALUE</span><h2>Yearly Premium</h2><div className="pricing-amount"><strong>US$ 39.99</strong><span>/ year</span></div><p>One year of Premium for the price of less than eight monthly payments.</p><ul><li>Everything in Monthly Premium</li><li>Lower effective monthly price</li><li>Early access to new features</li><li>One subscription for your shared room</li></ul><button className="primary-button" disabled={Boolean(loading)} onClick={() => void checkout("year")}>{loading === "year" ? "OPENING CHECKOUT…" : "CHOOSE YEARLY →"}</button></article></section>{error && <p className="form-error pricing-error" role="alert">{error}</p>}<p className="pricing-footnote">Premium renews automatically after the trial unless canceled. You can manage or cancel it from the Stripe customer portal.</p></main>;
}
