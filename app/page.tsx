import type { Metadata } from "next";
import GameClient from "./game-client";

export const metadata: Metadata = {
  title: "HONTO?! — Duas mentiras. Uma verdade.",
  description: "O party game online para descobrir quem conhece quem de verdade.",
};

export default function Home() {
  return <GameClient />;
}
