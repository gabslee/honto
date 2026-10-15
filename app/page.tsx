import type { Metadata } from "next";
import { headers } from "next/headers";
import GameClient from "./game-client";
import { currencyForCountry } from "./pricing-config.js";
import { getMessages } from "./i18n";

const t = getMessages();

export const metadata: Metadata = {
  title: t.meta.title,
  description: t.meta.description,
};

export default async function Home() {
  const currency = currencyForCountry((await headers()).get("x-vercel-ip-country"));
  return <GameClient appleConfigured={Boolean(process.env.APPLE_CLIENT_ID)} currency={currency} />;
}
