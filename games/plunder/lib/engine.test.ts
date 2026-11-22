import { describe, expect, it } from "vitest";
import {
  CARDS_PER_RESOURCE,
  atMerchant,
  attackTargets,
  islandsOf,
  tradePartners,
  waitingOn,
  inStorm,
  stormToll,
  winChance,
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
  // No storm here, so these tests don't depend on where it happens to land; it has its own tests.
  const s = { ...newGame(setup, 42, DEFAULT_LAYOUT, [2, 6]), storm: undefined };
  return play(s, { t: "pickIsland", island: "4d" }, { t: "pickIsland", island: "1a" });
}

/** Attack; if it's a player's ship or island, they decline to bribe and the battle goes ahead. */
function fight(s: GameState, a: Action): GameState {
  const pending = reducer(s, a);
  if (pending.pendingAttack?.stage !== "bribe") return pending;
  return play(pending, { t: "noBribe" }, a);
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

  it("offers the six one-skull islands to start on", () => {
    expect(
      startingIslands(DEFAULT_LAYOUT)
        .map((i) => i.id)
        .sort(),
    ).toEqual(["1a", "2c", "3f", "4d", "5b", "6d"]);
  });

  it("picks islands highest roll first; the last to pick starts, without drawing on that first turn", () => {
    let s = newGame(setup, 42, DEFAULT_LAYOUT, [2, 6]);
    expect(s.phase).toMatchObject({ t: "pickIsland", order: [1, 0] });
    s = play(s, { t: "pickIsland", island: "1a" });
    expect(s.owners).toEqual({ "1a": 1 });
    expect(s.ships[0]).toMatchObject({ owner: 1, pos: sq("B2"), lives: 3 });
    expect(play(s, { t: "pickIsland", island: "1a" })).toBe(play(s, { t: "pickIsland", island: "1a" })); // taken: no-op
    s = play(s, { t: "pickIsland", island: "4d" });
    expect(s.phase).toEqual({ t: "turn", roll: null, moves: 0 });
    expect(s.turn).toBe(0);
    expect(Object.values(s.players[0].hand).reduce((a, b) => a + b, 0)).toBe(STARTING_CARDS);
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

/** Put a ship somewhere specific (and optionally change it), for setting up battles. */
function moveShip(s: GameState, owner: number, at: Pos, patch: Partial<GameState["ships"][number]> = {}): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.owner === owner ? { ...sh, pos: at, ...patch } : sh)) };
}

