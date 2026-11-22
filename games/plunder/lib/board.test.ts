import { describe, expect, it } from "vitest";
import { COLS, ROWS, gridSize, parseTile, tileName, tilePosition } from "./board";

describe("plunder board", () => {
  it("names tiles letter + number", () => {
    expect(tileName({ col: 7, row: 2 })).toBe("C7");
    expect(parseTile("c7")).toEqual({ col: 7, row: 2 });
    expect(parseTile("L18")).toEqual({ col: 18, row: 11 });
    expect(parseTile("M1")).toBeNull();
    expect(parseTile("A19")).toBeNull();
  });

  it("lays out like the playtest board: 1 on the right, A at the bottom", () => {
    expect(tilePosition({ col: 1, row: 0 }, "landscape")).toEqual({ x: COLS - 1, y: ROWS - 1 });
    expect(tilePosition({ col: 18, row: 11 }, "landscape")).toEqual({ x: 0, y: 0 });
  });

  it("turned for phones: A–L left to right, 1–18 bottom to top", () => {
    expect(gridSize("portrait")).toEqual({ w: ROWS, h: COLS });
    expect(tilePosition({ col: 1, row: 0 }, "portrait")).toEqual({ x: 0, y: COLS - 1 });
    expect(tilePosition({ col: 18, row: 11 }, "portrait")).toEqual({ x: ROWS - 1, y: 0 });
  });
});
