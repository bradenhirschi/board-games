/**
 * Plunder's computer players. `botAction` returns the next thing a bot does on its turn, one action at
 * a time, so the UI can show each move. A bot never sees anything a human couldn't (other players'
 * cards aren't used). Returns null when it isn't a bot's move.
 *
 * Basic strategy for now (no storm or trading exist yet):
 * - Picking an island: the free one-skull island with the most open water around it.
 * - Without a ship: take the free card (gold), roll for doubles, then buy a ship if it can.
 * - Building: bury gold when it has five, repair a damaged ship, build a ship, masts (only before
 *   the roll, when they help this turn), then cannons.
 * - Fighting: attacks whenever the odds are good (an island at 50% or better, a ship at 55% or
 *   better, and only long shots when a damaged ship could sink).
 * - Sailing: heads for the port of an island worth attacking, or for treasure, taking it this turn
 *   if it can, otherwise getting as close as it can. Spare moves go to the next ship.
 */

import {
  COSTS,
  GOLD_TO_BURY,
  MAX_LIVES,
  attackTargets,
  defenseBonus,
  islandsOf,
  winChance,
  MAX_CANNONS,
  MAX_MASTS,
  MAX_SHIPS,
  canAfford,
  mapOf,
  reachable,
  shipAt,
  shipSpots,
  startingIslands,
  type Action,
  type GameState,
  type Ship,
} from "./engine";
import { SIDES, canSail, edgeKey, isSailable, type Pos, type Side } from "./tiles";

const STEP: Record<Side, Pos> = { N: { r: -1, c: 0 }, E: { r: 0, c: 1 }, S: { r: 1, c: 0 }, W: { r: 0, c: -1 } };
const key = (p: Pos) => `${p.r},${p.c}`;

/** Whose move it is: the picker during island picking, otherwise the player whose turn it is. */
export function actingPlayer(s: GameState): number | null {
  if (s.phase.t === "pickIsland") return s.phase.order[s.phase.index];
  if (s.phase.t === "turn") return s.turn;
  return null;
}

export function isBotMove(s: GameState): boolean {
  const p = actingPlayer(s);
  return p !== null && !!s.players[p].isBot;
}

/** Squares from which an X can be collected: the X itself if it's water, or the water beside it if it's on land. */
function collectSquares(s: GameState, x: Pos): Pos[] {
  const map = mapOf(s.layout);
  if (isSailable(map.squares[x.r]?.[x.c])) return [x];
  const out: Pos[] = [];
  for (const side of SIDES) {
    const p = { r: x.r + STEP[side].r, c: x.c + STEP[side].c };
    const back = ({ N: "S", E: "W", S: "N", W: "E" } as const)[side];
    if (isSailable(map.squares[p.r]?.[p.c]) && canSailEdge(s, p, back)) out.push(p);
  }
  return out;
}

/** Can a ship at `p` reach across the edge on `side` (no barrier there)? Used for collecting an X on land. */
function canSailEdge(s: GameState, p: Pos, side: Side): boolean {
  return !mapOf(s.layout).walls.has(edgeKey(p, side));
}

