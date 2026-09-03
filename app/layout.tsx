import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;
  return {
    title: "HONTO?! — Duas mentiras. Uma verdade.",
    description: "Um party game online para dois ou mais amigos.",
    openGraph: { title: "HONTO?!", description: "Duas mentiras. Uma verdade. Quem vai beber?", images: [socialImage] },
    twitter: { card: "summary_large_image", title: "HONTO?!", description: "Duas mentiras. Uma verdade.", images: [socialImage] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
