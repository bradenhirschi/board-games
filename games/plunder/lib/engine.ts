/**
 * Plunder's rules: a pure reducer over a serialisable `GameState`, like Stock Market's engine.
 *
 * No clocks and no `Math.random`: dice come in on actions (so the UI can animate the roll), and the
 * rest of the luck (shuffling the resource deck, spinning the compasses) comes from a seeded
 * generator kept in the state. The same actions from the same state always give the same result,
 * so online play can replay moves on every phone.
 *
 * Built so far: setup (players pick a one-skull island and start in its port, three resource cards
 * each), turns (draw a resource per island, roll, sail the fleet, build, bury gold, end the turn),
 * X-marks-the-spot tokens, Plunder Points and winning. Not yet: battles and conquering islands, the
 * storm, trading, and the Treasure card deck (finding an X only says the cards aren't written yet).
 */

import { COLS, ROWS } from "./board";
import {
  DEFAULT_LAYOUT,
  SIDES,
  boardMap,
  canSail,
  edgeKey,
  islands,
  isSailable,
  type Placement,
  type Pos,
  type SeaMap,
  type Side,
} from "./tiles";

export const MIN_PLAYERS = 2;
/** Every player starts on a one-skull island, and the board has six. */
export const MAX_PLAYERS = 6;
export const WIN_POINTS = 10;

export const PLAYER_COLORS = ["red", "purple", "yellow", "green", "grey", "brown"] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const RESOURCES = ["wood", "iron", "rum", "gold"] as const;
export type Resource = (typeof RESOURCES)[number];
export type Hand = Record<Resource, number>;

/** Placeholder until the real card counts are decided: 40 of each resource. */
export const CARDS_PER_RESOURCE = 40;
/** When the face-down deck runs out, this many of each resource stay in their face-up piles. */
const PILE_KEEP = 10;
export const STARTING_CARDS = 3;
export const X_TOKENS = 3;

export const MAX_SHIPS = 3;
export const MAX_LIVES = 3;
export const MAX_MASTS = 2;
export const MAX_CANNONS = 2;
export const GOLD_TO_BURY = 5;

export type Build = "ship" | "mast" | "cannon" | "life";
export const COSTS: Record<Build, Partial<Hand>> = {
  ship: { wood: 2, iron: 1, gold: 2 },
  mast: { wood: 1, rum: 2 },
  cannon: { iron: 2, rum: 1, gold: 1 },
  life: { wood: 1, iron: 1, rum: 1, gold: 1 },
};

export type PlayerSetup = { name: string; color: PlayerColor; isBot?: boolean };

export type Player = PlayerSetup & { hand: Hand; plunderCards: number };

export type Ship = {
  id: number;
  owner: number;
  pos: Pos;
  lives: number;
  masts: number;
  cannons: number;
  /** Extra squares this ship can still sail this turn from its masts (set when the die is rolled). */
  mastMoves: number;
  /** Built after this turn's roll: it can't sail until next turn. */
  docked: boolean;
};

export type Phase =
  /** Players choose their starting one-skull island, in `order`. */
  | { t: "pickIsland"; order: number[]; index: number }
  /** A player's turn: before the roll `roll` is null; `moves` is what's left of the shared roll. */
  | { t: "turn"; roll: number | null; moves: number }
  | { t: "gameOver"; winner: number };

/** Something the player should be told about (shown as a message, then cleared by the UI). */
export type Notice = { t: "treasure"; player: number; at: Pos } | { t: "drew"; player: number; cards: Resource[] };

export type GameState = {
  version: 1;
  layout: Placement[];
  players: Player[];
  ships: Ship[];
  nextShipId: number;
  /** Island id → owning player. */
  owners: Record<string, number>;
  /** The face-down resource deck (top card last) and the face-up discard piles. */
  deck: Resource[];
  piles: Hand;
  xs: Pos[];
  /** Whose turn it is (index into `players`). */
  turn: number;
  phase: Phase;
  /** Seeded random generator state, for shuffles and compass spins. */
  rng: number;
  notices: Notice[];
  log: string[];
};

