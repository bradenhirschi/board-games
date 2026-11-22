"use client";

import { useCallback, useEffect, useState } from "react";
import { authErrorMessage, onlineAvailable, signInWithGoogle, signOutUser, useFirebaseUser } from "@/shared/firebase";
import { newGame, randomLayout, type GameState, type PlayerSetup } from "@/games/plunder/lib/engine";
import PlunderGame, { turnKey } from "./PlunderGame";
import Setup from "./Setup";

const SAVE_KEY = "plunder:game";

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
  // Read the saved game after mounting (localStorage isn't there during the static render).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSaved(loadSaved());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

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

  return (
    <main className="pl-screen">
      <header className="pl-header">
        <h1 className="pl-title">Plunder</h1>
        {game ? (
          <button
            className="pl-link"
            onClick={() => {
              if (game.phase.t === "gameOver" || window.confirm("Leave this game? It stays saved on this phone.")) {
                setSaved(loadSaved());
                setGame(null);
              }
            }}
          >
            Menu
          </button>
        ) : (
          onlineAvailable && <Account />
        )}
      </header>
      {game ? (
        <PlunderGame
          key={turnKey(game)}
          game={game}
          onChange={change}
          onNewGame={() => setGame(null)}
          holder={holder}
          onHolder={setHolder}
        />
      ) : (
        <Setup onStart={start} onResume={saved ? () => setGame(saved) : undefined} />
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
