/**
 * Plunder's board tiles and the sailing rules that come from them.
 *
 * The board is six 6×6 tiles, three across and two down. A tile's layout is fixed, but tiles can be
 * placed in any slot and turned (see `Placement`). Tiles are numbered by their slot on the owner's
 * sample board (1 2 3 / 4 5 6), traced from that image.
 *
 * Each tile is a 6×6 map, rows A–F top to bottom and columns 1–6 left to right (tile-local
 * coordinates, like "C4"). In the map "." is open sea and a letter is island: squares with the same
 * letter are one island, so neighbouring islands stay separate. An island is made of:
 *
 * - **Full land** (lowercase letter): ships can't enter.
 * - **Half land** (uppercase letter, with `half` listing the sides the land is on): the rest of the
 *   square is water, so ships can be there, but can't cross the land sides.
 * - **Edges** (`barriers`): thin land along the edge between two squares, which ships can't cross.
 *   Free-standing land barriers are edges too.
 *
 * **Ports** (anchor symbols) are where a ship docks to interact with an island. A port is usually a
 * water or half-land square beside the island, and it can be entered from whichever sides the land
 * around it leaves open: an upright anchor ends up with one way in, a diagonal anchor with several.
 * A few small islands are a single land square that is its own port; for those the open sides are
 * given (`port: "N" | "E" | "S" | "W"`) or, for `"diagonal"`, every side facing water.
 *
 * Island types (from the rules): skulls make a **resource** island, a barrel a **merchant** island,
 * otherwise it's a **normal** island. **Land barriers** take up no square; they sit on the edge
 * between two squares and block sailing across it (`barriers`, as square + side).
 */

export const TILE_SIZE = 6;
export const TILE_ROWS = "ABCDEF".split("");

export type Side = "N" | "E" | "S" | "W";
export const SIDES: Side[] = ["N", "E", "S", "W"];
export type Port = "diagonal" | Side;

export type Feature = { port?: Port; skulls?: 1 | 2 | 3; barrel?: true; half?: Side[] };
export type Barrier = { at: string; side: Side };

export type TileDef = {
  id: number;
  map: string[];
  features: Record<string, Feature>;
  barriers: Barrier[];
};

export const TILES: TileDef[] = [
  {
    id: 1,
    map: [
      "......", //
      ".a.b..",
      ".....c",
      "...dd.",
      "...dd.",
      "......",
    ],
    features: {
      B2: { skulls: 1, port: "diagonal" },
      D5: { port: "diagonal" },
      E4: { port: "diagonal" },
      E5: { barrel: true },
    },
    barriers: [
      { at: "D1", side: "E" },
      { at: "E1", side: "E" },
    ],
  },
  {
    id: 2,
    map: [
      "....a.", //
      "..b...",
      ".BB...",
      "......",
      "...c..",
      ".d...e",
    ],
    features: {
      // The big island: B3 is full land; C2 and C3 are half land; a strip of land runs down the
      // B1|B2 edge and another down the C3|C4 edge. B2 is the bay inside it.
      B2: { port: "N" },
      B3: { skulls: 2 },
      C2: { half: ["N"] },
      C3: { half: ["N", "E"], port: "diagonal" },
    },
    barriers: [
      { at: "B2", side: "W" },
      { at: "C3", side: "E" },
      { at: "C5", side: "S" },
      { at: "C6", side: "S" },
      { at: "D1", side: "S" },
      { at: "D2", side: "S" },
    ],
  },
  {
    id: 3,
    map: [
      "......", //
      "a..bb.",
      "..c...",
      "....d.",
      "e.f...",
      "....g.",
    ],
    features: {
      B4: { skulls: 2 },
      B5: { port: "diagonal" },
      E3: { skulls: 1, port: "N" },
    },
    barriers: [{ at: "B3", side: "N" }],
  },
  {
    id: 4,
    map: [
      ".a....", //
      "...b..",
      "c.bbb.",
      "......",
      ".d...e",
      "...f..",
    ],
    features: {
      // The big island is B4 and C3–C5; its two ports are in the water above it, at B3 and B5.
      B3: { port: "diagonal" },
      B5: { port: "diagonal" },
      C4: { skulls: 2 },
      E2: { skulls: 1, port: "S" },
    },
    barriers: [],
  },
  {
    id: 5,
    map: [
      "......", //
      "..a.b.",
      ".c..b.",
      ".cc...",
      "...d..",
      "..e..f",
    ],
    features: {
      B5: { skulls: 1 },
      C5: { port: "E" },
      C2: { port: "diagonal" },
      D2: { barrel: true, port: "S" },
    },
    barriers: [],
  },
  {
    id: 6,
    map: [
      "a.....", //
      "...bb.",
      "....b.",
      "c..bB.",
      ".d...e",
      "......",
    ],
    features: {
      // The crescent: B4, B5, C5 and D4 are full land, D5 is half land (north and west), and it wraps
      // around an open-water bay at C4 whose port can only be entered from the west.
      C4: { port: "W" },
      C5: { skulls: 3 },
      D5: { half: ["N", "W"], port: "diagonal" },
      E2: { skulls: 1, port: "N" },
    },
    barriers: [
      { at: "A2", side: "E" },
      { at: "B2", side: "E" },
    ],
  },
];

