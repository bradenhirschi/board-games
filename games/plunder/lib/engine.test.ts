import { describe, expect, it } from "vitest";
import { newGame, reducer, type GameState } from "./engine";

function game(): GameState {
  return newGame([
    { name: "Anne", isBot: false },
    { name: "Bot 1", isBot: true },
  ]);
}

describe("plunder engine (boilerplate)", () => {
  it("starts with the first player to roll", () => {
    const s = game();
    expect(s.turn).toBe(0);
    expect(s.phase).toEqual({ t: "roll" });
    expect(s.players.every((p) => p.gold === 0)).toBe(true);
  });

  it("rejects bad player counts", () => {
    expect(() => newGame([{ name: "Solo", isBot: false }])).toThrow();
  });

  it("rolls, then passes the turn", () => {
    let s = reducer(game(), { t: "roll", die: 4 });
    expect(s.phase).toEqual({ t: "act", roll: 4 });
    s = reducer(s, { t: "endTurn" });
    expect(s.turn).toBe(1);
    expect(s.phase).toEqual({ t: "roll" });
  });

  it("ignores illegal actions", () => {
    const s = game();
    expect(reducer(s, { t: "endTurn" })).toBe(s);
    expect(reducer(s, { t: "roll", die: 7 })).toBe(s);
  });

  it("ends in a tie when gold is level", () => {
    expect(reducer(game(), { t: "endGame" }).phase).toEqual({ t: "gameOver", winner: null });
  });
});
