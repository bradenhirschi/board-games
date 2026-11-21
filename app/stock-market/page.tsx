import type { Metadata } from "next";
import Home from "@/games/stock-market/components/Home";

export const metadata: Metadata = {
  title: "Stock Market",
  description: "A stock market board game.",
};

export default function StockMarketPage() {
  return <Home />;
}