export type Action =
  | { t: "pickIsland"; island: string }
  | { t: "roll"; die: number }
  | { t: "sail"; ship: number; path: Pos[] }
  | { t: "build"; item: "ship"; at: Pos }
  | { t: "build"; item: "mast" | "cannon" | "life"; ship: number }
  | { t: "bury" }
  | { t: "endTurn" }
  | { t: "clearNotices" };

// ---------------------------------------------------------------------------------------------
// Randomness (seeded, kept in the state)

/** One step of mulberry32: returns [a number in 0..1, the next state]. */
function next(rng: number): [number, number] {
  const a = (rng + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

function shuffle<T>(items: T[], rng: number): [T[], number] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    let r: number;
    [r, rng] = next(rng);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, rng];
}

/** Spin both compasses: a random square on the board. */
function spin(rng: number): [Pos, number] {
  let a: number, b: number;
  [a, rng] = next(rng);
  [b, rng] = next(rng);
  return [{ r: Math.floor(a * ROWS), c: Math.floor(b * COLS) }, rng];
}

// ---------------------------------------------------------------------------------------------
// The board

const maps = new Map<string, SeaMap>();
/** The board's squares for a layout (cached: the state only stores the layout). */
export function mapOf(layout: Placement[]): SeaMap {
  const key = JSON.stringify(layout);
  let m = maps.get(key);
  if (!m) maps.set(key, (m = boardMap(layout)));
  return m;
}

export function islandsOf(layout: Placement[]) {
  return islands(mapOf(layout));
}

/** Islands players can start on: resource islands with exactly one skull. */
export function startingIslands(layout: Placement[]) {
  return islandsOf(layout).filter((i) => i.kind === "resource" && i.skulls === 1);
}

const STEP: Record<Side, Pos> = { N: { r: -1, c: 0 }, E: { r: 0, c: 1 }, S: { r: 1, c: 0 }, W: { r: 0, c: -1 } };
const same = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;
const step = (p: Pos, s: Side): Pos => ({ r: p.r + STEP[s].r, c: p.c + STEP[s].c });
const sideBetween = (a: Pos, b: Pos): Side | null => SIDES.find((s) => same(step(a, s), b)) ?? null;

export function shipAt(s: GameState, p: Pos): Ship | undefined {
  return s.ships.find((sh) => same(sh.pos, p));
}

/** How many squares a ship can sail right now: the shared roll plus its own masts. */
export function movesFor(s: GameState, ship: Ship): number {
  if (s.phase.t !== "turn" || s.phase.roll === null || ship.owner !== s.turn || ship.docked) return 0;
  return s.phase.moves + ship.mastMoves;
}

/**
 * Every square a ship can reach this turn, with the shortest path to it. Ships sail orthogonally,
 * can't cross land, barriers or the land side of half land, and can't pass through other ships.
 */
export function reachable(s: GameState, ship: Ship): Map<string, Pos[]> {
  const map = mapOf(s.layout);
  const budget = movesFor(s, ship);
  const out = new Map<string, Pos[]>();
  const key = (p: Pos) => `${p.r},${p.c}`;
  let frontier: { p: Pos; path: Pos[] }[] = [{ p: ship.pos, path: [] }];
  const seen = new Set([key(ship.pos)]);
  for (let d = 0; d < budget; d++) {
    const nextFrontier: typeof frontier = [];
    for (const { p, path } of frontier) {
      for (const side of SIDES) {
        const q = step(p, side);
        if (seen.has(key(q)) || !canSail(map, p, side) || shipAt(s, q)) continue;
        seen.add(key(q));
        const qPath = [...path, q];
        out.set(key(q), qPath);
        nextFrontier.push({ p: q, path: qPath });
      }
    }
    frontier = nextFrontier;
  }
  return out;
}

/** Plunder Points: one per ship, one per island owned, one per Plunder Point card. */
export function points(s: GameState, player: number): number {
  const ships = s.ships.filter((sh) => sh.owner === player).length;
  const isles = Object.values(s.owners).filter((o) => o === player).length;
  return ships + isles + s.players[player].plunderCards;
}

