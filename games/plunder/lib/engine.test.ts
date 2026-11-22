import { describe, expect, it } from "vitest";
import {
  CARDS_PER_RESOURCE,
  COSTS,
  MAX_SHIPS,
  STARTING_CARDS,
  newGame,
  points,
  randomLayout,
  reachable,
  reducer,
  shipSpots,
  startingIslands,
  type Action,
  type GameState,
  type Hand,
} from "./engine";
import { parseTile } from "./board";
import { DEFAULT_LAYOUT, type Pos } from "./tiles";

/** Board square by name, like "B2", as a 0-based position. */
function sq(name: string): Pos {
  const t = parseTile(name)!;
  return { r: t.row, c: t.col - 1 };
}

const setup = [
  { name: "Anne", color: "red" as const },
  { name: "Bart", color: "purple" as const },
];

function play(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce(reducer, s);
}

/**
 * Two players on the sample board. Bart rolls higher and picks first (tile 4's islet); Anne picks
 * last (tile 1's B2 islet), so she takes the first turn.
 */
function started(): GameState {
  const s = newGame(setup, 42, DEFAULT_LAYOUT, [2, 6]);
  return play(s, { t: "pickIsland", island: "4d" }, { t: "pickIsland", island: "1a" });
}

function withHand(s: GameState, player: number, hand: Partial<Hand>): GameState {
  return {
    ...s,
    players: s.players.map((p, i) =>
      i === player ? { ...p, hand: { wood: 0, iron: 0, rum: 0, gold: 0, ...hand } } : p,
    ),
  };
}

