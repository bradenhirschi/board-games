// Placeholder companies for development. Each maps to one of the companies on
// the playtest board; swap names/colors here once real licensing is sorted.

export type StockId = "ALUM" | "AMMO" | "GRAIN" | "SOLE" | "CRATE" | "SPIN" | "PRESS" | "WOOL";

export interface Stock {
  id: StockId;
  name: string;
  /** Short label that fits on a board square (­ = optional hyphen). */
  short: string;
  color: string;
  /** Text color that reads on `color`. */
  ink: string;
  /** Price at the bottom of the quotation board (also the forced-sale price). */
  low: number;
  /** Price at the top of the quotation board. */
  high: number;
}

/*
 * Quotation board rows. The low/high ends were read from the playtest board
 * photo where legible (real company in comments); prices in between are
 * interpolated in a straight line. Replace with the exact rows when available.
 */
export const STOCKS: Record<StockId, Stock> = {
  ALUM: { id: "ALUM", name: "Alumicorp", short: "ALUMI­CORP", color: "#e8343f", ink: "#fff", low: 20, high: 120 }, // Alcoa
  AMMO: { id: "AMMO", name: "Amerimotive", short: "AMERI­MOTIVE", color: "#f7d43a", ink: "#2a2200", low: 10, high: 110 }, // American Motors
  GRAIN: { id: "GRAIN", name: "General Grains", short: "GEN. GRAINS", color: "#2ec4d6", ink: "#062a30", low: 18, high: 43 }, // General Mills
  SOLE: { id: "SOLE", name: "Intl. Sole", short: "INTL. SOLE", color: "#ee2f8a", ink: "#fff", low: 10, high: 60 }, // International Shoe
  CRATE: { id: "CRATE", name: "J.T. Crate", short: "J.T. CRATE", color: "#f5a524", ink: "#2b1800", low: 15, high: 75 }, // J.I. Case
  SPIN: { id: "SPIN", name: "Spintag", short: "SPINTAG", color: "#1f9e6e", ink: "#fff", low: 15, high: 75 }, // Maytag
  PRESS: { id: "PRESS", name: "Westward Press", short: "WESTWARD PRESS", color: "#8cc63f", ink: "#13260a", low: 10, high: 110 }, // Western Publishing
  WOOL: { id: "WOOL", name: "Woolmart", short: "WOOL­MART", color: "#ff5b2e", ink: "#fff", low: 30, high: 130 }, // Woolworth
};

/** Order of rows on the price tracker. */
export const STOCK_ORDER: StockId[] = ["ALUM", "AMMO", "GRAIN", "SOLE", "CRATE", "SPIN", "PRESS", "WOOL"];

export const MARKET_MIN = 0;
export const MARKET_MAX = 50;
/** The slider starts in the middle of the quotation board. */
export const MARKET_START = 25;

export function priceAt(stock: StockId, level: number): number {
  const s = STOCKS[stock];
  return Math.round(s.low + ((s.high - s.low) * (level - MARKET_MIN)) / (MARKET_MAX - MARKET_MIN));
}

/** Price for a forced sale: the lowest price on the board for that stock. */
export function lowestPrice(stock: StockId): number {
  return priceAt(stock, MARKET_MIN);
}

/**
 * Move the slider. If it hits the top or bottom of the board the direction of
 * counting reverses and the remaining spaces are counted the other way.
 */
export function moveMarket(level: number, delta: number): number {
  let l = level + delta;
  while (l > MARKET_MAX || l < MARKET_MIN) {
    if (l > MARKET_MAX) l = 2 * MARKET_MAX - l;
    if (l < MARKET_MIN) l = 2 * MARKET_MIN - l;
  }
  return l;
}
