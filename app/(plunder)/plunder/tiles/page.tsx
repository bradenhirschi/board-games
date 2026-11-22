import type { Metadata } from "next";
import TileSheet from "@/games/plunder/components/TileSheet";

export const metadata: Metadata = { title: "Plunder tiles" };

export default function Page() {
  return <TileSheet />;
}
