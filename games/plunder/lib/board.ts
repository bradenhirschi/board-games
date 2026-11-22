/**
 * Plunder's board geometry. Tiles are addressed by column number (1–18) and row letter (A–L),
 * written like "C7". On the playtest board 1 is on the right, 18 on the left, A at the bottom.
 */

export const COLS = 18;
export const ROWS = 12;
export const ROW_LETTERS = "ABCDEFGHIJKL".split("");

export type Tile = { col: number; row: number }; // col 1–18, row 0 (A) – 11 (L)

export function tileName({ col, row }: Tile): string {
  return `${ROW_LETTERS[row]}${col}`;
}

export function parseTile(name: string): Tile | null {
  const m = /^([A-La-l])(\d{1,2})$/.exec(name.trim());
  if (!m) return null;
  const row = ROW_LETTERS.indexOf(m[1].toUpperCase());
  const col = Number(m[2]);
  return col >= 1 && col <= COLS ? { col, row } : null;
}

/**
 * Landscape is the playtest board as photographed. Portrait (phones) is the same board turned a
 * quarter turn clockwise: letters A–L run left to right, numbers 1–18 run bottom to top.
 */
export type Orientation = "landscape" | "portrait";

/** Grid size in tiles, not counting the one-tile border on each side. */
export function gridSize(o: Orientation): { w: number; h: number } {
  return o === "landscape" ? { w: COLS, h: ROWS } : { w: ROWS, h: COLS };
}

/** Where a tile sits on screen, in tile units from the top-left of the play area. */
export function tilePosition({ col, row }: Tile, o: Orientation): { x: number; y: number } {
  return o === "landscape" ? { x: COLS - col, y: ROWS - 1 - row } : { x: row, y: COLS - col };
}
