import { botMove } from "./bot";
import { CAREERS, START_SQUARES, marketMove, salaryOf } from "./board";
import {
  canRoll,
  fmt,
  mustGoToMarket,
  netWorth,
  reducer,
  type Action,
  type GameState,
  type LogEntry,
  type Phase,
  type Player,
  type Pos,
} from "./engine";
import { STOCK_ORDER, lowestPrice, moveMarket } from "./stocks";

/**
 * "Simultaneous turns" (online only): everyone plays each round at the same time, in private.
 *
 * 1. `sell`: before the throw, everyone may sell at the board price (and workers may change
 *    occupation or go to market), then presses Roll. The dice are thrown then but stay hidden.
 * 2. Once everyone has rolled (or time runs out), each player's own throw is revealed: their
 *    token walks, and their copy of the market moves by their own landing only. Salaries are
 *    paid for every throw of the round.
 * 3. `act`: everyone may buy at their own updated price and sell at the lowest price, then
 *    ends their turn.
 * 4. When everyone is done, every player's turn is shown in a fixed order (it rotates by one
 *    seat each round) and their market moves are applied to the real market in that order.
 *
 * Each player's turn runs on a private copy of the game state (`view`) through the normal
 * rules reducer, so every rule (fees, meetings, buying, going broke) works as it does in turns.
 * Like the reducer, everything here is pure apart from the dice, which come from `rollDie`.
 */

export const SELL_SECONDS = 60;
export const ACT_SECONDS = 90;
/** How long each player's box shows in the end-of-round summary. */
export const SUMMARY_BOX_MS = 2200;

export interface SimulTurn {
  /** This player's copy of themselves for the round. */
  player: Player;
  /** Their copy of the market: the real one, moved only by their own landing. */
  market: number;
  phase: Phase;
  /** Their throw, made when they pressed Roll (hidden from them until everyone has rolled). */
  dice: [number, number] | null;
  lastLanding: Pos | null;
  lastMarketDelta: number;
  /** What happened to them this round, newest first. */
  log: LogEntry[];
  rolled: boolean;
  /** Ended their turn (or ran out of time). */
  done: boolean;
  /** Ran out of time in the sell stage: from then on, their turn plays itself. */
  timedOut?: boolean;
  /** Where their token was when the throw was revealed, and every square it has stepped to since. */
  pathFrom: Pos | null;
  path: Pos[];
}

/** One player's box in the end-of-round summary. */
export interface SummaryEntry {
  playerId: number;
  lines: { text: string; tone?: LogEntry["tone"] }[];
  /** Their token before the round. */
  from: Pos | null;
  /** The real market before and after their landing is applied. */
  before: number;
  after: number;
}

export interface SimulState {
  stage: "sell" | "act";
  /** Counts from 1. */
  round: number;
  /** Seat that goes first in this round's order. */
  first: number;
  turns: SimulTurn[];
  /** Last round, as the summary shown at the start of this one. */
  summary: SummaryEntry[] | null;
}

/** The order players' turns are shown and applied in this round. */
export function roundOrder(sim: Pick<SimulState, "first">, n: number): number[] {
  return Array.from({ length: n }, (_, k) => (sim.first + k) % n);
}

/** Identifies the stage in progress: it changes whenever a stage's timer should restart. */
export function stageKey(state: GameState): string {
  if (state.phase.t === "gameOver") return "over";
  if (!state.simul) return state.phase.t;
  return `${state.simul.round}:${state.simul.stage}`;
}

/** How long the summary takes to play: the sell stage's timer starts after it. */
export function summaryMs(state: GameState): number {
  const n = state.simul?.summary?.length ?? 0;
  return n ? n * SUMMARY_BOX_MS : 0;
}

/** Milliseconds from the stage starting until its timer runs out. */
export function stageMs(state: GameState): number {
  if (!state.simul) return Infinity;
  return state.simul.stage === "sell" ? summaryMs(state) + SELL_SECONDS * 1000 : ACT_SECONDS * 1000;
}

/** Players still to roll (`sell`) or to end their turn (`act`). */
export function waitingOn(state: GameState): number[] {
  const sim = state.simul;
  if (!sim || state.phase.t === "gameOver") return [];
  return sim.turns.flatMap((t, i) => ((sim.stage === "sell" ? t.rolled : t.done) ? [] : [i]));
}

