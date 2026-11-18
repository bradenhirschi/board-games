import { describe, expect, it } from "vitest";
import { botMove } from "./bot";
import { CAREERS } from "./board";
import { newGame, reducer, netWorth, type Action, type GameState, type Pos } from "./engine";
import { lowestPrice, moveMarket, priceAt } from "./stocks";

const DOCTOR = CAREERS.findIndex((c) => c.name === "Doctor");

function game(n = 2): GameState {
  return newGame(Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, isBot: false })));
}

function place(s: GameState, i: number, pos: Pos, cash = 1000): GameState {
  const players = s.players.map((p, k) => (k === i ? { ...p, status: "market" as const, pos, cash } : p));
  return { ...s, players };
}

function run(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce(reducer, s);
}

/** Roll and walk every step (answers detours with `enter`). */
function rollAndMove(s: GameState, dice: [number, number], enter = false): GameState {
  s = reducer(s, { type: "roll", dice });
  for (let guard = 0; guard < 100; guard++) {
    if (s.phase.t === "moving") s = reducer(s, { type: "step" });
    else if (s.phase.t === "detour") s = reducer(s, { type: "detour", enter });
    else break;
  }
  return s;
}

describe("quotation board", () => {
  it("bounces off the top and bottom", () => {
    expect(moveMarket(45, 10)).toBe(45);
    expect(moveMarket(3, -5)).toBe(2);
    expect(moveMarket(25, 20)).toBe(45);
  });
  it("prices rise with the slider", () => {
    expect(priceAt("GRAIN", 0)).toBe(18);
    expect(priceAt("GRAIN", 50)).toBe(43);
    expect(lowestPrice("PRESS")).toBe(10);
  });
});

describe("working", () => {
  it("pays every worker whose number is thrown, no matter who throws", () => {
    let s = game(2);
    s = run(s, { type: "setCareer", career: DOCTOR }, { type: "roll", dice: [1, 1] });
    s = run(s, { type: "setCareer", career: 0 }, { type: "roll", dice: [2, 2] }); // P2 throws a 4
    expect(s.players[0].cash).toBe(200);
    expect(s.players[1].cash).toBe(0);
  });
  it("must go to the market once they have $1,000", () => {
    let s = game(2);
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, career: DOCTOR, cash: 1000 } : p)) };
    expect(reducer(s, { type: "roll", dice: [2, 2] })).toBe(s);
    s = run(s, { type: "goToMarket", start: 6 }, { type: "roll", dice: [1, 2] });
    expect(s.phase.t).not.toBe("preRoll");
  });
});

describe("moving", () => {
  it("START sends odd rolls one way and even rolls the other", () => {
    const s = place(game(), 0, { kind: "track", index: 6 });
    const odd = rollAndMove(s, [1, 2]);
    expect(odd.players[0].pos).toEqual({ kind: "track", index: 9 });
    const even = rollAndMove(s, [1, 1]);
    expect(even.players[0].pos).toEqual({ kind: "track", index: 4 });
  });

  it("follows the arrow on the square being left", () => {
    // Square 2 (J.T. Crate, bottom row) points toward the bottom-right corner.
    const s = rollAndMove(place(game(), 0, { kind: "track", index: 2 }), [1, 1]);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 0 });
  });

  it("moves the slider and offers stock at the new price", () => {
    const s = rollAndMove(place(game(), 0, { kind: "track", index: 6 }), [1, 2]); // lands on General Grains, DOWN 3
    expect(s.market).toBe(22);
    expect(s.phase).toMatchObject({ t: "buy", stock: "GRAIN", price: priceAt("GRAIN", 22), limited: true, max: 1 });
  });

  it("pays dividends on shares already owned", () => {
    let s = place(game(), 0, { kind: "track", index: 6 });
    s.players[0].shares.WOOL = 10;
    s = rollAndMove(s, [1, 1]); // even → back to square 4, Woolmart $4 DIV
    expect(s.players[0].cash).toBe(1040);
  });
});

