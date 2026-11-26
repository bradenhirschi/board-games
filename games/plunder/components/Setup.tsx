"use client";

import { useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  type PlayerColor,
  WIN_POINTS,
  type PlayerSetup,
} from "@/games/plunder/lib/engine";
import { COLOR_HEX } from "./Pieces";

/**
 * A player's token: their colour with their initial. With `onPick` it's a button that changes to
 * the next colour nobody else has.
 */
export function PlayerToken({
  color,
  name,
  taken = [],
  onPick,
}: {
  color: PlayerColor;
  name: string;
  /** Colours other players have (skipped when changing). */
  taken?: PlayerColor[];
  onPick?: (color: PlayerColor) => void;
}) {
  const initial = (name.trim() || "P").slice(0, 1).toUpperCase();
  const style = { background: COLOR_HEX[color] };
  if (!onPick)
    return (
      <span className="pl-token" style={style} aria-hidden="true">
        {initial}
      </span>
    );
  const at = PLAYER_COLORS.indexOf(color);
  const next = [...PLAYER_COLORS.slice(at + 1), ...PLAYER_COLORS.slice(0, at)].find((c) => !taken.includes(c));
  return (
    <button
      type="button"
      className="pl-token pl-token-pick"
      style={style}
      disabled={!next}
      aria-label={`${name || "Player"}'s colour: ${color}. Change colour`}
      onClick={() => next && onPick(next)}
    >
      {initial}
    </button>
  );
}

/** The "New local game" page: pass and play, with bots if you like. Laid out like every game's. */
export default function Setup({ onStart, onBack }: { onStart: (players: PlayerSetup[]) => void; onBack: () => void }) {
  const [players, setPlayers] = useState<PlayerSetup[]>([
    { name: "Player 1", color: "red" },
    { name: "Bot 1", color: "purple", isBot: true },
  ]);
  const used = players.map((p) => p.color);
  const free = () => PLAYER_COLORS.find((c) => !used.includes(c)) as PlayerColor;
  const update = (i: number, patch: Partial<PlayerSetup>) =>
    setPlayers((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  return (
    <div className="pl-home">
      <button type="button" className="pl-link pl-back" onClick={onBack}>
        Back to home
      </button>
      <h1 className="pl-home-title">New local game</h1>
      <form
        className="pl-home-form"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(players.map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}` })));
        }}
      >
        <ul className="pl-setup-rows">
          {players.map((p, i) => (
            <li key={i}>
              <PlayerToken
                color={p.color}
                name={p.name}
                taken={used.filter((_, k) => k !== i)}
                onPick={(color) => update(i, { color })}
              />
              <input
                className="pl-input"
                value={p.name}
                maxLength={14}
                aria-label={`Player ${i + 1} name`}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <div className="pl-seg" role="group" aria-label={`Player ${i + 1} type`}>
                <button type="button" className={!p.isBot ? "on" : ""} onClick={() => update(i, { isBot: false })}>
                  Human
                </button>
                <button type="button" className={p.isBot ? "on" : ""} onClick={() => update(i, { isBot: true })}>
                  Bot
                </button>
              </div>
              <button
                type="button"
                className="pl-link pl-remove"
                disabled={players.length <= MIN_PLAYERS}
                aria-label={`Remove player ${i + 1}`}
                onClick={() => setPlayers((ps) => ps.filter((_, k) => k !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {players.length < MAX_PLAYERS && (
          <div className="pl-link-row">
            <button
              type="button"
              className="pl-link"
              onClick={() => setPlayers((ps) => [...ps, { name: `Player ${ps.length + 1}`, color: free() }])}
            >
              + Add player
            </button>
            <button
              type="button"
              className="pl-link"
              onClick={() =>
                setPlayers((ps) => [
                  ...ps,
                  { name: `Bot ${ps.filter((p) => p.isBot).length + 1}`, color: free(), isBot: true },
                ])
              }
            >
              + Add bot
            </button>
          </div>
        )}
        <p className="pl-muted pl-small">
          Tap a player&apos;s token to change their colour. First to {WIN_POINTS} points wins.
        </p>
        <button type="submit" className="pl-btn pl-btn-main pl-btn-big">
          Start game
        </button>
      </form>
    </div>
  );
}