describe("plunder setup", () => {
  it("deals three resource cards each from a 160-card deck", () => {
    const s = newGame(setup, 1);
    for (const p of s.players) expect(Object.values(p.hand).reduce((a, b) => a + b, 0)).toBe(STARTING_CARDS);
    expect(s.deck).toHaveLength(4 * CARDS_PER_RESOURCE - 2 * STARTING_CARDS);
    expect(s.xs).toHaveLength(3);
  });

  it("is the same every time for the same seed", () => {
    expect(newGame(setup, 7)).toEqual(newGame(setup, 7));
    expect(randomLayout(7)).toEqual(randomLayout(7));
    expect(
      randomLayout(7)
        .map((p) => p.tile)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("offers the five one-skull islands to start on", () => {
    expect(
      startingIslands(DEFAULT_LAYOUT)
        .map((i) => i.id)
        .sort(),
    ).toEqual(["1a", "3f", "4d", "5b", "6d"]);
  });

  it("picks islands highest roll first; the last to pick starts, drawing a card for their island", () => {
    let s = newGame(setup, 42, DEFAULT_LAYOUT, [2, 6]);
    expect(s.phase).toMatchObject({ t: "pickIsland", order: [1, 0] });
    s = play(s, { t: "pickIsland", island: "1a" });
    expect(s.owners).toEqual({ "1a": 1 });
    expect(s.ships[0]).toMatchObject({ owner: 1, pos: sq("B2"), lives: 3 });
    expect(play(s, { t: "pickIsland", island: "1a" })).toBe(play(s, { t: "pickIsland", island: "1a" })); // taken: no-op
    s = play(s, { t: "pickIsland", island: "4d" });
    expect(s.phase).toEqual({ t: "turn", roll: null, moves: 0 });
    expect(s.turn).toBe(0);
    expect(Object.values(s.players[0].hand).reduce((a, b) => a + b, 0)).toBe(STARTING_CARDS + 1);
  });
});

describe("plunder sailing", () => {
  it("sails no further than the roll, and not before rolling", () => {
    let s = started();
    const ship = s.ships.find((sh) => sh.owner === s.turn)!;
    expect(play(s, { t: "sail", ship: ship.id, path: [sq("B3")] })).toBe(s);
    s = play(s, { t: "roll", die: 2 });
    expect(reachable(s, s.ships.find((sh) => sh.id === ship.id)!).size).toBeGreaterThan(0);
    const tooFar = play(s, { t: "sail", ship: ship.id, path: [sq("C2"), sq("C3"), sq("C4")] });
    expect(tooFar).toBe(s);
    s = play(s, { t: "sail", ship: ship.id, path: [sq("C2"), sq("C3")] });
    expect(s.ships.find((sh) => sh.id === ship.id)!.pos).toEqual(sq("C3"));
    expect(s.phase).toMatchObject({ moves: 0 });
  });

  it("won't sail onto land or through another ship", () => {
    let s = play(started(), { t: "roll", die: 6 });
    const ship = s.ships.find((sh) => sh.owner === s.turn)!;
    // Tile 1's B4 islet is full land.
    expect(play(s, { t: "sail", ship: ship.id, path: [sq("B3"), sq("B4")] })).toBe(s);
    // Park the other player's ship on C2: can't sail through it.
    s = { ...s, ships: s.ships.map((sh) => (sh.owner !== s.turn ? { ...sh, pos: sq("C2") } : sh)) };
    expect(play(s, { t: "sail", ship: ship.id, path: [sq("C2"), sq("D2")] })).toBe(s);
    expect(reachable(s, ship).has(`${sq("C2").r},${sq("C2").c}`)).toBe(false);
  });

  it("gives each mast an extra square for its own ship, used first", () => {
    let s = started();
    const id = s.ships.find((sh) => sh.owner === s.turn)!.id;
    s = { ...s, ships: s.ships.map((sh) => (sh.id === id ? { ...sh, masts: 2 } : sh)) };
    s = play(s, { t: "roll", die: 1 });
    // Three squares: two from masts, one from the roll.
    s = play(s, { t: "sail", ship: id, path: [sq("C2"), sq("C3"), sq("C4")] });
    expect(s.ships.find((sh) => sh.id === id)!.pos).toEqual(sq("C4"));
    expect(s.phase).toMatchObject({ moves: 0 });
  });
});

describe("plunder building", () => {
  it("builds upgrades within the limits, paying into the face-up piles", () => {
    let s = withHand(started(), 0, { wood: 5, iron: 5, rum: 5, gold: 5 });
    const id = s.ships.find((sh) => sh.owner === 0)!.id;
    s = play(
      s,
      { t: "build", item: "mast", ship: id },
      { t: "build", item: "mast", ship: id },
      { t: "build", item: "mast", ship: id },
    );
    expect(s.ships.find((sh) => sh.id === id)!.masts).toBe(2);
    expect(s.players[0].hand).toEqual({ wood: 3, iron: 5, rum: 1, gold: 5 });
    expect(s.piles).toEqual({ wood: 2, iron: 0, rum: 4, gold: 0 });
    // Full lives: can't buy another.
    expect(play(s, { t: "build", item: "life", ship: id })).toBe(s);
  });

  it("can't build without the resources", () => {
    const s = withHand(started(), 0, { wood: 1 });
    expect(play(s, { t: "build", item: "cannon", ship: s.ships[0].id })).toBe(s);
  });

  it("places a new ship in an owned port or beside one of your ships, up to three", () => {
    let s = withHand(started(), 0, { wood: 9, iron: 9, rum: 0, gold: 9 });
    const spots = shipSpots(s, 0);
    expect(spots.length).toBeGreaterThan(0);
    s = play(s, { t: "build", item: "ship", at: spots[0] });
    s = play(s, { t: "build", item: "ship", at: shipSpots(s, 0)[0] });
    expect(s.ships.filter((sh) => sh.owner === 0)).toHaveLength(MAX_SHIPS);
    expect(play(s, { t: "build", item: "ship", at: shipSpots(s, 0)[0] })).toBe(s);
    // Ship cost: 2 wood, 1 iron, 2 gold each.
    expect(s.players[0].hand).toEqual({ wood: 5, iron: 7, rum: 0, gold: 5 });
    expect(COSTS.ship).toEqual({ wood: 2, iron: 1, gold: 2 });
  });

  it("keeps a ship built after the roll in port until next turn", () => {
    let s = withHand(started(), 0, { wood: 2, iron: 1, gold: 2 });
    s = play(s, { t: "roll", die: 3 });
    s = play(s, { t: "build", item: "ship", at: shipSpots(s, 0)[0] });
    const fresh = s.ships[s.ships.length - 1];
    expect(fresh.docked).toBe(true);
    expect(reachable(s, fresh).size).toBe(0);
  });
});

describe("plunder points", () => {
  it("counts ships, islands and Plunder Point cards; burying five gold earns a card", () => {
    let s = withHand(started(), 0, { gold: 6 });
    expect(points(s, 0)).toBe(2); // one ship, one island
    s = play(s, { t: "bury" });
    expect(s.players[0].plunderCards).toBe(1);
    expect(s.players[0].hand.gold).toBe(1);
    expect(points(s, 0)).toBe(3);
    expect(play(s, { t: "bury" })).toBe(s);
  });

  it("wins the moment a player reaches ten", () => {
    let s = withHand(started(), 0, { gold: 5 });
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, plunderCards: 7 } : p)) };
    s = play(s, { t: "bury" });
    expect(s.phase).toEqual({ t: "gameOver", winner: 0 });
  });
});

describe("plunder turns and treasure", () => {
  it("passes the turn and deals the next player a card per island", () => {
    const s = started();
    const before = Object.values(s.players[1].hand).reduce((a, b) => a + b, 0);
    const after = play(s, { t: "roll", die: 4 }, { t: "endTurn" });
    expect(after.turn).toBe(1);
    expect(after.phase).toEqual({ t: "turn", roll: null, moves: 0 });
    expect(Object.values(after.players[1].hand).reduce((a, b) => a + b, 0)).toBe(before + 1);
  });

  it("finds treasure by sailing onto an X, then moves the X", () => {
    let s = play(started(), { t: "roll", die: 3 });
    const ship = s.ships.find((sh) => sh.owner === s.turn)!;
    s = { ...s, xs: [sq("C3")], notices: [] };
    s = play(s, { t: "sail", ship: ship.id, path: [sq("C2"), sq("C3")] });
    expect(s.notices).toEqual([{ t: "treasure", player: 0, at: sq("C3") }]);
    expect(s.xs[0]).not.toEqual(sq("C3"));
  });
});
