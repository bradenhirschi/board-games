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
 * battles (attacking islands from their port and ships next door), a captain without a ship,
 * the storm, trading (players and merchant islands), threats, bribes and treaties, X-marks-the-spot
 * tokens, Plunder Points and winning. Not yet: the Treasure card deck (finding an X only says the
 * cards aren't written yet).
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
/** Cards paid each time a ship sails into or out of the storm. */
export const STORM_TOLL = 2;

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

/** What a battle was fought over. */
export type Target = { kind: "ship"; id: number } | { kind: "island"; id: string };

/** One side of a battle: the die rolled and the bonus added (cannons, or the island's skulls). */
export type BattleSide = { die: number; bonus: number };

export type Battle = {
  t: "battle";
  /** The attacking player. */
  player: number;
  /** Who was attacked: a ship's owner, an island's owner, or null for an unowned island. */
  defender: number | null;
  target: Target;
  at: Pos;
  attack: BattleSide;
  defense: BattleSide;
  /** Ties go to the attacker. */
  won: boolean;
  /** A ship that sank: the attacker's (lost) or the defender's (won). */
  sunk: "attacker" | "defender" | null;
  /** Who got a Plunder Point card for it, if anyone. */
  pointTo: number | null;
};

/** Something the player should be told about (shown as a message, then cleared by the UI). */
export type Notice =
  | { t: "treasure"; player: number; at: Pos }
  | { t: "drew"; player: number; cards: Resource[] }
  | Battle
  | { t: "doubles"; player: number; dice: [number, number] }
  | { t: "storm"; player: number; at: Pos }
  /** A deal went through: `player` and `with` swapped cards (`kind` says what sort of deal). */
  | { t: "deal"; player: number; with: number; kind: Trade["kind"]; gave: Cards; got: Cards }
  /** Nobody took `player`'s offer. */
  | { t: "noDeal"; player: number; kind: Trade["kind"] };

/**
 * A player who starts their turn without a ship: they may take a free card (no islands and no
 * Plunder Point cards), roll two dice for a free ship on doubles, or get one another way. Only one
 * ship comes from this; once placed, the turn carries on as normal.
 */
export type Captain = {
  /** Owed one free resource card of their choosing. */
  freeCard: boolean;
  /** Has rolled for doubles this turn. */
  rolled: boolean;
  /** Has gained their one ship (placed, or waiting in `spots` to be placed). */
  acquired: boolean;
  /** Where the new ship can be placed, while it waits to be placed. */
  spots: Pos[] | null;
};

/** Some resource cards, by type. */
export type Cards = Partial<Record<Resource, number>>;

/**
 * An offer on the table. `from` gives `give` to whoever takes it, and gets `get` back.
 * - "trade": the current player offers it to everyone they may trade with (or a counter-offer goes
 *   back to one player). Everyone answers in turn; the offerer picks one of those who accepted.
 * - "threat": the current player demands `get` from one player, giving nothing, or else.
 * - "bribe": a player about to be attacked offers `give` to the attacker to call it off.
 * Any deal that goes through makes a treaty between the two for the rest of the turn.
 */
export type Trade = {
  kind: "trade" | "threat" | "bribe";
  from: number;
  to: number[];
  give: Cards;
  get: Cards;
  /** Answers so far (a missing player hasn't answered yet). */
  answers: Record<number, "accept" | "decline">;
};

/** An attack on a player, waiting while the defender decides whether to offer a bribe. */
export type PendingAttack = {
  ship: number;
  target: Target;
  defender: number;
  stage: "bribe" | "fight";
  /** Bribes offered so far for this attack. */
  bribes?: number;
};

/** Ways a shipless captain can get a ship other than doubles. */
export type ShipVia = "build" | "plunder" | "gold" | { disown: string };

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
  /** This turn's battles, as "shipId>target", so a ship can't attack the same thing twice. */
  attacks?: string[];
  /** Set while the current player has no ships (see `Captain`). */
  captain?: Captain | null;
  /** The centre of the 3×3 storm (it can hang off the board). Missing in games saved before the storm. */
  storm?: Pos;
  /** The offer currently on the table, if any. */
  trade?: Trade | null;
  /** An attack on a player, waiting on a possible bribe. */
  pendingAttack?: PendingAttack | null;
  /** Players the current player has a treaty with this turn (they can't attack each other). */
  treaties?: number[];
  /** Trade offers the current player has made this turn (bots make one at most). */
  offers?: number;
  notices: Notice[];
  log: string[];
};

