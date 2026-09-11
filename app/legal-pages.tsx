import type { ReactNode } from "react";

export const legalEmail = "menezesofrete@gmail.com";
export const legalUpdated = "September 11, 2026";

export function LegalLayout({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <main className="legal-page"><a className="pricing-back" href="/">← Back to Honto</a><div className="pricing-brand">HONTO?<b>!</b></div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="legal-meta">Last updated: {legalUpdated}</p><article className="legal-card">{children}</article><footer className="legal-footer"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/subscriptions">Subscriptions</a><a href="/responsible-play">Responsible play</a><a href={`mailto:${legalEmail}`}>{legalEmail}</a></footer></main>;
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="legal-section"><h2>{title}</h2>{children}</section>;
}
