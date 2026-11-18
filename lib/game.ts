import { START_SQUARES, TRACK, marketMove, pathFor, type Dir } from "./board";
import { MARKET_START, clampMarket } from "./stocks";

export interface Player {
  id: number;
  name: string;
  color: string;
  position: number;
}

export interface MoveRecord {
  playerId: number;
  dice: [number, number];
  from: number;
  to: number;
  dir: Dir;
  marketBefore: number;
  marketAfter: number;
}

export interface GameState {
  players: Player[];
  current: number;
  market: number;
  dice: [number, number] | null;
  phase: "idle" | "moving";
  /** Remaining squares the current player still has to step through. */
  path: number[];
  pending: Omit<MoveRecord, "to" | "marketAfter"> | null;
  history: MoveRecord[];
}

export const PLAYER_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0f172a"];

export type Action =
  | { type: "roll"; dice: [number, number] }
  | { type: "step" }
  | { type: "reset" };

export function newGame(names: string[]): GameState {
  return {
    players: names.map((name, i) => ({
      id: i,
      name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      position: START_SQUARES[i % START_SQUARES.length],
    })),
    current: 0,
    market: MARKET_START,
    dice: null,
    phase: "idle",
    path: [],
    pending: null,
    history: [],
  };
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "roll": {
      if (state.phase !== "idle") return state;
      const player = state.players[state.current];
      const total = action.dice[0] + action.dice[1];
      const { dir, path } = pathFor(player.position, total);
      return {
        ...state,
        dice: action.dice,
        phase: "moving",
        path,
        pending: { playerId: player.id, dice: action.dice, from: player.position, dir, marketBefore: state.market },
      };
    }
    case "step": {
      if (state.phase !== "moving" || state.path.length === 0 || !state.pending) return state;
      const [next, ...rest] = state.path;
      const players = state.players.map((p, i) => (i === state.current ? { ...p, position: next } : p));
      if (rest.length > 0) return { ...state, players, path: rest };

      // Landed: the square moves the market slider.
      const market = clampMarket(state.market + marketMove(next));
      const record: MoveRecord = { ...state.pending, to: next, marketAfter: market };
      return {
        ...state,
        players,
        path: [],
        market,
        phase: "idle",
        pending: null,
        current: (state.current + 1) % state.players.length,
        history: [record, ...state.history].slice(0, 50),
      };
    }
    case "reset":
      return newGame(state.players.map((p) => p.name));
  }
}

export function describeSquare(index: number): string {
  const sq = TRACK[index];
  switch (sq.kind) {
    case "start":
      return "START";
    case "corner":
      return "Broker Fee corner";
    case "stock":
      return sq.stock;
    case "sellAll":
      return `Sell All ${sq.stock}`;
  }
}
