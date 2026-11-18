import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stonks",
  description: "A stock market board game.",
  // Ask Dark Reader-based night modes (used by some browsers) not to recolor the board.
  other: { "darkreader-lock": "true" },
};

// The board is designed for light colors only; tell browsers not to auto-darken it.
export const viewport: Viewport = {
  colorScheme: "only light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
