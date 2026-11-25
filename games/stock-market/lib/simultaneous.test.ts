import { describe, expect, it } from "vitest";
import { botMove } from "./bot";
import { CAREERS } from "./board";
import { newGame, reducer, type GameState } from "./engine";
import {
  beginRounds,
  roundOrder,
  simulMove,
  simulReplaceWithBot,
  simulTimeout,
  stageKey,
  view,
  waitingOn,
} from "./simultaneous";
import { moveMarket } from "./stocks";

/** Dice that throw the given faces in turn (then repeat the last). */
const dice = (...faces: number[]) => {
  let i = 0;
  return () => faces[Math.min(i++, faces.length - 1)];
};

/** Two (or more) human players already in the market, a simultaneous round started. */
function game(names = ["A", "B"], cash = 2000): GameState {
  const s = newGame(
    names.map((name) => ({ name, isBot: false })),
    100_000,
    "normal",
    false,
    false,
    true,
  );
  s.phase = { t: "preRoll" };
  s.players.forEach((p, i) => {
    p.career = 2;
    p.status = "market";
    p.cash = cash;
    p.pos = { kind: "track", index: 6 + 12 * (i % 4) }; // a START square on each side
  });
  return beginRounds(s, dice(1))!;
}

const must = (s: GameState | null): GameState => {
  expect(s).not.toBeNull();
  return s!;
};

describe("starting", () => {
  it("only starts rounds in a simultaneous game once everyone can play", () => {
    const plain = newGame([
      { name: "A", isBot: false },
      { name: "B", isBot: false },
    ]);
    expect(beginRounds(plain, dice(1))).toBeNull();
    const choosing = newGame([{ name: "A", isBot: false }], 100_000, "normal", false, false, true);
    expect(choosing.phase.t).toBe("chooseCareers");
    expect(beginRounds(choosing, dice(1))).toBeNull();
  });

  it("starts in the sell stage with everyone to roll", () => {
    const s = game();
    expect(s.simul!.stage).toBe("sell");
    expect(s.simul!.round).toBe(1);
    expect(waitingOn(s)).toEqual([0, 1]);
  });

  it("refuses ordinary turn actions on the shared game", () => {
    const s = game();
    expect(reducer(s, { type: "roll", dice: [1, 1] })).toBe(s);
  });
});

describe("the sell stage", () => {
  it("sells at the shared board price, privately", () => {
    let s = game();
    s.players[0].shares.ALCOA = 10;
    s.simul!.turns[0].player.shares.ALCOA = 10;
    s = must(simulMove(s, 0, { type: "sell", stock: "ALCOA", qty: 4 }, dice(1)));
    expect(s.simul!.turns[0].player.shares.ALCOA).toBe(6);
    // The shared game (what others see) is unchanged until the round ends.
    expect(s.players[0].shares.ALCOA).toBe(10);
    expect(view(s, 1).players[0].shares.ALCOA).toBe(10);
    expect(view(s, 0).players[0].shares.ALCOA).toBe(6);
  });

  it("throws hidden dice on Roll and waits for everyone", () => {
    let s = game();
    s = must(simulMove(s, 0, { type: "rollDice" }, dice(2, 3)));
    expect(s.simul!.turns[0].dice).toEqual([2, 3]);
    expect(view(s, 0).dice).toBeNull();
    expect(s.simul!.stage).toBe("sell");
    expect(waitingOn(s)).toEqual([1]);
    // Can't roll twice, or sell after rolling.
    expect(simulMove(s, 0, { type: "rollDice" }, dice(1))).toBeNull();
  });

  it("reveals every throw once the last player rolls, each moving the market only for themselves", () => {
    let s = game();
    const market = s.market;
    s = must(simulMove(s, 0, { type: "rollDice" }, dice(1, 1))); // A: 2 from START (even: ccw)
    s = must(simulMove(s, 1, { type: "rollDice" }, dice(2, 1))); // B: 3 (odd: cw)
    expect(s.simul!.stage).toBe("act");
    const a = view(s, 0);
    const b = view(s, 1);
    expect(a.players[0].pos).toEqual({ kind: "track", index: 4 });
    expect(b.players[1].pos).toEqual({ kind: "track", index: 21 });
    expect(a.phase.t).toBe("afterRoll");
    expect(a.dice).toEqual([1, 1]);
    // Each private market moved by their own landing only.
    expect(a.market).toBe(moveMarket(market, 2)); // WOOL +2
    expect(b.market).not.toBe(a.market);
    // Others are shown where they started the round.
    expect(a.players[1].pos).toEqual({ kind: "track", index: 18 });
    // The path walked is recorded for the animation.
    expect(s.simul!.turns[0].pathFrom).toEqual({ kind: "track", index: 6 });
    expect(s.simul!.turns[0].path).toEqual([
      { kind: "track", index: 5 },
      { kind: "track", index: 4 },
    ]);
  });

  it("pays workers for every throw of the round", () => {
    let s = game(["A", "B", "C"]);
    // C is a Doctor at work (4 or 10).
    const doctor = CAREERS.findIndex((c) => c.rolls.includes(4) && c.rolls.includes(10));
    for (const p of [s.players[2], s.simul!.turns[2].player])
      Object.assign(p, { status: "work", career: doctor, cash: 0, pos: null });
    s = must(simulMove(s, 0, { type: "rollDice" }, dice(2, 2)));
    s = must(simulMove(s, 1, { type: "rollDice" }, dice(5, 5)));
    s = must(simulMove(s, 2, { type: "rollDice" }, dice(1, 1)));
    const c = s.simul!.turns[2];
    expect(c.player.cash).toBe(2 * CAREERS[doctor].salary);
    expect(c.done).toBe(true);
    expect(c.log.map((e) => e.text).join("\n")).toContain("A's 4");
  });
});

