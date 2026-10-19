import Link from "next/link";
import type { ReactNode } from "react";

export const legalEmail = "support@hontogame.com";
export const legalUpdated = "October 19, 2026";

/**
 * Shared shell of the legal and help pages. `app` pages (privacy, terms, support) cover the Honto iOS app
 * and use the system font stack (SF Pro on Apple devices, Inter elsewhere) with the plain "Honto" wordmark.
 */
export function LegalLayout({ title, eyebrow, children, app = false }: { title: string; eyebrow: string; children: ReactNode; app?: boolean }) {
  return <main className={app ? "legal-page legal-app" : "legal-page"}><Link className="pricing-back" href="/">Back to Honto</Link><div className="pricing-brand">{app ? "Honto" : <>HONTO?<b>!</b></>}</div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="legal-meta">Last updated: {legalUpdated}</p><article className="legal-card">{children}</article><footer className="legal-footer"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a><a href="/subscriptions">Web subscriptions</a><a href={`mailto:${legalEmail}`}>{legalEmail}</a></footer></main>;
}

export function LegalSection({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <section className="legal-section" id={id}><h2>{title}</h2>{children}</section>;
}
