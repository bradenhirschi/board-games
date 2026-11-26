"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  WIN_POINTS,
  type Action,
  type GameState,
  type Notice,
} from "@/games/plunder/lib/engine";
import { noticesFor, replay, resolve, seatToAct } from "@/games/plunder/lib/online";
import {
  RoomError,
  editLobby,
  freeColor,
  joinRoom,
  startGame,
  submitMove,
  watchRoom,
  type Replay,
  type Room,
} from "@/games/plunder/lib/rooms";
import { ensureUser } from "@/shared/firebase";
import PlunderGame, { turnKey } from "./PlunderGame";
import type { PresenceStatus } from "@/games/plunder/lib/presence";
import { PlayerToken } from "./Setup";

/** How long another player's ship takes per square when their move is replayed here. */
const SAIL_STEP_MS = 190;
/** Pause between other replayed actions so they don't blur together. */
const STEP_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const message = (e: unknown) =>
  e instanceof RoomError || e instanceof Error ? e.message : "Something went wrong. Try again.";

// ---------------------------------------------------------------------------
// A room: lobby, then the game (the lobby is laid out like every game's)
// ---------------------------------------------------------------------------

export function OnlineRoom({
  code,
  header,
  name,
  onQuit,
  onStatusChange,
}: {
  code: string;
  /** The home screens' header, shown above the lobby. */
  header: ReactNode;
  /** Your name, from the home screen (for taking a seat from an invite link). */
  name: string;
  onQuit: () => void;
  /** For "online now": in the lobby or playing. */
  onStatusChange: (status: PresenceStatus | undefined) => void;
}) {
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
      .catch((e) => setError(message(e)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [code]);

  const status = error || !room ? undefined : room.status === "lobby" ? "lobby" : "playing";
  useEffect(() => {
    onStatusChange(status);
  }, [onStatusChange, status]);

  if (error) return <RoomNotice header={header} title="Something went wrong" text={error} onQuit={onQuit} />;
  if (!uid || room === undefined)
    return <RoomNotice header={header} title={`Room ${code}`} text="Connecting…" onQuit={onQuit} />;
  if (room === null)
    return <RoomNotice header={header} title={`Room ${code}`} text="There's no room with that code." onQuit={onQuit} />;
  if (room.status === "lobby") return <Lobby header={header} room={room} uid={uid} name={name} onQuit={onQuit} />;
  return (
    <>
      <header className="pl-header">
        <h1 className="pl-title">Plunder</h1>
        <button className="pl-link" onClick={onQuit}>
          Menu
        </button>
      </header>
      <OnlineGame room={room} uid={uid} onQuit={onQuit} />
    </>
  );
}

function RoomNotice({
  header,
  title,
  text,
  onQuit,
}: {
  header: ReactNode;
  title: string;
  text: string;
  onQuit: () => void;
}) {
  return (
    <div className="pl-home">
      {header}
      <h2 className="pl-home-title pl-home-title-small">{title}</h2>
      <p className="pl-muted">{text}</p>
      <button className="pl-btn" onClick={onQuit}>
        Back to menu
      </button>
    </div>
  );
}

function Lobby({
  header,
  room,
  uid,
  name,
  onQuit,
}: {
  header: ReactNode;
  room: Room;
  uid: string;
  name: string;
  onQuit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState(name);
  const [copied, setCopied] = useState(false);
  const isHost = room.hostUid === uid;
  const seated = room.memberUids.includes(uid);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/plunder?room=${room.code}`;
  const bots = room.seats.filter((s) => s.isBot).length;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  /** The device's share sheet (Messages, WhatsApp, …); copies the link where there isn't one. */
  const share = async () => {
    if (!canShare) return copy();
    try {
      await navigator.share({ title: "Plunder", text: `Join my Plunder game (room ${room.code})`, url: link });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) await copy();
    }
  };

  return (
    <div className="pl-home">
      {header}
      <div className="pl-room-code">
        <span className="pl-muted pl-small">Room code</span>
        <b>{room.code}</b>
      </div>
      <div className="pl-btn-row">
        {canShare && (
          <button className="pl-btn pl-btn-main" onClick={share}>
            Share invite
          </button>
        )}
        <button className="pl-btn" onClick={copy}>
          {copied ? "Link copied!" : "Copy link"}
        </button>
      </div>

      <h2 className="pl-home-heading">Players</h2>
      <ul className="pl-lobby-seats">
        {room.seats.map((s, i) => (
          <li key={i}>
            <PlayerToken
              color={s.color}
              name={s.name}
              taken={room.seats.filter((_, j) => j !== i).map((o) => o.color)}
              onPick={
                // Your own colour, and the host can recolour bots.
                !busy && (s.uid === uid || (isHost && s.isBot))
                  ? (color) =>
                      run(() => editLobby(room.code, (r) => r.seats.map((o, j) => (j === i ? { ...o, color } : o))))
                  : undefined
              }
            />
            <span className="pl-lobby-name">
              {s.name}
              {s.isBot && <span className="pl-tag">BOT</span>}
              {s.uid === room.hostUid && <span className="pl-tag">HOST</span>}
              {s.uid === uid && <span className="pl-muted pl-small"> (you)</span>}
            </span>
            {isHost && s.uid !== uid && (
              <button
                className="pl-link pl-remove"
                disabled={busy}
                aria-label={`Remove ${s.name}`}
                onClick={() => run(() => editLobby(room.code, (r) => r.seats.filter((_, j) => j !== i)))}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {!seated && (
        <form
          className="pl-join"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => joinRoom(room.code, uid, joinName.trim() || "Captain"));
          }}
        >
          <input
            className="pl-input"
            value={joinName}
            maxLength={14}
            placeholder="Your name"
            aria-label="Your name"
            onChange={(e) => setJoinName(e.target.value)}
          />
          <button className="pl-btn pl-btn-main" disabled={busy || room.seats.length >= MAX_PLAYERS}>
            {room.seats.length >= MAX_PLAYERS ? "Room is full" : "Join game"}
          </button>
        </form>
      )}

      {isHost ? (
        <>
          {room.seats.length < MAX_PLAYERS && (
            <div className="pl-link-row">
              <button
                className="pl-link"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    editLobby(room.code, (r) => {
                      if (r.seats.length >= MAX_PLAYERS) throw new RoomError("That room is full.");
                      return [
                        ...r.seats,
                        { uid: null, name: `Bot ${bots + 1}`, color: freeColor(r.seats), isBot: true },
                      ];
                    }),
                  )
                }
              >
                + Add bot
              </button>
            </div>
          )}
          <p className="pl-muted pl-small">Tap your token to change your colour. First to {WIN_POINTS} points wins.</p>
          <button
            className="pl-btn pl-btn-main pl-btn-big"
            disabled={busy || room.seats.length < MIN_PLAYERS}
            onClick={() => run(() => startGame(room.code))}
          >
            {room.seats.length < MIN_PLAYERS ? "Waiting for players…" : "Start game"}
          </button>
        </>
      ) : (
        seated && <p className="pl-muted">First to {WIN_POINTS} points. Waiting for the host to start…</p>
      )}

      {error && <p className="pl-error">{error}</p>}

      <div className="pl-link-row">
        {seated && !isHost && (
          <button
            className="pl-link"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await editLobby(room.code, (r) => r.seats.filter((s) => s.uid !== uid));
                onQuit();
              })
            }
          >
            Leave room
          </button>
        )}
        <button className="pl-link" onClick={onQuit}>
          Back to menu
        </button>
      </div>
    </div>
  );
}

/**
 * The game in a room. What the board shows trails the saved room while moves are replayed:
 * each saved move's actions are re-applied here, other players' ships sail square by square, and
 * the news they make (battles, treasure, your card draws) shows on this device. Your own moves
 * show at once, and are put right if the save is refused.
 */
function OnlineGame({ room, uid, onQuit }: { room: Room; uid: string; onQuit: () => void }) {
  const seatIndex = room.seats.findIndex((s) => s.uid === uid);
  const seat = seatIndex >= 0 ? seatIndex : null;
  const [display, setDisplay] = useState<GameState>(room.state!);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownVersion = useRef(room.version);
  const displayRef = useRef<GameState>(room.state!);
  const latest = useRef(room);
  const [known, setKnown] = useState(room);
  const [shownV, setShownV] = useState(room.version);
  const pumping = useRef(false);
  /** A move is being saved (a ref, so a second tap can't slip in before the re-render). */
  const sending = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const show = useCallback((s: GameState) => {
    displayRef.current = s;
    setDisplay(s);
  }, []);

  /** Replay one saved move from what's shown: animate others' sailing, and collect the news. */
  const animate = useCallback(
    async (from: GameState, rep: Replay) => {
      let s = from;
      const mine = rep.by === uid;
      for (const action of rep.actions) {
        if (!alive.current) return;
        if (!mine && action.t === "sail") {
          for (const p of action.path) {
            s = { ...s, ships: s.ships.map((sh) => (sh.id === action.ship ? { ...sh, pos: p } : sh)) };
            show(s);
            await sleep(SAIL_STEP_MS);
          }
        }
        const r = replay(s, [action]);
        s = r.state;
        // Your own moves' news showed when you made them.
        if (!mine) {
          show(s);
          setNotices((n) => [...n, ...noticesFor(r.notices, seat)]);
          await sleep(STEP_MS);
        }
      }
    },
    [uid, seat, show],
  );

  /** Catch the board up with the latest saved version, replaying moves where possible. */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    setBusy(true);
    try {
      for (;;) {
        const r = latest.current;
        if (!alive.current || !r.state || r.version <= shownVersion.current) break;
        if (r.replay && r.replay.from === shownVersion.current && r.version === r.replay.from + 1) {
          await animate(displayRef.current, r.replay);
        }
        shownVersion.current = r.version;
        show(r.state);
        setShownV(r.version);
      }
    } finally {
      pumping.current = false;
      if (alive.current) setBusy(false);
    }
  }, [animate, show]);

  const adopt = useCallback(
    (r: Room) => {
      if (r.version < latest.current.version) return;
      latest.current = r;
      setKnown(r);
      void pump();
    },
    [pump],
  );

  useEffect(() => adopt(room), [room, adopt]);

  const send = useCallback(
    async (action: Action) => {
      // A tap during a replay isn't lost: wait for the board to catch up first (a few hundred ms).
      for (
        let i = 0;
        i < 100 && alive.current && (pumping.current || shownVersion.current !== latest.current.version);
        i++
      ) {
        await sleep(50);
      }
      const base = latest.current;
      if (!base.state || sending.current) return;
      // Moves are decided on what the board shows: if the room has moved on since, drop it
      // (a bot's move queued before someone else saved, say) and let the board catch up.
      if (base.version !== shownVersion.current) return;
      const acting = seatToAct(base.state);
      const byBot = acting !== null && base.seats[acting]?.isBot;
      // Only act for your own seat, or for a bot.
      if (!byBot && acting !== seat) return;
      const by = byBot ? "bot" : uid;
      // Your own move shows straight away (bots' moves arrive for everyone through the replay).
      if (!byBot) {
        const now = resolve(displayRef.current, action);
        if (!now) return;
        show(now.state);
        setNotices((n) => [...n, ...noticesFor(now.notices, seat)]);
      }
      sending.current = true;
      setPending(true);
      setError(null);
      try {
        const saved = await submitMove(base.code, base.version, by, (state) => resolve(state, action));
        if (saved && alive.current) adopt(saved.room);
        // Not saved (someone else got there first): go back to what the room says.
        else if (alive.current && !byBot) show(latest.current.state!);
      } catch (e) {
        if (alive.current) {
          setError(message(e));
          show(latest.current.state!);
        }
      } finally {
        sending.current = false;
        if (alive.current) setPending(false);
      }
    },
    [uid, seat, adopt, show],
  );

  const caughtUp = !busy && shownV === known.version;
  const game: GameState = { ...display, notices };
  return (
    <>
      <PlunderGame
        key={turnKey(display)}
        game={game}
        seat={seat}
        locked={!caughtUp || pending}
        note={`Room ${room.code}`}
        onAct={(a) => void send(a)}
        onDismiss={() => setNotices((n) => n.slice(1))}
        onNewGame={onQuit}
        onMenu={onQuit}
      />
      {error && (
        <div className="pl-toast pl-toast-error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </>
  );
}
