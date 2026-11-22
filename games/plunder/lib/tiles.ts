/**
 * Plunder's board tiles. The board is six 6×6 tiles, three across and two down. A tile's layout is
 * fixed, but tiles can be placed in any slot and turned (see `Placement`).
 *
 * Each tile is a 6×6 map, rows A–F top to bottom and columns 1–6 left to right (tile-local
 * coordinates, like "C4"). In the map, "." is sea and a letter is land: squares with the same letter
 * are one island, so two islands can sit side by side and stay separate. Symbols (anchors, skulls,
 * chests) are listed per square and may be on land or sea.
 *
 * These are drafts traced from a photo of the playtest tiles; the owner is correcting them.
 */

export const TILE_SIZE = 6;
export const TILE_ROWS = "ABCDEF".split("");

export type Feature = { anchor?: true; skulls?: 1 | 2 | 3; chest?: true };

export type TileDef = {
  id: number;
  map: string[];
  features: Record<string, Feature>;
};

export const TILES: TileDef[] = [
  {
    id: 1,
    map: [
      "aa....", //
      "...bb.",
      "c.dd.e",
      "......",
      "ff.g..",
      "...g.h",
    ],
    features: { B4: { skulls: 1 }, B5: { anchor: true }, E1: { skulls: 1 }, E2: { anchor: true } },
  },
  {
    id: 2,
    map: [
      "..a...", //
      "....b.",
      ".cc...",
      ".cc..d",
      ".cc.ed",
      "....e.",
    ],
    features: { B3: { anchor: true }, B5: { anchor: true, skulls: 1 }, D2: { skulls: 3 }, D3: { anchor: true } },
  },
  {
    id: 3,
    map: [
      "......", //
      ".aa.b.",
      "..a.b.",
      "c.....",
      "..d.e.",
      "......",
    ],
    features: { B3: { anchor: true }, C2: { anchor: true }, E5: { skulls: 2 } },
  },
  {
    id: 4,
    map: [
      ".a....", //
      "...bb.",
      "c.bbb.",
      "......",
      ".d...e",
      "...f..",
    ],
    features: { B3: { anchor: true }, B5: { anchor: true }, C4: { skulls: 2 }, E2: { skulls: 1, anchor: true } },
  },
  {
    id: 5,
    map: [
      "....a.", //
      ".bb...",
      "..b.cc",
      "......",
      "dd.e..",
      ".f...g",
    ],
    features: { B2: { anchor: true }, B3: { skulls: 2 }, C3: { anchor: true }, E4: { skulls: 1, anchor: true } },
  },
  {
    id: 6,
    map: [
      "a...c.", //
      "a.b.c.",
      "......",
      ".dd..e",
      "......",
      "..f...",
    ],
    features: { A5: { skulls: 1 }, B5: { anchor: true }, D2: { anchor: true }, D3: { anchor: true, chest: true } },
  },
];

/** A tile in a board slot, turned clockwise by `rotation` degrees. */
export type Rotation = 0 | 90 | 180 | 270;
export type Placement = { tile: number; rotation: Rotation };

/** Slots run left to right, top to bottom: 1 2 3 / 4 5 6. */
export const DEFAULT_LAYOUT: Placement[] = [1, 2, 3, 4, 5, 6].map((tile) => ({ tile, rotation: 0 }));

/** One square of the board: which island it belongs to (null for sea) and its symbols. */
export type Square = { island: string | null; feature: Feature | null };

export function localName(row: number, col: number): string {
  return `${TILE_ROWS[row]}${col + 1}`;
}

/** A tile's squares, turned clockwise. Island ids are tile number + letter, like "2c". */
export function tileSquares(def: TileDef, rotation: Rotation = 0): Square[][] {
  let grid: Square[][] = def.map.map((line, r) =>
    [...line].map((ch, c) => ({
      island: ch === "." ? null : `${def.id}${ch}`,
      feature: def.features[localName(r, c)] ?? null,
    })),
  );
  for (let turn = 0; turn < rotation / 90; turn++) {
    // A quarter turn clockwise: the left column becomes the top row.
    grid = grid.map((_, r) => grid.map((row) => row[r]).reverse());
  }
  return grid;
}

/** The whole board: 12 rows (A–L) of 18 columns (1–18). */
export function boardSquares(layout: Placement[] = DEFAULT_LAYOUT): Square[][] {
  const rows: Square[][] = Array.from({ length: TILE_SIZE * 2 }, () => []);
  layout.forEach((p, slot) => {
    const def = TILES.find((t) => t.id === p.tile);
    if (!def) throw new Error(`No tile ${p.tile}`);
    const squares = tileSquares(def, p.rotation);
    const top = Math.floor(slot / 3) * TILE_SIZE;
    squares.forEach((row, r) => rows[top + r].push(...row));
  });
  return rows;
}
