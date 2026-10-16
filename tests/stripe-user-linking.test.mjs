import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripeEventUserId } from "../app/stripe-event.js";

test("webhook resolves user from metadata, subscription metadata, then client_reference_id", () => {
  assert.equal(stripeEventUserId({ metadata: { user_id: "u1" }, client_reference_id: "u2" }), "u1");
  assert.equal(stripeEventUserId({ metadata: {}, subscription_details: { metadata: { user_id: "u3" } } }), "u3");
  assert.equal(stripeEventUserId({ metadata: {}, client_reference_id: "u2" }), "u2");
  assert.equal(stripeEventUserId({}), "");
});

test("checkout always tags the session and subscription with the user id", async () => {
  const route = await readFile(new URL("../app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  for (const key of ["client_reference_id: user.id", '"metadata[user_id]": user.id', '"subscription_data[metadata][user_id]": user.id']) assert.ok(route.includes(key), key);
});

test("webhook persists the Stripe customer when the user is resolved, with typed SQL params", async () => {
  const route = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  assert.match(route, /stripeEventUserId\(object\)/);
  assert.match(route, /linkStripeCustomer\(userId, customerId, subscriptionId\)/);
  const stripe = await readFile(new URL("../app/stripe.ts", import.meta.url), "utf8");
  assert.match(stripe, /\$\{customerId\}::text IS NOT NULL/);
});