/** A tile in a board slot, turned clockwise by `rotation` degrees. */
export type Rotation = 0 | 90 | 180 | 270;
export type Placement = { tile: number; rotation: Rotation };

/** Slots run left to right, top to bottom: 1 2 3 / 4 5 6. This reproduces the sample board. */
export const DEFAULT_LAYOUT: Placement[] = [1, 2, 3, 4, 5, 6].map((tile) => ({ tile, rotation: 0 }));

/**
 * One square: which island it belongs to (null for open sea), the sides its land covers if it's
 * half land (null for full land or sea), and its symbols.
 */
export type Square = { island: string | null; half: Side[] | null; feature: Feature | null };

/** A map of squares plus the barrier edges between them (see `edgeKey`). */
export type SeaMap = { squares: Square[][]; walls: Set<string> };

export type Pos = { r: number; c: number };

const STEP: Record<Side, Pos> = { N: { r: -1, c: 0 }, E: { r: 0, c: 1 }, S: { r: 1, c: 0 }, W: { r: 0, c: -1 } };
const OPPOSITE: Record<Side, Side> = { N: "S", E: "W", S: "N", W: "E" };
const CLOCKWISE: Record<Side, Side> = { N: "E", E: "S", S: "W", W: "N" };

export function localName(r: number, c: number): string {
  return `${TILE_ROWS[r]}${c + 1}`;
}

function parseLocal(name: string): Pos {
  return { r: TILE_ROWS.indexOf(name[0]), c: Number(name.slice(1)) - 1 };
}

/** Each edge has one key, whichever square it's named from: the north or west side of a square. */
export function edgeKey({ r, c }: Pos, side: Side): string {
  if (side === "S") return `${r + 1},${c},N`;
  if (side === "E") return `${r},${c + 1},W`;
  return `${r},${c},${side}`;
}

/** The two ends of an edge, in squares from the top-left. */
export function edgeEnds(key: string): [Pos, Pos] {
  const [r, c, side] = key.split(",");
  const p = { r: Number(r), c: Number(c) };
  return side === "N" ? [p, { r: p.r, c: p.c + 1 }] : [p, { r: p.r + 1, c: p.c }];
}

/** A tile's squares and barriers, turned clockwise. Island ids are tile number + letter, like "2b". */
export function tileMap(def: TileDef, rotation: Rotation = 0): SeaMap {
  const n = TILE_SIZE - 1;
  const turns = rotation / 90;
  // A quarter turn clockwise moves (r, c) to (c, n - r) and turns every side clockwise.
  const turnPos = (p: Pos) => {
    let q = p;
    for (let i = 0; i < turns; i++) q = { r: q.c, c: n - q.r };
    return q;
  };
  const turnSide = (s: Side) => {
    let t = s;
    for (let i = 0; i < turns; i++) t = CLOCKWISE[t];
    return t;
  };
  const squares: Square[][] = Array.from({ length: TILE_SIZE }, () => []);
  def.map.forEach((line, r) =>
    [...line].forEach((ch, c) => {
      const f = def.features[localName(r, c)];
      let feature: Feature | null = null;
      if (f) {
        feature = { ...f };
        if (f.port && f.port !== "diagonal") feature.port = turnSide(f.port);
        if (f.half) feature.half = f.half.map(turnSide);
      }
      const p = turnPos({ r, c });
      const halfLand = ch !== "." && ch === ch.toUpperCase();
      squares[p.r][p.c] = {
        island: ch === "." ? null : `${def.id}${ch.toLowerCase()}`,
        half: halfLand ? (feature?.half ?? []) : null,
        feature,
      };
    }),
  );
  const walls = new Set(def.barriers.map((b) => edgeKey(turnPos(parseLocal(b.at)), turnSide(b.side))));
  return { squares, walls };
}

