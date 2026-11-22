import { describe, expect, it } from "vitest";
import { botAction, isBotMove } from "./bot";
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
  while (s.phase.t !== "gameOver" && actions < maxActions) {
    let a = botAction(s);
    expect(a, "a bot always has a move").not.toBeNull();
    if (a!.t === "roll") a = { t: "roll", die: roll() };
    const next = reducer(s, a!);
    expect(next, `bot action ${JSON.stringify(a)} should change the game`).not.toBe(s);
    treasures += next.notices.filter((n) => n.t === "treasure").length;
    s = { ...next, notices: [] };
    actions++;
  }
  return { s, actions, treasures };
}

describe("plunder bots", () => {
  it("play a whole game to a winner, every action legal", () => {
    for (const seed of [1, 2, 3]) {
      const { s, treasures } = playOut(newGame(bots, seed, randomLayout(seed)), seed);
      expect(s.phase.t, `seed ${seed}`).toBe("gameOver");
      expect(treasures, "bots go treasure hunting").toBeGreaterThan(0);
    }
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
