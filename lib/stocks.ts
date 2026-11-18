// Placeholder companies for development. Each maps to one of the companies on
// the playtest board; swap names/colors here once real licensing is sorted.

export type StockId =
  | "ALUM"
  | "AMMO"
  | "GRAIN"
  | "SOLE"
  | "CRATE"
  | "SPIN"
  | "PRESS"
  | "WOOL";

export interface Stock {
  id: StockId;
  name: string;
  /** Short label that fits on a board square. */
  short: string;
  color: string;
  /** Text color that reads on `color`. */
  ink: string;
  /** Price when the market slider is at MARKET_START. */
  base: number;
  /** Price change per market level. */
  step: number;
}

export const STOCKS: Record<StockId, Stock> = {
  ALUM: { id: "ALUM", name: "Alumicorp", short: "ALUMI\u00ADCORP", color: "#e8343f", ink: "#fff", base: 110, step: 2 },
  AMMO: { id: "AMMO", name: "Amerimotive", short: "AMERI\u00ADMOTIVE", color: "#f7d43a", ink: "#2a2200", base: 100, step: 2 },
  GRAIN: { id: "GRAIN", name: "General Grains", short: "GEN. GRAINS", color: "#2ec4d6", ink: "#062a30", base: 40, step: 0.5 },
  SOLE: { id: "SOLE", name: "Intl. Sole", short: "INTL. SOLE", color: "#ee2f8a", ink: "#fff", base: 50, step: 1 },
  CRATE: { id: "CRATE", name: "J.T. Crate", short: "J.T. CRATE", color: "#f5a524", ink: "#2b1800", base: 70, step: 1 },
  SPIN: { id: "SPIN", name: "Spintag", short: "SPINTAG", color: "#1f9e6e", ink: "#fff", base: 60, step: 1 },
  PRESS: { id: "PRESS", name: "Westward Press", short: "WESTWARD PRESS", color: "#8cc63f", ink: "#13260a", base: 80, step: 1.5 },
  WOOL: { id: "WOOL", name: "Woolmart", short: "WOOL\u00ADMART", color: "#ff5b2e", ink: "#fff", base: 90, step: 2 },
};

/** Order of rows on the price tracker. */
export const STOCK_ORDER: StockId[] = ["ALUM", "AMMO", "GRAIN", "SOLE", "CRATE", "SPIN", "PRESS", "WOOL"];

export const MARKET_MIN = 0;
export const MARKET_MAX = 72;
export const MARKET_START = 36;

export function priceAt(stock: StockId, level: number): number {
  const s = STOCKS[stock];
  return Math.floor(s.base + s.step * (level - MARKET_START));
}

export function clampMarket(level: number): number {
  return Math.max(MARKET_MIN, Math.min(MARKET_MAX, level));
}
