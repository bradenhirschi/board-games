"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { authErrorMessage, ensureUser, onlineAvailable, useFirebaseUser } from "@/shared/firebase";
import { newGame, randomLayout, reducer, type GameState, type PlayerSetup } from "@/games/plunder/lib/engine";
import { usePlunderPresence, type PresenceStatus } from "@/games/plunder/lib/presence";
import { ROOM_CODE_MAX_LENGTH, enterRoom, isRoomCode, normalizeCode } from "@/games/plunder/lib/rooms";
import { OnlineRoom } from "./Online";
import PlunderGame, { turnKey } from "./PlunderGame";
import PlunderHeader from "./PlunderHeader";
import Setup from "./Setup";

const SAVE_KEY = "plunder:game";
const NAME_KEY = "plunder:name";
const TAB_KEY = "plunder:home-tab";

type Tab = "online" | "local";

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Keep the room code in the address bar so the page can be refreshed or shared. */
function setRoomInUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const g = raw ? (JSON.parse(raw) as GameState) : null;
    return g && g.version === 1 && g.phase.t !== "gameOver" ? g : null;
  } catch {
    return null;
  }
}

function save(g: GameState | null) {
  try {
    if (g) localStorage.setItem(SAVE_KEY, JSON.stringify(g));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}

const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  home: "On home screen",
  lobby: "Waiting in room",
  playing: "In a game",
};

/**
 * Plunder's home: laid out like every game's (Stock Market's is the standard). Header, then the
 * Online / On this device tabs; online is your name, a room code to open or join, and who's on
 * now; on this device is a saved game to continue and "New local game", which opens the setup.
 */
