"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { botMove } from "@/lib/bot";
import { CAREERS, START_SQUARES, TRACK, arrowFor, sideOf } from "@/lib/board";
import {
  canRoll,
  fmt,
  mustGoToMarket,
  netWorth,
  posName,
  reducer,
  type Action,
  type BuyOffer,
  type GameState,
  type Player,
} from "@/lib/engine";
import { STOCKS, STOCK_ORDER, lowestPrice, priceAt } from "@/lib/stocks";
import Board from "./Board";
import ZoomableBoard from "./ZoomableBoard";
import { Die } from "./Dice";

export const SAVE_KEY = "stock-market:game:v3";

const ROLL_MS = 550;
/** Delay between each square a token steps through. */
export const STEP_MS = 200;
/** Bots "think" for a random time in this range (ms) before each decision. */
export const BOT_THINK_MS = [1000, 1900] as const;

const rollDie = () => 1 + Math.floor(Math.random() * 6);

/** Pass-and-play on one device: the rules run here, bots included, and the game autosaves. */
export default function LocalGame({ initial, onQuit }: { initial: GameState; onQuit: () => void }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [rolling, setRolling] = useState<[number, number] | null>(null);
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
    const t = setTimeout(() => dispatch({ type: "step" }), STEP_MS);
    return () => clearTimeout(t);
  }, [ph]);

  useEffect(
    () => () => {
      if (rollTimer.current) clearInterval(rollTimer.current);
    },
    [],
  );

  const roll = useCallback(() => {
    if (rolling || !canRoll(state)) return;
    rollTimer.current = animateRoll(setRolling, () => dispatch({ type: "roll", dice: [rollDie(), rollDie()] }));
  }, [rolling, state]);

  // Computer players.
  useEffect(() => {
    if (!botTurn || rolling || ph.t === "moving") return;
    const t = setTimeout(
      () => {
        const move = botMove(state);
        if (!move) return;
        if (move.type === "rollDice") roll();
        else dispatch(move);
      },
      BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]),
    );
    return () => clearTimeout(t);
  }, [botTurn, rolling, ph, state, roll]);

  // The panel always shows a human's box (never a bot's): while occupations are chosen,
  // the next human still to pick; then the current player on a human turn, otherwise the
  // next human due to play. Only an all-bot game shows a bot.
  const choosing = ph.t === "chooseCareers";
  const viewer = choosing
    ? (state.players.find((p) => !p.isBot && p.career === null) ?? current)
    : current.isBot
      ? (nextHuman(state) ?? current)
      : current;
  const myTurn = choosing || (viewer.id === current.id && !botTurn);

  return (
    <GameView
      state={state}
      viewer={viewer}
      isTurn={myTurn}
      canAct={myTurn}
      rolling={rolling}
      dispatch={dispatch}
      roll={roll}
      onQuit={onQuit}
    />
  );
}

/**
 * Tumble the dice for ROLL_MS, then call `done` (which applies the real roll).
 * Returns the interval so the caller can cancel it on unmount.
 */
export function animateRoll(
  setRolling: (d: [number, number] | null) => void,
  done: () => void,
): ReturnType<typeof setInterval> {
  const started = Date.now();
  setRolling([rollDie(), rollDie()]);
  const timer = setInterval(() => {
    if (Date.now() - started < ROLL_MS) {
      setRolling([rollDie(), rollDie()]);
      return;
    }
    clearInterval(timer);
    setRolling(null);
    done();
  }, 70);
  return timer;
}

export interface GameViewProps {
  state: GameState;
  /** The human whose box the panel shows. */
  viewer: Player;
  /** Whether it's `viewer`'s turn: show their controls (perhaps disabled) rather than "waiting". */
  isTurn: boolean;
  /** Whether `viewer` may act right now (nothing saving or animating). */
  canAct: boolean;
  /** Dice faces while tumbling, or null. */
  rolling: [number, number] | null;
  dispatch: (a: Action) => void;
  roll: () => void;
  onQuit: () => void;
  /** Extra items for the top bar (e.g. the room code). */
  headerExtra?: ReactNode;
  /** Shown in the player box instead of "Waiting for your turn…". */
  waitingNote?: string;
  /** A short status shown under the turn heading (e.g. "Saving…"). */
  statusNote?: string;
}

