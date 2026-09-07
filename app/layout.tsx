import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getMessages } from "./i18n";

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export async function generateMetadata(): Promise<Metadata> {
  const t = getMessages();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;
  return {
    title: t.meta.title,
    description: t.meta.description,
    openGraph: { title: "HONTO?!", description: t.meta.socialDescription, images: [socialImage] },
    twitter: { card: "summary_large_image", title: "HONTO?!", description: t.meta.socialDescription, images: [socialImage] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