export type Action =
  | { t: "pickIsland"; island: string }
  | { t: "roll"; die: number }
  /** `pay` is the cards given for the storm: STORM_TOLL for each time the path crosses its border. */
  | { t: "sail"; ship: number; path: Pos[]; pay?: Resource[] }
  | { t: "build"; item: "ship"; at: Pos }
  | { t: "build"; item: "mast" | "cannon" | "life"; ship: number }
  | { t: "bury" }
  | { t: "attack"; ship: number; target: Target; attackDie: number; defenseDie: number }
  | { t: "freeCard"; resource: Resource }
  | { t: "rollDoubles"; dice: [number, number] }
  | { t: "getShip"; via: ShipVia }
  | { t: "placeShip"; at: Pos }
  | { t: "merchant"; give: [Resource, Resource]; get: Resource }
  | { t: "offer"; kind: "trade"; give: Cards; get: Cards }
  | { t: "offer"; kind: "threat"; to: number; get: Cards }
  /** The player whose answer is awaited (see `waitingOn`) accepts or declines. */
  | { t: "answer"; accept: boolean }
  /** The player whose answer is awaited sends a counter-offer back instead. */
  | { t: "counter"; give: Cards; get: Cards }
  /** The offerer picks one of the players who accepted. */
  | { t: "pickTrade"; with: number }
  | { t: "cancelTrade" }
  /** The defender of a pending attack offers a bribe, or lets the battle go ahead. */
  | { t: "bribe"; give: Cards }
  | { t: "noBribe" }
  | { t: "cancelAttack" }
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

// ---------------------------------------------------------------------------------------------
// The storm

/** Is a square inside the 3×3 storm? */
export function inStorm(s: GameState, p: Pos): boolean {
  const c = s.storm;
  return !!c && Math.abs(p.r - c.r) <= 1 && Math.abs(p.c - c.c) <= 1;
}

/** Are two squares on the same side of the storm's border (both inside, or both outside)? */
export function sameSide(s: GameState, a: Pos, b: Pos): boolean {
  return inStorm(s, a) === inStorm(s, b);
}

/** How many times a route (from `from`) crosses the storm's border. */
export function stormCrossings(s: GameState, from: Pos, path: Pos[]): number {
  let n = 0;
  let at = from;
  for (const p of path) {
    if (!sameSide(s, at, p)) n++;
    at = p;
  }
  return n;
}

/** The cards a route costs in storm tolls. */
export function stormToll(s: GameState, from: Pos, path: Pos[]): number {
  return stormCrossings(s, from, path) * STORM_TOLL;
}

/** Spin the compasses for the storm's centre. At the start it mustn't cover a one-skull island's port. */
function placeStorm(s: GameState, initial: boolean): GameState {
  const ports = initial ? startingIslands(s.layout).flatMap((i) => i.ports) : [];
  let rng = s.rng;
  let at: Pos;
  let tries = 0;
  do {
    [at, rng] = spin(rng);
    tries++;
  } while (ports.some((p) => Math.abs(p.r - at.r) <= 1 && Math.abs(p.c - at.c) <= 1) && tries < 100);
  return { ...s, storm: at, rng };
}

const handSize = (h: Hand) => RESOURCES.reduce((n, r) => n + h[r], 0);

/**
 * Every square a ship can reach this turn, with the path to it. Of the routes that fit in the
 * moves left, it picks the one crossing the storm's border the fewest times (each crossing costs
 * STORM_TOLL cards), then the shortest; squares whose toll the player can't pay are left out. Ships sail orthogonally,
 * can't cross land, barriers or the land side of half land, and can't pass through other ships.
 */
