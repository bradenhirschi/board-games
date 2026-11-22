import type { Metadata, Viewport } from "next";
import "@/games/stock-market/styles.css";

export const metadata: Metadata = {
  title: "Stock Market",
  description: "A stock market board game.",
  // Pinned to an iPhone Home Screen, open full screen like an app (no browser bars).
  appleWebApp: { capable: true, title: "Stock Market", statusBarStyle: "default" },
  other: {
    // Ask Dark Reader-based night modes (used by some browsers) not to recolor the board.
    "darkreader-lock": "true",
    // Older iOS versions only look for this tag.
    "apple-mobile-web-app-capable": "yes",
  },
};

// The board is designed for light colors only; tell browsers not to auto-darken it.
export const viewport: Viewport = {
  colorScheme: "only light",
  themeColor: "#f6f4ea",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
