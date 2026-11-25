"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mustGoToMarket, type Action, type GameState, type Player } from "@/games/stock-market/lib/engine";
import { kickPlayer, serverNow, submitMove, fetchRoom, type Room } from "@/games/stock-market/lib/rooms";
import {
  SUMMARY_BOX_MS,
  simulMove,
  simulTimeout,
  stageKey,
  stageMs,
  summaryMs,
  view,
  waitingOn,
  type SimulDecision,
  type SummaryEntry,
} from "@/games/stock-market/lib/simultaneous";
import { resolve } from "@/games/stock-market/lib/online";
import { playDice } from "@/games/stock-market/lib/sound";
import { GameView, STEP_MS } from "./Game";
import { Notice, useRemoved } from "./RoomNotice";

/**
 * An online game with "Simultaneous turns" on: everyone plays each round at once, privately.
 * The rules are in `lib/simultaneous.ts`; this shows this device's player their own turn, runs
 * the stage timers, and plays the end-of-round summary.
 */

const d6 = () => 1 + Math.floor(Math.random() * 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After a stage's time is up, wait this long (plus a little per seat) before playing for anyone still out. */
const TIMEOUT_GRACE_MS = 1500;

export default function SimulGame({ room, uid, onQuit }: { room: Room; uid: string; onQuit: () => void }) {
  const [known, setKnown] = useState(room);
  const latest = useRef(room);
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Take a newer room (or the same version once its stage start time has arrived from the server). */
  const adopt = useCallback((r: Room) => {
    const cur = latest.current;
    if (r.version < cur.version) return;
    if (r.version === cur.version && (cur.stageStartedAt !== null || r.stageStartedAt === null)) return;
    latest.current = r;
    setKnown(r);
  }, []);
  useEffect(() => adopt(room), [room, adopt]);

  const state = known.state!;
  const sim = state.simul;
  const over = state.phase.t === "gameOver";
  const mySeat = room.seats.findIndex((s) => s.uid === uid);
  const seated = mySeat >= 0;
  const key = stageKey(state);
  const mine = sim && seated ? sim.turns[mySeat] : null;

  // The clock, in server time, so every device runs the same timer.
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, []);

  // When the stage started: from the server, or (until that arrives) when this device first saw it.
  const [seen, setSeen] = useState(() => ({ key, at: serverNow() }));
  if (seen.key !== key) setSeen({ key, at: serverNow() });
  const stageStart = known.stageStartedAt ?? seen.at;
  const deadline = stageStart + stageMs(state);
  const secondsLeft = sim && !over ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  // ---- Saving ---------------------------------------------------------------------------------

  const save = useCallback(
    async (decide: (s: GameState) => GameState | null) => {
      setPending(true);
      setError(null);
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const saved = await submitMove(latest.current.code, null, uid, (s) => {
              const next = decide(s);
              return next ? { state: next, actions: [] } : null;
            });
            if (saved && alive.current) adopt(saved);
            else if (!saved && alive.current) {
              const fresh = await fetchRoom(latest.current.code).catch(() => null);
              if (fresh && alive.current && fresh.status === "playing") adopt(fresh);
            }
            return;
          } catch (e) {
            // Everyone saves to the same room at once, so a save can lose a race: try again.
            if (attempt >= 3) throw e;
            await sleep(200 + Math.random() * 600);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your move.");
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [uid, adopt],
  );

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), 1000);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [pending]);

  const send = useCallback(
    (decision: SimulDecision) => {
      if (!seated) return;
      // Before the first round (everyone picking an occupation) the normal rules apply; picking
      // the last occupation starts round 1.
      void save((s) => (s.simul ? simulMove(s, mySeat, decision, d6) : (resolve(s, decision, d6)?.state ?? null)));
    },
    [save, seated, mySeat],
  );

  // Time's up: any seated device plays for whoever is still out (the first save wins; later ones
  // find the stage already over and save nothing).
  const timedOutKey = useRef<string | null>(null);
  const outstanding = waitingOn(state).length > 0;
  const lateBy = now - deadline - TIMEOUT_GRACE_MS - Math.max(0, mySeat) * 400;
  useEffect(() => {
    if (!seated || !sim || over || !outstanding || pending || lateBy < 0 || timedOutKey.current === key) return;
    timedOutKey.current = key;
    void save((s) => simulTimeout(s, key, d6));
  }, [seated, sim, over, outstanding, pending, lateBy, key, save]);

  // ---- The end-of-round summary -----------------------------------------------------------------

  const [skipped, setSkipped] = useState<string | null>(null);
  const summary = sim?.summary ?? null;
  const intoStage = now - stageStart;
  const summaryOn = !!summary && skipped !== key && (sim!.stage === "sell" || over) && intoStage < summaryMs(state);
  const shownBoxes = summary ? Math.min(summary.length, Math.max(1, Math.floor(intoStage / SUMMARY_BOX_MS) + 1)) : 0;

  // ---- This player's own move: dice tumble while waiting, then the token walks ----------------

  const round = sim?.round ?? 0;
  const [rollClicked, setRollClicked] = useState<number | null>(null);
  const tumbling = !!sim && sim.stage === "sell" && !over && !!mine && (mine.rolled || rollClicked === round);
  const [faces, setFaces] = useState<[number, number]>([1, 1]);
  useEffect(() => {
    if (!tumbling) return;
    const t = setInterval(() => setFaces([d6(), d6()]), 90);
    return () => clearInterval(t);
  }, [tumbling]);

  // Steps of the token's walk shown so far (a reload shows the walk as already done).
  const pathLength = mine && sim?.stage === "act" ? mine.path.length : 0;
  const [walk, setWalk] = useState(() => ({ round, shown: pathLength }));
  if (walk.round !== round) setWalk({ round, shown: 0 });
  const walking = walk.round === round && walk.shown < pathLength;
  useEffect(() => {
    if (!walking) return;
    const t = setTimeout(() => setWalk((w) => ({ ...w, shown: w.shown + 1 })), STEP_MS);
    return () => clearTimeout(t);
  }, [walking, walk]);

  const roll = useCallback(() => {
    if (!sim || sim.stage !== "sell" || !mine || mine.rolled || rollClicked === round || pending) return;
    setRollClicked(round);
    playDice();
    send({ type: "rollDice" });
  }, [sim, mine, rollClicked, round, pending, send]);
  const dispatch = useCallback((a: Action) => send(a), [send]);

  // ---- Kicking ------------------------------------------------------------------------------------

  const isHost = room.hostUid === uid;
  const kick = useCallback(
    async (playerId: number) => {
      setError(null);
      try {
        const saved = await kickPlayer(room.code, uid, playerId);
        if (saved && alive.current) adopt(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't remove that player.");
      }
    },
    [room.code, uid, adopt],
  );
  const removed = useRemoved(room, uid);
  if (removed)
    return <Notice title={`Room ${room.code}`} text="The host removed you from this game." onQuit={onQuit} />;

  // ---- What to show -------------------------------------------------------------------------------

  let display: GameState = sim && seated && !over ? view(state, mySeat) : { ...state, simul: undefined };
  if (summaryOn && summary) display = duringSummary(display, summary, shownBoxes);
  else if (walking && mine) {
    const at = walk.shown === 0 ? mine.pathFrom : mine.path[walk.shown - 1];
    display = {
      ...display,
      players: display.players.map((p, i) => (i === mySeat ? { ...p, pos: at } : p)),
      market: state.market,
      lastMarketDelta: 0,
      lastLanding: null,
      phase: { t: "moving", remaining: pathLength - walk.shown, dir: "cw", skipDetourAt: null, leftLane: null },
    };
  }

  const others = (seats: number[]) => seats.filter((i) => i !== mySeat).map((i) => state.players[i].name);
  const waiting = sim && mine && !over ? (sim.stage === "sell" ? tumbling : mine.done) : false;
  const viewer: Player = seated
    ? display.players[mySeat]
    : (display.players.find((p) => !p.isBot) ?? display.players[0]);
  const choosing = state.phase.t === "chooseCareers";

  return (
    <>
      <GameView
        state={display}
        viewer={viewer}
        isTurn={seated && !over}
        canAct={seated && !pending && !summaryOn && !walking && !waiting}
        rolling={tumbling ? faces : null}
        dispatch={dispatch}
        roll={roll}
        onQuit={onQuit}
        kickable={
          isHost && !over
            ? display.players.filter((p) => room.seats[p.id]?.uid && room.seats[p.id].uid !== uid)
            : undefined
        }
        onKick={isHost ? (id) => void kick(id) : undefined}
        headerExtra={
          <>
            {" "}
            · Room <b>{room.code}</b>
          </>
        }
        waitingNote={seated ? undefined : "You're watching this game."}
        statusNote={slow ? "Saving…" : undefined}
        simul={
          choosing || !sim
            ? undefined
            : {
                heading: summaryOn ? `Round ${sim.round - 1} results` : stageHeading(sim.stage, mine?.player ?? null),
                secondsLeft: summaryOn || !seated ? null : secondsLeft,
                waitingFor: !seated ? [] : waiting ? others(waitingOn(state)) : null,
                waitingButton: sim.stage === "sell" ? "Roll dice" : "End turn",
                summary:
                  summaryOn && summary ? (
                    <RoundSummary state={state} entries={summary} shown={shownBoxes} />
                  ) : undefined,
                headingEnd:
                  summaryOn && summary ? (
                    <SummaryProgress
                      state={state}
                      entries={summary}
                      shown={shownBoxes}
                      onSkip={() => setSkipped(key)}
                    />
                  ) : undefined,
              }
        }
      />
      {error && <div className="toast bad">{error}</div>}
    </>
  );
}

