import type { Metadata, Viewport } from "next";
import "@/games/plunder/styles.css";

// Plunder's own root layout: its own <html>, metadata and styles, nothing shared with other games.
export const metadata: Metadata = {
  title: "Plunder",
  description: "A pirate board game.",
  appleWebApp: { capable: true, title: "Plunder", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#14202b",
};

export default function PlunderLayout({ children }: LayoutProps<"/plunder">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