/** The game screen: board, dice, the viewer's box, players and ticker. Holds no game logic. */
export function GameView({
  state,
  viewer,
  isTurn,
  canAct,
  rolling,
  dispatch,
  roll,
  onQuit,
  headerExtra,
  waitingNote,
  statusNote,
}: GameViewProps) {
  const [pickingStart, setPickingStart] = useState(false);
  const current = state.players[state.current];
  const ph = state.phase;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("button, input, select, textarea")) return;
      if ((e.key === " " || e.key === "Enter") && canAct) {
        e.preventDefault();
        setPickingStart(false);
        roll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roll, canAct]);

  const dice = rolling ?? state.dice;
  const diceTotal = !rolling && state.dice ? state.dice[0] + state.dice[1] : null;
  const winner = ph.t === "gameOver" ? state.players[ph.winnerId] : null;
  const ranked = [...state.players].sort((a, b) => netWorth(b, state.market) - netWorth(a, state.market));
  const rollAndClose = () => {
    setPickingStart(false);
    roll();
  };

  return (
    <div className="game">
      <header className="topbar">
        <h1>STOCK MARKET</h1>
        <div className="topbar-info">
          First to <b>${fmt(state.target)}</b> · Round {Math.floor((state.turn - 1) / state.players.length) + 1}
          {headerExtra}
        </div>
        <button className="link topbar-menu" onClick={onQuit}>
          Menu
        </button>
      </header>
      <ZoomableBoard>
        <Board
          players={state.players}
          currentId={current.id}
          market={state.market}
          marketDelta={state.lastMarketDelta}
          lastLanding={ph.t === "moving" ? null : state.lastLanding}
          diceTotal={diceTotal}
          onPickStart={
            pickingStart && canAct
              ? (start) => {
                  setPickingStart(false);
                  dispatch({ type: "goToMarket", start });
                }
              : undefined
          }
        />
      </ZoomableBoard>

      {/* Between the board and the sidebar: the dice and the viewer's turn controls. */}
      <div className="action-col">
        {/* Just the two dice; nothing until the first roll. */}
        {dice && (
          <div className="dice">
            <Die value={dice[0]} rolling={!!rolling} />
            <Die value={dice[1]} rolling={!!rolling} />
          </div>
        )}

        {winner ? (
          <section className="turn turn-over">
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
          <section className="turn">
            <div className="turn-heading">
              {ph.t === "chooseCareers"
                ? "Choose an occupation"
                : isTurn
                  ? "Your turn"
                  : current.isBot
                    ? `${current.name} is playing`
                    : `${current.name}'s turn`}
              {statusNote && <span className="status-note">{statusNote}</span>}
            </div>
            {ph.t === "chooseCareers" ? (
              <CareerChoice state={state} viewer={viewer} disabled={!canAct} dispatch={dispatch} />
            ) : isTurn ? (
              <TurnControls
                state={state}
                player={current}
                disabled={!!rolling || !canAct}
                dispatch={dispatch}
                roll={rollAndClose}
                pickingStart={pickingStart}
                setPickingStart={setPickingStart}
              />
            ) : viewer.isBot ? (
              <BotTurn state={state} busy={!!rolling || ph.t === "moving"} />
            ) : (
              <div className="controls">
                <p className="hint muted">{waitingNote ?? "Waiting for your turn…"}</p>
                <button className="btn btn-primary btn-big" disabled>
                  Roll dice
                </button>
              </div>
            )}
          </section>
        )}

      </div>

      {/* Sidebar: ticker on top, other players below, and this device's player at the bottom. */}
      <aside className="sidebar">
        <section className="card log">
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

        <section className="card others">
          <ul className="players">
            {state.players
              .filter((p) => p.id !== viewer.id)
              .map((p) => (
                <PlayerRow key={p.id} p={p} market={state.market} active={p.id === current.id && !winner} />
              ))}
          </ul>
        </section>

        <MeCard p={viewer} market={state.market} active={viewer.id === current.id && !winner} />
      </aside>
    </div>
  );
}