export function reachable(s: GameState, ship: Ship): Map<string, Pos[]> {
  const map = mapOf(s.layout);
  const budget = movesFor(s, ship);
  const cards = handSize(s.players[ship.owner].hand);
  const key = (p: Pos) => `${p.r},${p.c}`;
  // Best route to each square: fewest crossings, then fewest squares.
  const best = new Map<string, { path: Pos[]; cross: number }>([[key(ship.pos), { path: [], cross: 0 }]]);
  let frontier = [{ p: ship.pos, path: [] as Pos[], cross: 0 }];
  for (let d = 0; d < budget; d++) {
    const next: typeof frontier = [];
    for (const { p, path, cross } of frontier) {
      for (const side of SIDES) {
        const q = step(p, side);
        if (!canSail(map, p, side) || shipAt(s, q)) continue;
        const c = cross + (sameSide(s, p, q) ? 0 : 1);
        if (c * STORM_TOLL > cards) continue;
        const prev = best.get(key(q));
        if (prev && prev.cross <= c) continue;
        const entry = { p: q, path: [...path, q], cross: c };
        best.set(key(q), { path: entry.path, cross: c });
        next.push(entry);
      }
    }
    frontier = next;
  }
  best.delete(key(ship.pos));
  return new Map([...best].map(([k, v]) => [k, v.path]));
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
    for (const side of SIDES) {
      const q = step(sh.pos, side);
      // Not across the storm's border.
      if (canSail(map, sh.pos, side) && sameSide(s, sh.pos, q)) add(q);
    }
  }
  return spots;
}

// ---------------------------------------------------------------------------------------------
// Battles

const targetKey = (t: Target) => (t.kind === "ship" ? `s${t.id}` : `i${t.id}`);

/** Has this ship already attacked this target this turn? */
export function attackedAlready(s: GameState, ship: number, t: Target): boolean {
  return (s.attacks ?? []).includes(`${ship}>${targetKey(t)}`);
}

/**
 * Everything a ship can attack right now: enemy ships next to it (not diagonally, not across land or
 * a barrier, docked or not), and the resource island whose port it's in (unless it already owns it).
 * Merchant and normal islands can't be attacked. Each target only once per ship per turn.
 */
export function attackTargets(s: GameState, ship: Ship): Target[] {
  if (s.phase.t !== "turn" || ship.owner !== s.turn) return [];
  const map = mapOf(s.layout);
  const out: Target[] = [];
  for (const side of SIDES) {
    const enemy = shipAt(s, step(ship.pos, side));
    if (enemy && enemy.owner !== ship.owner && canSail(map, ship.pos, side) && sameSide(s, ship.pos, enemy.pos)) {
      out.push({ kind: "ship", id: enemy.id });
    }
  }
  for (const isl of islandsOf(s.layout)) {
    if (isl.kind !== "resource" || s.owners[isl.id] === ship.owner) continue;
    if (isl.ports.some((p) => same(p, ship.pos))) out.push({ kind: "island", id: isl.id });
  }
  // No attacking a player you have a treaty with this turn.
  const treaties = s.treaties ?? [];
  const owner = (t: Target) => (t.kind === "ship" ? s.ships.find((sh) => sh.id === t.id)?.owner : s.owners[t.id]);
  return out.filter((t) => !attackedAlready(s, ship.id, t) && !treaties.includes(owner(t) ?? -1));
}

/** The defender's bonus: the defending ship's cannons, or the island's skulls. */
export function defenseBonus(s: GameState, t: Target): number {
  if (t.kind === "ship") return s.ships.find((sh) => sh.id === t.id)?.cannons ?? 0;
  return islandsOf(s.layout).find((i) => i.id === t.id)?.skulls ?? 0;
}

/** The chance an attack wins: die + attack bonus beats or ties die + defence bonus. */
export function winChance(attackBonus: number, defenseBonus: number): number {
  let wins = 0;
  for (let a = 1; a <= 6; a++) for (let d = 1; d <= 6; d++) if (a + attackBonus >= d + defenseBonus) wins++;
  return wins / 36;
}

/** Take a life from a ship; at no lives it sinks (its masts and cannons go back to the supply). */
function hit(s: GameState, shipId: number): [GameState, boolean] {
  const ship = s.ships.find((sh) => sh.id === shipId)!;
  if (ship.lives > 1) {
    return [{ ...s, ships: s.ships.map((sh) => (sh.id === shipId ? { ...sh, lives: sh.lives - 1 } : sh)) }, false];
  }
  return [{ ...s, ships: s.ships.filter((sh) => sh.id !== shipId) }, true];
}

function givePlunderCard(s: GameState, player: number): GameState {
  return { ...s, players: s.players.map((p, i) => (i === player ? { ...p, plunderCards: p.plunderCards + 1 } : p)) };
}

