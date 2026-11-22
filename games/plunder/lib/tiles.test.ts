import { describe, expect, it } from "vitest";
import { COLS, ROWS, parseTile } from "./board";
import {
  DEFAULT_LAYOUT,
  TILES,
  TILE_SIZE,
  boardMap,
  canSail,
  edgeKey,
  islands,
  isSailable,
  portSides,
  tileMap,
  type Pos,
  type Rotation,
} from "./tiles";

/** Board square by name, like "D8", as a 0-based position. */
function sq(name: string): Pos {
  const t = parseTile(name)!;
  return { r: t.row, c: t.col - 1 };
}

describe("plunder tiles", () => {
  it("are six well-formed 6×6 maps", () => {
    expect(TILES.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const t of TILES) {
      expect(t.map).toHaveLength(TILE_SIZE);
      for (const line of t.map) expect(line).toMatch(/^[.a-zA-Z]{6}$/);
      // Half-land squares say which sides their land is on.
      t.map.forEach((line, r) =>
        [...line].forEach((ch, c) => {
          const half = t.features[`${"ABCDEF"[r]}${c + 1}`]?.half;
          if (ch !== "." && ch === ch.toUpperCase())
            expect(half?.length, `tile ${t.id} ${"ABCDEF"[r]}${c + 1}`).toBeGreaterThan(0);
          else expect(half).toBeUndefined();
        }),
      );
      for (const key of Object.keys(t.features)) expect(key).toMatch(/^[A-F][1-6]$/);
      for (const b of t.barriers) expect(b.at).toMatch(/^[A-F][1-6]$/);
    }
  });

  it("keeps each island's squares connected", () => {
    for (const t of TILES) {
      for (const isl of islands(tileMap(t))) {
        const key = (p: Pos) => `${p.r},${p.c}`;
        const all = new Set(isl.squares.map(key));
        const seen = new Set([key(isl.squares[0])]);
        const queue = [isl.squares[0]];
        while (queue.length) {
          const p = queue.pop()!;
          for (const q of [
            { r: p.r + 1, c: p.c },
            { r: p.r - 1, c: p.c },
            { r: p.r, c: p.c + 1 },
            { r: p.r, c: p.c - 1 },
          ]) {
            if (all.has(key(q)) && !seen.has(key(q))) {
              seen.add(key(q));
              queue.push(q);
            }
          }
        }
        expect(seen.size, `tile ${t.id} island ${isl.id}`).toBe(isl.squares.length);
      }
    }
  });

  it("puts skulls and barrels on islands, ports beside them, and gives every port island a reason to visit", () => {
    for (const t of TILES) {
      const map = tileMap(t);
      map.squares.flat().forEach((s) => {
        if (s.feature?.skulls || s.feature?.barrel) expect(s.island, `tile ${t.id}: symbol at sea`).not.toBeNull();
      });
      for (const isl of islands(map)) {
        // Normal islands can't be interacted with, so they have no port; the others need one.
        if (isl.kind === "normal") expect(isl.ports, `tile ${t.id} island ${isl.id}`).toHaveLength(0);
        else expect(isl.ports.length, `tile ${t.id} island ${isl.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives upright anchors one way in and diagonal anchors several", () => {
    for (const t of TILES) {
      const map = tileMap(t);
      map.squares.forEach((row, r) =>
        row.forEach((sq, c) => {
          const port = sq.feature?.port;
          if (!port) return;
          const n = portSides(map, { r, c }).length;
          const where = `tile ${t.id} ${"ABCDEF"[r]}${c + 1}`;
          // Every anchor square shows both land and water: it's never full land, and never open sea.
          expect(sq.half, `${where}: port on full land or open sea`).not.toBeNull();
          if (port === "diagonal") expect(n, where).toBeGreaterThanOrEqual(2);
          else expect(n, where).toBe(1);
        }),
      );
    }
  });

  it("classifies islands from their symbols", () => {
    const kinds = islands(boardMap()).reduce<Record<string, number>>(
      (n, i) => ({ ...n, [i.kind]: (n[i.kind] ?? 0) + 1 }),
      {},
    );
    expect(kinds.merchant).toBe(2); // the two barrels: tiles 1 and 5
    expect(kinds.resource).toBe(9);
    const crescent = islands(boardMap()).find((i) => i.id === "6b")!;
    expect(crescent).toMatchObject({ kind: "resource", skulls: 3 });
  });

  it("turns a tile clockwise with its ports and barriers", () => {
    const t2 = TILES[1];
    const flat = tileMap(t2);
    const turned = tileMap(t2, 90);
    // C3's half land (north and east) turns to face east and south, and keeps its port.
    expect(flat.squares[2][2].half).toEqual(["N", "E"]);
    expect(turned.squares[2][3].half).toEqual(["E", "S"]);
    expect(turned.squares[2][3].feature?.port).toBe("diagonal");
    // The barrier on the south side of C5 (row 2, col 4) becomes the west side of E4 (row 4, col 3).
    expect(flat.walls.has(edgeKey({ r: 2, c: 4 }, "S"))).toBe(true);
    expect(turned.walls.has(edgeKey({ r: 4, c: 3 }, "W"))).toBe(true);
    // Four quarter turns come back to the start.
    const n = TILE_SIZE - 1;
    const half = tileMap(t2, 180);
    for (let r = 0; r <= n; r++)
      for (let c = 0; c <= n; c++) expect(half.squares[r][c].island).toBe(flat.squares[n - r][n - c].island);
    expect(tileMap(t2, 270 as Rotation).walls.size).toBe(flat.walls.size);
  });

  it("lays tiles out three across and two down", () => {
    const map = boardMap(DEFAULT_LAYOUT);
    expect(map.squares).toHaveLength(ROWS);
    for (const row of map.squares) expect(row).toHaveLength(COLS);
    // Tile 6's three skulls (its C5) land on board square I17; tile 5's barrel (its D2) on J8.
    expect(map.squares[sq("I17").r][sq("I17").c].feature?.skulls).toBe(3);
    expect(map.squares[sq("J8").r][sq("J8").c].feature?.barrel).toBe(true);
  });
});

describe("plunder sailing", () => {
  const map = boardMap();

  it("sails open water but not onto islands", () => {
    expect(canSail(map, sq("A1"), "E")).toBe(true);
    expect(isSailable(map.squares[sq("B4").r][sq("B4").c])).toBe(false); // tile 1's B4 islet
    expect(canSail(map, sq("B3"), "E")).toBe(false);
    expect(canSail(map, sq("A1"), "N")).toBe(false); // off the board
  });

  it("can't cross a land barrier", () => {
    // Tile 1: a barrier on the east side of D1.
    expect(canSail(map, sq("D1"), "E")).toBe(false);
    expect(canSail(map, sq("D2"), "W")).toBe(false);
    expect(canSail(map, sq("C1"), "E")).toBe(true);
  });

  it("enters an upright port only from its open side", () => {
    // Tile 2's B2 (board B8) opens north.
    expect(portSides(map, sq("B8"))).toEqual(["N"]);
    expect(canSail(map, sq("A8"), "S")).toBe(true);
    expect(canSail(map, sq("B7"), "E")).toBe(false);
    expect(canSail(map, sq("B8"), "N")).toBe(true);
  });

  it("sails the water side of half land but never across its land", () => {
    // Tile 2's big island: C2 (board C8) has land on its north side, C3 (board C9) north and east.
    expect(isSailable(map.squares[sq("C8").r][sq("C8").c])).toBe(true);
    expect(canSail(map, sq("D8"), "N")).toBe(true); // into C8 from the open water below
    expect(canSail(map, sq("C8"), "N")).toBe(false); // across its land into the bay
    expect(canSail(map, sq("C8"), "E")).toBe(true); // along the water side into C9
    expect(canSail(map, sq("C9"), "E")).toBe(false); // the island's edge on the C9|C10 line
    // The bay B8 opens only north: its own land west and south, B9's land east.
    expect(portSides(map, sq("B8"))).toEqual(["N"]);
    // C9's diagonal port opens south and west.
    expect(portSides(map, sq("C9"))).toEqual(["S", "W"]);
  });

  it("opens tile 4's and tile 6's ports where their islands leave water", () => {
    // Tile 4 (bottom-left): ports in the water above the big island, at its B3 and B5 (board H3, H5).
    expect(portSides(map, sq("H3"))).toEqual(["N", "W"]);
    expect(portSides(map, sq("H5"))).toEqual(["N", "E"]);
    // Tile 6 (bottom-right): the crescent's bay at its C4 (board I16) opens west only; the half-land
    // port at its D5 (board J17) opens south and east.
    expect(portSides(map, sq("I16"))).toEqual(["W"]);
    expect(portSides(map, sq("J17"))).toEqual(["E", "S"]);
  });

  it("follows the owner's corrections to tiles 2, 3 and 5", () => {
    const half = (name: string) => map.squares[sq(name).r][sq(name).c].half;
    // Tile 2 (top-middle): its E4 (board E10) and F6 (board F12).
    expect(half("E10")).toEqual(["W", "S"]);
    expect(half("F12")).toEqual(["W", "N"]);
    // Tile 3 (top-right): its B4 (board B16) and B5 (board B17).
    expect(half("B16")).toEqual(["N"]);
    expect(half("B17")).toEqual(["N", "E"]);
    // Tile 5 (bottom-middle): its C5 (board I11) opens east only; D3 (board J9) is open water;
    // F3 (board L9) is blocked to the west.
    expect(half("I11")).toEqual(["N", "W", "S"]);
    expect(portSides(map, sq("I11"))).toEqual(["E"]);
    expect(map.squares[sq("J9").r][sq("J9").c].island).toBeNull();
    expect(half("L9")).toEqual(["W"]);
    expect(canSail(map, sq("L8"), "E")).toBe(false);
    expect(canSail(map, sq("K9"), "S")).toBe(true);
  });

  it("enters a diagonal port from any side facing water", () => {
    // Tile 1's B2 islet is half land (jungle to the west) with its port on the water side.
    expect(portSides(map, sq("B2"))).toEqual(["N", "E", "S"]);
    // Tile 1's D5 port has island to the west and south, so it opens north and east.
    expect(portSides(map, sq("D5"))).toEqual(["N", "E"]);
    expect(canSail(map, sq("C5"), "S")).toBe(true);
    expect(canSail(map, sq("D4"), "E")).toBe(false);
  });
});