export function canAfford(hand: Hand, cost: Partial<Hand>): boolean {
  return RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
}

/** Where a newly built ship can go: an empty port of an island you own, or open water next to one of your ships. */
export function shipSpots(s: GameState, player: number): Pos[] {
  const map = mapOf(s.layout);
  const spots: Pos[] = [];
  const add = (p: Pos) => {
    if (!shipAt(s, p) && isSailable(map.squares[p.r]?.[p.c]) && !spots.some((q) => same(q, p))) spots.push(p);
  };
  for (const isl of islandsOf(s.layout)) if (s.owners[isl.id] === player) isl.ports.forEach(add);
  for (const sh of s.ships) {
    if (sh.owner !== player) continue;
    for (const side of SIDES) if (canSail(map, sh.pos, side)) add(step(sh.pos, side));
  }
  return spots;
}

// ---------------------------------------------------------------------------------------------
// Cards

function emptyHand(): Hand {
  return { wood: 0, iron: 0, rum: 0, gold: 0 };
}

/** Draw `n` cards for a player, refilling the deck from the face-up piles if it runs out. */
function draw(s: GameState, player: number, n: number): GameState {
  let deck = [...s.deck];
  const piles = { ...s.piles };
  let rng = s.rng;
  const hand = { ...s.players[player].hand };
  const cards: Resource[] = [];
  for (let i = 0; i < n; i++) {
    if (deck.length === 0) {
      const refill: Resource[] = [];
      for (const r of RESOURCES) {
        const take = Math.max(0, piles[r] - PILE_KEEP);
        piles[r] -= take;
        for (let k = 0; k < take; k++) refill.push(r);
      }
      [deck, rng] = shuffle(refill, rng);
      if (deck.length === 0) break;
    }
    const card = deck.pop()!;
    hand[card]++;
    cards.push(card);
  }
  const players = s.players.map((p, i) => (i === player ? { ...p, hand } : p));
  const notices: Notice[] = cards.length ? [...s.notices, { t: "drew", player, cards }] : s.notices;
  return { ...s, deck, piles, rng, players, notices };
}

function pay(s: GameState, player: number, cost: Partial<Hand>): GameState {
  const hand = { ...s.players[player].hand };
  const piles = { ...s.piles };
  for (const r of RESOURCES) {
    hand[r] -= cost[r] ?? 0;
    piles[r] += cost[r] ?? 0;
  }
  return { ...s, piles, players: s.players.map((p, i) => (i === player ? { ...p, hand } : p)) };
}

// ---------------------------------------------------------------------------------------------
// Setup

/**
 * A new game. `seed` drives the shuffles and compass spins; `pickRolls` are the dice each player
 * rolled to decide the picking order (highest picks first, then counter-clockwise; the last to
 * pick takes the first turn).
 */