describe("plunder battles", () => {
  // Anne (player 0) to move, with Bart's ship right next to hers on open water.
  function facing(): GameState {
    let s = started();
    s = moveShip(s, 0, sq("C2"));
    s = moveShip(s, 1, sq("C3"));
    return s;
  }
  const anne = (s: GameState) => s.ships.find((sh) => sh.owner === 0)!;
  const bart = (s: GameState) => s.ships.find((sh) => sh.owner === 1)!;

  it("lists ships next door and the island whose port you're in as targets", () => {
    const s = facing();
    expect(attackTargets(s, anne(s))).toEqual([{ kind: "ship", id: bart(s).id }]);
    // Not diagonally.
    const diag = moveShip(s, 1, sq("D3"));
    expect(attackTargets(diag, anne(diag))).toEqual([]);
    // Bart's island (tile 4's islet) can be attacked from its port.
    const isl = startingIslands(DEFAULT_LAYOUT).find((i) => i.id === "4d")!;
    const inPort = moveShip(moveShip(s, 1, sq("A6")), 0, isl.ports[0]);
    expect(attackTargets(inPort, anne(inPort))).toEqual([{ kind: "island", id: "4d" }]);
  });

  it("wins ties, takes a life, and can't attack the same ship twice in a turn", () => {
    let s = facing();
    s = fight(s, {
      t: "attack",
      ship: anne(s).id,
      target: { kind: "ship", id: bart(s).id },
      attackDie: 3,
      defenseDie: 3,
    });
    expect(bart(s).lives).toBe(2);
    expect(s.notices.at(-1)).toMatchObject({ t: "battle", won: true, sunk: null });
    const again = fight(s, {
      t: "attack",
      ship: anne(s).id,
      target: { kind: "ship", id: bart(s).id },
      attackDie: 6,
      defenseDie: 1,
    });
    expect(again).toBe(s);
  });

  it("adds cannons: the defender's cannons can beat the attacker", () => {
    let s = moveShip(facing(), 1, sq("C3"), { cannons: 2 });
    s = fight(s, {
      t: "attack",
      ship: anne(s).id,
      target: { kind: "ship", id: bart(s).id },
      attackDie: 5,
      defenseDie: 4,
    });
    expect(anne(s).lives).toBe(2);
    expect(s.notices.at(-1)).toMatchObject({ won: false, attack: { die: 5, bonus: 0 }, defense: { die: 4, bonus: 2 } });
  });

  it("sinking a ship earns a Plunder Point card", () => {
    let s = moveShip(facing(), 1, sq("C3"), { lives: 1, masts: 2 });
    s = fight(s, {
      t: "attack",
      ship: anne(s).id,
      target: { kind: "ship", id: bart(s).id },
      attackDie: 6,
      defenseDie: 1,
    });
    expect(s.ships.some((sh) => sh.owner === 1)).toBe(false);
    expect(s.players[0].plunderCards).toBe(1);
    expect(s.notices.at(-1)).toMatchObject({ sunk: "defender", pointTo: 0 });
  });

  it("losing your last ship ends your turn and hands the defender a card", () => {
    let s = moveShip(facing(), 0, sq("C2"), { lives: 1 });
    s = fight(s, {
      t: "attack",
      ship: anne(s).id,
      target: { kind: "ship", id: bart(s).id },
      attackDie: 1,
      defenseDie: 6,
    });
    expect(s.players[1].plunderCards).toBe(1);
    expect(s.turn).toBe(1);
  });

  it("conquers an island on a win (skulls add to its roll), and the owner loses its point", () => {
    let s = started();
    const isl = startingIslands(DEFAULT_LAYOUT).find((i) => i.id === "4d")!;
    s = moveShip(moveShip(s, 1, sq("A6")), 0, isl.ports[0]);
    expect(points(s, 1)).toBe(2);
    // One skull: 4 + 0 vs 3 + 1 is a tie, which goes to the attacker.
    s = fight(s, { t: "attack", ship: anne(s).id, target: { kind: "island", id: "4d" }, attackDie: 4, defenseDie: 3 });
    expect(s.owners["4d"]).toBe(0);
    expect(points(s, 0)).toBe(3);
    expect(points(s, 1)).toBe(1);
  });

  it("sinking against an unowned island earns nobody a card", () => {
    let s = started();
    const isl = startingIslands(DEFAULT_LAYOUT).find((i) => i.id === "5b")!;
    s = moveShip(s, 0, isl.ports[0], { lives: 1 });
    s = fight(s, { t: "attack", ship: anne(s).id, target: { kind: "island", id: "5b" }, attackDie: 1, defenseDie: 6 });
    expect(s.players.map((p) => p.plunderCards)).toEqual([0, 0]);
    expect(s.notices.some((n) => n.t === "battle" && n.sunk === "attacker" && n.pointTo === null)).toBe(true);
  });

  it("knows the odds", () => {
    expect(winChance(0, 0)).toBeCloseTo(21 / 36);
    expect(winChance(2, 0)).toBeGreaterThan(winChance(0, 2));
  });
});