describe("the act stage and the end of the round", () => {
  function revealed() {
    let s = game();
    s = must(simulMove(s, 0, { type: "rollDice" }, dice(1, 1))); // A to WOOL (buy, +2)
    s = must(simulMove(s, 1, { type: "rollDice" }, dice(2, 1)));
    return s;
  }

  it("buys at the player's own updated price", () => {
    let s = revealed();
    const a = view(s, 0);
    expect(a.phase.t === "afterRoll" && a.phase.buy?.stock).toBe("WOOL");
    s = must(simulMove(s, 0, { type: "buy", qty: 3 }, dice(1)));
    expect(s.simul!.turns[0].player.shares.WOOL).toBe(3);
  });

  it("waits for everyone to end their turn, then applies the moves in order", () => {
    let s = revealed();
    const start = s.market;
    const aMarket = view(s, 0).market;
    s = must(simulMove(s, 0, { type: "endTurn" }, dice(1)));
    expect(waitingOn(s)).toEqual([1]);
    expect(s.simul!.round).toBe(1);
    s = must(simulMove(s, 1, { type: "endTurn" }, dice(1)));
    // Round 2 has started; the summary lists A then B.
    expect(s.simul!.round).toBe(2);
    expect(s.simul!.stage).toBe("sell");
    const summary = s.simul!.summary!;
    expect(summary.map((e) => e.playerId)).toEqual([0, 1]);
    expect(summary[0].before).toBe(start);
    expect(summary[0].after).toBe(aMarket);
    expect(summary[1].before).toBe(aMarket);
    expect(s.market).toBe(summary[1].after);
    expect(summary[0].lines[0].text).toBe("rolls 1 + 1 = 2");
    // Everyone's turn is now in the shared game and log.
    expect(s.players[0].pos).toEqual({ kind: "track", index: 4 });
    expect(s.log.some((e) => e.playerId === 1 && e.text.startsWith("rolls"))).toBe(true);
    // Next round, B goes first.
    expect(roundOrder(s.simul!, 2)).toEqual([1, 0]);
  });

  it("applies the moves with bounces in order", () => {
    let s = game();
    s.market = 49;
    s.simul!.turns.forEach((t) => (t.market = 49));
    s = must(simulMove(s, 0, { type: "rollDice" }, dice(1, 1))); // WOOL +2: 49 → bounce 49
    s = must(simulMove(s, 1, { type: "rollDice" }, dice(1, 1))); // index 16 from 18
    const bMove = view(s, 1).lastMarketDelta;
    s = must(simulMove(s, 0, { type: "endTurn" }, dice(1)));
    s = must(simulMove(s, 1, { type: "endTurn" }, dice(1)));
    const [a, b] = s.simul!.summary!;
    expect(a.after).toBe(moveMarket(49, 2));
    expect(b.before).toBe(a.after);
    expect(s.market).toBe(b.after);
    expect(typeof bMove).toBe("number");
  });
});

