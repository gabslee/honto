import type { Me } from "../../contracts/honto-api";
import { Hanko, Icon } from "./icons";
import { SignOutButton } from "./sign-out-button";
import { formatCalendarDate, initial, premiumSummary } from "./web-app-model.js";

export type SettingsPageView = { kind: "signed-out" } | { kind: "unavailable"; message: string } | { kind: "ready"; me: Me };

/** Settings (minimal, read-only): account, Premium status, couple, sign out. */
export function SettingsView({ me }: { me: Me }) {
  const premium = premiumSummary(me.entitlement);
  const partner = me.couple?.partner ?? null;
  return <div className="ha-settings">
    <section className="ha-card ha-setting" aria-labelledby="ha-account-title">
      <h2 id="ha-account-title" className="ha-caption">Account</h2>
      <div className="ha-row"><span className="ha-avatar me" aria-hidden="true">{initial(me.user.displayName)}</span><div><strong>{me.user.displayName}</strong><span className="ha-muted">{me.user.email}</span></div></div>
    </section>
    <section className="ha-card ha-setting" aria-labelledby="ha-premium-title">
      <h2 id="ha-premium-title" className="ha-caption">Premium</h2>
      <div className="ha-row">{premium.active ? <Hanko size={36}/> : <span className="ha-avatar is-plain" aria-hidden="true"><Icon name="lock" size={18}/></span>}<div><strong>{premium.label}</strong><span className="ha-muted">{premium.detail}</span></div></div>
    </section>
    <section className="ha-card ha-setting" aria-labelledby="ha-couple-title">
      <h2 id="ha-couple-title" className="ha-caption">Couple</h2>
      {partner && me.couple
        ? <div className="ha-row"><span className="ha-avatar partner" aria-hidden="true">{initial(partner.displayName)}</span><div><strong>{partner.displayName}</strong><span className="ha-muted">Paired since {formatCalendarDate(me.couple.pairedAt.slice(0, 10))}</span></div></div>
        : <p className="ha-muted">Not paired yet. Invite your partner from the Honto app.</p>}
    </section>
    <div className="ha-signout"><SignOutButton/><p className="ha-footnote">Changes to your account, couple and subscription are made in the app.</p></div>
  </div>;
}
