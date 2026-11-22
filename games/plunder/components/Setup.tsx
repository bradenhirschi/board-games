"use client";

import { useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  type PlayerColor,
  type PlayerSetup,
} from "@/games/plunder/lib/engine";
import { COLOR_HEX } from "./Pieces";

/** Choose players (names and colours) for a pass-and-play game. */
export default function Setup({
  onStart,
  onResume,
}: {
  onStart: (players: PlayerSetup[]) => void;
  onResume?: () => void;
}) {
  const [players, setPlayers] = useState<PlayerSetup[]>([
    { name: "Player 1", color: "red" },
    { name: "Player 2", color: "purple" },
  ]);
  const used = new Set(players.map((p) => p.color));
  const update = (i: number, patch: Partial<PlayerSetup>) =>
    setPlayers((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const add = () => {
    const color = PLAYER_COLORS.find((c) => !used.has(c)) as PlayerColor;
    setPlayers((ps) => [...ps, { name: `Player ${ps.length + 1}`, color }]);
  };

  return (
    <div className="pl-setup">
      <p className="pl-setup-lead">Pass and play on this phone. First to 10 Plunder Points wins.</p>
      {onResume && (
        <button className="pl-btn pl-btn-wide" onClick={onResume}>
          Resume saved game
        </button>
      )}
      <ul className="pl-setup-players">
        {players.map((p, i) => (
          <li key={i}>
            <input
              className="pl-input"
              value={p.name}
              maxLength={14}
              aria-label={`Player ${i + 1} name`}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <div className="pl-swatches" role="radiogroup" aria-label={`Player ${i + 1} colour`}>
              {PLAYER_COLORS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={p.color === c}
                  aria-label={c}
                  className={`pl-swatch${p.color === c ? " on" : ""}`}
                  style={{ background: COLOR_HEX[c] }}
                  disabled={used.has(c) && p.color !== c}
                  onClick={() => update(i, { color: c })}
                />
              ))}
            </div>
            {players.length > MIN_PLAYERS && (
              <button
                className="pl-close"
                aria-label={`Remove ${p.name}`}
                onClick={() => setPlayers((ps) => ps.filter((_, k) => k !== i))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {players.length < MAX_PLAYERS && (
        <button className="pl-link" onClick={add}>
          + Add a player
        </button>
      )}
      <button
        className="pl-btn pl-btn-main pl-btn-wide"
        onClick={() => onStart(players.map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}` })))}
      >
        Set sail
      </button>
    </div>
  );
}
