"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  fmt,
  reducer,
  type Action,
  type GameState,
  type Player,
} from "@/games/stock-market/lib/engine";
import { botDecision, isBotTurn, resolve, type Decision } from "@/games/stock-market/lib/online";
import {
  RoomError,
  editLobby,
  fetchRoom,
  isNewer,
  joinRoom,
  kickPlayer,
  playAgain,
  startGame,
  submitMove,
  watchRoom,
  type Replay,
  type Room,
} from "@/games/stock-market/lib/rooms";
import { BOT_THINK_MS, GameView, STEP_MS, animateRoll } from "./Game";
import GameSettingsFields from "./GameSettingsFields";
import { Notice, useRemoved } from "./RoomNotice";
import SimulGame from "./SimulGame";
import { restartConnection } from "@/shared/firebase";

/** Pause between replayed decisions (buying, ending a turn…) so they don't blur together. */
const DECISION_MS = 350;

/** Wait this long before reopening a live listener that failed. */
const RECONNECT_MS = 2000;
/** Check the server if the live listener has been silent this long. */
const QUIET_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function OnlineRoom({ code, uid, connectionError, header, name, onQuit, onStatusChange }: {
  code: string;
  uid: string | undefined;
  connectionError: boolean;
  header: ReactNode;
  name: string;
  onQuit: () => void;
  onStatusChange: (status: Room["status"] | undefined) => void;
}) {
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Bumped to tear down and reopen the live listener when it's found to have gone quiet.
  const [watchKey, setWatchKey] = useState(0);
  const roomRef = useRef<Room | null | undefined>(undefined);
  const lastHeard = useRef(0);

  useEffect(() => {
    if (!uid) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const stop = watchRoom(
      code,
      (r) => {
        lastHeard.current = Date.now();
        roomRef.current = r;
        setRoom(r);
        setError(null);
      },
      (e) => {
        // Don't give up on the room: reconnect after a moment. Only show the error if the
        // room never loaded at all.
        console.warn(`[stock-market] live updates stopped (${e.message}); reconnecting`);
        if (roomRef.current === undefined) setError(e.message);
        retry = setTimeout(() => setWatchKey((k) => k + 1), RECONNECT_MS);
      },
    );
    return () => {
      stop();
      clearTimeout(retry);
    };
  }, [code, uid, watchKey]);

  // Safety net for a listener that has gone quiet without an error (common on phones after the
  // app was in the background): check the server when the page comes back into view, when the
  // network comes back, and whenever nothing has been heard for a while. If the server is ahead,
  // show its version and reopen the listener.
  useEffect(() => {
    if (!uid) return;
    let stopped = false;
    let checking = false;
    const check = async (force: boolean) => {
      if (stopped || checking || document.visibilityState !== "visible") return;
      if (!force && Date.now() - lastHeard.current < QUIET_MS) return;
      checking = true;
      try {
        const fresh = await fetchRoom(code);
        const seen = roomRef.current;
        lastHeard.current = Date.now();
        if (stopped || !fresh || !seen || !isNewer(fresh, seen)) return;
        console.warn(
          `[stock-market] live updates fell behind (showing move ${seen.version}, server has ${fresh.version}); reconnecting`,
        );
        roomRef.current = fresh;
        setRoom(fresh);
        setError(null);
        await restartConnection();
        setWatchKey((k) => k + 1);
      } catch {
        // Offline or similar: try again on the next tick.
      } finally {
        checking = false;
      }
    };
    const now = () => void check(true);
    const onVisible = () => document.visibilityState === "visible" && now();
    const timer = setInterval(() => void check(false), QUIET_MS / 2);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", now);
    window.addEventListener("online", now);
    window.addEventListener("pageshow", now);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", now);
      window.removeEventListener("online", now);
      window.removeEventListener("pageshow", now);
    };
  }, [code, uid]);

  const status = error ? undefined : room?.status;
  useEffect(() => {
    onStatusChange(status);
  }, [onStatusChange, status]);

  if (error || connectionError) return <Notice header={header} title="Something went wrong" text={error ?? "Couldn’t connect."} onQuit={onQuit} />;
  if (!uid || room === undefined) return <Notice header={header} title={`Room ${code}`} text="Connecting…" onQuit={onQuit} />;
  if (room === null) return <Notice header={header} title={`Room ${code}`} text="There's no room with that code." onQuit={onQuit} />;

  if (room.status === "lobby") return <Lobby header={header} room={room} uid={uid} name={name} onQuit={onQuit} />;
  if (room.state?.simultaneous) return <SimulGame room={room} uid={uid} onQuit={onQuit} />;
  return <OnlineGame room={room} uid={uid} onQuit={onQuit} />;
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function Lobby({ header, room, uid, name, onQuit }: { header: ReactNode; room: Room; uid: string; name: string; onQuit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState(name);
  const [copied, setCopied] = useState(false);
  const isHost = room.hostUid === uid;
  const seated = room.memberUids.includes(uid);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/stock-market?room=${room.code}`;

  const run = async (task: () => Promise<void>, setPending = setBusy) => {
    setPending(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof RoomError || e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  /** The phone's share sheet (Messages, WhatsApp, …); copies the link where there isn't one. */
  const share = async () => {
    if (!canShare) return copy();
    try {
      await navigator.share({
        title: "Stock Market",
        text: `Join my Stock Market game (room ${room.code})`,
        url: link,
      });
    } catch (e) {
      // Closing the share sheet isn't an error worth acting on; anything else, copy instead.
      if (!(e instanceof DOMException && e.name === "AbortError")) await copy();
    }
  };

  const bots = room.seats.filter((s) => s.isBot).length;

  return (
    <main className="setup">
      <div className="setup-card">
        {header}
        <div className="room-code">
          <span className="muted small">Room code</span>
          <b>{room.code}</b>
        </div>
        <div className="btn-row">
          {canShare && (
            <button className="btn btn-primary" onClick={share}>
              Share invite
            </button>
          )}
          <button className="btn" onClick={copy}>
            {copied ? "Link copied!" : "Copy link"}
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
            <input
              value={joinName}
              maxLength={16}
              onChange={(e) => setJoinName(e.target.value)}
              aria-label="Your name"
            />
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
                    editLobby(room.code, (r) => {
                      if (r.seats.length >= MAX_PLAYERS) throw new RoomError("That room is full.");
                      const botCount = r.seats.filter((seat) => seat.isBot).length;
                      return { seats: [...r.seats, { uid: null, name: `Bot ${botCount + 1}`, isBot: true }] };
                    }),
                  )
                }
              >
                + Add bot
              </button>
            )}
            <GameSettingsFields
              online
              settings={room}
              hasBots={bots > 0}
              disabled={savingSettings}
              onChange={(change) => void run(() => editLobby(room.code, () => change), setSavingSettings)}
            />
            <button
              className="btn btn-primary btn-big stock-lobby-start"
              disabled={busy || savingSettings || room.seats.length < MIN_PLAYERS}
              onClick={() => run(() => startGame(room.code))}
            >
              {room.seats.length < MIN_PLAYERS ? "Waiting for players…" : "Start game"}
            </button>
          </>
        ) : (
          seated && (
            <p className="muted">
              First to <b>${fmt(room.target)}</b>
            {room.simultaneous ? ", simultaneous turns" : ""}. Waiting for the host to start…
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
  // The newest room state this phone knows: from the live listener, or from its own save
  // (which arrives first, so the mover never waits on the listener to see their own move).
  const latest = useRef(room);
  const [known, setKnown] = useState(room);
  const savedAt = useRef<{ version: number; at: number } | null>(null);
  const [slowSave, setSlowSave] = useState(false);
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
          // Someone else rolled: tumble the dice here too, then show the result in the same
          // update that stops the tumble.
          const rolled = reducer(s, action);
          await new Promise<void>((done) => {
            rollTimer.current = animateRoll(setRolling, () => {
              setDisplay(rolled);
              done();
            });
          });
          s = rolled;
        } else {
          s = reducer(s, action);
          setDisplay(s);
        }
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

  /** Take a newer room state (never step back to an older one) and animate up to it. */
  const adopt = useCallback(
    (r: Room) => {
      if (r.version < latest.current.version) return;
      latest.current = r;
      setKnown(r);
      void pump();
    },
    [pump],
  );

  useEffect(() => {
    const s = savedAt.current;
    if (s && room.version >= s.version) {
      console.info(
        `[stock-market] live update for move ${s.version} arrived ${Math.round(performance.now() - s.at)}ms after it saved`,
      );
      savedAt.current = null;
    }
    adopt(room);
  }, [room, adopt]);

  // If a save takes a while, say so rather than looking frozen.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlowSave(true), 1000);
    return () => {
      clearTimeout(t);
      setSlowSave(false);
    };
  }, [pending]);

  const caughtUp = !animating && shownV === known.version;
  const authoritative = known.state!;
  const mySeat = room.seats.findIndex((s) => s.uid === uid);
  // Based on what the board shows, so the panel doesn't flicker to "waiting" while your
  // own move is saving and replaying.
  const choosing = display.phase.t === "chooseCareers";
  const myTurn = mySeat >= 0 && (choosing || (display.current === mySeat && display.phase.t !== "gameOver"));

  const send = useCallback(
    async (decision: Decision, by: string) => {
      const base = latest.current;
      if (!base.state) return;
      setPending(true);
      setError(null);
      try {
        // Occupations are picked by everyone at once, so apply those to the latest state;
        // every other move must be made on the version this phone is showing.
        const anyTime = decision.type === "chooseCareer";
        const started = performance.now();
        const saved = await submitMove(base.code, anyTime ? null : base.version, by, (state) =>
          resolve(state, decision),
        );
        console.info(`[stock-market] saving took ${Math.round(performance.now() - started)}ms`);
        if (saved && alive.current) {
          savedAt.current = { version: saved.version, at: performance.now() };
          adopt(saved);
        } else if (!saved && alive.current) {
          // Usually means this phone was behind (someone else's move hadn't reached it yet):
          // catch up from the server rather than wait for the live listener.
          const fresh = await fetchRoom(base.code).catch(() => null);
          if (fresh && alive.current && fresh.status === "playing") adopt(fresh);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your move.");
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [adopt],
  );

  const dispatch = useCallback((action: Action) => void send(action, uid), [send, uid]);

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
  /** Back to the lobby with everyone (the room shows it as soon as it's saved). */
  const again = async () => {
    setError(null);
    try {
      await playAgain(room.code, uid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't go back to the lobby.");
    }
  };

  const roll = useCallback(() => {
    if (rolling || pending) return;
    // Save the roll straight away and keep the dice tumbling until it's saved: the dice are
    // thrown in the save, so stopping earlier would settle on the last roll's faces and then
    // jump to the real ones.
    let saved = false;
    void send({ type: "rollDice" }, uid).finally(() => (saved = true));
    rollTimer.current = animateRoll(
      setRolling,
      () => {},
      () => saved,
    );
  }, [rolling, pending, send, uid]);

  // Bot turns: any seated player's phone may play them. If two phones try at once,
  // the first save wins and the other is rejected harmlessly.
  useEffect(() => {
    if (!caughtUp || pending || mySeat < 0 || !isBotTurn(authoritative)) return;
    const version = known.version;
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
  }, [caughtUp, pending, mySeat, authoritative, known.version, send]);

  if (removed)
    return <Notice title={`Room ${room.code}`} text="The host removed you from this game." onQuit={onQuit} />;

  const viewer: Player =
    mySeat >= 0 ? display.players[mySeat] : (display.players.find((p) => !p.isBot) ?? display.players[display.current]);
  return (
    <>
      <GameView
        state={display}
        viewer={viewer}
        isTurn={myTurn}
        canAct={myTurn && caughtUp && !pending}
        rolling={rolling}
        dispatch={dispatch}
        roll={roll}
        onQuit={onQuit}
        onPlayAgain={mySeat >= 0 ? () => void again() : undefined}
        kickable={
          isHost && display.phase.t !== "gameOver"
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
        waitingNote={mySeat < 0 ? "You're watching this game." : undefined}
        statusNote={slowSave ? "Saving…" : undefined}
      />
      {error && <div className="toast bad">{error}</div>}
    </>
  );
}
