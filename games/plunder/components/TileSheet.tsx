"use client";

import { useState } from "react";
import { TILES, TILE_ROWS, TILE_SIZE, tileMap } from "@/games/plunder/lib/tiles";
import { ArtDefs, IslandsArt, S, SailingOverlay, SeaArt } from "./Art";

/** Labels sit in a half-square margin around the tile. */
const M = S * 0.7;
const SIZE = TILE_SIZE * S;

function TileCard({ id, sailing }: { id: number; sailing: boolean }) {
  const def = TILES.find((t) => t.id === id)!;
  const map = tileMap(def);
  return (
    <figure className="pl-tile-card">
      <figcaption>Tile {id}</figcaption>
      <svg viewBox={`${-M} ${-M} ${SIZE + 2 * M} ${SIZE + 2 * M}`} role="img" aria-label={`Tile ${id}`}>
        <defs>
          <ArtDefs />
        </defs>
        <rect className="pl-sheet-frame" x={-0.4} y={-0.4} width={SIZE + 0.8} height={SIZE + 0.8} />
        <SeaArt w={TILE_SIZE} h={TILE_SIZE} />
        <IslandsArt placed={[{ tile: id, rotation: 0, x: 0, y: 0 }]} />
        {sailing && <SailingOverlay map={map} />}
        {Array.from({ length: TILE_SIZE }, (_, i) => (
          <g key={i} className="pl-sheet-label">
            <text x={(i + 0.5) * S} y={-M / 2} dy="0.35em">
              {i + 1}
            </text>
            <text x={-M / 2} y={(i + 0.5) * S} dy="0.35em">
              {TILE_ROWS[i]}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** Every tile on its own with tile-local coordinates, for checking layouts against the playtest tiles. */
export default function TileSheet() {
  const [sailing, setSailing] = useState(false);
  return (
    <main className="pl-sheet">
      <header className="pl-header">
        <h1 className="pl-title">Tiles</h1>
        <a className="pl-link" href="/plunder">
          Board
        </a>
      </header>
      <p className="pl-sheet-note">
        Squares are named by row (A–F) and column (1–6) within each tile, like &ldquo;Tile 3, C5&rdquo;.
      </p>
      <label className="pl-sheet-toggle">
        <input type="checkbox" checked={sailing} onChange={(e) => setSailing(e.target.checked)} /> Show sailing: blocked
        squares (red), ports and the sides they open to (green), barriers (red edges)
      </label>
      <div className="pl-sheet-grid">
        {TILES.map((t) => (
          <TileCard key={t.id} id={t.id} sailing={sailing} />
        ))}
      </div>
    </main>
  );
}