/**
 * Where a shipless captain's new ship can go: an empty port of an island they own; if there's none,
 * the compasses pick a square (`spin`), and if that's land or taken, any open square next to it.
 */
function captainSpots(s: GameState, player: number): [Pos[], number] {
  const map = mapOf(s.layout);
  const open = (p: Pos) => isSailable(map.squares[p.r]?.[p.c]) && !shipAt(s, p);
  const ports = islandsOf(s.layout)
    .filter((i) => s.owners[i.id] === player)
    .flatMap((i) => i.ports)
    .filter(open);
  if (ports.length) return [ports, s.rng];
  let rng = s.rng;
  for (let tries = 0; tries < 50; tries++) {
    let p: Pos;
    [p, rng] = spin(rng);
    if (open(p)) return [[p], rng];
    const around = SIDES.map((side) => step(p, side)).filter(open);
    if (around.length) return [around, rng];
  }
  return [[], rng];
}

// ---------------------------------------------------------------------------------------------
// Trading

export const cardCount = (c: Cards) => RESOURCES.reduce((n, r) => n + (c[r] ?? 0), 0);

/** Does a hand hold these cards? */
export function hasCards(hand: Hand, c: Cards): boolean {
  return RESOURCES.every((r) => hand[r] >= (c[r] ?? 0) && (c[r] ?? 0) >= 0);
}

/** A player's ships sitting in ports the storm doesn't cover. */
function portsInUse(s: GameState, player: number): { ship: Ship; island: string }[] {
  const out: { ship: Ship; island: string }[] = [];
  for (const isl of islandsOf(s.layout)) {
    for (const sh of s.ships) {
      if (sh.owner === player && isl.ports.some((p) => same(p, sh.pos)) && !inStorm(s, sh.pos)) {
        out.push({ ship: sh, island: isl.id });
      }
    }
  }
  return out;
}

/** Is the player docked at a merchant island (through a port the storm doesn't cover)? */
export function atMerchant(s: GameState, player: number): boolean {
  const merchants = new Set(
    islandsOf(s.layout)
      .filter((i) => i.kind === "merchant")
      .map((i) => i.id),
  );
  return portsInUse(s, player).some((d) => merchants.has(d.island));
}

/** Is a ship of `a` in a port of an island `b` owns, or are their ships side by side (not across land or the storm's edge)? */
function closeEnough(s: GameState, a: number, b: number): boolean {
  const inPortOf = (x: number, y: number) => portsInUse(s, x).some((d) => s.owners[d.island] === y);
  if (inPortOf(a, b) || inPortOf(b, a)) return true;
  const map = mapOf(s.layout);
  for (const sh of s.ships) {
    if (sh.owner !== a) continue;
    for (const side of SIDES) {
      const other = shipAt(s, step(sh.pos, side));
      if (other?.owner === b && canSail(map, sh.pos, side) && sameSide(s, sh.pos, other.pos)) return true;
    }
  }
  return false;
}

/** Players `a` may trade with: positioned as the rules say, or anyone if either is docked at a merchant island. */
export function tradePartners(s: GameState, a: number): number[] {
  return s.players
    .map((_, b) => b)
    .filter((b) => b !== a && (atMerchant(s, a) || atMerchant(s, b) || closeEnough(s, a, b)));
}

/** Players `a` may threaten: in their port, or ship beside ship (a merchant island doesn't count). */
export function threatTargets(s: GameState, a: number): number[] {
  return s.players.map((_, b) => b).filter((b) => b !== a && closeEnough(s, a, b));
}

/** Who the game is waiting on: someone answering an offer or deciding on a bribe, else the current player. */
export function waitingOn(s: GameState): number {
  if (s.phase.t === "pickIsland") return s.phase.order[s.phase.index];
  const t = s.trade;
  if (t) {
    // Answers come in seat order, starting after the offerer.
    const n = s.players.length;
    const order = [...t.to].sort((x, y) => ((x - t.from + n) % n) - ((y - t.from + n) % n));
    return order.find((p) => !t.answers[p]) ?? t.from;
  }
  if (s.pendingAttack?.stage === "bribe") return s.pendingAttack.defender;
  return s.turn;
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
    storm: undefined,
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
  // The storm: spun like everything else, but not over a starting island's port.
  s = placeStorm(s, true);
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

/** The first player to reach ten points wins at once (the current player first, then the rest in turn order). */
function checkWin(s: GameState): GameState {
  if (s.phase.t === "gameOver") return s;
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const p = (s.turn + k) % n;
    if (points(s, p) >= WIN_POINTS)
      return log({ ...s, phase: { t: "gameOver", winner: p } }, `${s.players[p].name} wins!`);
  }
  return s;
}

