/**
 * Plunder's board geometry. Tiles are addressed by column number (1–18) and row letter (A–L),
 * written like "C7". Rotated from the playtest board: 1 is on the left, 18 on the right, A at the top.
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

/** Where a tile sits on screen, in tile units from the top-left of the play area. */
export function tilePosition({ col, row }: Tile): { x: number; y: number } {
  return { x: col - 1, y: row };
}
