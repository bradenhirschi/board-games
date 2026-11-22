import { reducer, waitingOn, type Action, type GameState, type Notice } from "./engine";

/**
 * Online play (no server), the same way Stock Market does it: the device whose move it is
 * applies it with the shared rules, then saves the new state plus the actions it applied. Every
 * other device replays those actions to animate the move and show its news.
 *
 * Notices (battle results, treasure, the cards you drew…) are local to each device, so saved
 * states never hold any: each device gets them by replaying the saved actions.
 */

export interface Resolved {
  /** The new state, without notices. */
  state: GameState;
  /** The actions applied, dice included: replayable by any device. */
  actions: Action[];
  /** The notices the move produced (every device recreates these when it replays). */
  notices: Notice[];
}

/** The state as it's saved: no notices. */
export function stripNotices(s: GameState): GameState {
  return s.notices.length ? { ...s, notices: [] } : s;
}

/** Apply one action to a saved state. Null if it isn't allowed right now. */
export function resolve(state: GameState, action: Action): Resolved | null {
  const base = stripNotices(state);
  const next = reducer(base, action);
  if (next === base) return null;
  return { state: stripNotices(next), actions: [action], notices: next.notices };
}

/** Replay saved actions on a state, returning the end state and the notices along the way. */
export function replay(state: GameState, actions: Action[]): { state: GameState; notices: Notice[] } {
  let s = stripNotices(state);
  const notices: Notice[] = [];
  for (const a of actions) {
    s = reducer(s, a);
    notices.push(...s.notices);
    s = stripNotices(s);
  }
  return { state: s, notices };
}

/** Notices one seat should see: everything public, and only their own card draws. */
export function noticesFor(notices: Notice[], seat: number | null): Notice[] {
  return notices.filter((n) => n.t !== "drew" || n.player === seat);
}

/** The seat the room is waiting on (whose device may save the next move). */
export function seatToAct(state: GameState): number | null {
  return state.phase.t === "gameOver" ? null : waitingOn(state);
}
