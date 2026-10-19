import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("privacy, terms and support describe the Honto app (App Review)", () => {
  const layout = read("app/legal-pages.tsx");
  assert.match(layout, /legalEmail = "support@hontogame\.com"/);
  for (const href of ["/privacy", "/terms", "/support"]) assert.ok(layout.includes(`href="${href}"`), href);
  const privacy = read("app/privacy/page.tsx");
  for (const topic of [/Sign in with Apple/, /Cloudflare R2/, /WeatherKit/, /never receive or store your location/, /RevenueCat/, /Resend/, /APNs/, /Delete account/, /under 13/, /do not sell/i, /do not show ads/i]) assert.match(privacy, topic);
  const terms = read("app/terms/page.tsx");
  for (const topic of [/auto-renewable/, /24 hours/, /Restore purchases/, /under 13/, /Stripe/]) assert.match(terms, topic);
  const support = read("app/support/page.tsx");
  for (const topic of [/pair/i, /Delete account/, /Restore purchases/, /Cancel Subscription/]) assert.match(support, topic);
  for (const [name, text] of [["privacy", privacy], ["terms", terms], ["support", support]]) {
    assert.doesNotMatch(text, /not intended for minors|alcohol|menezesofrete|Fraunces/i, name);
    assert.match(text, /<LegalLayout app /, `${name} uses the app style`);
  }
});