export function newGame(
  setup: PlayerSetup[],
  seed: number,
  layout: Placement[] = DEFAULT_LAYOUT,
  pickRolls?: number[],
): GameState {
  if (setup.length < MIN_PLAYERS || setup.length > MAX_PLAYERS) {
    throw new Error(`Plunder needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  }
  const cards: Resource[] = RESOURCES.flatMap((r) => Array<Resource>(CARDS_PER_RESOURCE).fill(r));
  const [deck, shuffled] = shuffle(cards, seed >>> 0);
  let rng = shuffled;
  // Place the X tokens: spin the compasses for each; land is fine (collected from next door).
  const xs: Pos[] = [];
  for (let i = 0; i < X_TOKENS; i++) {
    const [p, after] = spin(rng);
    rng = after;
    xs.push(p);
  }
  const n = setup.length;
  const rolls = pickRolls ?? setup.map((_, i) => n - i);
  const first = rolls.indexOf(Math.max(...rolls));
  const order = Array.from({ length: n }, (_, k) => (first - k + n) % n);
  let s: GameState = {
    version: 1,
    layout,
    players: setup.map((p) => ({ ...p, hand: emptyHand(), plunderCards: 0 })),
    ships: [],
    nextShipId: 1,
    owners: {},
    deck,
    piles: emptyHand(),
    xs,
    turn: order[0],
    phase: { t: "pickIsland", order, index: 0 },
    rng,
    notices: [],
    log: [],
  };
  for (let i = 0; i < n; i++) s = draw(s, i, STARTING_CARDS);
  return { ...s, notices: [] };
}

/** Make a random board: the six tiles shuffled into the slots, each turned at random. */
export function randomLayout(seed: number): Placement[] {
  const [tiles, shuffled] = shuffle([1, 2, 3, 4, 5, 6], seed >>> 0);
  let rng = shuffled;
  return tiles.map((tile) => {
    let r: number;
    [r, rng] = next(rng);
    return { tile, rotation: ([0, 90, 180, 270] as const)[Math.floor(r * 4)] };
  });
}

// ---------------------------------------------------------------------------------------------
// The reducer

function log(s: GameState, line: string): GameState {
  return { ...s, log: [...s.log, line] };
}

function checkWin(s: GameState): GameState {
  if (s.phase.t === "gameOver") return s;
  const p = s.turn;
  if (points(s, p) >= WIN_POINTS)
    return log({ ...s, phase: { t: "gameOver", winner: p } }, `${s.players[p].name} wins!`);
  return s;
}

/** Collect any X the ship is on, or next to when the X is on land. */
function collectXs(s: GameState, ship: Ship): GameState {
  const map = mapOf(s.layout);
  let out = s;
  for (let i = 0; i < out.xs.length; i++) {
    const x = out.xs[i];
    const onIt = same(x, ship.pos);
    const side = sideBetween(ship.pos, x);
    const onLand = !isSailable(map.squares[x.r]?.[x.c]);
    // From next door only when the X is on land, and never across a barrier or land edge.
    const fromNextDoor = side !== null && onLand && !map.walls.has(edgeKey(ship.pos, side));
    if (!onIt && !fromNextDoor) continue;
    const [p, rng] = spin(out.rng);
    const xs = out.xs.map((q, k) => (k === i ? p : q));
    out = log(
      { ...out, xs, rng, notices: [...out.notices, { t: "treasure", player: ship.owner, at: x }] },
      `${out.players[ship.owner].name} found treasure!`,
    );
  }
  return out;
}

export function reducer(s: GameState, a: Action): GameState {
  if (s.phase.t === "gameOver" && a.t !== "clearNotices") return s;
  switch (a.t) {
    case "clearNotices":
      return s.notices.length ? { ...s, notices: [] } : s;

    case "pickIsland": {
      if (s.phase.t !== "pickIsland") return s;
      const isl = startingIslands(s.layout).find((i) => i.id === a.island);
      if (!isl || s.owners[isl.id] !== undefined) return s;
      const port = isl.ports.find((p) => !shipAt(s, p));
      if (!port) return s;
      const player = s.phase.order[s.phase.index];
      const ship: Ship = {
        id: s.nextShipId,
        owner: player,
        pos: port,
        lives: MAX_LIVES,
        masts: 0,
        cannons: 0,
        mastMoves: 0,
        docked: false,
      };
      let out: GameState = {
        ...s,
        owners: { ...s.owners, [isl.id]: player },
        ships: [...s.ships, ship],
        nextShipId: s.nextShipId + 1,
      };
      out = log(out, `${s.players[player].name} claimed an island.`);
      const index = s.phase.index + 1;
      if (index < s.phase.order.length) return { ...out, turn: s.phase.order[index], phase: { ...s.phase, index } };
      // The last to pick goes first. No resource draw on this very first turn: everyone has their three.
      return { ...out, turn: player, phase: { t: "turn", roll: null, moves: 0 } };
    }

    case "roll": {
      if (s.phase.t !== "turn" || s.phase.roll !== null) return s;
      if (!Number.isInteger(a.die) || a.die < 1 || a.die > 6) return s;
      const ships = s.ships.map((sh) => (sh.owner === s.turn ? { ...sh, mastMoves: sh.masts } : sh));
      return log(
        { ...s, ships, phase: { t: "turn", roll: a.die, moves: a.die } },
        `${s.players[s.turn].name} rolled ${a.die}.`,
      );
    }

    case "sail": {
      if (s.phase.t !== "turn" || s.phase.roll === null) return s;
      const ship = s.ships.find((sh) => sh.id === a.ship);
      if (!ship || ship.owner !== s.turn || a.path.length === 0) return s;
      if (a.path.length > movesFor(s, ship)) return s;
      const map = mapOf(s.layout);
      let at = ship.pos;
      for (const p of a.path) {
        const side = sideBetween(at, p);
        if (!side || !canSail(map, at, side) || shipAt(s, p)) return s;
        at = p;
      }
      // Masts' extra squares are used first, then the shared roll.
      const fromMasts = Math.min(ship.mastMoves, a.path.length);
      const moved = { ...ship, pos: at, mastMoves: ship.mastMoves - fromMasts };
      let out: GameState = {
        ...s,
        ships: s.ships.map((sh) => (sh.id === ship.id ? moved : sh)),
        phase: { ...s.phase, moves: s.phase.moves - (a.path.length - fromMasts) },
      };
      // Treasure along the way counts too (sailing over an X picks it up).
      for (let i = 0; i < a.path.length; i++) {
        out = collectXs(out, { ...moved, pos: a.path[i] });
      }
      return out;
    }

    case "build": {
      if (s.phase.t !== "turn") return s;
      const player = s.turn;
      const cost = COSTS[a.item];
      if (!canAfford(s.players[player].hand, cost)) return s;
      if (a.item === "ship") {
        if (s.ships.filter((sh) => sh.owner === player).length >= MAX_SHIPS) return s;
        if (!shipSpots(s, player).some((p) => same(p, a.at))) return s;
        const ship: Ship = {
          id: s.nextShipId,
          owner: player,
          pos: a.at,
          lives: MAX_LIVES,
          masts: 0,
          cannons: 0,
          mastMoves: 0,
          docked: s.phase.roll !== null,
        };
        let out = pay(s, player, cost);
        out = { ...out, ships: [...out.ships, ship], nextShipId: s.nextShipId + 1 };
        out = collectXs(log(out, `${s.players[player].name} built a ship.`), ship);
        return checkWin(out);
      }
      const ship = s.ships.find((sh) => sh.id === a.ship);
      if (!ship || ship.owner !== player) return s;
      if (a.item === "mast" && ship.masts >= MAX_MASTS) return s;
      if (a.item === "cannon" && ship.cannons >= MAX_CANNONS) return s;
      if (a.item === "life" && ship.lives >= MAX_LIVES) return s;
      const upgraded: Ship = {
        ...ship,
        masts: ship.masts + (a.item === "mast" ? 1 : 0),
        cannons: ship.cannons + (a.item === "cannon" ? 1 : 0),
        lives: ship.lives + (a.item === "life" ? 1 : 0),
        // A mast built after the roll doesn't give an extra square this turn.
      };
      const out = pay(s, player, cost);
      return log(
        { ...out, ships: out.ships.map((sh) => (sh.id === ship.id ? upgraded : sh)) },
        `${s.players[player].name} built a ${a.item}.`,
      );
    }

    case "bury": {
      if (s.phase.t !== "turn") return s;
      const player = s.turn;
      if (s.players[player].hand.gold < GOLD_TO_BURY) return s;
      let out = pay(s, player, { gold: GOLD_TO_BURY });
      out = {
        ...out,
        players: out.players.map((p, i) => (i === player ? { ...p, plunderCards: p.plunderCards + 1 } : p)),
      };
      return checkWin(log(out, `${s.players[player].name} buried treasure for a Plunder Point.`));
    }

    case "endTurn": {
      if (s.phase.t !== "turn") return s;
      const turn = (s.turn + 1) % s.players.length;
      const ships = s.ships.map((sh) => ({ ...sh, mastMoves: 0, docked: false }));
      let out: GameState = { ...s, ships, turn, phase: { t: "turn", roll: null, moves: 0 } };
      // Start of the next turn: one resource card for every island they own.
      const owned = Object.values(s.owners).filter((o) => o === turn).length;
      out = draw(out, turn, owned);
      return out;
    }
  }
}