/** Sailing distance from every square to the nearest of `targets` (ignoring other ships). */
function distances(s: GameState, targets: Pos[]): Map<string, number> {
  const map = mapOf(s.layout);
  const dist = new Map<string, number>();
  let frontier = targets;
  for (const t of targets) dist.set(key(t), 0);
  for (let d = 1; frontier.length; d++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (const side of SIDES) {
        const q = { r: p.r + STEP[side].r, c: p.c + STEP[side].c };
        // Distance runs backwards from the targets, so check the move from q into p.
        const back = ({ N: "S", E: "W", S: "N", W: "E" } as const)[side];
        if (dist.has(key(q)) || !canSail(map, q, back)) continue;
        dist.set(key(q), d);
        next.push(q);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Is this battle worth fighting? */
function worthIt(ship: Ship, chance: number, island: boolean): boolean {
  // A ship on its last life only takes near-certain fights.
  if (ship.lives === 1) return chance >= 0.8;
  return chance >= (island ? 0.5 : 0.55);
}

/** Ports of islands this ship would like to attack (not already attacked by it this turn). */
function islandGoals(s: GameState, ship: Ship): Pos[] {
  return islandsOf(s.layout)
    .filter((i) => i.kind === "resource" && s.owners[i.id] !== ship.owner)
    .filter((i) => !(s.attacks ?? []).includes(`${ship.id}>i${i.id}`))
    .filter((i) => worthIt(ship, winChance(ship.cannons, i.skulls), true))
    .flatMap((i) => i.ports.filter((p) => !shipAt(s, p)));
}

/** The best sail for one ship this turn, or null if it has nowhere useful to go. */
function bestSail(s: GameState, ship: Ship): Pos[] | null {
  const reach = reachable(s, ship);
  if (!reach.size) return null;
  const xSquares = s.xs.flatMap((x) => collectSquares(s, x));
  const ports = islandGoals(s, ship);
  const targets = [...xSquares, ...ports];
  if (!targets.length) return null;
  const xKeys = new Set(xSquares.map(key));
  const portKeys = new Set(ports.map(key));
  // Reachable this turn: ending in a port worth attacking scores most, then Xs collected on the way.
  let best: Pos[] | null = null;
  let bestScore = 0;
  for (const path of reach.values()) {
    const hits = new Set(path.filter((p) => xKeys.has(key(p))).map(key)).size;
    const port = portKeys.has(key(path[path.length - 1])) ? 1 : 0;
    const score = port * 250 + hits * 100 - path.length;
    if ((hits || port) && score > bestScore) [best, bestScore] = [path, score];
  }
  if (best) return best;
  // Otherwise get as close as possible to the nearest goal.
  const dist = distances(s, targets);
  const here = dist.get(key(ship.pos)) ?? Infinity;
  let closest: Pos[] | null = null;
  let closestDist = here;
  for (const path of reach.values()) {
    const d = dist.get(key(path[path.length - 1])) ?? Infinity;
    if (d < closestDist || (d === closestDist && closest && path.length < closest.length)) {
      [closest, closestDist] = [path, d];
    }
  }
  return closest;
}

/** How much open water surrounds an island's ports: a rough "room to move" score for picking. */
function openness(s: GameState, ports: Pos[]): number {
  const dist = distances(s, ports);
  let n = 0;
  for (const d of dist.values()) if (d <= 4) n++;
  return n;
}

/**
 * The bot's next action, or null if it isn't a bot's move. Dice come back as 0 (a roll, an attack's
 * dice, or rolling for doubles): the caller rolls them (so it can animate them) and fills them in.
 */
export function botAction(s: GameState): Action | null {
  if (!isBotMove(s)) return null;
  const me = actingPlayer(s)!;

  if (s.phase.t === "pickIsland") {
    const free = startingIslands(s.layout).filter(
      (i) => s.owners[i.id] === undefined && i.ports.some((p) => !shipAt(s, p)),
    );
    if (!free.length) return null;
    const pick = free.reduce((a, b) => (openness(s, b.ports) > openness(s, a.ports) ? b : a));
    return { t: "pickIsland", island: pick.id };
  }

  if (s.phase.t !== "turn") return null;
  const hand = s.players[me].hand;
  const ships = s.ships.filter((sh) => sh.owner === me);

  // A captain without a ship: free card, doubles, then any affordable way to get one.
  const c = s.captain;
  if (c && !ships.length) {
    if (c.freeCard) return { t: "freeCard", resource: "gold" };
    if (c.spots?.length) return { t: "placeShip", at: c.spots[0] };
    if (!c.acquired) {
      if (!c.rolled) return { t: "rollDoubles", dice: [0, 0] };
      if (canAfford(hand, COSTS.ship)) return { t: "getShip", via: "build" };
      if (hand.gold >= GOLD_TO_BURY) return { t: "getShip", via: "gold" };
    }
    return { t: "endTurn" };
  }

  // Building: points first, then repairs, then a bigger fleet, then upgrades.
  if (hand.gold >= GOLD_TO_BURY) return { t: "bury" };
  if (canAfford(hand, COSTS.life)) {
    const hurt = ships.find((sh) => sh.lives < MAX_LIVES);
    if (hurt) return { t: "build", item: "life", ship: hurt.id };
  }
  if (ships.length < MAX_SHIPS && canAfford(hand, COSTS.ship)) {
    const spots = shipSpots(s, me);
    if (spots.length) {
      // Place it where it's closest to an X, so it can go treasure hunting.
      const dist = distances(
        s,
        s.xs.flatMap((x) => collectSquares(s, x)),
      );
      const at = spots.reduce((a, b) => ((dist.get(key(b)) ?? 99) < (dist.get(key(a)) ?? 99) ? b : a));
      return { t: "build", item: "ship", at };
    }
  }
  if (s.phase.roll === null && canAfford(hand, COSTS.mast)) {
    const ship = ships.find((sh) => sh.masts < MAX_MASTS);
    if (ship) return { t: "build", item: "mast", ship: ship.id };
  }
  if (canAfford(hand, COSTS.cannon)) {
    const ship = ships.find((sh) => sh.cannons < MAX_CANNONS);
    if (ship) return { t: "build", item: "cannon", ship: ship.id };
  }

  // Fight anything worth fighting from where the ships are now.
  for (const ship of ships) {
    for (const target of attackTargets(s, ship)) {
      const chance = winChance(ship.cannons, defenseBonus(s, target));
      if (worthIt(ship, chance, target.kind === "island")) {
        return { t: "attack", ship: ship.id, target, attackDie: 0, defenseDie: 0 };
      }
    }
  }

  if (s.phase.roll === null) return { t: "roll", die: 0 };

  // Sailing: the first ship with somewhere useful to go.
  for (const ship of ships) {
    const path = bestSail(s, ship);
    if (path) return { t: "sail", ship: ship.id, path };
  }
  return { t: "endTurn" };
}

/** Fill in the dice a bot's action left as 0, using `d6` to roll each one. */
export function fillDice(a: Action, d6: () => number): Action {
  if (a.t === "roll") return { ...a, die: d6() };
  if (a.t === "attack") return { ...a, attackDie: d6(), defenseDie: d6() };
  if (a.t === "rollDoubles") return { ...a, dice: [d6(), d6()] };
  return a;
}
