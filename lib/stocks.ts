// Placeholder companies for development. Each maps to one of the companies on
// the playtest board; swap names/colors here once real licensing is sorted.

export type StockId = "ALUM" | "AMMO" | "GRAIN" | "SOLE" | "CRATE" | "SPIN" | "PRESS" | "WOOL";

export interface Stock {
  id: StockId;
  name: string;
  /** Short label that fits on a board square (\u00AD = optional hyphen). */
  short: string;
  color: string;
  /** Text color that reads on `color`. */
  ink: string;
  /**
   * Price at each slider position (index 0 = far "DOWN" end, 50 = far "UP" end).
   * Stocks come in four pairs that share one ladder, inverted: when the slider
   * goes up one of the pair rises and the other falls by the same steps.
   */
  ladder: readonly number[];
  /** The other stock in this stock's pair. */
  pair: StockId;
}

/*
 * Quotation board rows, copied from the playtest board (real company in comments).
 * Each is listed from the DOWN end of the board to the UP end; its partner uses the
 * same row reversed.
 */
// prettier-ignore
const ALUM_WOOL = [
  30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 90, 94, 98, 102, 106, 110, 114, 118, 122, 126,
  130, 134, 138, 142, 146, 150, 154, 158, 162, 166, 170, 174, 178, 182, 186, 190, 194, 198, 202, 206, 210, 214, 218, 222, 226, 230,
];
// prettier-ignore
const AMMO_PRESS = [
  10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58,
  60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110,
];
// prettier-ignore
const CRATE_SPIN = [
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43,
  45, 47, 49, 51, 53, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
];
// prettier-ignore
const GRAIN_SOLE = [
  18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 30,
  30, 30, 31, 31, 32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37, 38, 38, 39, 39, 40, 40, 41, 41, 42, 42,
];
const up = (row: number[]) => row;
const down = (row: number[]) => [...row].reverse();

export const STOCKS: Record<StockId, Stock> = {
  ALUM: { id: "ALUM", name: "Alumicorp", short: "ALUMI\u00ADCORP", color: "#e8343f", ink: "#fff", ladder: up(ALUM_WOOL), pair: "WOOL" }, // Alcoa
  WOOL: { id: "WOOL", name: "Woolmart", short: "WOOL\u00ADMART", color: "#ff5b2e", ink: "#fff", ladder: down(ALUM_WOOL), pair: "ALUM" }, // Woolworth
  AMMO: { id: "AMMO", name: "Amerimotive", short: "AMERI\u00ADMOTIVE", color: "#f7d43a", ink: "#2a2200", ladder: up(AMMO_PRESS), pair: "PRESS" }, // American Motors
  PRESS: { id: "PRESS", name: "Westward Press", short: "WESTWARD PRESS", color: "#8cc63f", ink: "#13260a", ladder: down(AMMO_PRESS), pair: "AMMO" }, // Western Publishing
  CRATE: { id: "CRATE", name: "J.T. Crate", short: "J.T. CRATE", color: "#f5a524", ink: "#2b1800", ladder: up(CRATE_SPIN), pair: "SPIN" }, // J.I. Case
  SPIN: { id: "SPIN", name: "Spintag", short: "SPINTAG", color: "#1f9e6e", ink: "#fff", ladder: down(CRATE_SPIN), pair: "CRATE" }, // Maytag
  GRAIN: { id: "GRAIN", name: "General Grains", short: "GEN. GRAINS", color: "#2ec4d6", ink: "#062a30", ladder: up(GRAIN_SOLE), pair: "SOLE" }, // General Mills
  SOLE: { id: "SOLE", name: "Intl. Sole", short: "INTL. SOLE", color: "#ee2f8a", ink: "#fff", ladder: down(GRAIN_SOLE), pair: "GRAIN" }, // International Shoe
};

/** Order of rows on the price tracker: each pair sits together. */
export const STOCK_ORDER: StockId[] = ["ALUM", "WOOL", "AMMO", "PRESS", "CRATE", "SPIN", "GRAIN", "SOLE"];

export const MARKET_MIN = 0;
export const MARKET_MAX = 50;
/** The slider starts in the middle of the quotation board. */
export const MARKET_START = 25;

export function priceAt(stock: StockId, level: number): number {
  return STOCKS[stock].ladder[level - MARKET_MIN];
}

/** Price for a forced sale: the lowest price on the board for that stock. */
export function lowestPrice(stock: StockId): number {
  return Math.min(...STOCKS[stock].ladder);
}

/** 0 when the stock is at its cheapest on the board, 1 at its most expensive. */
export function pricePosition(stock: StockId, level: number): number {
  const lo = lowestPrice(stock);
  const hi = Math.max(...STOCKS[stock].ladder);
  return (priceAt(stock, level) - lo) / (hi - lo);
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
