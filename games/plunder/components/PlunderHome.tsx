"use client";

import { useCallback, useEffect, useState } from "react";
import { authErrorMessage, onlineAvailable, signInWithGoogle, signOutUser, useFirebaseUser } from "@/shared/firebase";
import { newGame, randomLayout, reducer, type GameState, type PlayerSetup } from "@/games/plunder/lib/engine";
import { normalizeCode } from "@/games/plunder/lib/rooms";
import { OnlineRoom, OnlineStart } from "./Online";
import PlunderGame, { turnKey } from "./PlunderGame";
import Setup from "./Setup";

const SAVE_KEY = "plunder:game";
const LAST_ROOM_KEY = "plunder:last-room";
const TAB_KEY = "plunder:home-tab";

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

/** Plunder's one-screen layout: slim header, then either the player setup or the game. Nothing scrolls. */
export default function PlunderHome() {
  const [game, setGame] = useState<GameState | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  /** The human holding the phone (kept across turns so the hand-over cover shows only on a change). */
  const [holder, setHolder] = useState<number | null>(null);
  /** The online room being played, if any. */
  const [room, setRoom] = useState<string | null>(null);
  const [lastRoom, setLastRoom] = useState<string | null>(null);
  const [tab, setTab] = useState<"local" | "online">("local");
  // Read what's saved after mounting (localStorage isn't there during the static render), and open
  // a room from an invite link.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSaved(loadSaved());
    setLastRoom(readKey(LAST_ROOM_KEY));
    if (onlineAvailable && readKey(TAB_KEY) === "online") setTab("online");
    const fromUrl = normalizeCode(new URLSearchParams(window.location.search).get("room") ?? "");
    if (onlineAvailable && fromUrl.length === 5) setRoom(fromUrl);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function openRoom(code: string) {
    setRoom(code);
    setLastRoom(code);
    writeKey(LAST_ROOM_KEY, code);
    setRoomInUrl(code);
  }

  function leaveRoom() {
    setRoom(null);
    setRoomInUrl(null);
  }

  function pickTab(t: "local" | "online") {
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

  return (
    <main className={`pl-screen${game || room ? " pl-screen-game" : ""}`}>
      <header className="pl-header">
        <h1 className="pl-title">Plunder</h1>
        {room ? (
          <button className="pl-link" onClick={leaveRoom}>
            Menu
          </button>
        ) : game ? (
          <button className="pl-link" onClick={leaveGame}>
            Menu
          </button>
        ) : (
          onlineAvailable && <Account />
        )}
      </header>
      {room ? (
        <OnlineRoom key={room} code={room} onQuit={leaveRoom} />
      ) : game ? (
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
      ) : (
        <>
          {onlineAvailable && (
            <div className="pl-home-tabs" role="tablist" aria-label="How to play">
              <button role="tab" aria-selected={tab === "local"} onClick={() => pickTab("local")}>
                On this device
              </button>
              <button role="tab" aria-selected={tab === "online"} onClick={() => pickTab("online")}>
                Online
              </button>
            </div>
          )}
          {tab === "online" && onlineAvailable ? (
            <OnlineStart onRoom={openRoom} lastRoom={lastRoom} />
          ) : (
            <Setup onStart={start} onResume={saved ? () => setGame(saved) : undefined} />
          )}
        </>
      )}
    </main>
  );
}

/** The shared account (one login across every game). */
function Account() {
  const user = useFirebaseUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (user === undefined) return null;
  const googleName = user && !user.isAnonymous ? (user.displayName ?? user.email ?? "Google account") : null;
  return (
    <div className="pl-account" aria-live="polite">
      {error && <span className="pl-error">{error}</span>}
      {googleName ? (
        <>
          <span className="pl-account-name">{googleName}</span>
          <button className="pl-link" disabled={busy} onClick={() => run(signOutUser)}>
            Sign out
          </button>
        </>
      ) : (
        <button className="pl-link" disabled={busy} onClick={() => run(signInWithGoogle)}>
          Sign in
        </button>
      )}
    </div>
  );
}
