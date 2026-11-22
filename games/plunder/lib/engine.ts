/**
 * Plunder's rules: a pure reducer over a serialisable `GameState`, like Stock Market's engine.
 * No clocks or randomness in here: dice and shuffles come in on actions, so online play can
 * replay the same moves on every phone.
 *
 * This is boilerplate: players take turns rolling until someone ends the game. The real rules
 * replace the placeholder phases and actions.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export type PlayerSetup = { name: string; isBot: boolean };

export type Player = PlayerSetup & { gold: number };

export type Phase = { t: "roll" } | { t: "act"; roll: number } | { t: "gameOver"; winner: number | null };

export type GameState = {
  version: 1;
  players: Player[];
  /** Index into `players` of whose turn it is. */
  turn: number;
  phase: Phase;
  log: string[];
};

export type Action = { t: "roll"; die: number } | { t: "endTurn" } | { t: "endGame" };

export function newGame(setup: PlayerSetup[]): GameState {
  if (setup.length < MIN_PLAYERS || setup.length > MAX_PLAYERS) {
    throw new Error(`Plunder needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  }
  return {
    version: 1,
    players: setup.map((p) => ({ ...p, gold: 0 })),
    turn: 0,
    phase: { t: "roll" },
    log: [],
  };
}

/** Apply one action. Illegal actions return the state unchanged. */
export function reducer(s: GameState, a: Action): GameState {
  const me = s.players[s.turn];
  switch (a.t) {
    case "roll": {
      if (s.phase.t !== "roll" || !Number.isInteger(a.die) || a.die < 1 || a.die > 6) return s;
      return { ...s, phase: { t: "act", roll: a.die }, log: [...s.log, `${me.name} rolled ${a.die}.`] };
    }
    case "endTurn": {
      if (s.phase.t !== "act") return s;
      return { ...s, turn: (s.turn + 1) % s.players.length, phase: { t: "roll" } };
    }
    case "endGame": {
      if (s.phase.t === "gameOver") return s;
      return { ...s, phase: { t: "gameOver", winner: leader(s) } };
    }
  }
}

/** The player with the most gold, or null on a tie. */
export function leader(s: GameState): number | null {
  const most = Math.max(...s.players.map((p) => p.gold));
  const top = s.players.flatMap((p, i) => (p.gold === most ? [i] : []));
  return top.length === 1 ? top[0] : null;
}
