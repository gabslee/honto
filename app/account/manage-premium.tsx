"use client";

import { useState } from "react";

export function ManagePremiumButton({ enabled }: { enabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (!enabled) return <a className="primary-button account-cta" href="/pricing">EXPLORE PREMIUM →</a>;
  return <><button type="button" className="primary-button account-cta" disabled={loading} onClick={async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error ?? "Unable to open Premium management.");
      window.location.assign(data.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open Premium management."); }
    finally { setLoading(false); }
  }}>{loading ? "OPENING…" : "MANAGE PREMIUM →"}</button>{error && <p className="form-error" role="alert">{error}</p>}</>;
}
