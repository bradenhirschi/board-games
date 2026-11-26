import type { Metadata, Viewport } from "next";
import "./home.css";

// The game picker's own root layout. Each game has its own root layout (and its own Home Screen app).
export const metadata: Metadata = {
  title: "Board Games",
  description: "A collection of board games.",
  manifest: "/manifests/home.webmanifest",
  appleWebApp: { capable: true, title: "Board Games", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  colorScheme: "only light",
  themeColor: "#f4efe4",
};

export default function HomeLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
