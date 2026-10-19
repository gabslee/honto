import { headers } from "next/headers";
import { LegalLayout, LegalSection, legalEmail } from "../legal-pages";
import { currencyForCountry } from "../pricing-config.js";

export const dynamic = "force-dynamic";

// One currency per visitor, same rule as the landing, /pricing and checkout (Vercel IP country).
const PLANS = {
  BRL: { intro: "Prices are in Brazilian reais (BRL), based on the country you are visiting from. Payment is by card; Pix is not available yet.", line: "R$14,90 per month or R$99 per year (saves R$79,80 per year)." },
  USD: { intro: "Prices are in US dollars (USD), based on the country you are visiting from. Payment is by card.", line: "US$4.99 per month or US$29.99 per year (saves US$29.89 per year)." },
} as const;

export default async function SubscriptionsPage() {
  const plan = PLANS[currencyForCountry((await headers()).get("x-vercel-ip-country"))];
  return <LegalLayout eyebrow="HONTO · PREMIUM" title="Subscriptions"><p>Honto Premium is an optional recurring subscription for players who want more customization, AI suggestions and premium content.</p><LegalSection title="Plans and prices"><p>{plan.intro}</p><ul><li>{plan.line}</li></ul><p>The price, currency and applicable taxes are shown again on Stripe Checkout before you confirm.</p></LegalSection><LegalSection title="Seven-day trial"><p>Eligible accounts may start one seven-day Premium trial. The trial is available once per account and may end or be unavailable if abuse is detected. The trial currently does not require a payment method.</p></LegalSection><LegalSection title="Renewal and cancellation"><p>After a paid subscription begins, it renews automatically at the selected interval until canceled. You can cancel through the Stripe customer portal. Cancellation stops future renewals; access remains available according to the subscription status shown at cancellation.</p></LegalSection><LegalSection title="Refunds and legal rights"><p>Refunds are handled according to applicable law and the circumstances of the request. Contact <a href={`mailto:${legalEmail}`}>{legalEmail}</a> with your account email and transaction details. Nothing on this page limits mandatory consumer rights.</p></LegalSection><LegalSection title="Payment processing"><p>Stripe processes payments and stores payment information. Honto receives subscription status and limited billing identifiers needed to provide Premium access.</p></LegalSection><LegalSection title="Changes"><p>We may change plans or prices for future purchases. Existing subscriptions will be handled according to applicable law and any notice required by the payment provider.</p></LegalSection></LegalLayout>;
}
