"use client";

import { MAX_LIVES, RESOURCES, WIN_POINTS, points, type GameState, type Ship } from "@/games/plunder/lib/engine";
import { COLOR_HEX, Flag, ShipPiece, SkullIcon } from "./Pieces";

/**
 * How everyone is doing: on phones a row of chips over the board (the other players; tap for the
 * standings), on wide screens cards in the sidebar. Hand sizes are public (as at a real table), but
 * never which resources.
 */

type Row = {
  i: number;
  name: string;
  color: string;
  bot: boolean;
  ships: Ship[];
  isles: number;
  cards: number;
  plunderCards: number;
  pts: number;
};

function crew(s: GameState): Row[] {
  return s.players.map((p, i) => ({
    i,
    name: p.name,
    color: COLOR_HEX[p.color],
    bot: !!p.isBot,
    ships: s.ships.filter((sh) => sh.owner === i),
    isles: Object.values(s.owners).filter((o) => o === i).length,
    cards: RESOURCES.reduce((n, r) => n + p.hand[r], 0),
    plunderCards: p.plunderCards,
    pts: points(s, i),
  }));
}

/** Who to highlight: whoever's turn it is (the winner once it's over). */
function spotlight(s: GameState): number {
  const p = s.phase;
  return p.t === "gameOver" ? p.winner : p.t === "pickIsland" ? p.order[p.index] : s.turn;
}

const ICON_SHIP: Ship = {
  id: -1,
  owner: -1,
  pos: { r: 0, c: 0 },
  lives: MAX_LIVES,
  masts: 0,
  cannons: 0,
  mastMoves: 0,
  docked: false,
};

/** A little ship from the board, with sails in the player's colour. */
export function ShipIcon({ color, size = 19 }: { color: GameState["players"][number]["color"]; size?: number }) {
  return (
    <svg className="pl-crew-icon" viewBox="1.2 -0.4 7.6 10" width={size} height={size} aria-hidden="true">
      <ShipPiece ship={ICON_SHIP} color={color} />
    </svg>
  );
}

/** An island flag, as planted on the board. */
export function FlagIcon({ color, size = 15 }: { color: GameState["players"][number]["color"]; size?: number }) {
  return (
    <svg className="pl-crew-icon" viewBox="2.6 -0.2 6.2 8" width={size} height={size} aria-hidden="true">
      <Flag at={{ r: 0, c: 0 }} color={color} />
    </svg>
  );
}

/** Cards in hand (face down: just how many). */
function CardsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="pl-crew-icon" viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="5" width="10" height="13" rx="1.6" fill="#efe2c2" stroke="#3b2410" strokeWidth="1.3" />
      <rect x="7.5" y="2" width="10" height="13" rx="1.6" fill="#d9c79c" stroke="#3b2410" strokeWidth="1.3" />
    </svg>
  );
}

/** Phones: ☰ and a chip for each other player, over the board. Tap a chip for the standings. */
export function CrewRow({
  game,
  hide,
  onMenu,
  onOpen,
}: {
  game: GameState;
  /** The player shown in the strip below (pass-and-play) or this device's seat (online): left out. */
  hide: number | null;
  onMenu: () => void;
  onOpen: () => void;
}) {
  const rows = crew(game).filter((r) => r.i !== hide);
  const on = spotlight(game);
  const compact = rows.length > 3;
  return (
    <nav className={`pl-crew${compact ? " pl-crew-compact" : ""}`} aria-label="Players">
      <button className="pl-crew-menu" onClick={onMenu} aria-label="Menu">
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {rows.map((r) => (
        <button
          key={r.i}
          className={`pl-crew-chip${r.i === on ? " on" : ""}`}
          onClick={onOpen}
          aria-label={`${r.name}: ${r.pts} points. Show the standings.`}
        >
          <span className="pl-crew-top">
            <span className="pl-dot" style={{ background: r.color }} />
            {!compact && <span className="pl-crew-name">{r.name}</span>}
            <b className="pl-crew-pts">{r.pts}</b>
          </span>
          {compact && <span className="pl-crew-name">{r.name}</span>}
          {!compact && (
            <span className="pl-crew-stats">
              <span>
                <ShipIcon color={game.players[r.i].color} />
                {r.ships.length}
              </span>
              <span>
                <FlagIcon color={game.players[r.i].color} />
                {r.isles}
              </span>
              <span>
                <CardsIcon />
                {r.cards}
              </span>
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** Everyone's standing, most points first: the sheet behind the chips. */
export function Standings({ game, you, onClose }: { game: GameState; you: number | null; onClose: () => void }) {
  const rows = crew(game).sort((a, b) => b.pts - a.pts || a.i - b.i);
  const on = spotlight(game);
  return (
    <div className="pl-sheet-backdrop" onClick={onClose}>
      <div className="pl-standings" role="dialog" aria-label="Standings" onClick={(e) => e.stopPropagation()}>
        <div className="pl-standings-head">
          <h2>Standings</h2>
          <span>First to {WIN_POINTS} wins</span>
          <button className="pl-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Crew</th>
              <th>Ships</th>
              <th>Islands</th>
              <th>
                <SkullIcon size={13} /> PP cards
              </th>
              <th>Hand</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i} className={r.i === on ? "on" : ""}>
                <td>
                  <span className="pl-standings-name">
                    <span className="pl-dot" style={{ background: r.color }} />
                    <span>{r.name}</span>
                    {r.i === you ? <small>YOU</small> : r.bot ? <small>BOT</small> : null}
                  </span>
                </td>
                <td>
                  {r.ships.length}
                  {r.ships.length > 0 && (
                    <span className="pl-standings-lives" aria-label="Lives on each ship">
                      {r.ships.map((sh) => "♥".repeat(sh.lives)).join(" ")}
                    </span>
                  )}
                </td>
                <td>{r.isles}</td>
                <td>{r.plunderCards}</td>
                <td>{r.cards}</td>
                <td className="pl-standings-pts">{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pl-standings-note">
          A point for each ship, each island you own and each Plunder Point card. Hands show how many cards, not which.
        </p>
      </div>
    </div>
  );
}

/** Wide screens: a card per player in the sidebar, with a bar towards ten points. */
export function CrewSide({ game, you }: { game: GameState; you: number | null }) {
  const on = spotlight(game);
  return (
    <section className="pl-crew-side" aria-label="Players">
      <h2>Race to {WIN_POINTS}</h2>
      {crew(game).map((r) => (
        <div key={r.i} className={`pl-crew-card${r.i === on ? " on" : ""}`}>
          <span className="pl-dot" style={{ background: r.color }} />
          <span className="pl-crew-card-name">
            {r.name}
            {r.i === you ? <small>YOU</small> : r.bot ? <small>BOT</small> : null}
          </span>
          <span className="pl-crew-card-pts">
            {r.pts}
            <small>/{WIN_POINTS}</small>
          </span>
          <span className="pl-crew-stats">
            <span title="Ships">
              <ShipIcon color={game.players[r.i].color} />
              {r.ships.length}
            </span>
            <span title="Islands">
              <FlagIcon color={game.players[r.i].color} />
              {r.isles}
            </span>
            <span title="Plunder Point cards">
              <SkullIcon size={14} />
              {r.plunderCards}
            </span>
            <span title="Cards in hand">
              <CardsIcon />
              {r.cards}
            </span>
          </span>
          <span className="pl-crew-bar">
            <i style={{ width: `${Math.min(100, (r.pts / WIN_POINTS) * 100)}%`, background: r.color }} />
          </span>
        </div>
      ))}
    </section>
  );
}
