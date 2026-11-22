import { describe, expect, it } from "vitest";
import { botAction, fillDice, isBotMove } from "./bot";
import { newGame, randomLayout, reducer, type GameState, type PlayerSetup } from "./engine";
import { DEFAULT_LAYOUT } from "./tiles";

const bots: PlayerSetup[] = [
  { name: "Bot 1", color: "red", isBot: true },
  { name: "Bot 2", color: "purple", isBot: true },
  { name: "Bot 3", color: "yellow", isBot: true },
];

/** A little seeded die for tests. */
function dice(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return 1 + (s % 6);
  };
}

/** Let the bots play until someone wins (or `maxActions` runs out), checking every action does something. */
function playOut(start: GameState, seed: number, maxActions = 20000) {
  const roll = dice(seed);
  let s = start;
  let actions = 0;
  let treasures = 0;
  let battles = 0;
  let conquests = 0;
  let sinkings = 0;
  let captains = 0;
  let trades = 0;
  let bribes = 0;
  while (s.phase.t !== "gameOver" && actions < maxActions) {
    let a = botAction(s);
    expect(a, "a bot always has a move").not.toBeNull();
    a = fillDice(a!, roll);
    const next = reducer(s, a!);
    expect(next, `bot action ${JSON.stringify(a)} should change the game`).not.toBe(s);
    treasures += next.notices.filter((n) => n.t === "treasure").length;
    for (const n of next.notices) {
      if (n.t === "deal") {
        if (n.kind === "bribe") bribes++;
        else trades++;
      }
      if (n.t !== "battle") continue;
      battles++;
      if (n.won && n.target.kind === "island") conquests++;
      if (n.sunk) sinkings++;
    }
    if (next.captain && !s.captain) captains++;
    s = { ...next, notices: [] };
    actions++;
  }
  return { s, actions, treasures, battles, conquests, sinkings, captains, trades, bribes };
}

describe("plunder bots", () => {
  it("play whole games to a winner, every action legal, fighting along the way", () => {
    const totals = { treasures: 0, battles: 0, conquests: 0, sinkings: 0, captains: 0, trades: 0, bribes: 0 };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = playOut(newGame(bots, seed, randomLayout(seed)), seed);
      expect(r.s.phase.t, `seed ${seed}`).toBe("gameOver");
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
    }
    expect(totals.treasures, "bots go treasure hunting").toBeGreaterThan(0);
    expect(totals.battles, "bots fight").toBeGreaterThan(0);
    expect(totals.conquests, "bots conquer islands").toBeGreaterThan(0);
    expect(totals.captains, "sunk captains get back on the water").toBeGreaterThan(0);
    expect(totals.trades, "bots trade").toBeGreaterThan(0);
  });

  it("only moves for bots", () => {
    const mixed = newGame([{ name: "Anne", color: "red" }, bots[1]], 5, DEFAULT_LAYOUT, [6, 1]);
    // Anne rolled highest, so she picks first: not a bot's move.
    expect(isBotMove(mixed)).toBe(false);
    expect(botAction(mixed)).toBeNull();
  });

  it("picks a free one-skull island", () => {
    const s = newGame(bots, 9, DEFAULT_LAYOUT, [6, 2, 1]);
    const a = botAction(s);
    expect(a?.t).toBe("pickIsland");
    const after = reducer(s, a!);
    expect(Object.keys(after.owners)).toHaveLength(1);
  });
});
