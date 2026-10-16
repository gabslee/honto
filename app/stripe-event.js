/** Resolve the Honto user id carried by a Stripe event object: metadata.user_id, then subscription metadata, then client_reference_id. */
export function stripeEventUserId(object) {
  const value = object?.metadata?.user_id || object?.subscription_details?.metadata?.user_id || object?.client_reference_id || "";
  return String(value);
}