/** Game start: the viewer picks an occupation; the first roll waits for everyone. */
function CareerChoice({
  state,
  viewer,
  disabled,
  dispatch,
}: {
  state: GameState;
  viewer: Player;
  disabled: boolean;
  dispatch: (a: Action) => void;
}) {
  const waitingFor = state.players.filter((p) => p.career === null && p.id !== viewer.id);
  return (
    <div className="controls">
      <p className="hint">
        {viewer.career === null ? (
          <>
            <b>Choose your occupation.</b> You&apos;re paid whenever <i>anyone</i> throws your numbers. The first
            roll waits until everyone has picked.
          </>
        ) : (
          <>
            You&apos;re a <b>{CAREERS[viewer.career].name}</b>. You can still change before the first roll.
          </>
        )}
      </p>
      <div className="career-picks">
        {CAREERS.map((c, i) => (
          <button
            key={c.name}
            className={`career-pick ${viewer.career === i ? "career-pick-on" : ""}`}
            disabled={disabled}
            onClick={() => dispatch({ type: "chooseCareer", playerId: viewer.id, career: i })}
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
      {waitingFor.length > 0 && (
        <p className="hint muted">Waiting for {waitingFor.map((p) => p.name).join(", ")} to choose…</p>
      )}
    </div>
  );
}

function nextHuman(state: GameState): Player | null {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const p = state.players[(state.current + k) % n];
    if (!p.isBot) return p;
  }
  return null;
}

/** What a computer player is doing this turn (only shown in an all-bot game), without showing it the human controls. */
function BotTurn({ state, busy }: { state: GameState; busy: boolean }) {
  const p = state.players[state.current];
  const start = state.turnLogStart ?? 0;
  const done = state.log.filter((e) => e.id >= start && e.playerId === p.id).reverse();
  return (
    <div className="bot-turn">
      {done.length > 0 && (
        <ul className="bot-actions">
          {done.slice(-5).map((e) => (
            <li key={e.id} className={e.tone ? `log-${e.tone}` : ""}>
              {e.text}
            </li>
          ))}
        </ul>
      )}
      <p className="bot-status">
        🤖 <b>{p.name}</b> {busy ? <span>is moving…</span> : <span className="thinking">is thinking</span>}
      </p>
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
              At work. You&apos;re paid whenever <i>anyone</i> throws your number. Earn $1,000 to start playing the
              market (${fmt(1000 - player.cash)} to go).
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
          </div>
        ) : (
          <div className="btn-row">
            {!must && (
              <button className="btn btn-primary" disabled={disabled || player.career === null} onClick={roll}>
                Roll for salary
              </button>
            )}
            {must && (
              <button className="btn btn-primary" disabled={disabled} onClick={() => setPickingStart(true)}>
                Play the market →
              </button>
            )}
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

  if (ph.t === "afterRoll") {
    return <AfterRollBox key={state.turn} state={state} disabled={disabled} dispatch={dispatch} />;
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

/**
 * After landing: optionally buy the stock landed on, sell at the lowest board price
 * (to raise cash or otherwise), then end the turn.
 */
function AfterRollBox({
  state,
  disabled,
  dispatch,
}: {
  state: GameState;
  disabled: boolean;
  dispatch: (a: Parameters<typeof reducer>[1]) => void;
}) {
  const ph = state.phase;
  const [qty, setQty] = useState(0);
  if (ph.t !== "afterRoll") return null;
  const offer = ph.buy;
  const player = state.players[state.current];
  const held = STOCK_ORDER.filter((id) => player.shares[id] > 0);

  return (
    <div className="controls">
      <p className="hint">
        Landed on <b>{posName(player.pos)}</b>.
        {offer ? "" : " Nothing to buy here."} You can still sell (at the lowest board price) before you end your turn.
      </p>

      {offer && (
        <BuyControls
          offer={offer}
          qty={qty}
          setQty={setQty}
          disabled={disabled}
          onBuy={(n) => {
            dispatch({ type: "buy", qty: n });
            setQty(0);
          }}
        />
      )}

      {held.length > 0 && (
        <div className="sell-box sell-low">
          <div className="small muted">
            Sell after the throw, at the <b>lowest board price</b>:
          </div>
          {held.map((id) => (
            <SellRow
              key={`${id}-${player.shares[id]}`}
              stock={id}
              owned={player.shares[id]}
              price={lowestPrice(id)}
              disabled={disabled}
              onSell={(q) => dispatch({ type: "forcedSell", stock: id, qty: q })}
            />
          ))}
        </div>
      )}

      <button className="btn btn-primary btn-big" disabled={disabled} onClick={() => dispatch({ type: "endTurn" })}>
        End turn
      </button>
    </div>
  );
}

function BuyControls({
  offer,
  qty,
  setQty,
  disabled,
  onBuy,
}: {
  offer: BuyOffer;
  qty: number;
  setQty: (n: number) => void;
  disabled: boolean;
  onBuy: (n: number) => void;
}) {
  const stock = STOCKS[offer.stock];
  const set = (n: number) => setQty(Math.max(0, Math.min(offer.max, Math.floor(n) || 0)));
  // Limit squares buy exactly one share once it's affordable.
  const n = offer.limited ? offer.max : Math.min(qty, offer.max);
  let note: string;
  if (offer.limited && offer.bought > 0) note = " — you've bought your 1 share.";
  else if (offer.max === 0) note = " — you can't afford a share right now.";
  else if (offer.limited) note = " — limit 1 share here.";
  else note = ` — up to ${fmt(offer.max)}.`;

  return (
    <div className="buy-box">
      <p className="hint">
        Buy <b>{stock.name}</b> at <b>${offer.price}</b>/share{note}
        {offer.bought > 0 && !offer.limited && <> (bought {fmt(offer.bought)} so far)</>}
      </p>
      {!offer.limited && offer.max > 0 && (
        <div className="qty">
          <button className="btn btn-sq" disabled={disabled} onClick={() => set(qty - 1)} aria-label="One fewer">
            −
          </button>
          <input
            type="number"
            min={0}
            max={offer.max}
            value={Math.min(qty, offer.max)}
            disabled={disabled}
            onChange={(e) => set(Number(e.target.value))}
            aria-label="Shares to buy"
          />
          <button className="btn btn-sq" disabled={disabled} onClick={() => set(qty + 1)} aria-label="One more">
            +
          </button>
          <button className="link small" disabled={disabled} onClick={() => set(Math.floor(offer.max / 2))}>
            Half
          </button>
          <button className="link small" disabled={disabled} onClick={() => set(offer.max)}>
            Max
          </button>
        </div>
      )}
      {offer.max > 0 && (
        <button className="btn" disabled={disabled || n === 0} onClick={() => onBuy(n)}>
          Buy {n} for ${fmt(n * offer.price)}
        </button>
      )}
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

/** This device's player: a larger box with their money, whereabouts and holdings. */
function MeCard({ p, market, active }: { p: Player; market: number; active: boolean }) {
  const held = STOCK_ORDER.filter((id) => p.shares[id] > 0);
  const where =
    p.status === "work" ? (p.career !== null ? `At work · ${CAREERS[p.career].name}` : "At work") : posName(p.pos);
  return (
    <section className={`card me ${active ? "me-active" : ""}`}>
      <div className="me-top">
        <span className="token token-static token-big" style={{ background: p.color }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="me-name">
          <b>{p.name}</b>
          <span className="muted small">{where}</span>
        </div>
        {active && <span className="tag me-turn">YOUR TURN</span>}
      </div>
      <div className="me-money">
        <div>
          <span className="muted small">Cash</span>
          <b>${fmt(p.cash)}</b>
        </div>
        <div>
          <span className="muted small">Net worth</span>
          <b>${fmt(netWorth(p, market))}</b>
        </div>
      </div>
      {held.length > 0 ? (
        <table className="me-holdings">
          <tbody>
            {held.map((id) => (
              <tr key={id}>
                <td>
                  <span className="chip" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
                    {STOCKS[id].name}
                  </span>
                </td>
                <td className="num">×{fmt(p.shares[id])}</td>
                <td className="num muted">${priceAt(id, market)}</td>
                <td className="num">${fmt(p.shares[id] * priceAt(id, market))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small me-empty">No stock yet.</p>
      )}
    </section>
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
