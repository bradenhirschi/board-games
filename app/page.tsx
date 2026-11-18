"use client";

import { useState } from "react";
import Game from "@/components/Game";
import { PLAYER_COLORS } from "@/lib/game";

const MAX_PLAYERS = 4;

export default function Home() {
  const [names, setNames] = useState<string[]>(["Player 1", "Player 2"]);
  const [started, setStarted] = useState<string[] | null>(null);
  const [gameKey, setGameKey] = useState(0);

  if (started) {
    return <Game key={gameKey} names={started} onQuit={() => setStarted(null)} />;
  }

  const clean = names.map((n, i) => n.trim() || `Player ${i + 1}`);

  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-logo">
          STONKS <span className="logo-arrow">↗</span>
        </h1>
        <p className="muted">Roll, move, and watch the market swing.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setGameKey((k) => k + 1);
            setStarted(clean);
          }}
        >
          {names.map((name, i) => (
            <div key={i} className="setup-row">
              <span className="token token-static" style={{ background: PLAYER_COLORS[i] }}>
                {(name.trim() || `P`).slice(0, 1).toUpperCase()}
              </span>
              <input
                value={name}
                maxLength={16}
                aria-label={`Player ${i + 1} name`}
                onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
              />
              {names.length > 2 && (
                <button type="button" className="link" onClick={() => setNames(names.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {names.length < MAX_PLAYERS && (
            <button type="button" className="link" onClick={() => setNames([...names, `Player ${names.length + 1}`])}>
              + Add player
            </button>
          )}
          <button type="submit" className="roll">
            Start game
          </button>
        </form>
        <p className="muted small">Each player starts on one of the four START squares.</p>
      </div>
    </main>
  );
}