/** The turn card's heading for this stage, by what the player can do in it. */
function stageHeading(stage: "sell" | "act", p: Player | null): string {
  if (p?.status === "work") {
    // Workers only roll; after the reveal they wait for the others.
    if (stage === "act") return "At work";
    return mustGoToMarket(p) ? "Time to play the market" : "Roll for salary";
  }
  return stage === "sell" ? "Sell, then roll" : "Buy & sell, then end turn";
}

/**
 * The board while the summary plays: the market as it stands after the boxes shown so far, and
 * the players whose box hasn't come up yet still where they started the round.
 */
function duringSummary(state: GameState, entries: SummaryEntry[], shown: number): GameState {
  const last = entries[shown - 1];
  const later = new Map(entries.slice(shown).map((e) => [e.playerId, e.from]));
  return {
    ...state,
    market: last.after,
    lastMarketDelta: last.after - last.before,
    lastLanding: null,
    dice: null,
    players: state.players.map((p) => (later.has(p.id) ? { ...p, pos: later.get(p.id)! } : p)),
  };
}

/** Last round, one player at a time in the round's order, each box applying their market move. */
function RoundSummary({ state, entries, shown }: { state: GameState; entries: SummaryEntry[]; shown: number }) {
  const entry = entries[shown - 1];
  const p = state.players[entry.playerId];
  const delta = entry.after - entry.before;
  return (
    <div className="controls round-summary">
      <div className="summary-box" key={entry.playerId}>
        <div className="summary-who">
          <span className="token token-static" style={{ background: p.color }}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
          <b style={{ color: p.color }}>{p.name}</b>
          <span className={`summary-market ${delta > 0 ? "log-up" : delta < 0 ? "log-down" : ""}`}>
            Market {entry.before} → {entry.after}
          </span>
        </div>
        <ul>
          {entry.lines.map((l, i) => (
            <li key={i} className={l.tone ? `log-${l.tone}` : ""}>
              {/* The box's heading shows the market move already. */}
              {l.text.replace(/ \(\d+ → \d+\)$/, "")}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** How far through the summary we are (a dot per player, in order), and a button to skip the rest. */
function SummaryProgress({
  state,
  entries,
  shown,
  onSkip,
}: {
  state: GameState;
  entries: SummaryEntry[];
  shown: number;
  onSkip: () => void;
}) {
  return (
    <>
      <span className="summary-dots" aria-label={`${shown} of ${entries.length}`}>
        {entries.map((e, i) => (
          <span key={e.playerId} style={{ background: i < shown ? state.players[e.playerId].color : undefined }} />
        ))}
      </span>
      <button className="btn btn-small" onClick={onSkip}>
        Skip
      </button>
    </>
  );
}
