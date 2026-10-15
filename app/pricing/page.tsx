import { headers } from "next/headers";
import PricingClient from "./pricing-client";
import { currencyForCountry } from "../pricing-config.js";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const currency = currencyForCountry((await headers()).get("x-vercel-ip-country"));
  return <PricingClient currency={currency} />;
}
