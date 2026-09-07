import type { Metadata } from "next";
import GameClient from "./game-client";
import { getMessages } from "./i18n";

const t = getMessages();

export const metadata: Metadata = {
  title: t.meta.title,
  description: t.meta.description,
};

export default function Home() {
  return <GameClient />;
}
