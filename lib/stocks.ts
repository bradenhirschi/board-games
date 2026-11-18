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
  /** Lowest price on the quotation board (also the forced-sale price). */
  low: number;
  /** Highest price on the quotation board. */
  high: number;
  /**
   * Stocks come in four pairs that share one price ladder, inverted: when the
   * slider goes up one of the pair rises and the other falls by the same steps.
   */
  inverted: boolean;
  /** The other stock in this stock's pair. */
  pair: StockId;
}

/*
 * Quotation board rows. The ends of each ladder were read from the playtest
 * board photo (real company in comments); prices in between are interpolated
 * in a straight line. Replace with the exact rows when available.
 */
const ladder = (low: number, high: number) => ({ low, high });
const ALUM_WOOL = ladder(20, 120);
const AMMO_PRESS = ladder(10, 110);
const CRATE_SPIN = ladder(15, 75);
const GRAIN_SOLE = ladder(18, 43);

export const STOCKS: Record<StockId, Stock> = {
  ALUM: { id: "ALUM", name: "Alumicorp", short: "ALUMI\u00ADCORP", color: "#e8343f", ink: "#fff", ...ALUM_WOOL, inverted: false, pair: "WOOL" }, // Alcoa
  WOOL: { id: "WOOL", name: "Woolmart", short: "WOOL\u00ADMART", color: "#ff5b2e", ink: "#fff", ...ALUM_WOOL, inverted: true, pair: "ALUM" }, // Woolworth
  AMMO: { id: "AMMO", name: "Amerimotive", short: "AMERI\u00ADMOTIVE", color: "#f7d43a", ink: "#2a2200", ...AMMO_PRESS, inverted: false, pair: "PRESS" }, // American Motors
  PRESS: { id: "PRESS", name: "Westward Press", short: "WESTWARD PRESS", color: "#8cc63f", ink: "#13260a", ...AMMO_PRESS, inverted: true, pair: "AMMO" }, // Western Publishing
  CRATE: { id: "CRATE", name: "J.T. Crate", short: "J.T. CRATE", color: "#f5a524", ink: "#2b1800", ...CRATE_SPIN, inverted: false, pair: "SPIN" }, // J.I. Case
  SPIN: { id: "SPIN", name: "Spintag", short: "SPINTAG", color: "#1f9e6e", ink: "#fff", ...CRATE_SPIN, inverted: true, pair: "CRATE" }, // Maytag
  GRAIN: { id: "GRAIN", name: "General Grains", short: "GEN. GRAINS", color: "#2ec4d6", ink: "#062a30", ...GRAIN_SOLE, inverted: false, pair: "SOLE" }, // General Mills
  SOLE: { id: "SOLE", name: "Intl. Sole", short: "INTL. SOLE", color: "#ee2f8a", ink: "#fff", ...GRAIN_SOLE, inverted: true, pair: "GRAIN" }, // International Shoe
};

/** Order of rows on the price tracker: each pair sits together. */
export const STOCK_ORDER: StockId[] = ["ALUM", "WOOL", "AMMO", "PRESS", "CRATE", "SPIN", "GRAIN", "SOLE"];

export const MARKET_MIN = 0;
export const MARKET_MAX = 50;
/** The slider starts in the middle of the quotation board. */
export const MARKET_START = 25;

export function priceAt(stock: StockId, level: number): number {
  const s = STOCKS[stock];
  const span = MARKET_MAX - MARKET_MIN;
  const step = s.inverted ? MARKET_MAX - level : level - MARKET_MIN;
  return Math.round(s.low + ((s.high - s.low) * step) / span);
}

/** Price for a forced sale: the lowest price on the board for that stock. */
export function lowestPrice(stock: StockId): number {
  return STOCKS[stock].low;
}

/** 0 when the stock is at its cheapest on the board, 1 at its most expensive. */
export function pricePosition(stock: StockId, level: number): number {
  const s = STOCKS[stock];
  return (priceAt(stock, level) - s.low) / (s.high - s.low);
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
