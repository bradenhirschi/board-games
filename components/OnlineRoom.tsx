"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_TARGET, MAX_PLAYERS, MIN_PLAYERS, PLAYER_COLORS, fmt, reducer, type Action, type GameState, type Player } from "@/lib/engine";
import { ensureUser } from "@/lib/firebase";
import { botDecision, isBotTurn, resolve, type Decision } from "@/lib/online";
import { RoomError, editLobby, joinRoom, startGame, submitMove, watchRoom, type Replay, type Room } from "@/lib/rooms";
import { BOT_THINK_MS, GameView, STEP_MS, animateRoll } from "./Game";

const TARGETS = [25_000, 50_000, 100_000, 250_000];
/** Pause between replayed decisions (buying, ending a turn…) so they don't blur together. */
const DECISION_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function OnlineRoom({ code, name, onQuit }: { code: string; name: string; onQuit: () => void }) {
  const [uid, setUid] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    ensureUser()
      .then((user) => {
        if (cancelled) return;
        setUid(user.uid);
        stop = watchRoom(code, setRoom, (e) => setError(e.message));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't connect."));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [code]);

  if (error) return <Notice title="Something went wrong" text={error} onQuit={onQuit} />;
  if (!uid || room === undefined) return <Notice title={`Room ${code}`} text="Connecting…" onQuit={onQuit} />;
  if (room === null) return <Notice title={`Room ${code}`} text="There's no room with that code." onQuit={onQuit} />;

  if (room.status === "lobby") return <Lobby room={room} uid={uid} name={name} onQuit={onQuit} />;
  return <OnlineGame room={room} uid={uid} onQuit={onQuit} />;
}

function Notice({ title, text, onQuit }: { title: string; text: string; onQuit: () => void }) {
  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-logo">{title}</h1>
        <p className="muted">{text}</p>
        <button className="btn" onClick={onQuit}>
          Back to menu
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function Lobby({ room, uid, name, onQuit }: { room: Room; uid: string; name: string; onQuit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState(name);
  const [copied, setCopied] = useState(false);
  const isHost = room.hostUid === uid;
  const seated = room.memberUids.includes(uid);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/?room=${room.code}`;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof RoomError || e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Stock Market", text: `Join my Stock Market game (room ${room.code})`, url: link });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const bots = room.seats.filter((s) => s.isBot).length;

  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-logo">Stock Market</h1>
        <div className="room-code">
          <span className="muted small">Room code</span>
          <b>{room.code}</b>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={share}>
            {copied ? "Link copied!" : "Share invite link"}
          </button>
        </div>

        <h2 className="lobby-heading">Players</h2>
        <ul className="lobby-seats">
          {room.seats.map((s, i) => (
            <li key={i}>
              <span className="token token-static" style={{ background: PLAYER_COLORS[i] }}>
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="lobby-name">
                {s.name}
                {s.isBot && <span className="tag">BOT</span>}
                {s.uid === room.hostUid && <span className="tag">HOST</span>}
                {s.uid === uid && <span className="muted small"> (you)</span>}
              </span>
              {isHost && s.uid !== uid && (
                <button
                  className="link small"
                  disabled={busy}
                  aria-label={`Remove ${s.name}`}
                  onClick={() => run(() => editLobby(room.code, (r) => ({ seats: r.seats.filter((_, j) => j !== i) })))}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>

        {!seated && (
          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => joinRoom(room.code, uid, joinName.trim() || "Player"));
            }}
          >
            <input value={joinName} maxLength={16} onChange={(e) => setJoinName(e.target.value)} aria-label="Your name" />
            <button className="btn btn-primary" disabled={busy || room.seats.length >= MAX_PLAYERS}>
              {room.seats.length >= MAX_PLAYERS ? "Room is full" : "Join game"}
            </button>
          </form>
        )}

        {isHost ? (
          <>
            {room.seats.length < MAX_PLAYERS && (
              <button
                className="link"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    editLobby(room.code, (r) => ({
                      seats: [...r.seats, { uid: null, name: `Bot ${bots + 1}`, isBot: true }],
                    })),
                  )
                }
              >
                + Add bot
              </button>
            )}
            <label className="setup-target">
              <span>Winning amount</span>
              <select
                value={room.target}
                disabled={busy}
                onChange={(e) => run(() => editLobby(room.code, () => ({ target: Number(e.target.value) })))}
              >
                {TARGETS.map((t) => (
                  <option key={t} value={t}>
                    ${fmt(t)}
                    {t === DEFAULT_TARGET ? " (standard)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-primary btn-big"
              disabled={busy || room.seats.length < MIN_PLAYERS}
              onClick={() => run(() => startGame(room.code))}
            >
              {room.seats.length < MIN_PLAYERS ? "Waiting for players…" : "Start game"}
            </button>
          </>
        ) : (
          seated && (
            <p className="muted">
              First to <b>${fmt(room.target)}</b>. Waiting for the host to start…
            </p>
          )
        )}

        {error && <p className="hint bad">{error}</p>}

        <div className="btn-row">
          {seated && !isHost && (
            <button
              className="link small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await editLobby(room.code, (r) => ({ seats: r.seats.filter((s) => s.uid !== uid) }));
                  onQuit();
                })
              }
            >
              Leave room
            </button>
          )}
          <button className="link small" onClick={onQuit}>
            Back to menu
          </button>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

function OnlineGame({ room, uid, onQuit }: { room: Room; uid: string; onQuit: () => void }) {
  // What the board shows: it trails the saved state while a move is being replayed.
  const [display, setDisplay] = useState<GameState>(room.state!);
  const [rolling, setRolling] = useState<[number, number] | null>(null);
  const [animating, setAnimating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownVersion = useRef(room.version);
  // Mirror of shownVersion for rendering (refs can't be read during render).
  const [shownV, setShownV] = useState(room.version);
  const displayRef = useRef<GameState>(room.state!);
  const latest = useRef(room);
  const pumping = useRef(false);
  const alive = useRef(true);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (rollTimer.current) clearInterval(rollTimer.current);
    };
  }, []);

  /** Animate one saved move from the version currently shown. */
  const animate = useCallback(
    async (from: GameState, rep: Replay) => {
      let s = from;
      for (const action of rep.actions) {
        if (!alive.current) return;
        if (action.type === "roll" && rep.by !== uid) {
          // Someone else rolled: tumble the dice here too before showing the result.
          setRolling([1, 1]);
          await new Promise<void>((done) => {
            rollTimer.current = animateRoll(setRolling, done);
          });
        }
        s = reducer(s, action);
        setDisplay(s);
        await sleep(action.type === "step" ? STEP_MS : DECISION_MS);
      }
    },
    [uid],
  );

  /** Catch the board up with the latest saved version, replaying moves where possible. */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    setAnimating(true);
    try {
      for (;;) {
        const r = latest.current;
        if (!alive.current || !r.state || r.version <= shownVersion.current) break;
        const fromState = displayRef.current;
        if (r.replay && r.replay.from === shownVersion.current && r.version === r.replay.from + 1) {
          await animate(fromState, r.replay);
        }
        shownVersion.current = r.version;
        displayRef.current = r.state;
        setDisplay(r.state);
        setShownV(r.version);
      }
    } finally {
      pumping.current = false;
      if (alive.current) setAnimating(false);
    }
  }, [animate]);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    latest.current = room;
    void pump();
  }, [room, pump]);

  const caughtUp = !animating && shownV === room.version;
  const authoritative = room.state!;
  const mySeat = room.seats.findIndex((s) => s.uid === uid);
  const myTurn = mySeat >= 0 && authoritative.current === mySeat && authoritative.phase.t !== "gameOver";

  const send = useCallback(
    async (decision: Decision, by: string) => {
      const base = latest.current;
      if (!base.state) return;
      const move = resolve(base.state, decision);
      if (!move) return;
      setPending(true);
      setError(null);
      try {
        await submitMove(base.code, base.version, by, move);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your move.");
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [],
  );

  const dispatch = useCallback((action: Action) => void send(action, uid), [send, uid]);

  const roll = useCallback(() => {
    if (rolling || pending) return;
    setPending(true);
    rollTimer.current = animateRoll(setRolling, () => void send({ type: "rollDice" }, uid));
  }, [rolling, pending, send, uid]);

  // Bot turns: any seated player's phone may play them. If two phones try at once,
  // the first save wins and the other is rejected harmlessly.
  useEffect(() => {
    if (!caughtUp || pending || mySeat < 0 || !isBotTurn(authoritative)) return;
    const version = room.version;
    const t = setTimeout(
      () => {
        const r = latest.current;
        if (r.version !== version || !r.state) return;
        const decision = botDecision(r.state);
        if (decision) void send(decision, "bot");
      },
      BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]),
    );
    return () => clearTimeout(t);
  }, [caughtUp, pending, mySeat, authoritative, room.version, send]);

  const viewer: Player =
    mySeat >= 0 ? display.players[mySeat] : (display.players.find((p) => !p.isBot) ?? display.players[display.current]);
  const isHost = room.hostUid === uid;

  return (
    <>
      <GameView
        state={display}
        viewer={viewer}
        canAct={myTurn && caughtUp && !pending}
        rolling={rolling}
        dispatch={dispatch}
        roll={roll}
        onQuit={onQuit}
        onEndGame={isHost ? () => void send({ type: "endGame" }, uid) : undefined}
        headerExtra={<> · Room <b>{room.code}</b></>}
        waitingNote={mySeat < 0 ? "You're watching this game." : undefined}
      />
      {error && <div className="toast bad">{error}</div>}
    </>
  );
}
