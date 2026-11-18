"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { botMove } from "@/lib/bot";
import { CAREERS, START_SQUARES, TRACK, arrowFor, sideOf } from "@/lib/board";
import { canRoll, fmt, mustGoToMarket, netWorth, posName, reducer, type GameState, type Player } from "@/lib/engine";
import { STOCKS, STOCK_ORDER, lowestPrice, priceAt } from "@/lib/stocks";
import Board from "./Board";
import { Die } from "./Dice";

export const SAVE_KEY = "stonks:game:v2";

const ROLL_MS = 550;
const SPEEDS = {
  // Bots pause for a random "thinking" time between `bot` and `bot + botJitter` ms before each decision.
  normal: { step: 200, bot: 1000, botJitter: 900 },
  fast: { step: 70, bot: 180, botJitter: 0 },
};

const rollDie = () => 1 + Math.floor(Math.random() * 6);

export default function Game({ initial, onQuit }: { initial: GameState; onQuit: () => void }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [rolling, setRolling] = useState<[number, number] | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>("normal");
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = state.players[state.current];
  const ph = state.phase;
  const botTurn = current.isBot && ph.t !== "gameOver";

  // Save after every change so a refresh doesn't lose the game.
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state]);

  // Walk the token one square at a time.
  useEffect(() => {
    if (ph.t !== "moving") return;
    const t = setTimeout(() => dispatch({ type: "step" }), SPEEDS[speed].step);
    return () => clearTimeout(t);
  }, [ph, speed]);

  useEffect(
    () => () => {
      if (rollTimer.current) clearInterval(rollTimer.current);
    },
    [],
  );

  const roll = useCallback(() => {
    if (rolling || !canRoll(state)) return;
    const started = Date.now();
    setPickingStart(false);
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
  }, [rolling, state]);

  // Computer players.
  useEffect(() => {
    if (!botTurn || rolling || ph.t === "moving") return;
    const { bot, botJitter } = SPEEDS[speed];
    const t = setTimeout(
      () => {
        const move = botMove(state);
        if (!move) return;
        if (move.type === "rollDice") roll();
        else dispatch(move);
      },
      bot + Math.random() * botJitter,
    );
    return () => clearTimeout(t);
  }, [botTurn, rolling, ph, state, speed, roll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("button, input, select, textarea")) return;
      if ((e.key === " " || e.key === "Enter") && !current.isBot) {
        e.preventDefault();
        roll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roll, current.isBot]);

  const dice = rolling ?? state.dice;
  const diceTotal = !rolling && state.dice ? state.dice[0] + state.dice[1] : null;
  const winner = ph.t === "gameOver" ? state.players[ph.winnerId] : null;
  const ranked = [...state.players].sort((a, b) => netWorth(b, state.market) - netWorth(a, state.market));

  return (
    <div className="game">
      <div className="board-wrap">
        <Board
          players={state.players}
          currentId={current.id}
          market={state.market}
          marketDelta={state.lastMarketDelta}
          lastLanding={ph.t === "moving" ? null : state.lastLanding}
          diceTotal={diceTotal}
          onPickStart={
            pickingStart && !botTurn
              ? (start) => {
                  setPickingStart(false);
                  dispatch({ type: "goToMarket", start });
                }
              : undefined
          }
        />
      </div>

      <aside className="panel">
        <header className="panel-head">
          <h1>
            STONKS <span className="logo-arrow">↗</span>
          </h1>
          <div className="panel-tools">
            <button className="link" onClick={() => setSpeed(speed === "normal" ? "fast" : "normal")}>
              {speed === "normal" ? "Speed: normal" : "Speed: fast"}
            </button>
            <button className="link" onClick={onQuit}>
              Menu
            </button>
          </div>
        </header>
        <div className="muted small">
          First to <b>${fmt(state.target)}</b> at their turn to roll wins · Round{" "}
          {Math.floor((state.turn - 1) / state.players.length) + 1}
        </div>

        {winner ? (
          <section className="turn turn-over" style={{ borderColor: winner.color }}>
            <div className="turn-label">
              🏆 <b style={{ color: winner.color }}>{winner.name}</b> wins!
            </div>
            <ol className="standings">
              {ranked.map((p) => (
                <li key={p.id}>
                  <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span> — ${fmt(netWorth(p, state.market))}
                </li>
              ))}
            </ol>
            <button className="btn btn-primary" onClick={onQuit}>
              New game
            </button>
          </section>
        ) : (
          <section className="turn" style={{ borderColor: current.color }}>
            <div className="turn-label">
              <span className="token token-static" style={{ background: current.color }}>
                {current.name.slice(0, 1).toUpperCase()}
              </span>
              <b>{current.name}</b>
              {current.isBot && <span className="tag">BOT</span>}
              {botTurn && !rolling && ph.t !== "moving" && <span className="muted small thinking">thinking</span>}
              <span className="turn-cash">${fmt(current.cash)}</span>
            </div>

            <div className="dice-row">
              {dice ? (
                <>
                  <Die value={dice[0]} rolling={!!rolling} />
                  <Die value={dice[1]} rolling={!!rolling} />
                  {!rolling && <span className="dice-total">= {dice[0] + dice[1]}</span>}
                </>
              ) : (
                <span className="muted">Choose an occupation to start earning.</span>
              )}
            </div>

            <TurnControls
              state={state}
              player={current}
              disabled={botTurn || !!rolling}
              dispatch={dispatch}
              roll={roll}
              pickingStart={pickingStart}
              setPickingStart={setPickingStart}
            />
          </section>
        )}

        <section>
          <h2>Players</h2>
          <ul className="players">
            {state.players.map((p) => (
              <PlayerRow key={p.id} p={p} market={state.market} active={p.id === current.id && !winner} />
            ))}
          </ul>
        </section>

        <section className="log">
          <h2>Ticker</h2>
          {state.log.length === 0 ? (
            <p className="muted small">Nothing has happened yet.</p>
          ) : (
            <ol>
              {state.log.map((e) => {
                const p = e.playerId !== null ? state.players[e.playerId] : null;
                return (
                  <li key={e.id} className={e.tone ? `log-${e.tone}` : ""}>
                    {p && <b style={{ color: p.color }}>{p.name}</b>} {e.text}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        {!winner && (
          <button
            className="link small end-game"
            onClick={() => confirm("End the game now? The player worth the most wins.") && dispatch({ type: "endGame" })}
          >
            End game now (most money wins)
          </button>
        )}
      </aside>
    </div>
  );
}

const SIDE_NAME = { bottom: "Bottom", left: "Left", top: "Top", right: "Right" } as const;

function TurnControls({
  state,
  player,
  disabled,
  dispatch,
  roll,
  pickingStart,
  setPickingStart,
}: {
  state: GameState;
  player: Player;
  disabled: boolean;
  dispatch: (a: Parameters<typeof reducer>[1]) => void;
  roll: () => void;
  pickingStart: boolean;
  setPickingStart: (v: boolean) => void;
}) {
  const ph = state.phase;

  if (ph.t === "moving") return <p className="hint">Moving…</p>;

  if (ph.t === "preRoll" && player.status === "work") {
    const must = mustGoToMarket(player);
    return (
      <div className="controls">
        <p className="hint">
          {must ? (
            <>
              You&apos;ve earned <b>${fmt(player.cash)}</b>. Time to play the market!
            </>
          ) : (
            <>
              At work. You&apos;re paid whenever <i>anyone</i> throws your number. Reach $1,000 and you must play the market.
            </>
          )}
        </p>
        {!must && (
          <div className="career-picks">
            {CAREERS.map((c, i) => (
              <button
                key={c.name}
                className={`career-pick ${player.career === i ? "career-pick-on" : ""}`}
                disabled={disabled}
                onClick={() => dispatch({ type: "setCareer", career: i })}
              >
                <span>
                  {c.icon} {c.name}
                </span>
                <small>
                  {c.rolls[0]} or {c.rolls[1]} · ${c.salary}
                </small>
              </button>
            ))}
          </div>
        )}
        {pickingStart ? (
          <div className="start-picks">
            <p className="hint">Pick a START square (or click one on the board). There&apos;s no fee to start.</p>
            <div className="btn-row">
              {START_SQUARES.map((i) => (
                <button
                  key={i}
                  className="btn"
                  disabled={disabled}
                  onClick={() => {
                    setPickingStart(false);
                    dispatch({ type: "goToMarket", start: i });
                  }}
                >
                  {SIDE_NAME[sideOf(i) as keyof typeof SIDE_NAME]}
                </button>
              ))}
            </div>
            {!must && (
              <button className="link small" onClick={() => setPickingStart(false)}>
                Cancel
              </button>
            )}
          </div>
        ) : (
          <div className="btn-row">
            {!must && (
              <button className="btn btn-primary" disabled={disabled || player.career === null} onClick={roll}>
                Roll for salary
              </button>
            )}
            <button className={`btn ${must ? "btn-primary" : ""}`} disabled={disabled} onClick={() => setPickingStart(true)}>
              Play the market →
            </button>
          </div>
        )}
      </div>
    );
  }

  if (ph.t === "preRoll") {
    const pos = player.pos;
    const held = STOCK_ORDER.filter((id) => player.shares[id] > 0);
    let dirHint = "";
    if (pos?.kind === "track") {
      const sq = TRACK[pos.index];
      dirHint =
        sq.kind === "start"
          ? `odd ${arrowFor(pos.index, "cw")} · even ${arrowFor(pos.index, "ccw")}`
          : `you'll move ${arrowFor(pos.index, sq.dir)}`;
    } else if (pos) dirHint = "continuing through the meeting";
    return (
      <div className="controls">
        <p className="hint">
          On <b>{posName(pos)}</b>: {dirHint}
        </p>
        {held.length > 0 && (
          <div className="sell-box">
            <div className="small muted">Sell now at the board price (only before you roll):</div>
            {held.map((id) => (
              <SellRow
                key={id}
                stock={id}
                owned={player.shares[id]}
                price={priceAt(id, state.market)}
                disabled={disabled}
                onSell={(qty) => dispatch({ type: "sell", stock: id, qty })}
              />
            ))}
          </div>
        )}
        <button className="btn btn-primary btn-big" disabled={disabled} onClick={roll}>
          Roll dice
        </button>
        {!disabled && <div className="muted small">Space / Enter also rolls</div>}
      </div>
    );
  }

  if (ph.t === "detour") {
    return (
      <div className="controls">
        <p className="hint">
          Passing the <b>{STOCKS[ph.stock].name}</b> shareholders&apos; meeting. You own {player.shares[ph.stock]} shares —
          detour in for stock dividends? ({ph.remaining} {ph.remaining === 1 ? "step" : "steps"} left)
        </p>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={disabled} onClick={() => dispatch({ type: "detour", enter: true })}>
            Enter meeting
          </button>
          <button className="btn" disabled={disabled} onClick={() => dispatch({ type: "detour", enter: false })}>
            Keep going
          </button>
        </div>
      </div>
    );
  }

  if (ph.t === "buy") {
    return <BuyBox key={state.turn} state={state} disabled={disabled} dispatch={dispatch} />;
  }

  if (ph.t === "raiseCash") {
    const held = STOCK_ORDER.filter((id) => player.shares[id] > 0);
    return (
      <div className="controls">
        <p className="hint bad">
          You owe <b>${fmt(ph.owed)}</b> for the {ph.reason} but have ${fmt(player.cash)}. Sell stock at the lowest board
          price, or go broke.
        </p>
        <div className="sell-box">
          {held.map((id) => (
            <SellRow
              key={id}
              stock={id}
              owned={player.shares[id]}
              price={lowestPrice(id)}
              disabled={disabled}
              onSell={(qty) => dispatch({ type: "forcedSell", stock: id, qty })}
            />
          ))}
        </div>
        <button className="btn btn-danger" disabled={disabled} onClick={() => dispatch({ type: "goBroke" })}>
          Go broke (return everything, back to work)
        </button>
      </div>
    );
  }

  return null;
}

function BuyBox({
  state,
  disabled,
  dispatch,
}: {
  state: GameState;
  disabled: boolean;
  dispatch: (a: Parameters<typeof reducer>[1]) => void;
}) {
  const ph = state.phase;
  const [qty, setQty] = useState(ph.t === "buy" ? Math.min(ph.max, ph.limited ? 1 : 0) : 0);
  if (ph.t !== "buy") return null;
  const stock = STOCKS[ph.stock];
  const set = (n: number) => setQty(Math.max(0, Math.min(ph.max, Math.floor(n) || 0)));
  return (
    <div className="controls">
      <p className="hint">
        Buy <b>{stock.name}</b> at <b>${ph.price}</b>/share
        {ph.limited ? " — limit 1 share here." : ` — up to ${fmt(ph.max)}.`} This is your only chance this turn.
      </p>
      {!ph.limited && (
        <div className="qty">
          <button className="btn btn-sq" disabled={disabled} onClick={() => set(qty - 1)} aria-label="One fewer">
            −
          </button>
          <input
            type="number"
            min={0}
            max={ph.max}
            value={qty}
            disabled={disabled}
            onChange={(e) => set(Number(e.target.value))}
            aria-label="Shares to buy"
          />
          <button className="btn btn-sq" disabled={disabled} onClick={() => set(qty + 1)} aria-label="One more">
            +
          </button>
          <button className="link small" disabled={disabled} onClick={() => set(Math.floor(ph.max / 2))}>
            Half
          </button>
          <button className="link small" disabled={disabled} onClick={() => set(ph.max)}>
            Max
          </button>
        </div>
      )}
      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={disabled || qty === 0}
          onClick={() => dispatch({ type: "buy", qty })}
        >
          Buy {qty} for ${fmt(qty * ph.price)}
        </button>
        <button className="btn" disabled={disabled} onClick={() => dispatch({ type: "buy", qty: 0 })}>
          Pass
        </button>
      </div>
    </div>
  );
}

function SellRow({
  stock,
  owned,
  price,
  disabled,
  onSell,
}: {
  stock: keyof typeof STOCKS;
  owned: number;
  price: number;
  disabled: boolean;
  onSell: (qty: number) => void;
}) {
  const [qty, setQty] = useState(owned);
  const n = Math.max(1, Math.min(owned, qty || 1));
  const s = STOCKS[stock];
  return (
    <div className="sell-row">
      <span className="chip" style={{ background: s.color, color: s.ink }}>
        {s.name}
      </span>
      <span className="small muted">
        {owned} @ ${price}
      </span>
      <input
        type="number"
        min={1}
        max={owned}
        value={Math.min(qty, owned)}
        disabled={disabled}
        onChange={(e) => setQty(Number(e.target.value))}
        aria-label={`Shares of ${s.name} to sell`}
      />
      <button className="btn btn-small" disabled={disabled} onClick={() => onSell(n)}>
        Sell ${fmt(n * price)}
      </button>
    </div>
  );
}

function PlayerRow({ p, market, active }: { p: Player; market: number; active: boolean }) {
  const held = STOCK_ORDER.filter((id) => p.shares[id] > 0);
  return (
    <li className={active ? "players-current" : ""}>
      <div className="players-top">
        <span className="token token-static" style={{ background: p.color }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="players-name">
          <span>
            {p.name} {p.isBot && <span className="tag">BOT</span>}
          </span>
          <span className="muted small players-where">
            {p.status === "work" ? (p.career !== null ? `At work · ${CAREERS[p.career].name}` : "At work") : posName(p.pos)}
          </span>
        </span>
        <span className="players-money">
          <b>${fmt(netWorth(p, market))}</b>
          <span className="muted small">${fmt(p.cash)} cash</span>
        </span>
      </div>
      {held.length > 0 && (
        <div className="chips">
          {held.map((id) => (
            <span key={id} className="chip" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
              {STOCKS[id].name} ×{p.shares[id]}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
