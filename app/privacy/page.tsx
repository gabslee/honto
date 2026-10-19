import type { Metadata } from "next";
import { LegalLayout, LegalSection, legalEmail } from "../legal-pages";

export const metadata: Metadata = { title: "Privacy Policy | Honto", description: "How the Honto app for long-distance couples collects, uses and deletes your information." };

const mail = <a href={`mailto:${legalEmail}`}>{legalEmail}</a>;

export default function PrivacyPage() {
  return <LegalLayout app eyebrow="HONTO · PRIVACY" title="Privacy Policy">
    <p>This Privacy Policy explains what information Honto collects, how it is used and shared, and how you can delete it. It covers the Honto app for iPhone, its widgets, and the hontogame.com website.</p>
    <p>Short version: Honto exists to connect you with one partner. What you share in the app is seen by your partner and by no one else. We do not show ads, we do not sell or rent personal information, we do not track you across other apps or websites, and the app contains no third-party analytics or advertising tools.</p>

    <LegalSection title="Who we are">
      <p>Honto is operated by Gabriel Menezes dos Anjos as an independent project. For any privacy question or request, contact {mail}.</p>
    </LegalSection>

    <LegalSection title="Information we collect">
      <h3>Account</h3>
      <p>When you sign in with Apple, Google or your email address, we receive your email address (for Sign in with Apple this can be a private relay address), the name you choose to share, and an identifier from Apple or Google that links your account to that sign-in method. Email sign-in sends you a one-time link and 6-digit code; we store only a hashed version of them.</p>
      <h3>Your couple</h3>
      <p>When you pair with your partner we store the pairing, and any details you add: the date your relationship started and your next reunion (date, time, city and time zone). We store your device time zone so both of you see the right local times and day counters.</p>
      <h3>Photos</h3>
      <p>Photos you take or choose in the app are compressed on your device and uploaded with a small thumbnail, their size and the local day they were taken. They are kept in a private Cloudflare R2 storage bucket that is not publicly accessible and are shown only to you and your partner through short-lived signed links.</p>
      <h3>Calendar (optional)</h3>
      <p>If you allow calendar access, the app reads your calendar on your device and uploads only the times you are busy for the next 14 days, so your partner can see when you are free. All-day events are never uploaded. Event titles are uploaded only if your couple has Premium and you turn on title sharing for a specific calendar, and never for events your device marks as private. Busy times are deleted one day after they end.</p>
      <h3>Weather (optional)</h3>
      <p>If you allow location access, the app uses your approximate location on your device to ask Apple WeatherKit for the local weather. Only a short summary is sent to our servers: the condition (for example rain), the temperature, whether it is day or night, and when it was observed. We never receive or store your location, coordinates or place name. Turning location off clears your weather summary.</p>
      <h3>Notifications and widgets</h3>
      <p>If you allow notifications, we store the push tokens Apple gives your device and widgets, plus your app version, operating system version and language, to deliver notifications such as a new photo from your partner or a Thinking of you nudge. We also store the nudges you send and the milestones and streaks of your couple.</p>
      <h3>Subscriptions</h3>
      <p>If you subscribe to Honto Premium in the app, Apple processes the payment. We receive the subscription status (product, trial or paid period, renewal and expiry dates) through RevenueCat. We never receive your card or bank details.</p>
      <h3>Security information</h3>
      <p>To prevent abuse we apply rate limits using your IP address, which we keep only as a salted one-way hash. Our hosting provider keeps standard server logs for a short time.</p>
    </LegalSection>

    <LegalSection title="How we use information">
      <p>We use this information only to run Honto: to sign you in, pair you with your partner, show your shared photos, calendar, weather and dates, send the notifications you allowed, keep widgets up to date, provide Premium features, prevent abuse and answer support requests. We do not use your content for advertising or to train AI models.</p>
    </LegalSection>

    <LegalSection title="What your partner sees">
      <p>Your paired partner sees your name, time zone and local time, the photos you share, your busy times (and titles only where you turned them on), your weather summary, your nudges and the couple dates either of you set. When you unpair, your partner immediately stops seeing all of it.</p>
    </LegalSection>

    <LegalSection title="Service providers">
      <p>We share information only with providers that help us run Honto, and only as needed for that purpose:</p>
      <ul>
        <li>Apple: Sign in with Apple, push notifications (APNs), WeatherKit (requested from your device) and App Store payments.</li>
        <li>Google: Google Sign-In, if you choose it.</li>
        <li>RevenueCat: subscription status for in-app purchases.</li>
        <li>Resend: delivery of sign-in emails.</li>
        <li>Vercel: hosting of our servers and website.</li>
        <li>Neon: our database.</li>
        <li>Cloudflare: R2 storage for app photos and photo exports (private bucket), domain name services, email forwarding for our support address and scheduled maintenance jobs.</li>
      </ul>
      <p>We may also disclose information if required by law or to protect the safety of users.</p>
    </LegalSection>

    <LegalSection title="The hontogame.com website">
      <p>The party game on hontogame.com can be played without an account. If you sign in on the website, we receive your Google or Apple account name and email address. Web Premium purchases are processed by Stripe, which stores your payment details; we receive only the subscription status and billing identifiers. If you use an AI suggestion feature on the website, the text you submit is sent to OpenAI to generate the suggestion. Photo moments shared through the older web version are stored with Vercel Blob.</p>
    </LegalSection>

    <LegalSection title="How long we keep information">
      <ul>
        <li>Your account and content: until you delete your account.</li>
        <li>After unpairing: shared history (reunion, calendar, nudges) is removed at once. Each partner keeps their own photos, read-only and exportable, for 30 days, after which they are permanently deleted.</li>
        <li>Photo exports: deleted 7 days after they are created.</li>
        <li>Sign-in links and codes: expire after 15 minutes.</li>
        <li>Calendar busy times: deleted one day after they end.</li>
      </ul>
    </LegalSection>

    <LegalSection title="Deleting your account" id="delete">
      <p>You can delete your account at any time in the app (Settings, Delete account) or by emailing {mail} from the address you sign in with.</p>
      <p>Deletion is immediate and permanent. We delete your account, your sign-in methods, sessions and devices, your photos and photo exports (including the files in storage), your calendar data, weather summary, nudges and pairing codes. If you are paired, your partner keeps their own account and is unpaired; they keep their own photos for 30 days as described above.</p>
      <p>Deleting your account does not cancel an App Store subscription. Cancel it in your iPhone Settings, under your name, then Subscriptions. Limited purchase records may be kept where the law requires it for accounting or fraud prevention.</p>
    </LegalSection>

    <LegalSection title="Your rights">
      <p>Depending on where you live (for example under the GDPR or Brazil’s LGPD), you may have the right to access, correct, export or delete your information, and to object to or restrict some uses. You can do most of this in the app; for anything else, email {mail} and we will reply within 30 days.</p>
    </LegalSection>

    <LegalSection title="Security and transfers">
      <p>Information is encrypted in transit, photos are kept in a private Cloudflare R2 bucket, and session tokens, sign-in codes and IP addresses are stored only as hashes. Our providers may process information in the United States and other countries, with safeguards required by applicable law.</p>
    </LegalSection>

    <LegalSection title="Children">
      <p>Honto is a general audience app and is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has given us information, contact {mail} and we will delete it.</p>
    </LegalSection>

    <LegalSection title="Changes">
      <p>We will post any update to this Policy on this page with a new date.</p>
    </LegalSection>
  </LegalLayout>;
}