describe("plunder captain without a ship", () => {
  /** Anne sinks; it's her turn again with no ship. */
  function shipless(): GameState {
    let s = started();
    s = { ...s, ships: s.ships.filter((sh) => sh.owner !== 0) };
    return play(s, { t: "endTurn" }, { t: "endTurn" });
  }

  it("starts the turn as a captain without a ship", () => {
    const s = shipless();
    expect(s.turn).toBe(0);
    expect(s.captain).toMatchObject({ freeCard: false, rolled: false, acquired: false });
  });

  it("gets a ship on doubles and places it in an owned port", () => {
    let s = play(shipless(), { t: "rollDoubles", dice: [4, 4] });
    expect(s.captain?.acquired).toBe(true);
    const spot = s.captain!.spots![0];
    s = play(s, { t: "placeShip", at: spot });
    expect(s.ships.find((sh) => sh.owner === 0)).toMatchObject({ pos: spot, lives: 3, masts: 0, cannons: 0 });
    expect(s.captain).toBeNull();
  });

  it("can roll for doubles only once, then try another way", () => {
    let s = play(shipless(), { t: "rollDoubles", dice: [2, 5] });
    expect(s.captain?.acquired).toBe(false);
    expect(play(s, { t: "rollDoubles", dice: [3, 3] })).toBe(s);
    s = withHand(s, 0, { gold: 5 });
    s = play(s, { t: "getShip", via: "gold" });
    expect(s.players[0].hand.gold).toBe(0);
    expect(s.captain?.acquired).toBe(true);
    // Only one ship through this process.
    expect(play(withHand(s, 0, { gold: 5 }), { t: "getShip", via: "gold" }).captain).toEqual(s.captain);
  });

  it("can give up an island for a ship", () => {
    const s = play(shipless(), { t: "getShip", via: { disown: "1a" } });
    expect(s.owners["1a"]).toBeUndefined();
    expect(s.captain?.acquired).toBe(true);
  });

  it("with no islands and no Plunder Point cards takes a free card of their choice", () => {
    let s = started();
    s = { ...s, ships: s.ships.filter((sh) => sh.owner !== 0), owners: { "4d": 1 } };
    s = play(s, { t: "endTurn" }, { t: "endTurn" });
    expect(s.captain?.freeCard).toBe(true);
    const rum = s.players[0].hand.rum;
    s = play(s, { t: "freeCard", resource: "rum" });
    expect(s.players[0].hand.rum).toBe(rum + 1);
    expect(play(s, { t: "freeCard", resource: "rum" })).toBe(s);
    // With no port of their own, the compasses pick where the ship goes.
    s = play(s, { t: "rollDoubles", dice: [1, 1] });
    expect(s.captain!.spots!.length).toBeGreaterThan(0);
  });
});

describe("plunder storm", () => {
  /** Anne at C2 with cards to spare, the storm centred on C5 (covering B4–D6). */
  function stormy(): GameState {
    let s = withHand(started(), 0, { wood: 3, iron: 2, rum: 1, gold: 1 });
    s = moveShip(s, 0, sq("C2"));
    return { ...s, storm: sq("C5") };
  }
  const anne = (s: GameState) => s.ships.find((sh) => sh.owner === 0)!;

  it("is a 3×3 square around its centre", () => {
    const s = stormy();
    expect(inStorm(s, sq("B4"))).toBe(true);
    expect(inStorm(s, sq("D6"))).toBe(true);
    expect(inStorm(s, sq("C3"))).toBe(false);
  });

  it("is placed at the start, never over a one-skull island's port", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = newGame(setup, seed);
      expect(s.storm).toBeDefined();
      for (const isl of startingIslands(s.layout)) for (const p of isl.ports) expect(inStorm(s, p)).toBe(false);
    }
  });

  it("charges two cards to sail in, and four to sail in and back out", () => {
    let s = play(stormy(), { t: "roll", die: 6 });
    const into = [sq("C3"), sq("C4")];
    expect(stormToll(s, anne(s).pos, into)).toBe(2);
    // Must pay exactly the toll, from the hand.
    expect(play(s, { t: "sail", ship: anne(s).id, path: into })).toBe(s);
    expect(play(s, { t: "sail", ship: anne(s).id, path: into, pay: ["gold", "gold"] })).toBe(s);
    const paid = play(s, { t: "sail", ship: anne(s).id, path: into, pay: ["wood", "iron"] });
    expect(anne(paid).pos).toEqual(sq("C4"));
    expect(paid.players[0].hand).toMatchObject({ wood: 2, iron: 1 });
    // In and straight back out again: two crossings.
    s = { ...s, storm: sq("C5") };
    expect(stormToll(s, anne(s).pos, [sq("C3"), sq("C4"), sq("C3")])).toBe(4);
  });

  it("only lets a ship reach what it can pay for, and traps a ship with nothing to pay", () => {
    let s = play(stormy(), { t: "roll", die: 6 });
    expect(reachable(s, anne(s)).has(`${sq("C4").r},${sq("C4").c}`)).toBe(true);
    // One card: can't pay to go in.
    const broke = withHand(s, 0, { wood: 1 });
    expect(reachable(broke, anne(broke)).has(`${sq("C4").r},${sq("C4").c}`)).toBe(false);
    // Inside with nothing: trapped, but free to move about within the storm.
    s = withHand(moveShip(s, 0, sq("C5")), 0, {});
    const reach = reachable(s, anne(s));
    expect([...reach.keys()].every((k) => inStorm(s, { r: +k.split(",")[0], c: +k.split(",")[1] }))).toBe(true);
  });

  it("blocks attacks and treasure across its border", () => {
    let s = moveShip(moveShip(stormy(), 0, sq("C3")), 1, sq("C4"));
    expect(attackTargets(s, anne(s))).toEqual([]);
    // Both inside: fine.
    s = moveShip(s, 0, sq("C5"));
    expect(attackTargets(s, anne(s))).toHaveLength(1);
  });

  it("moves when someone rolls a 1, and they still sail one square", () => {
    const s = play(stormy(), { t: "roll", die: 1 });
    expect(s.storm).not.toEqual(sq("C5"));
    expect(s.notices.some((n) => n.t === "storm")).toBe(true);
    expect(s.phase).toMatchObject({ roll: 1, moves: 1 });
  });

  it("stops an island producing when all its ports are in the storm", () => {
    // Bart's island (tile 4's islet): put the storm over its port, then start Bart's turn.
    const isl = startingIslands(DEFAULT_LAYOUT).find((i) => i.id === "4d")!;
    let s: GameState = { ...started(), storm: isl.ports[0] };
    const before = Object.values(s.players[1].hand).reduce((a, b) => a + b, 0);
    s = play(s, { t: "endTurn" });
    expect(Object.values(s.players[1].hand).reduce((a, b) => a + b, 0)).toBe(before);
    expect(points(s, 1)).toBe(2); // it still counts
  });
});