/** Take one card of a chosen resource: from its face-up pile, or out of the deck if the pile is empty. */
function takeCard(s: GameState, player: number, r: Resource): GameState {
  const piles = { ...s.piles };
  let deck = s.deck;
  if (piles[r] > 0) piles[r]--;
  else {
    const i = deck.lastIndexOf(r);
    if (i < 0) return s;
    deck = [...deck.slice(0, i), ...deck.slice(i + 1)];
  }
  const players = s.players.map((p, i) => (i === player ? { ...p, hand: { ...p.hand, [r]: p.hand[r] + 1 } } : p));
  return { ...s, piles, deck, players };
}

/** A shipless captain gets their one ship: work out where it can be placed. */
function acquireShip(s: GameState): GameState {
  const [spots, rng] = captainSpots(s, s.turn);
  return { ...s, rng, captain: { ...s.captain!, acquired: true, spots } };
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
    if (!onIt && !(fromNextDoor && sameSide(out, ship.pos, x))) continue;
    const [p, rng] = spin(out.rng);
    const xs = out.xs.map((q, k) => (k === i ? p : q));
    out = log(
      { ...out, xs, rng, notices: [...out.notices, { t: "treasure", player: ship.owner, at: x }] },
      `${out.players[ship.owner].name} found treasure!`,
    );
  }
  return out;
}

/** Actions that answer an open offer or a pending bribe; while one is open, nothing else can happen. */
const NEGOTIATION = new Set<Action["t"]>([
  "answer",
  "counter",
  "pickTrade",
  "cancelTrade",
  "bribe",
  "noBribe",
  "cancelAttack",
]);

/** Move cards from one player's hand to another's. */
function transfer(s: GameState, from: number, to: number, c: Cards): GameState {
  return {
    ...s,
    players: s.players.map((p, i) => {
      if (i !== from && i !== to) return p;
      const hand = { ...p.hand };
      for (const r of RESOURCES) hand[r] += (i === to ? 1 : -1) * (c[r] ?? 0);
      return { ...p, hand };
    }),
  };
}

/** Carry out an accepted deal between the offerer and `partner`, and make them a treaty for the turn. */
function closeDeal(s: GameState, t: Trade, partner: number): GameState {
  if (!hasCards(s.players[t.from].hand, t.give) || !hasCards(s.players[partner].hand, t.get)) return s;
  let out = transfer(s, t.from, partner, t.give);
  out = transfer(out, partner, t.from, t.get);
  const other = t.from === s.turn ? partner : t.from;
  const treaties = [...new Set([...(s.treaties ?? []), other])];
  const deal: Notice = { t: "deal", player: t.from, with: partner, kind: t.kind, gave: t.give, got: t.get };
  out = { ...out, trade: null, treaties, notices: [...out.notices, deal] };
  // A bribe calls off the attack.
  if (t.kind === "bribe") out = { ...out, pendingAttack: null };
  const what = t.kind === "trade" ? "traded with" : t.kind === "threat" ? "gave in to a threat from" : "bribed";
  return log(
    out,
    `${s.players[t.kind === "threat" ? partner : t.from].name} ${what} ${s.players[t.kind === "threat" ? t.from : partner].name}.`,
  );
}

const validCards = (c: Cards) => RESOURCES.every((r) => Number.isInteger(c[r] ?? 0) && (c[r] ?? 0) >= 0);