/** The whole board: 12 rows (A–L) of 18 columns (1–18). */
export function boardMap(layout: Placement[] = DEFAULT_LAYOUT): SeaMap {
  const squares: Square[][] = Array.from({ length: TILE_SIZE * 2 }, () => []);
  const walls = new Set<string>();
  layout.forEach((p, slot) => {
    const def = TILES.find((t) => t.id === p.tile);
    if (!def) throw new Error(`No tile ${p.tile}`);
    const tile = tileMap(def, p.rotation);
    const top = Math.floor(slot / 3) * TILE_SIZE;
    const left = (slot % 3) * TILE_SIZE;
    tile.squares.forEach((row, r) => squares[top + r].push(...row));
    for (const key of tile.walls) {
      const [r, c, side] = key.split(",");
      walls.add(`${Number(r) + top},${Number(c) + left},${side}`);
    }
  });
  return { squares, walls };
}

function at(map: SeaMap, p: Pos): Square | undefined {
  return map.squares[p.r]?.[p.c];
}

/** Ships can be on open sea, on the water side of half land, or in a port; never on full land. */
export function isSailable(sq: Square | undefined): boolean {
  return !!sq && (sq.island === null || sq.half !== null || !!sq.feature?.port);
}

function step(p: Pos, side: Side): Pos {
  return { r: p.r + STEP[side].r, c: p.c + STEP[side].c };
}

/**
 * Can a ship cross the edge on `side` of `p` (in either direction)? Not if either square is full
 * land, a barrier lies on the edge, or half land covers that side of either square.
 */
function edgeOpen(map: SeaMap, p: Pos, side: Side): boolean {
  const q = step(p, side);
  const a = at(map, p);
  const b = at(map, q);
  if (!isSailable(a) || !isSailable(b)) return false;
  if (map.walls.has(edgeKey(p, side))) return false;
  if (a!.half?.includes(side) || b!.half?.includes(OPPOSITE[side])) return false;
  return true;
}

/** The sides a port can be entered from (and left by). */
export function portSides(map: SeaMap, p: Pos): Side[] {
  const port = at(map, p)?.feature?.port;
  if (!port) return [];
  // A single land square that is its own port with one way in names that side.
  if (port !== "diagonal" && at(map, p)!.island && at(map, p)!.half === null) return [port];
  return SIDES.filter((s) => edgeOpen(map, p, s));
}

/**
 * Can a ship sail one square from `from` in direction `dir`? The edge between them must be open
 * (see `edgeOpen`), and a port on full land must be entered and left through its open sides.
 * (Ships move orthogonally; diagonal moves aren't decided yet.)
 */
export function canSail(map: SeaMap, from: Pos, dir: Side): boolean {
  const to = step(from, dir);
  if (!edgeOpen(map, from, dir)) return false;
  const landPort = (p: Pos) => !!at(map, p)?.feature?.port && at(map, p)!.island !== null && at(map, p)!.half === null;
  if (landPort(from) && !portSides(map, from).includes(dir)) return false;
  if (landPort(to) && !portSides(map, to).includes(OPPOSITE[dir])) return false;
  return true;
}

export type IslandKind = "resource" | "merchant" | "normal";
export type Island = { id: string; kind: IslandKind; skulls: number; squares: Pos[]; ports: Pos[] };

/**
 * Every island on a map with its type, skull count, squares and ports. A port on open water belongs
 * to the island beside it.
 */
export function islands(map: SeaMap): Island[] {
  const byId = new Map<string, Island>();
  const get = (id: string) => {
    let isl = byId.get(id);
    if (!isl) byId.set(id, (isl = { id, kind: "normal", skulls: 0, squares: [], ports: [] }));
    return isl;
  };
  map.squares.forEach((row, r) =>
    row.forEach((sq, c) => {
      if (sq.island) {
        const isl = get(sq.island);
        isl.squares.push({ r, c });
        if (sq.feature?.port) isl.ports.push({ r, c });
        isl.skulls += sq.feature?.skulls ?? 0;
        if (sq.feature?.barrel) isl.kind = "merchant";
      } else if (sq.feature?.port) {
        const beside = new Set(SIDES.flatMap((s) => at(map, step({ r, c }, s))?.island ?? []));
        for (const id of beside) get(id).ports.push({ r, c });
      }
    }),
  );
  for (const isl of byId.values()) if (isl.kind === "normal" && isl.skulls > 0) isl.kind = "resource";
  return [...byId.values()];
}
