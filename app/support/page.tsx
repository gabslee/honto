import type { Metadata } from "next";
import { LegalLayout, LegalSection, legalEmail } from "../legal-pages";

export const metadata: Metadata = { title: "Support | Honto", description: "Help with pairing, subscriptions and your Honto account." };

const mail = <a href={`mailto:${legalEmail}`}>{legalEmail}</a>;

export default function SupportPage() {
  return <LegalLayout app eyebrow="HONTO · SUPPORT" title="Support">
    <p>Need help with Honto? Write to {mail}. We usually answer within two business days. Please include the email you sign in with and, if something went wrong, what you were doing when it happened.</p>

    <LegalSection title="How do I pair with my partner?">
      <p>One of you creates an invite in the app and sends the 6-character code or the link. The other opens the link, or signs in and types the code. A code works once and expires after 48 hours; you can create a new one at any time. Each account can be paired with one partner at a time.</p>
    </LegalSection>

    <LegalSection title="The sign-in email did not arrive">
      <p>Check your spam or promotions folder. The link and the 6-digit code expire after 15 minutes and work once. You can ask for a new email after 60 seconds. You can also sign in with Apple or Google.</p>
    </LegalSection>

    <LegalSection title="How do I unpair?">
      <p>Open Settings in the app and choose Unpair. Your shared history disappears for both of you right away. Each of you keeps your own photos, read-only and exportable, for 30 days.</p>
    </LegalSection>

    <LegalSection title="How do I delete my account?">
      <p>Open Settings in the app and choose Delete account. This permanently deletes your account, photos and other data right away. If you are paired, your partner keeps their account and is unpaired. You can also email {mail} from the address you sign in with. Details are in the <a href="/privacy#delete">Privacy Policy</a>.</p>
    </LegalSection>

    <LegalSection title="How do I restore my purchase?">
      <p>Sign in to the App Store with the same Apple ID you used to subscribe, open the Honto Premium screen in the app and tap Restore purchases.</p>
    </LegalSection>

    <LegalSection title="How do I cancel my subscription?">
      <p>Subscriptions bought in the app are managed by Apple. On your iPhone, open Settings, tap your name, then Subscriptions, choose Honto and tap Cancel Subscription. Cancel at least 24 hours before the renewal date to avoid the next charge. Deleting the app or your account does not cancel the subscription. For refunds, use reportaproblem.apple.com.</p>
      <p>Premium bought on hontogame.com is managed separately, from your account page on the website.</p>
    </LegalSection>

    <LegalSection title="Privacy and terms">
      <p>Read the <a href="/privacy">Privacy Policy</a> and the <a href="/terms">Terms of Use</a>.</p>
    </LegalSection>
  </LegalLayout>;
}
