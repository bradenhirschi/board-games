import { describe, expect, it } from "vitest";
import { botAction, fillDice } from "./bot";
import { newGame, randomLayout, type GameState } from "./engine";
import { noticesFor, replay, resolve, seatToAct } from "./online";

const bots = [
  { name: "A", color: "red" as const, isBot: true },
  { name: "B", color: "purple" as const, isBot: true },
  { name: "C", color: "green" as const, isBot: true },
];

describe("plunder online", () => {
  it("saves states without notices, and replaying the saved actions rebuilds the same game", () => {
    let k = 11;
    const d6 = () => 1 + ((k = (k * 16807) % 2147483647) % 6);
    let saved: GameState = newGame(bots, 4, randomLayout(4));
    for (let i = 0; i < 4000 && saved.phase.t !== "gameOver"; i++) {
      const a = fillDice(botAction(saved)!, d6);
      const move = resolve(saved, a);
      expect(move, JSON.stringify(a)).not.toBeNull();
      expect(move!.state.notices).toEqual([]);
      // Another device replays the saved actions from the previous version.
      const again = replay(saved, move!.actions);
      expect(again.state).toEqual(move!.state);
      expect(again.notices).toEqual(move!.notices);
      saved = move!.state;
    }
    expect(saved.phase.t).toBe("gameOver");
  });

  it("refuses a move that isn't allowed", () => {
    const s = newGame(bots, 1, randomLayout(1));
    expect(resolve(s, { t: "endTurn" })).toBeNull();
  });

  it("shows each seat only its own card draws", () => {
    const notices = [
      { t: "drew" as const, player: 0, cards: ["wood" as const] },
      { t: "drew" as const, player: 1, cards: ["rum" as const] },
      { t: "treasure" as const, player: 1, at: { r: 0, c: 0 } },
    ];
    expect(noticesFor(notices, 0).map((n) => n.t + n.player)).toEqual(["drew0", "treasure1"]);
    expect(noticesFor(notices, null).map((n) => n.t)).toEqual(["treasure"]);
  });

  it("knows who must act", () => {
    const s = newGame(bots, 1, randomLayout(1), [1, 6, 2]);
    expect(seatToAct(s)).toBe(1);
  });
});