/**
 * Seat `seat`'s private game: the shared state (everyone else as they were at the start of the
 * round) with this player's own copy of themselves, the market, their phase and their log.
 */
export function view(state: GameState, seat: number): GameState {
  const sim = state.simul;
  if (!sim) return state;
  const t = sim.turns[seat];
  return {
    ...state,
    simul: undefined,
    current: seat,
    players: state.players.map((p, i) => (i === seat ? t.player : p)),
    market: t.market,
    phase: t.phase,
    // Their own throw, once everyone's has been revealed.
    dice: sim.stage === "act" ? t.dice : null,
    lastLanding: t.lastLanding,
    lastMarketDelta: t.lastMarketDelta,
    log: [...t.log, ...state.log],
    nextLogId: state.nextLogId + t.log.length,
    turnLogStart: state.nextLogId,
  };
}

/** Copy a seat's private game back into its turn. */
function absorb(s: GameState, seat: number, v: GameState) {
  const t = s.simul!.turns[seat];
  t.player = v.players[seat];
  t.market = v.market;
  t.lastLanding = v.lastLanding;
  t.lastMarketDelta = v.lastMarketDelta;
  t.log = v.log.filter((e) => e.id >= s.nextLogId);
  // Ending the turn (or going broke) passes play on in the private game: the turn is over.
  if (v.current !== seat) {
    t.done = true;
    t.phase = { t: "preRoll" };
  } else {
    t.phase = v.phase;
  }
  const at = t.player.pos;
  const last = t.path.length ? t.path[t.path.length - 1] : t.pathFrom;
  if (s.simul!.stage === "act" && at && JSON.stringify(at) !== JSON.stringify(last)) t.path.push(at);
}

/** Apply one rules action to a seat's private game. False if it isn't allowed. */
function applyTo(s: GameState, seat: number, action: Action): boolean {
  const v = view(s, seat);
  const next = reducer(v, action);
  if (next === v) return false;
  absorb(s, seat, next);
  return true;
}

/** Walk a seat's token until it needs a decision or lands (a timed-out player enters meetings). */
function advance(s: GameState, seat: number) {
  const t = s.simul!.turns[seat];
  for (let guard = 0; guard < 100 && !t.done; guard++) {
    if (t.phase.t === "moving") applyTo(s, seat, { type: "step" });
    else if (t.phase.t === "detour" && t.timedOut) applyTo(s, seat, { type: "detour", enter: true });
    else break;
  }
}

function privateLog(s: GameState, seat: number, text: string, tone?: LogEntry["tone"]) {
  const t = s.simul!.turns[seat];
  t.log.unshift({ id: s.nextLogId + t.log.length, playerId: seat, text, ...(tone ? { tone } : {}) });
}