export default function PlunderHome() {
  const [game, setGame] = useState<GameState | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  /** The human holding the device (kept across turns so the hand-over cover shows only on a change). */
  const [holder, setHolder] = useState<number | null>(null);
  /** The online room open on this device, if any. */
  const [room, setRoom] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState<PresenceStatus | undefined>(undefined);
  const [localSetup, setLocalSetup] = useState(false);
  const [name, setName] = useState("");
  const [tab, setTab] = useState<Tab>(onlineAvailable ? "online" : "local");
  const [presenceError, setPresenceError] = useState(false);
  const user = useFirebaseUser();
  const { players: onlinePlayers, unavailable } = usePlunderPresence(
    user?.uid,
    name.trim() || "Captain",
    roomStatus ?? (game ? "playing" : "home"),
    !room && !game && !localSetup,
  );

  useEffect(() => {
    if (onlineAvailable) void ensureUser().catch(() => setPresenceError(true));
  }, []);

  // Read what's saved after mounting (localStorage isn't there during the static render), and open
  // a room from an invite link.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSaved(loadSaved());
    setName(readKey(NAME_KEY) ?? "");
    const savedTab = readKey(TAB_KEY);
    if (savedTab === "local" || (savedTab === "online" && onlineAvailable)) setTab(savedTab);
    const fromUrl = normalizeCode(new URLSearchParams(window.location.search).get("room") ?? "");
    if (onlineAvailable && isRoomCode(fromUrl)) setRoom(fromUrl);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const updateName = (value: string) => {
    setName(value);
    writeKey(NAME_KEY, value.trim() ? value : null);
  };

  function openRoom(code: string) {
    setRoom(code);
    setRoomInUrl(code);
  }

  function leaveRoom() {
    setRoom(null);
    setRoomStatus(undefined);
    setRoomInUrl(null);
  }

  function pickTab(t: Tab) {
    setTab(t);
    writeKey(TAB_KEY, t);
  }

  function start(players: PlayerSetup[]) {
    const seed = Math.floor(Math.random() * 2 ** 32);
    // Everyone rolls a die to decide who picks an island first (re-rolled until there's one highest).
    let rolls: number[];
    do rolls = players.map(() => 1 + Math.floor(Math.random() * 6));
    while (rolls.filter((r) => r === Math.max(...rolls)).length > 1);
    const g = newGame(players, seed, randomLayout(seed ^ 0x9e3779b9), rolls);
    setGame(g);
    setHolder(null);
    setLocalSetup(false);
    save(g);
  }

  const change = useCallback((g: GameState) => {
    setGame(g);
    save(g);
  }, []);

  const leaveGame = () => {
    if (!game || game.phase.t === "gameOver" || window.confirm("Leave this game? It stays saved on this device.")) {
      setSaved(loadSaved());
      setGame(null);
    }
  };

  const header = <PlunderHeader user={user} name={name} setName={updateName} />;

  if (room)
    return (
      <main className={`pl-screen ${roomStatus === "playing" ? "pl-screen-game" : "pl-screen-home"}`}>
        <OnlineRoom
          key={`${room}:${user?.uid ?? ""}`}
          code={room}
          header={header}
          name={name.trim() || "Captain"}
          onQuit={leaveRoom}
          onStatusChange={setRoomStatus}
        />
      </main>
    );

  if (game)
    return (
      <main className="pl-screen pl-screen-game">
        <header className="pl-header">
          <h1 className="pl-title">Plunder</h1>
          <button className="pl-link" onClick={leaveGame}>
            Menu
          </button>
        </header>
        <PlunderGame
          key={turnKey(game)}
          game={game}
          onAct={(a) => change(reducer(game, a))}
          onDismiss={() => change({ ...game, notices: game.notices.slice(1) })}
          onNewGame={() => setGame(null)}
          onMenu={leaveGame}
          holder={holder}
          onHolder={setHolder}
        />
      </main>
    );

  if (localSetup)
    return (
      <main className="pl-screen pl-screen-home">
        <Setup onStart={start} onBack={() => setLocalSetup(false)} />
      </main>
    );

  return (
    <main className="pl-screen pl-screen-home">
      <div className="pl-home">
        {header}

        {onlineAvailable && (
          <div className="pl-home-tabs" role="group" aria-label="Play mode">
            {(
              [
                ["online", "Online"],
                ["local", "On this device"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                className={tab === id ? "on" : ""}
                onClick={() => pickTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "online" && onlineAvailable && <OnlineStart name={name} setName={updateName} onOpenRoom={openRoom} />}

        {(tab === "local" || !onlineAvailable) && (
          <section className="pl-local-start">
            {saved && (
              <div className="pl-saved">
                <span>Game in progress · {saved.players.map((p) => p.name).join(", ")}</span>
                <button className="pl-btn pl-btn-main" onClick={() => setGame(saved)}>
                  Continue
                </button>
              </div>
            )}
            <button type="button" className="pl-btn pl-btn-main" onClick={() => setLocalSetup(true)}>
              New local game
            </button>
          </section>
        )}

        {onlineAvailable && (
          <section className="pl-roster" aria-labelledby="pl-roster-title">
            <h2 className="pl-home-heading" id="pl-roster-title">
              <span className="pl-roster-dot" aria-hidden="true" />
              {onlinePlayers && !unavailable ? `${onlinePlayers.length} online now` : "Online now"}
            </h2>
            {unavailable || (presenceError && !user) ? (
              <p className="pl-muted">Online players are temporarily unavailable.</p>
            ) : !onlinePlayers ? (
              <p className="pl-muted">Checking who’s online…</p>
            ) : onlinePlayers.length === 0 ? (
              <p className="pl-muted">Nobody is online.</p>
            ) : (
              <ul>
                {onlinePlayers.map((player) => (
                  <li key={player.uid}>
                    <span>
                      <b aria-hidden="true">{player.name.charAt(0).toUpperCase()}</b>
                      {player.name}
                      {player.uid === user?.uid && " (you)"}
                    </span>
                    <small className="pl-muted">{PRESENCE_LABELS[player.status]}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

/** Your name and a room code: a new code opens a room (you host), an existing one joins it. */
function OnlineStart({
  name,
  setName,
  onOpenRoom,
}: {
  name: string;
  setName: (name: string) => void;
  onOpenRoom: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeId = useId();

  const join = async () => {
    if (busy) return;
    if (!isRoomCode(code)) {
      setError("Enter a room code with at least 3 letters or numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await ensureUser();
      await enterRoom(code, user.uid, name.trim() || "Captain");
      onOpenRoom(code);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pl-online-start">
      <label className="pl-field">
        <span className="pl-home-label">Your name</span>
        <input
          className="pl-input"
          value={name}
          maxLength={14}
          placeholder="Captain"
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <form
        className="pl-field"
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <label className="pl-home-label" htmlFor={codeId}>
          Room code
        </label>
        <div className="pl-join">
          <input
            id={codeId}
            className="pl-input"
            value={code}
            placeholder="e.g. FAM"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={ROOM_CODE_MAX_LENGTH}
            aria-describedby={`${codeId}-hint`}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <button className="pl-btn pl-btn-main" disabled={busy}>
            {busy ? "Joining…" : "Join"}
          </button>
        </div>
        <small className="pl-muted pl-small" id={`${codeId}-hint`}>
          Pick a code to open a room, or enter the code your friends are using.
        </small>
      </form>
      {error && (
        <p className="pl-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
