import { describe, expect, it } from "vitest";
import { COLS, ROWS, parseTile, tileName, tilePosition } from "./board";

describe("plunder board", () => {
  it("names tiles letter + number", () => {
    expect(tileName({ col: 7, row: 2 })).toBe("C7");
    expect(parseTile("c7")).toEqual({ col: 7, row: 2 });
    expect(parseTile("L18")).toEqual({ col: 18, row: 11 });
    expect(parseTile("M1")).toBeNull();
    expect(parseTile("A19")).toBeNull();
  });

  it("puts 1 on the left and A at the top", () => {
    expect(tilePosition({ col: 1, row: 0 })).toEqual({ x: 0, y: 0 });
    expect(tilePosition({ col: 18, row: 11 })).toEqual({ x: COLS - 1, y: ROWS - 1 });
  });
});
