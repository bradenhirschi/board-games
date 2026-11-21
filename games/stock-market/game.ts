import type { OnlineGame, Seat } from "@/platform/game";
import { DEFAULT_TARGET, MAX_PLAYERS, MIN_PLAYERS, newGame, type GameState } from "./engine";

export type StockMarketSettings = {
  /** Net worth that wins. */
  target: number;
};

/** Winning amounts the start screen and lobby offer. */
export const TARGETS = [25_000, 50_000, 100_000, 250_000];

/** Who may save the next move: the current player, or anyone seated (null) while occupations are chosen. */
export function seatUid(state: GameState, seats: Seat[]): string | null {
  if (state.phase.t === "chooseCareers") return null;
  return seats[state.current]?.uid ?? null;
}

/** Stock Market as the platform sees it (online rooms). */
export const STOCK_MARKET: OnlineGame<GameState, StockMarketSettings> = {
  id: "stock-market",
  name: "Stock Market",
  collection: "stockMarketRooms",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  defaultSettings: { target: DEFAULT_TARGET },
  newGame: (seats, settings) => newGame(seats, settings.target),
  writerUid: seatUid,
};