describe("fees and forced sales", () => {
  it("charges $10 per share on broker fee corners", () => {
    let s = place(game(), 0, { kind: "track", index: 11 });
    s.players[0].shares.ALUM = 7;
    s = rollAndMove(s, [1, 0] as unknown as [number, number]);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 12 });
    expect(s.players[0].cash).toBe(1000 - 70);
  });

  it("sell-all squares sell at the lowest board price", () => {
    let s = place(game(), 0, { kind: "track", index: 2 });
    s.players[0].shares.GRAIN = 10;
    s = rollAndMove(s, [1, 0] as unknown as [number, number]); // square 1: Sell All General Grains
    expect(s.players[0].shares.GRAIN).toBe(0);
    expect(s.players[0].cash).toBe(1000 + 10 * lowestPrice("GRAIN"));
  });

  it("makes a short player sell at the lowest price, or go broke", () => {
    let s = place(game(), 0, { kind: "track", index: 11 }, 5);
    s.players[0].shares.PRESS = 20;
    s = rollAndMove(s, [1, 0] as unknown as [number, number]); // broker fee $200
    expect(s.phase).toMatchObject({ t: "raiseCash", owed: 200 });
    const sold = reducer(s, { type: "forcedSell", stock: "PRESS", qty: 20 });
    expect(sold.players[0].cash).toBe(5 + 20 * lowestPrice("PRESS") - 200);
    expect(sold.phase.t).toBe("preRoll");
    const broke = reducer(s, { type: "goBroke" });
    expect(broke.players[0]).toMatchObject({ status: "work", cash: 0, pos: null });
  });
});

describe("shareholders' meetings", () => {
  it("detours owners into the meeting and pays a stock dividend", () => {
    let s = place(game(), 0, { kind: "track", index: 6 });
    s.players[0].shares.SOLE = 5;
    s = rollAndMove(s, [3, 3], true); // 5, 4, 3 (entrance) → lane p0, p1, p2
    expect(s.players[0].pos).toEqual({ kind: "lane", lane: 0, from: 1, p: 2 });
    expect(s.players[0].shares.SOLE).toBe(15); // landed on 2 FOR 1
    expect(s.market).toBe(25); // the slider doesn't move in a meeting
  });

  it("lets non-owners walk past", () => {
    const s = rollAndMove(place(game(), 0, { kind: "track", index: 6 }), [3, 3], true);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 0 });
  });

  it("can't re-enter a meeting straight after leaving one", () => {
    let s = place(game(), 0, { kind: "lane", lane: 0, from: 1, p: 7 });
    s.players[0].shares.SOLE = 1;
    s.players[0].shares.GRAIN = 1; // owns the stock at the far entrance too
    s = reducer(s, { type: "roll", dice: [1, 2] });
    const phases: string[] = [];
    while (s.phase.t === "moving") {
      s = reducer(s, { type: "step" });
      phases.push(s.phase.t);
    }
    expect(phases).not.toContain("detour");
    expect(s.players[0].pos).toEqual({ kind: "track", index: 10 });
  });

  it("can enter from the far entrance on a later turn after landing there", () => {
    let s = place(game(), 0, { kind: "lane", lane: 0, from: 1, p: 7 });
    s.players[0].shares.SOLE = 1;
    s.players[0].shares.GRAIN = 1;
    s = rollAndMove(s, [1, 1]); // p8, then out onto the General Grains entrance
    expect(s.players[0].pos).toEqual({ kind: "track", index: 9 });
    s = { ...s, current: 0, phase: { t: "preRoll" } };
    s = reducer(s, { type: "roll", dice: [1, 2] });
    s = reducer(s, { type: "step" });
    expect(s.phase.t).toBe("detour");
  });

  it("exits by the far entrance and keeps going", () => {
    let s = place(game(), 0, { kind: "lane", lane: 0, from: 1, p: 7 });
    s.players[0].shares.SOLE = 1;
    s = rollAndMove(s, [1, 2]);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 10 });
  });
});

describe("winning", () => {
  it("wins when worth the target at their turn to roll", () => {
    let s = place(game(), 1, { kind: "track", index: 6 }, 100_000);
    s = run(s, { type: "setCareer", career: 0 }, { type: "roll", dice: [1, 1] });
    expect(s.phase).toMatchObject({ t: "gameOver", winnerId: 1 });
  });
});

describe("bot games", () => {
  it("play to completion", () => {
    const turns: number[] = [];
    for (let g = 0; g < 20; g++) {
      let s = newGame(
        Array.from({ length: 4 }, (_, i) => ({ name: `Bot ${i}`, isBot: true })),
        100_000,
      );
      for (let i = 0; i < 400_000 && s.phase.t !== "gameOver"; i++) {
        if (s.phase.t === "moving") {
          s = reducer(s, { type: "step" });
          continue;
        }
        const m = botMove(s);
        if (!m) throw new Error(`bot stuck in ${s.phase.t}`);
        const a: Action =
          m.type === "rollDice" ? { type: "roll", dice: [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] } : m;
        const next = reducer(s, a);
        if (next === s) throw new Error(`bot made an illegal move ${JSON.stringify(a)} in ${s.phase.t}`);
        s = next;
      }
      expect(s.phase.t).toBe("gameOver");
      for (const p of s.players) expect(p.cash).toBeGreaterThanOrEqual(0);
      turns.push(s.turn);
      void netWorth;
    }
    turns.sort((a, b) => a - b);
    console.log("turns per 4-player game (min/median/max):", turns[0], turns[10], turns[19]);
  }, 60_000);
});
