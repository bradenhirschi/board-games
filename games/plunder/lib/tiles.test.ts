import { describe, expect, it } from "vitest";
import { COLS, ROWS, parseTile } from "./board";
import { DEFAULT_LAYOUT, TILES, TILE_SIZE, boardSquares, localName, tileSquares, type Rotation } from "./tiles";

describe("plunder tiles", () => {
  it("are six well-formed 6×6 maps", () => {
    expect(TILES.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const t of TILES) {
      expect(t.map).toHaveLength(TILE_SIZE);
      for (const line of t.map) expect(line).toMatch(/^[.a-z]{6}$/);
      for (const key of Object.keys(t.features)) expect(key).toMatch(/^[A-F][1-6]$/);
    }
  });

  it("keeps each island's squares connected", () => {
    for (const t of TILES) {
      const letters = new Set(t.map.join("").replace(/\./g, ""));
      for (const ch of letters) {
        const cells = t.map.flatMap((line, r) => [...line].flatMap((c, col) => (c === ch ? [[r, col]] : [])));
        const seen = new Set([cells[0].join()]);
        const queue = [cells[0]];
        while (queue.length) {
          const [r, c] = queue.pop()!;
          for (const [dr, dc] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const key = [r + dr, c + dc].join();
            if (!seen.has(key) && t.map[r + dr]?.[c + dc] === ch) {
              seen.add(key);
              queue.push([r + dr, c + dc]);
            }
          }
        }
        expect(seen.size, `tile ${t.id} island ${ch}`).toBe(cells.length);
      }
    }
  });

  it("turns a tile clockwise, with its symbols", () => {
    const t2 = TILES[1];
    const turned = tileSquares(t2, 90);
    // D2 (row 3, col 1) moves to row 1, col 2 (B3) after a quarter turn clockwise.
    expect(turned[1][2].feature).toEqual({ skulls: 3 });
    expect(turned[1][2].island).toBe("2c");
    // A half turn sends every square to the opposite one; three quarter turns undo one.
    const flat = tileSquares(t2);
    const half = tileSquares(t2, 180);
    const n = TILE_SIZE - 1;
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) expect(half[r][c]).toEqual(flat[n - r][n - c]);
    const three = tileSquares(t2, 270 as Rotation);
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) expect(three[n - c][r]).toEqual(flat[r][c]);
    expect(localName(3, 1)).toBe("D2");
  });

  it("lays tiles out three across and two down", () => {
    const board = boardSquares(DEFAULT_LAYOUT);
    expect(board).toHaveLength(ROWS);
    for (const row of board) expect(row).toHaveLength(COLS);
    // Tile 2's three skulls (its D2) land on board square D8.
    const d8 = parseTile("D8")!;
    expect(board[d8.row][d8.col - 1].feature).toEqual({ skulls: 3 });
    // Tile 6's chest (its D3) lands on board square J15.
    const j15 = parseTile("J15")!;
    expect(board[j15.row][j15.col - 1].feature?.chest).toBe(true);
  });
});
