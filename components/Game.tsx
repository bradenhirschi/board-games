"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { TRACK, arrowFor } from "@/lib/board";
import { newGame, reducer, type GameState, type MoveRecord, type Player } from "@/lib/game";
import { STOCKS } from "@/lib/stocks";
import Board from "./Board";
import { Die } from "./Dice";

const STEP_MS = 200;
const ROLL_MS = 600;

const rollDie = () => 1 + Math.floor(Math.random() * 6);

export default function Game({ names, onQuit }: { names: string[]; onQuit: () => void }) {
  const [state, dispatch] = useReducer(reducer, names, newGame);
  const [rolling, setRolling] = useState<[number, number] | null>(null);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Walk the token one square at a time.
  useEffect(() => {
    if (state.phase !== "moving") return;
    const t = setTimeout(() => dispatch({ type: "step" }), STEP_MS);
    return () => clearTimeout(t);
  }, [state.phase, state.path]);

  useEffect(() => () => {
    if (rollTimer.current) clearInterval(rollTimer.current);
  }, []);

  const busy = state.phase !== "idle" || rolling !== null;

  const roll = useCallback(() => {
    if (busy) return;
    const started = Date.now();
    setRolling([rollDie(), rollDie()]);
    rollTimer.current = setInterval(() => {
      if (Date.now() - started < ROLL_MS) {
        setRolling([rollDie(), rollDie()]);
        return;
      }
      clearInterval(rollTimer.current!);
      rollTimer.current = null;
      setRolling(null);
      dispatch({ type: "roll", dice: [rollDie(), rollDie()] });
    }, 70);
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === " " || e.key === "Enter") && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        roll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roll]);

  const last = state.history[0] ?? null;
  const mover = state.pending ? state.players[state.pending.playerId] : null;
  const current = state.players[state.current];
  const dice = rolling ?? state.dice;
  const diceTotal = !rolling && state.dice ? state.dice[0] + state.dice[1] : null;

  return (
    <div className="game">
      <div className="board-wrap">
        <Board
          players={state.players}
          currentId={mover?.id ?? current.id}
          market={state.market}
          marketDelta={state.phase === "idle" && last ? last.marketAfter - last.marketBefore : null}
          path={state.path}
          lastLanding={state.phase === "idle" ? (last?.to ?? null) : null}
          diceTotal={diceTotal}
        />
      </div>

      <aside className="panel">
        <header className="panel-head">
          <h1>
            STONKS <span className="logo-arrow">↗</span>
          </h1>
          <button className="link" onClick={onQuit}>
            New game
          </button>
        </header>

        <section className="turn" style={{ borderColor: (mover ?? current).color }}>
          <div className="turn-label">
            {mover ? (
              <>
                <b style={{ color: mover.color }}>{mover.name}</b> is moving…
              </>
            ) : rolling ? (
              <>
                <b style={{ color: current.color }}>{current.name}</b> is rolling…
              </>
            ) : (
              <>
                <b style={{ color: current.color }}>{current.name}</b>&apos;s turn
              </>
            )}
          </div>
          <div className="dice-row">
            {dice ? (
              <>
                <Die value={dice[0]} rolling={!!rolling} />
                <Die value={dice[1]} rolling={!!rolling} />
                {!rolling && <span className="dice-total">= {dice[0] + dice[1]}</span>}
              </>
            ) : (
              <span className="muted">Roll to start the game</span>
            )}
          </div>
          {state.phase === "idle" && !rolling && (
            <div className="hint">
              Moving from <b>{squareName(current.position)}</b>: {directionHint(current)}
            </div>
          )}
          <button className="roll" onClick={roll} disabled={busy}>
            {busy ? "…" : "Roll dice"}
          </button>
          <div className="muted small">Space / Enter also rolls</div>
        </section>

        <section>
          <h2>Players</h2>
          <ul className="players">
            {state.players.map((p, i) => (
              <li key={p.id} className={i === state.current && !mover ? "players-current" : ""}>
                <span className="token token-static" style={{ background: p.color }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="players-name">{p.name}</span>
                <span className="muted small">{squareName(p.position)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="log">
          <h2>Moves</h2>
          {state.history.length === 0 ? (
            <p className="muted small">No moves yet.</p>
          ) : (
            <ol>
              {state.history.map((m, i) => (
                <li key={state.history.length - i}>{describeMove(m, state)}</li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}

function squareName(index: number): string {
  const sq = TRACK[index];
  switch (sq.kind) {
    case "start":
      return "Start";
    case "corner":
      return "Broker fee corner";
    case "stock":
      return STOCKS[sq.stock].name;
    case "sellAll":
      return `Sell all ${STOCKS[sq.stock].name}`;
  }
}

function directionHint(player: Player): string {
  const sq = TRACK[player.position];
  if (sq.kind === "start") {
    return `odd ${arrowFor(player.position, "cw")} / even ${arrowFor(player.position, "ccw")}`;
  }
  return `you'll move ${arrowFor(player.position, sq.dir)}`;
}

function describeMove(m: MoveRecord, state: GameState) {
  const p = state.players[m.playerId];
  const delta = m.marketAfter - m.marketBefore;
  return (
    <>
      <b style={{ color: p.color }}>{p.name}</b> rolled {m.dice[0]}+{m.dice[1]} {arrowFor(m.from, m.dir)} to{" "}
      {squareName(m.to)}
      {delta !== 0 && (
        <span className={delta > 0 ? "up" : "down"}>
          {" "}
          · market {delta > 0 ? "▲" : "▼"}
          {Math.abs(delta)} ({m.marketBefore}→{m.marketAfter})
        </span>
      )}
    </>
  );
}