function freshTurn(p: Player, market: number): SimulTurn {
  return {
    player: structuredClone(p),
    market,
    phase: { t: "preRoll" },
    dice: null,
    lastLanding: null,
    lastMarketDelta: 0,
    log: [],
    rolled: false,
    done: false,
    pathFrom: null,
    path: [],
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** A player's choice in a simultaneous round. "rollDice" throws their (hidden) dice. */
export type SimulDecision = Action | { type: "rollDice" };

/** Actions allowed in each stage (everything else belongs to the shared game or isn't a choice). */
const SELL_ACTIONS = new Set<Action["type"]>(["sell", "setCareer", "goToMarket"]);
const ACT_ACTIONS = new Set<Action["type"]>(["detour", "buy", "forcedSell", "goBroke", "endTurn"]);

/** Apply `seat`'s decision without moving the round on. False if it isn't allowed now. */
function decide(s: GameState, seat: number, d: SimulDecision, rollDie: () => number): boolean {
  const sim = s.simul!;
  const t = sim.turns[seat];
  if (!t || t.done) return false;
  if (sim.stage === "sell") {
    if (t.rolled) return false;
    if (d.type === "rollDice") {
      if (!canRoll(view(s, seat))) return false;
      t.rolled = true;
      t.dice = [rollDie(), rollDie()];
      return true;
    }
    return SELL_ACTIONS.has(d.type) && applyTo(s, seat, d);
  }
  if (d.type === "rollDice" || !ACT_ACTIONS.has(d.type)) return false;
  if (!applyTo(s, seat, d)) return false;
  advance(s, seat);
  return true;
}

/** Everyone has rolled: reveal each throw, pay salaries, walk the tokens. */
function reveal(s: GameState) {
  const sim = s.simul!;
  sim.stage = "act";
  const totals = sim.turns.map((t) => t.dice![0] + t.dice![1]);
  sim.turns.forEach((t, seat) => {
    t.pathFrom = t.player.pos;
    t.path = [];
    applyTo(s, seat, { type: "roll", dice: t.dice!, noSalaries: true });
  });
  // Salaries: a worker is paid for every throw of the round that hits their numbers.
  sim.turns.forEach((t, seat) => {
    const w = t.player;
    if (w.status !== "work" || w.career === null) return;
    const career = CAREERS[w.career];
    const salary = salaryOf(career, s.balancedCareers);
    totals.forEach((total, by) => {
      if (!career.rolls.includes(total)) return;
      w.cash += salary;
      const whose = by === seat ? "your" : `${s.players[by].name}'s`;
      privateLog(s, seat, `earns a $${salary} ${career.name} salary (${whose} ${total})`, "money");
    });
  });
  sim.turns.forEach((_, seat) => advance(s, seat));
}

/** Everyone is done: apply the market moves in order, merge everyone's turn, start the next round. */
function finishRound(s: GameState) {
  const sim = s.simul!;
  const n = s.players.length;
  const summary: SummaryEntry[] = [];
  const merged: LogEntry[] = [];
  let market = s.market;
  for (const seat of roundOrder(sim, n)) {
    const t = sim.turns[seat];
    const before = market;
    const landed = t.lastLanding?.kind === "track" ? t.lastLanding.index : null;
    if (landed !== null) market = moveMarket(market, marketMove(landed));
    // Their own log quoted their private market; quote the real one.
    const lines = [...t.log].reverse().map((e) => ({
      ...e,
      text: e.text.replace(/: market (UP|DOWN) (\d+) \(\d+ → \d+\)$/, `: market $1 $2 (${before} → ${market})`),
    }));
    if (t.timedOut) lines.unshift({ id: 0, playerId: seat, text: "ran out of time", tone: "bad" });
    summary.push({
      playerId: seat,
      lines: lines.map((e) => ({ text: e.text, ...(e.tone ? { tone: e.tone } : {}) })),
      from: s.players[seat].pos,
      before,
      after: market,
    });
    merged.push(...lines);
  }
  s.players = sim.turns.map((t) => t.player);
  s.lastMarketDelta = market - s.market;
  s.market = market;
  s.lastLanding = null;
  s.dice = null;
  s.turn += n;
  for (const e of merged) {
    s.log.unshift({ ...e, id: s.nextLogId++ });
  }
  if (s.log.length > 200) s.log.length = 200;
  s.turnLogStart = s.nextLogId;

  // Winning: worth the target at the start of a round, using the round's final prices. If
  // several are, the richest wins (then the lowest seat).
  const winner = [...s.players]
    .filter((p) => netWorth(p, s.market) >= s.target)
    .sort((a, b) => netWorth(b, s.market) - netWorth(a, s.market) || a.id - b.id)[0];
  s.simul = {
    stage: "sell",
    round: sim.round + 1,
    first: (sim.first + 1) % n,
    turns: s.players.map((p) => freshTurn(p, s.market)),
    summary,
  };
  if (winner) {
    s.phase = { t: "gameOver", winnerId: winner.id, reason: "target" };
    s.log.unshift({
      id: s.nextLogId++,
      playerId: winner.id,
      text: `reaches $${fmt(netWorth(winner, s.market))} and wins!`,
      tone: "money",
    });
  }
}

/** Let the bots play their part of the stage, and move the round on while everyone's done. */
function settle(s: GameState, rollDie: () => number) {
  for (let guard = 0; guard < 4 && s.simul && s.phase.t !== "gameOver"; guard++) {
    const sim = s.simul;
    sim.turns.forEach((t, seat) => {
      if (!t.player.isBot) return;
      for (let k = 0; k < 30 && !t.done && !(sim.stage === "sell" && t.rolled); k++) {
        const move = botMove(view(s, seat));
        if (!move || !decide(s, seat, move, rollDie)) {
          // Nothing sensible to do: let the turn play itself.
          autoPlay(s, seat, rollDie);
          break;
        }
      }
    });
    if (waitingOn(s).length > 0) return;
    if (sim.stage === "sell") reveal(s);
    else {
      finishRound(s);
      // Only one round per call, even if every seat is a bot.
      if (s.simul.turns.every((t) => t.player.isBot)) return;
    }
  }
}

/** Time ran out for `seat`: roll without selling (sell), or end the turn without trading (act). */
function autoPlay(s: GameState, seat: number, rollDie: () => number) {
  const sim = s.simul!;
  const t = sim.turns[seat];
  if (sim.stage === "sell") {
    if (t.rolled) return;
    t.timedOut = true;
    const p = t.player;
    if (p.status === "work" && p.career === null) applyTo(s, seat, { type: "setCareer", career: 0 });
    if (mustGoToMarket(t.player)) applyTo(s, seat, { type: "goToMarket", start: START_SQUARES[0] });
    if (!decide(s, seat, { type: "rollDice" }, rollDie)) {
      // Can't roll for some reason: sit the round out.
      t.rolled = true;
      t.dice = [rollDie(), rollDie()];
    }
    return;
  }
  for (let guard = 0; guard < 50 && !t.done; guard++) {
    const ph = t.phase;
    const p = t.player;
    if (ph.t === "detour") decide(s, seat, { type: "detour", enter: true }, rollDie);
    else if (ph.t === "afterRoll") decide(s, seat, { type: "endTurn" }, rollDie);
    else if (ph.t === "raiseCash") {
      // Sell the biggest holding (at the lowest price) first, until the fee is covered.
      const held = STOCK_ORDER.filter((id) => p.shares[id] > 0).sort(
        (a, b) => p.shares[b] * lowestPrice(b) - p.shares[a] * lowestPrice(a),
      );
      const short = ph.owed - p.cash;
      const total = held.reduce((v, id) => v + p.shares[id] * lowestPrice(id), 0);
      if (total < short) decide(s, seat, { type: "goBroke" }, rollDie);
      else {
        const id = held[0];
        const qty = Math.min(p.shares[id], Math.ceil(short / lowestPrice(id)));
        decide(s, seat, { type: "forcedSell", stock: id, qty }, rollDie);
      }
    } else if (ph.t === "moving") advance(s, seat);
    else {
      t.done = true;
      t.phase = { t: "preRoll" };
    }
  }
  if (!t.done) {
    t.done = true;
    t.phase = { t: "preRoll" };
  }
}

// ---------------------------------------------------------------------------
// Entry points (each returns a new state, or null when nothing changed)
// ---------------------------------------------------------------------------

/** Start the first round once occupations are chosen. */
export function beginRounds(state: GameState, rollDie: () => number): GameState | null {
  if (!state.simultaneous || state.simul || state.phase.t !== "preRoll") return null;
  const s = structuredClone(state);
  s.simul = {
    stage: "sell",
    round: 1,
    first: 0,
    turns: s.players.map((p) => freshTurn(p, s.market)),
    summary: null,
  };
  settle(s, rollDie);
  return s;
}

/** `seat` makes a decision in the current round. */
export function simulMove(
  state: GameState,
  seat: number,
  decision: SimulDecision,
  rollDie: () => number,
): GameState | null {
  if (!state.simul || state.phase.t === "gameOver") return null;
  const s = structuredClone(state);
  if (!decide(s, seat, decision, rollDie)) return null;
  settle(s, rollDie);
  return s;
}

/** The stage's time is up: everyone still playing it is played for. */
export function simulTimeout(state: GameState, key: string, rollDie: () => number): GameState | null {
  if (!state.simul || state.phase.t === "gameOver" || stageKey(state) !== key) return null;
  const s = structuredClone(state);
  for (const seat of waitingOn(s)) autoPlay(s, seat, rollDie);
  settle(s, rollDie);
  return s;
}

/** A player leaves mid-game: a bot plays their seat from now on (finishing this stage at once). */
export function simulReplaceWithBot(state: GameState, seat: number, rollDie: () => number): GameState | null {
  const sim = state.simul;
  if (!sim || state.phase.t === "gameOver" || !state.players[seat] || state.players[seat].isBot) return null;
  const s = structuredClone(state);
  s.players[seat].isBot = true;
  s.simul!.turns[seat].player.isBot = true;
  privateLog(s, seat, "left the game. A bot plays for them now.");
  settle(s, rollDie);
  return s;
}
