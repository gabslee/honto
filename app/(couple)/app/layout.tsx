import type { Metadata } from "next";
import "../../app-ui/tokens.css";
import "../../app-ui/web-app.css";

export const metadata: Metadata = {
  title: "Honto · Memories",
  description: "Your daily photos together, on the web.",
  robots: { index: false, follow: false },
};

export default function CoupleAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="ha-root">{children}</div>;
}
