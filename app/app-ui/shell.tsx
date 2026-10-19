import Link from "next/link";
import type { ReactNode } from "react";
import type { Me } from "../../contracts/honto-api";
import { Hanko, Icon } from "./icons";
import { initial, premiumSummary } from "./web-app-model.js";

type ImgProps = { src: string; width: number; height: number; alt: string; className?: string; eager?: boolean };

/**
 * Photos are presigned S3 URLs (24h) from a private bucket, so they skip the Next image optimizer. Always sized
 * (no layout shift) and lazy unless it is the banner.
 */
export function Img({ src, width, height, alt, className, eager = false }: ImgProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} width={width} height={height} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "high" : undefined}/>;
}

export function Brand() {
  return <Link className="ha-brand" href="/app"><Hanko size={28}/><span>Honto</span></Link>;
}

export function AppNav({ active, me }: { active: "memories" | "settings"; me: Me }) {
  const premium = premiumSummary(me.entitlement);
  return <header className="ha-nav">
    <Brand/>
    <nav className="ha-tabs" aria-label="Sections">
      <Link className="ha-tab" href="/app" aria-current={active === "memories" ? "page" : undefined}>Memories</Link>
      <Link className="ha-tab" href="/app/settings" aria-current={active === "settings" ? "page" : undefined}>Settings</Link>
    </nav>
    <div className="ha-nav-end">
      <span className={premium.active ? "ha-pill is-premium" : "ha-pill"}>{premium.active && <Hanko size={16}/>}{premium.label}</span>
      <Link className="ha-avatar me" href="/app/settings" aria-label={`Account: ${me.user.displayName}`}>{initial(me.user.displayName)}</Link>
    </div>
  </header>;
}

/** One calm card for states without data (unpaired, unavailable, link results). */
export function StateCard({ title, children, icon = "phone" }: { title: string; children: ReactNode; icon?: "phone" | "mail" | "lock" | "photo" }) {
  return <section className="ha-card ha-state">
    <span className="ha-state-icon"><Icon name={icon} size={22}/></span>
    <h1>{title}</h1>
    {children}
  </section>;
}

export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <main className={narrow ? "ha-page is-narrow" : "ha-page"}>{children}</main>;
}
