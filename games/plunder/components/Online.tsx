"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  type Action,
  type GameState,
  type Notice,
} from "@/games/plunder/lib/engine";
import { noticesFor, replay, resolve, seatToAct } from "@/games/plunder/lib/online";
import {
  RoomError,
  createRoom,
  editLobby,
  freeColor,
  joinRoom,
  normalizeCode,
  startGame,
  submitMove,
  watchRoom,
  type Replay,
  type Room,
} from "@/games/plunder/lib/rooms";
import { ensureUser } from "@/shared/firebase";
import { COLOR_HEX } from "./Pieces";
import PlunderGame, { turnKey } from "./PlunderGame";

const NAME_KEY = "plunder:name";
/** How long another player's ship takes per square when their move is replayed here. */
const SAIL_STEP_MS = 190;
/** Pause between other replayed actions so they don't blur together. */
const STEP_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

const message = (e: unknown) =>
  e instanceof RoomError || e instanceof Error ? e.message : "Something went wrong. Try again.";

// ---------------------------------------------------------------------------
// Creating or joining a room
// ---------------------------------------------------------------------------

export function OnlineStart({ onRoom, lastRoom }: { onRoom: (code: string) => void; lastRoom: string | null }) {
  const [name, setName] = useState(readName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      writeName(name.trim());
      onRoom(await task());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const player = name.trim() || "Captain";
  return (
    <div className="pl-online">
      <label className="pl-field">
        <span>Your name</span>
        <input
          className="pl-input"
          value={name}
          maxLength={14}
          placeholder="Captain"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        className="pl-btn pl-btn-main pl-btn-wide"
        disabled={busy}
        onClick={() => run(async () => createRoom((await ensureUser()).uid, player))}
      >
        Create a room
      </button>
      <form
        className="pl-join"
        onSubmit={(e) => {
          e.preventDefault();
          const c = normalizeCode(code);
          if (c.length === 5)
            run(async () => {
              await joinRoom(c, (await ensureUser()).uid, player);
              return c;
            });
        }}
      >
        <input
          className="pl-input pl-code"
          value={code}
          placeholder="ROOM CODE"
          aria-label="Room code"
          autoCapitalize="characters"
          onChange={(e) => setCode(normalizeCode(e.target.value))}
        />
        <button className="pl-btn" disabled={busy || code.length !== 5}>
          Join
        </button>
      </form>
      {lastRoom && (
        <button className="pl-link" onClick={() => onRoom(lastRoom)}>
          Back to room {lastRoom}
        </button>
      )}
      {error && <p className="pl-error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A room: lobby, then the game
// ---------------------------------------------------------------------------

export function OnlineRoom({ code, onQuit }: { code: string; onQuit: () => void }) {
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

  if (error) return <Message text={error} onQuit={onQuit} />;
  if (!uid || room === undefined) return <Message text="Connecting…" onQuit={onQuit} />;
  if (room === null) return <Message text={`There's no room ${code}.`} onQuit={onQuit} />;
  if (room.status === "lobby") return <Lobby room={room} uid={uid} onQuit={onQuit} />;
  return <OnlineGame room={room} uid={uid} onQuit={onQuit} />;
}

function Message({ text, onQuit }: { text: string; onQuit: () => void }) {
  return (
    <div className="pl-setup">
      <p className="pl-setup-lead">{text}</p>
      <button className="pl-btn pl-btn-wide" onClick={onQuit}>
        Back
      </button>
    </div>
  );
}

function Lobby({ room, uid, onQuit }: { room: Room; uid: string; onQuit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState(readName);
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
    <div className="pl-setup pl-lobby">
      <div className="pl-room-code">
        <span>Room code</span>
        <b>{room.code}</b>
      </div>
      <div className="pl-actions pl-lobby-share">
        {canShare && (
          <button className="pl-btn" onClick={share}>
            Share invite
          </button>
        )}
        <button className="pl-btn" onClick={copy}>
          {copied ? "Link copied!" : "Copy link"}
        </button>
      </div>

      <ul className="pl-lobby-seats">
        {room.seats.map((s, i) => (
          <li key={i}>
            <span className="pl-dot" style={{ background: COLOR_HEX[s.color] }} />
            <span className="pl-lobby-name">
              {s.name}
              {s.isBot && <small className="pl-tag">BOT</small>}
              {s.uid === room.hostUid && <small className="pl-tag">HOST</small>}
              {s.uid === uid && <small> (you)</small>}
            </span>
            {s.uid === uid && (
              <span className="pl-swatches pl-lobby-swatches">
                {PLAYER_COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={c}
                    className={`pl-swatch${s.color === c ? " on" : ""}`}
                    style={{ background: COLOR_HEX[c] }}
                    disabled={busy || room.seats.some((o, j) => j !== i && o.color === c)}
                    onClick={() =>
                      run(() =>
                        editLobby(room.code, (r) => r.seats.map((o) => (o.uid === uid ? { ...o, color: c } : o))),
                      )
                    }
                  />
                ))}
              </span>
            )}
            {isHost && s.uid !== uid && (
              <button
                className="pl-close"
                aria-label={`Remove ${s.name}`}
                disabled={busy}
                onClick={() => run(() => editLobby(room.code, (r) => r.seats.filter((_, j) => j !== i)))}
              >
                ×
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
            writeName(joinName.trim());
            run(() => joinRoom(room.code, uid, joinName.trim() || "Captain"));
          }}
        >
          <input
            className="pl-input"
            value={joinName}
            maxLength={14}
            placeholder="Your name"
            onChange={(e) => setJoinName(e.target.value)}
          />
          <button className="pl-btn pl-btn-main" disabled={busy || room.seats.length >= MAX_PLAYERS}>
            {room.seats.length >= MAX_PLAYERS ? "Full" : "Join"}
          </button>
        </form>
      )}

      {isHost && room.seats.length < MAX_PLAYERS && (
        <button
          className="pl-link"
          disabled={busy}
          onClick={() =>
            run(() =>
              editLobby(room.code, (r) => [
                ...r.seats,
                { uid: null, name: `Bot ${bots + 1}`, color: freeColor(r.seats), isBot: true },
              ]),
            )
          }
        >
          + Add a bot
        </button>
      )}

      {error && <p className="pl-error">{error}</p>}

      <div className="pl-lobby-foot">
        {isHost ? (
          <button
            className="pl-btn pl-btn-main pl-btn-wide"
            disabled={busy || room.seats.length < MIN_PLAYERS}
            onClick={() => run(() => startGame(room.code))}
          >
            {room.seats.length < MIN_PLAYERS ? "Waiting for players…" : "Set sail"}
          </button>
        ) : (
          seated && <p className="pl-setup-lead">Waiting for the host to start…</p>
        )}
        <div className="pl-lobby-links">
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
            Back
          </button>
        </div>
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
      />
      {error && (
        <div className="pl-toast pl-toast-error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </>
  );
}