export function reducer(s: GameState, a: Action): GameState {
  if (s.phase.t === "gameOver" && a.t !== "clearNotices") return s;
  // While an offer is on the table or a bribe is being decided, only answers to it are allowed.
  if ((s.trade || s.pendingAttack?.stage === "bribe") && !NEGOTIATION.has(a.t) && a.t !== "clearNotices") return s;
  if (s.pendingAttack?.stage === "fight" && a.t !== "attack" && a.t !== "cancelAttack" && a.t !== "clearNotices") {
    return s;
  }
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
      let out = log(
        { ...s, ships, phase: { t: "turn", roll: a.die, moves: a.die } },
        `${s.players[s.turn].name} rolled ${a.die}.`,
      );
      // A one moves the storm (and the ship still sails its one square).
      if (a.die === 1 && s.storm) {
        out = placeStorm(out, false);
        out = { ...out, notices: [...out.notices, { t: "storm", player: s.turn, at: out.storm! }] };
      }
      return out;
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
      // Storm tolls: exactly the cards owed, from the player's hand.
      const toll = stormToll(s, ship.pos, a.path);
      const cards = a.pay ?? [];
      if (cards.length !== toll) return s;
      const cost: Partial<Hand> = {};
      for (const r of cards) cost[r] = (cost[r] ?? 0) + 1;
      if (!canAfford(s.players[ship.owner].hand, cost)) return s;
      const paid = toll
        ? log(pay(s, ship.owner, cost), `${s.players[ship.owner].name} paid ${toll} cards to the storm.`)
        : s;
      // Masts' extra squares are used first, then the shared roll.
      const fromMasts = Math.min(ship.mastMoves, a.path.length);
      const moved = { ...ship, pos: at, mastMoves: ship.mastMoves - fromMasts };
      let out: GameState = {
        ...paid,
        ships: paid.ships.map((sh) => (sh.id === ship.id ? moved : sh)),
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
        const fleet = s.ships.filter((sh) => sh.owner === player).length;
        // A captain without a ship builds through `getShip` instead.
        if (fleet === 0 || fleet >= MAX_SHIPS) return s;
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

    case "attack": {
      if (s.phase.t !== "turn") return s;
      const ship = s.ships.find((sh) => sh.id === a.ship);
      if (!ship || ship.owner !== s.turn) return s;
      if (!attackTargets(s, ship).some((t) => targetKey(t) === targetKey(a.target))) return s;
      // Attacking a player: first they get the chance to offer a bribe.
      const victim =
        a.target.kind === "ship"
          ? s.ships.find((sh) => sh.id === (a.target as { id: number }).id)!.owner
          : s.owners[a.target.id];
      const pending = s.pendingAttack;
      const agreed =
        pending?.stage === "fight" && pending.ship === ship.id && targetKey(pending.target) === targetKey(a.target);
      if (victim !== undefined && !agreed) {
        return { ...s, pendingAttack: { ship: ship.id, target: a.target, defender: victim, stage: "bribe" } };
      }
      const ok = (d: number) => Number.isInteger(d) && d >= 1 && d <= 6;
      if (!ok(a.attackDie) || !ok(a.defenseDie)) return s;
      const attacker = ship.owner;
      const attack = { die: a.attackDie, bonus: ship.cannons };
      const defense = { die: a.defenseDie, bonus: defenseBonus(s, a.target) };
      const won = attack.die + attack.bonus >= defense.die + defense.bonus;
      let out: GameState = {
        ...s,
        pendingAttack: null,
        attacks: [...(s.attacks ?? []), `${ship.id}>${targetKey(a.target)}`],
      };
      let defender: number | null;
      let at: Pos;
      let sunk: Battle["sunk"] = null;
      let pointTo: number | null = null;
      let didSink = false;
      const name = (p: number | null) => (p === null ? "an unowned island" : s.players[p].name);
      if (a.target.kind === "ship") {
        const targetId = a.target.id;
        const target = s.ships.find((sh) => sh.id === targetId)!;
        defender = target.owner;
        at = target.pos;
        if (won) {
          [out, didSink] = hit(out, target.id);
          if (didSink) [sunk, pointTo] = ["defender", attacker];
        } else {
          [out, didSink] = hit(out, ship.id);
          if (didSink) [sunk, pointTo] = ["attacker", defender];
        }
        out = log(out, `${name(attacker)} attacked ${name(defender)}'s ship and ${won ? "won" : "lost"}.`);
      } else {
        const islandId = a.target.id;
        defender = s.owners[islandId] ?? null;
        at = ship.pos;
        if (won) {
          out = { ...out, owners: { ...out.owners, [islandId]: attacker } };
          out = log(out, `${name(attacker)} conquered an island${defender === null ? "" : ` from ${name(defender)}`}.`);
        } else {
          [out, didSink] = hit(out, ship.id);
          // Sinking against an unowned island earns nobody a card.
          if (didSink) [sunk, pointTo] = ["attacker", defender];
          out = log(out, `${name(attacker)} attacked ${name(defender)} and was driven off.`);
        }
      }
      if (pointTo !== null) out = givePlunderCard(out, pointTo);
      const battle: Battle = {
        t: "battle",
        player: attacker,
        defender,
        target: a.target,
        at,
        attack,
        defense,
        won,
        sunk,
        pointTo,
      };
      out = checkWin({ ...out, notices: [...out.notices, battle] });
      // A turn ends when your last ship sinks.
      if (out.phase.t === "turn" && !out.ships.some((sh) => sh.owner === attacker))
        out = reducer(out, { t: "endTurn" });
      return out;
    }

    case "freeCard": {
      if (s.phase.t !== "turn" || !s.captain?.freeCard) return s;
      return { ...takeCard(s, s.turn, a.resource), captain: { ...s.captain, freeCard: false } };
    }

    case "rollDoubles": {
      const c = s.captain;
      if (s.phase.t !== "turn" || !c || c.rolled || c.acquired) return s;
      const [d1, d2] = a.dice;
      if (![d1, d2].every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) return s;
      let out: GameState = {
        ...s,
        captain: { ...c, rolled: true },
        notices: [...s.notices, { t: "doubles", player: s.turn, dice: [d1, d2] }],
      };
      if (d1 === d2) out = acquireShip(log(out, `${s.players[s.turn].name} rolled doubles for a new ship.`));
      return out;
    }

    case "getShip": {
      const c = s.captain;
      if (s.phase.t !== "turn" || !c || c.acquired) return s;
      const player = s.turn;
      const me = s.players[player];
      let out: GameState;
      if (a.via === "build") {
        if (!canAfford(me.hand, COSTS.ship)) return s;
        out = pay(s, player, COSTS.ship);
      } else if (a.via === "gold") {
        if (me.hand.gold < GOLD_TO_BURY) return s;
        out = pay(s, player, { gold: GOLD_TO_BURY });
      } else if (a.via === "plunder") {
        if (me.plunderCards < 1) return s;
        out = {
          ...s,
          players: s.players.map((p, i) => (i === player ? { ...p, plunderCards: p.plunderCards - 1 } : p)),
        };
      } else {
        if (s.owners[a.via.disown] !== player) return s;
        const owners = { ...s.owners };
        delete owners[a.via.disown];
        out = { ...s, owners };
      }
      return acquireShip(log(out, `${me.name} got a new ship.`));
    }

    case "placeShip": {
      const c = s.captain;
      if (s.phase.t !== "turn" || !c?.spots || !c.spots.some((p) => same(p, a.at))) return s;
      const ship: Ship = {
        id: s.nextShipId,
        owner: s.turn,
        pos: a.at,
        lives: MAX_LIVES,
        masts: 0,
        cannons: 0,
        mastMoves: 0,
        docked: s.phase.roll !== null,
      };
      // With a ship in play, the turn carries on like any other.
      const out: GameState = { ...s, ships: [...s.ships, ship], nextShipId: s.nextShipId + 1, captain: null };
      return checkWin(collectXs(out, ship));
    }

    case "merchant": {
      if (s.phase.t !== "turn" || !atMerchant(s, s.turn) || a.give.length !== 2) return s;
      const cost: Cards = {};
      for (const r of a.give) cost[r] = (cost[r] ?? 0) + 1;
      if (!hasCards(s.players[s.turn].hand, cost)) return s;
      const out = takeCard(pay(s, s.turn, cost), s.turn, a.get);
      return log(out, `${s.players[s.turn].name} traded at a merchant island.`);
    }

    case "offer": {
      if (s.phase.t !== "turn") return s;
      const me = s.turn;
      if (a.kind === "trade") {
        if (!validCards(a.give) || !validCards(a.get) || !cardCount(a.give) || !cardCount(a.get)) return s;
        if (!hasCards(s.players[me].hand, a.give)) return s;
        const to = tradePartners(s, me);
        if (!to.length) return s;
        return {
          ...s,
          offers: (s.offers ?? 0) + 1,
          trade: { kind: "trade", from: me, to, give: a.give, get: a.get, answers: {} },
        };
      }
      if (!validCards(a.get) || !cardCount(a.get) || !threatTargets(s, me).includes(a.to)) return s;
      return {
        ...s,
        offers: (s.offers ?? 0) + 1,
        trade: { kind: "threat", from: me, to: [a.to], give: {}, get: a.get, answers: {} },
      };
    }

    case "answer": {
      const t = s.trade;
      if (!t) return s;
      const who = waitingOn(s);
      if (who === t.from || !t.to.includes(who)) return s;
      // Can't accept without the cards they're asking for.
      if (a.accept && !hasCards(s.players[who].hand, t.get)) return s;
      const answers = { ...t.answers, [who]: a.accept ? ("accept" as const) : ("decline" as const) };
      const trade = { ...t, answers };
      // With one player asked (a counter-offer, a threat, a bribe), their yes closes the deal.
      if (a.accept && t.to.length === 1) return closeDeal({ ...s, trade }, trade, who);
      // Everyone said no: the offer is withdrawn.
      if (t.to.every((p) => answers[p] === "decline")) {
        return { ...s, trade: null, notices: [...s.notices, { t: "noDeal", player: t.from, kind: t.kind }] };
      }
      return { ...s, trade };
    }

    case "counter": {
      const t = s.trade;
      if (!t || t.kind !== "trade") return s;
      const who = waitingOn(s);
      if (who === t.from) return s;
      if (!validCards(a.give) || !validCards(a.get) || !cardCount(a.give) || !cardCount(a.get)) return s;
      if (!hasCards(s.players[who].hand, a.give)) return s;
      // The counter replaces the offer, between just these two.
      return { ...s, trade: { kind: "trade", from: who, to: [t.from], give: a.give, get: a.get, answers: {} } };
    }

    case "pickTrade": {
      const t = s.trade;
      if (!t || t.answers[a.with] !== "accept" || waitingOn(s) !== t.from) return s;
      return closeDeal(s, t, a.with);
    }

    case "cancelTrade": {
      if (!s.trade || waitingOn(s) !== s.trade.from) return s;
      return { ...s, trade: null };
    }

    case "bribe": {
      const pa = s.pendingAttack;
      if (!pa || pa.stage !== "bribe" || s.trade) return s;
      if (!validCards(a.give) || !cardCount(a.give) || !hasCards(s.players[pa.defender].hand, a.give)) return s;
      return {
        ...s,
        pendingAttack: { ...pa, bribes: (pa.bribes ?? 0) + 1 },
        trade: { kind: "bribe", from: pa.defender, to: [s.turn], give: a.give, get: {}, answers: {} },
      };
    }

    case "noBribe": {
      const pa = s.pendingAttack;
      if (!pa || pa.stage !== "bribe" || s.trade) return s;
      return { ...s, pendingAttack: { ...pa, stage: "fight" } };
    }

    case "cancelAttack": {
      if (!s.pendingAttack || s.trade) return s;
      return { ...s, pendingAttack: null };
    }

    case "endTurn": {
      if (s.phase.t !== "turn") return s;
      const turn = (s.turn + 1) % s.players.length;
      const ships = s.ships.map((sh) => ({ ...sh, mastMoves: 0, docked: false }));
      let out: GameState = {
        ...s,
        ships,
        turn,
        phase: { t: "turn", roll: null, moves: 0 },
        attacks: [],
        captain: null,
        trade: null,
        pendingAttack: null,
        treaties: [],
        offers: 0,
      };
      // Start of the next turn: one resource card for every island they own, except islands with
      // every port inside the storm.
      const owned = Object.values(s.owners).filter((o) => o === turn).length;
      const producing = islandsOf(s.layout).filter(
        (i) => s.owners[i.id] === turn && !(i.ports.length && i.ports.every((p) => inStorm(s, p))),
      ).length;
      out = draw(out, turn, producing);
      // No ships: a captain without a ship (a free card if they have no islands or Plunder Point cards).
      if (!out.ships.some((sh) => sh.owner === turn)) {
        const freeCard = owned === 0 && out.players[turn].plunderCards === 0;
        out = { ...out, captain: { freeCard, rolled: false, acquired: false, spots: null } };
      }
      return out;
    }
  }
}