describe("plunder trading", () => {
  const trio = [
    { name: "Anne", color: "red" as const },
    { name: "Bart", color: "purple" as const },
    { name: "Cleo", color: "yellow" as const },
  ];
  /** Three players, Anne to move; Bart's and Cleo's ships parked beside Anne's on open water (C2/C3/D2). */
  function table(): GameState {
    let s: GameState = { ...newGame(trio, 3, DEFAULT_LAYOUT, [1, 2, 6]), storm: undefined };
    s = play(
      s,
      { t: "pickIsland", island: "4d" },
      { t: "pickIsland", island: "5b" },
      { t: "pickIsland", island: "1a" },
    );
    expect(s.turn).toBe(0);
    s = moveShip(moveShip(moveShip(s, 0, sq("C2")), 1, sq("C3")), 2, sq("D2"));
    s = withHand(withHand(withHand(s, 0, { wood: 2, rum: 1 }), 1, { gold: 2 }), 2, { gold: 1, iron: 1 });
    return { ...s, notices: [] };
  }

  it("trades with players beside you, in your port or theirs, or anyone from a merchant island", () => {
    const s = table();
    expect(tradePartners(s, 0)).toEqual([1, 2]);
    const apart = moveShip(s, 1, sq("A12"));
    expect(tradePartners(apart, 0)).toEqual([2]);
    // Docked at a merchant island (tile 1's, its E4 port): trade with everyone.
    const merchant = islandsOf(DEFAULT_LAYOUT).find((i) => i.kind === "merchant" && i.id.startsWith("1"))!;
    const docked = moveShip(moveShip(apart, 2, sq("L18")), 0, merchant.ports[0]);
    expect(atMerchant(docked, 0)).toBe(true);
    expect(tradePartners(docked, 0)).toEqual([1, 2]);
  });

  it("asks everyone in seat order, then the offerer picks one who said yes, and they make a treaty", () => {
    let s = play(table(), { t: "offer", kind: "trade", give: { wood: 1 }, get: { gold: 1 } });
    expect(waitingOn(s)).toBe(1);
    // While the offer is out, nothing else can happen.
    expect(play(s, { t: "roll", die: 3 })).toBe(s);
    s = play(s, { t: "answer", accept: true });
    expect(waitingOn(s)).toBe(2);
    s = play(s, { t: "answer", accept: true });
    expect(waitingOn(s)).toBe(0);
    s = play(s, { t: "pickTrade", with: 2 });
    expect(s.trade).toBeNull();
    expect(s.players[0].hand).toMatchObject({ wood: 1, gold: 1 });
    expect(s.players[2].hand).toMatchObject({ wood: 1, gold: 0 });
    expect(s.treaties).toEqual([2]);
    // The treaty stops Anne attacking Cleo's ship (beside her), but not Bart's.
    const targets = attackTargets(s, s.ships.find((sh) => sh.owner === 0)!);
    expect(targets.map((t) => (t.kind === "ship" ? s.ships.find((sh) => sh.id === t.id)!.owner : -1))).toEqual([1]);
  });

  it("can't accept without the cards; everyone declining withdraws the offer", () => {
    let s = play(table(), { t: "offer", kind: "trade", give: { wood: 1 }, get: { gold: 2 } });
    // Cleo has only one gold, but Bart can: Bart declines anyway, then Cleo can't accept.
    s = play(s, { t: "answer", accept: false });
    expect(play(s, { t: "answer", accept: true })).toBe(s);
    s = play(s, { t: "answer", accept: false });
    expect(s.trade).toBeNull();
    expect(s.notices.at(-1)).toMatchObject({ t: "noDeal", player: 0 });
  });

  it("goes back and forth with counter-offers", () => {
    let s = play(table(), { t: "offer", kind: "trade", give: { wood: 1 }, get: { gold: 2 } });
    // Bart counters: one gold for two wood. It goes back to Anne alone.
    s = play(s, { t: "counter", give: { gold: 1 }, get: { wood: 2 } });
    expect(s.trade).toMatchObject({ from: 1, to: [0] });
    expect(waitingOn(s)).toBe(0);
    // Anne counters back: one gold for one wood. Bart accepts and it's done.
    s = play(s, { t: "counter", give: { wood: 1 }, get: { gold: 1 } });
    expect(waitingOn(s)).toBe(1);
    s = play(s, { t: "answer", accept: true });
    expect(s.players[0].hand).toMatchObject({ wood: 1, gold: 1 });
    expect(s.treaties).toEqual([1]);
  });

  it("swaps any two cards for one at a merchant island", () => {
    let s = table();
    expect(play(s, { t: "merchant", give: ["wood", "wood"], get: "iron" })).toBe(s);
    const merchant = islandsOf(DEFAULT_LAYOUT).find((i) => i.kind === "merchant" && i.id.startsWith("1"))!;
    s = moveShip(s, 0, merchant.ports[0]);
    s = play(s, { t: "merchant", give: ["wood", "rum"], get: "iron" });
    expect(s.players[0].hand).toMatchObject({ wood: 1, rum: 0, iron: 1 });
  });

  it("threatens a player positioned for it; giving in makes a treaty", () => {
    let s = play(table(), { t: "offer", kind: "threat", to: 1, get: { gold: 2 } });
    expect(waitingOn(s)).toBe(1);
    s = play(s, { t: "answer", accept: true });
    expect(s.players[0].hand.gold).toBe(2);
    expect(s.players[1].hand.gold).toBe(0);
    expect(s.treaties).toEqual([1]);
  });

  it("lets the defender bribe before a battle: raise after a refusal, or fight", () => {
    let s = table();
    const attack: Action = {
      t: "attack",
      ship: s.ships.find((sh) => sh.owner === 0)!.id,
      target: { kind: "ship", id: s.ships.find((sh) => sh.owner === 1)!.id },
      attackDie: 6,
      defenseDie: 1,
    };
    s = play(s, attack);
    expect(s.pendingAttack).toMatchObject({ defender: 1, stage: "bribe" });
    expect(waitingOn(s)).toBe(1);
    // One gold: Anne refuses. Bart raises to two: Anne takes it and the attack is off.
    s = play(s, { t: "bribe", give: { gold: 1 } }, { t: "answer", accept: false });
    expect(s.pendingAttack?.stage).toBe("bribe");
    s = play(s, { t: "bribe", give: { gold: 2 } }, { t: "answer", accept: true });
    expect(s.pendingAttack).toBeNull();
    expect(s.players[0].hand.gold).toBe(2);
    expect(s.treaties).toEqual([1]);
    expect(play(s, attack)).toBe(s);
  });

  it("goes ahead with the battle when the defender won't bribe", () => {
    let s = table();
    const attack: Action = {
      t: "attack",
      ship: s.ships.find((sh) => sh.owner === 0)!.id,
      target: { kind: "ship", id: s.ships.find((sh) => sh.owner === 1)!.id },
      attackDie: 6,
      defenseDie: 1,
    };
    s = play(s, attack, { t: "noBribe" });
    expect(waitingOn(s)).toBe(0);
    s = play(s, attack);
    expect(s.notices.at(-1)).toMatchObject({ t: "battle", won: true });
  });
});
