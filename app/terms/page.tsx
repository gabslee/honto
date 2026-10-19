import type { Metadata } from "next";
import { LegalLayout, LegalSection, legalEmail } from "../legal-pages";

export const metadata: Metadata = { title: "Terms of Use | Honto", description: "The terms for using the Honto app for long-distance couples and hontogame.com." };

const mail = <a href={`mailto:${legalEmail}`}>{legalEmail}</a>;

export default function TermsPage() {
  return <LegalLayout app eyebrow="HONTO · TERMS" title="Terms of Use">
    <p>These Terms of Use apply to the Honto app for iPhone, its widgets and the hontogame.com website (together, Honto). By using Honto you agree to them. If you do not agree, do not use Honto.</p>

    <LegalSection title="The service">
      <p>Honto helps two people in a long-distance relationship stay close: you pair with one partner and share photos, your local time and weather, when you are free, the countdown to your next reunion and small nudges. Honto is operated by Gabriel Menezes dos Anjos. Features may change as the product evolves.</p>
    </LegalSection>

    <LegalSection title="Who can use Honto">
      <p>Honto is a general audience service and is not directed to children under 13. You must be at least 13 years old, and if you are under the age of majority where you live, you need permission from a parent or guardian.</p>
    </LegalSection>

    <LegalSection title="Your account">
      <p>You sign in with Apple, Google or your email address. Keep access to that account secure; you are responsible for activity on your Honto account. You can delete your account at any time in the app (Settings, Delete account) or by writing to {mail}. See the <a href="/privacy#delete">Privacy Policy</a> for what is deleted.</p>
    </LegalSection>

    <LegalSection title="Pairing and your content">
      <p>Only pair with someone who wants to pair with you. You keep ownership of the photos and text you share. You give us permission to store them, process them (for example to create thumbnails) and show them to your paired partner, only to operate Honto.</p>
      <p>Do not share content that is illegal, that you do not have the right to share, that shows another person without their consent, that sexualizes minors, or that harasses, threatens or exploits anyone. We may remove content or suspend accounts that break these rules or put others at risk.</p>
    </LegalSection>

    <LegalSection title="Honto Premium in the app">
      <p>Some features, such as the shared calendar, need Honto Premium. Premium is an auto-renewable subscription sold through the Apple App Store, with monthly and annual options. The price, any free trial and the renewal period are shown in the app before you confirm. One subscription covers your couple.</p>
      <ul>
        <li>Payment is charged to your Apple ID when you confirm the purchase, or when a free trial ends.</li>
        <li>The subscription renews automatically unless it is canceled at least 24 hours before the end of the current period.</li>
        <li>Manage or cancel it in your iPhone Settings, under your name, then Subscriptions. Deleting the app or your account does not cancel it.</li>
        <li>If you subscribe during a free trial, any unused part of the trial ends when the paid subscription starts.</li>
        <li>Refunds are handled by Apple under its policies. Use Restore purchases in the app to recover a subscription on a new device.</li>
      </ul>
      <p>In-app purchases are also subject to the Apple Media Services Terms and, where no other agreement applies, Apple’s standard Licensed Application End User License Agreement.</p>
    </LegalSection>

    <LegalSection title="Purchases on hontogame.com">
      <p>The party game on hontogame.com offers its own Premium plan, paid through Stripe. Its prices, trial, renewal and cancellation rules are described on the <a href="/subscriptions">Web subscriptions page</a> and it is managed separately from App Store subscriptions. The web game has its own rules for respectful play, described on the <a href="/responsible-play">Responsible play page</a>.</p>
    </LegalSection>

    <LegalSection title="Acceptable use">
      <p>Do not misuse Honto: do not try to access other people’s accounts or data, interfere with or overload the service, reverse engineer it except where the law allows, or use it to send spam or malicious material.</p>
    </LegalSection>

    <LegalSection title="Availability and disclaimers">
      <p>We work to keep Honto available and your content safe, but Honto is provided as is and as available. Weather, local times and calendar information are for convenience and may be delayed or inaccurate. To the extent permitted by law, we are not liable for indirect or consequential losses, and our total liability is limited to the amount you paid for Honto in the 12 months before the claim. Nothing in these Terms limits rights you have under mandatory consumer law.</p>
    </LegalSection>

    <LegalSection title="Ending your use">
      <p>You can stop using Honto and delete your account at any time. We may suspend or end access for serious or repeated violations of these Terms, and will tell you why unless the law or safety prevents it.</p>
    </LegalSection>

    <LegalSection title="Changes and contact">
      <p>We may update these Terms as Honto evolves; the new version will be posted on this page with a new date. Continued use after an update means you accept it. Questions: {mail}.</p>
    </LegalSection>
  </LegalLayout>;
}