describe("time running out", () => {
  it("rolls for anyone who hasn't (without selling), entering meetings", () => {
    let s = game();
    s.simul!.turns[0].player.shares.ISHOE = 5; // A passes the Int. Shoe meeting on a 6 (5, 4, 3)
    s = must(simulMove(s, 1, { type: "rollDice" }, dice(1, 1)));
    s = must(simulTimeout(s, stageKey(s), dice(3, 3)));
    expect(s.simul!.stage).toBe("act");
    expect(s.simul!.turns[0].timedOut).toBe(true);
    expect(s.simul!.turns[0].player.shares.ISHOE).toBeGreaterThanOrEqual(5);
    expect(s.simul!.turns[0].player.pos?.kind).toBe("lane");
  });

  it("ends everyone's turn without trading", () => {
    let s = game();
    s = must(simulMove(s, 0, { type: "rollDice" }, dice(1, 1)));
    s = must(simulMove(s, 1, { type: "rollDice" }, dice(2, 1)));
    s = must(simulTimeout(s, stageKey(s), dice(1)));
    expect(s.simul!.round).toBe(2);
    expect(s.players[0].shares.WOOL).toBe(0);
  });

  it("ignores a timeout for a stage that has already ended", () => {
    const s = game();
    expect(simulTimeout(s, "1:act", dice(1))).toBeNull();
  });

  it("covers a fee by selling the biggest holding at the lowest price", () => {
    let s = game(["A", "B"], 0);
    // A has stock and no cash, 2 squares from the bottom-right broker fee corner (moving ccw).
    const a = s.simul!.turns[0].player;
    a.pos = { kind: "track", index: 2 };
    a.shares.ALCOA = 30;
    a.shares.WOOL = 2;
    s = must(simulMove(s, 1, { type: "rollDice" }, dice(1, 1)));
    s = must(simulTimeout(s, stageKey(s), dice(1, 1)));
    expect(s.simul!.turns[0].phase.t).toBe("raiseCash");
    s = must(simulTimeout(s, stageKey(s), dice(1)));
    const p = s.players[0];
    expect(p.status).toBe("market");
    expect(p.shares.WOOL).toBe(2);
    expect(p.shares.ALCOA).toBeLessThan(30);
  });
});

describe("players leaving", () => {
  it("a bot takes over and finishes the stage", () => {
    let s = game();
    s = must(simulMove(s, 0, { type: "rollDice" }, dice(1, 1)));
    s = must(simulReplaceWithBot(s, 1, dice(2, 1)));
    expect(s.players[1].isBot).toBe(true);
    expect(s.simul!.stage).toBe("act");
  });
});

describe("whole games", () => {
  it("bots and timeouts play simultaneous games to the end", () => {
    for (let g = 0; g < 20; g++) {
      const setup = [
        { name: "A", isBot: false },
        { name: "B", isBot: true },
        { name: "C", isBot: false },
        { name: "D", isBot: true },
      ];
      let s = beginRounds(newGame(setup, 25_000, g % 2 ? "easy" : "normal", true, false, true), d6)!;
      for (let step = 0; step < 20_000 && s.phase.t !== "gameOver"; step++) {
        const seat = waitingOn(s).find((i) => !s.players[i].isBot);
        if (seat === undefined) throw new Error("stuck waiting on bots");
        // Humans play like bots, sometimes letting the clock run out.
        const move = Math.random() < 0.1 ? null : botMove(view(s, seat));
        const next = move ? simulMove(s, seat, move, d6) : simulTimeout(s, stageKey(s), d6);
        s = next ?? must(simulTimeout(s, stageKey(s), d6));
        const sim = s.simul!;
        expect(sim.turns.length).toBe(4);
        for (const p of s.players) expect(p.cash).toBeGreaterThanOrEqual(0);
      }
      expect(s.phase.t).toBe("gameOver");
    }
  });
});

function d6() {
  return 1 + Math.floor(Math.random() * 6);
}
