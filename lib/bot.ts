import { START_SQUARES } from "./board";
import { BROKER_FEE_PER_SHARE, START_FEE, canRoll, mustGoToMarket, totalShares, type Action, type GameState } from "./engine";
import { MARKET_MAX, STOCK_ORDER, lowestPrice } from "./stocks";

/** What a computer player wants to do next. `roll` is handled by the UI so the dice animate. */
export type BotMove = Action | { type: "rollDice" };

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// Doctor (4/10) and Deep Sea Diver (3/11) pay the most per throw on average.
const BEST_CAREERS = [2, 3];

/** Sell everything once the slider is this high. */
const SELL_LEVEL = Math.round(MARKET_MAX * 0.76);

/** Fraction of spare cash a bot will spend, by how cheap the market is. */
function appetite(level: number): number {
  const r = level / MARKET_MAX;
  if (r <= 0.3) return 0.9;
  if (r <= 0.5) return 0.6;
  if (r <= 0.7) return 0.3;
  return 0;
}

export function botMove(state: GameState): BotMove | null {
  const ph = state.phase;
  const p = state.players[state.current];

  switch (ph.t) {
    case "preRoll": {
      if (p.status === "work") {
        if (p.career === null) return { type: "setCareer", career: pick(BEST_CAREERS) };
        if (mustGoToMarket(p)) return { type: "goToMarket", start: pick(START_SQUARES) };
        return { type: "rollDice" };
      }
      if (state.market >= SELL_LEVEL) {
        const held = STOCK_ORDER.find((id) => p.shares[id] > 0);
        if (held) return { type: "sell", stock: held, qty: p.shares[held] };
      }
      return canRoll(state) ? { type: "rollDice" } : null;
    }
    case "detour":
      return { type: "detour", enter: true };
    case "buy": {
      // Keep enough back for a START fee and a broker fee on everything held.
      const reserve = START_FEE + BROKER_FEE_PER_SHARE * totalShares(p);
      const unit = ph.price + BROKER_FEE_PER_SHARE;
      if (ph.limited) return { type: "buy", qty: p.cash - ph.price >= reserve ? 1 : 0 };
      const budget = Math.max(0, p.cash - reserve) * appetite(state.market);
      return { type: "buy", qty: Math.min(ph.max, Math.floor(budget / unit)) };
    }
    case "raiseCash": {
      const short = ph.owed - p.cash;
      const held = STOCK_ORDER.filter((id) => p.shares[id] > 0).sort(
        (a, b) => p.shares[b] * lowestPrice(b) - p.shares[a] * lowestPrice(a),
      );
      if (held.length === 0) return { type: "goBroke" };
      const id = held[0];
      return { type: "forcedSell", stock: id, qty: Math.min(p.shares[id], Math.ceil(short / lowestPrice(id))) };
    }
    default:
      return null;
  }
}
