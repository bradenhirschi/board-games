import type { ReactNode } from "react";
import { edgeEnds, portSides, type Feature, type SeaMap, type Side } from "@/games/plunder/lib/tiles";

/**
 * Plunder's sea and island art, drawn as SVG from the square map, one square = S units.
 * Islands are clusters of overlapping circles (with a little seeded jitter so coastlines look
 * organic) run through a "goo" filter that melts them into one smooth blob, layered like the
 * printed tiles: white surf, shallow water, sand, then jungle. The same map always draws the same.
 *
 * Ports are beaches: their jungle shrinks and steps back from the open sides, so the anchor sits on
 * sand facing the water it's entered from. Land barriers are thin sandbars along their edge.
 */
export const S = 10;

/** Deterministic pseudo-random numbers from a string seed (mulberry32). */
function rng(seed: string) {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h ^ (h >>> 16)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Circle = { x: number; y: number; r: number };

const VEC: Record<Side, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

/** For a port square, the average direction of its open sides (zero if they cancel out). */
function openDir(map: SeaMap, x: number, y: number): { x: number; y: number } | null {
  if (!map.squares[y][x].feature?.port) return null;
  const sides = portSides(map, { r: y, c: x });
  const v = sides.reduce((a, s) => ({ x: a.x + VEC[s].x, y: a.y + VEC[s].y }), { x: 0, y: 0 });
  const len = Math.hypot(v.x, v.y);
  return len ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

/**
 * Where a square's land sits: the middle of a full-land square, or pushed toward the land sides of
 * a half-land square (null for squares that aren't this island's land).
 */
function landPoint(map: SeaMap, island: string, x: number, y: number): { x: number; y: number } | null {
  const sq = map.squares[y]?.[x];
  if (!sq || sq.island !== island) return null;
  const v = (sq.half ?? []).reduce((a, s) => ({ x: a.x + VEC[s].x, y: a.y + VEC[s].y }), { x: 0, y: 0 });
  const len = Math.hypot(v.x, v.y) || 1;
  const d = sq.half ? 0.27 * S : 0;
  return { x: (x + 0.5) * S + (v.x / len) * d, y: (y + 0.5) * S + (v.y / len) * d };
}

/** The circles for one layer of one island. `size` scales the whole layer (sand 1, jungle smaller). */
function islandCircles(map: SeaMap, island: string, size: number, layer: string): Circle[] {
  const out: Circle[] = [];
  const jungle = layer === "jungle";
  const at = (x: number, y: number) => map.squares[y]?.[x]?.island;
  const full = (x: number, y: number) => at(x, y) === island && map.squares[y][x].half === null;
  map.squares.forEach((row, y) =>
    row.forEach((sq, x) => {
      if (sq.island !== island) return;
      const p = landPoint(map, island, x, y)!;
      let cx = p.x;
      let cy = p.y;
      // Squares that touch a different island keep further back, so the two stay apart.
      const crowded = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].some((i) => i && i !== island);
      let k = size * (crowded ? 0.8 : 1);
      const rand = rng(`${island}:${x},${y}:${layer}`);
      if (sq.half) {
        // Half land: a smaller mass on the land side, plus land running along each land edge.
        k *= 0.62;
        for (const side of sq.half) {
          const v = VEC[side];
          for (const t of [-0.44, -0.15, 0.15, 0.44]) {
            out.push({
              x: (x + 0.5 + v.x * 0.3 + v.y * t) * S,
              y: (y + 0.5 + v.y * 0.3 + v.x * t) * S,
              r: (0.2 + rand() * 0.05) * S * size,
            });
          }
        }
      } else {
        const open = openDir(map, x, y);
        if (jungle && open) {
          // A port is beach: a smaller patch of jungle, pushed away from the water it opens onto.
          cx -= open.x * 0.2 * S;
          cy -= open.y * 0.2 * S;
          k *= 0.78;
        }
      }
      out.push({ x: cx, y: cy, r: (0.34 + rand() * 0.08) * S * k });
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2;
        const d = (0.1 + rand() * 0.24) * S * k;
        out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: (0.14 + rand() * 0.16) * S * k });
      }
      // Bridge to the same island's neighbours so it reads as one landmass: between two full squares
      // through the middle of their shared edge; to or from half land, along the land between them.
      for (const [x2, y2] of [
        [x + 1, y],
        [x, y + 1],
      ]) {
        const q = landPoint(map, island, x2, y2);
        if (!q) continue;
        const both = !sq.half && full(x2, y2);
        const steps = both ? [0.5] : [0.25, 0.5, 0.75];
        for (const t of steps) {
          out.push({
            x: p.x + (q.x - p.x) * t + (rand() - 0.5) * S * 0.1,
            y: p.y + (q.y - p.y) * t + (rand() - 0.5) * S * 0.1,
            r: (both ? 0.32 + rand() * 0.08 : 0.22 + rand() * 0.05) * S * size,
          });
        }
      }
      // Fill the middle of any 2×2 block of full land (the four squares' circles leave a hole there).
      if (!sq.half && full(x + 1, y) && full(x, y + 1) && full(x + 1, y + 1)) {
        out.push({ x: (x + 1) * S, y: (y + 1) * S, r: 0.5 * S * size });
      }
    }),
  );
  return out;
}

/** The island an edge belongs to, if it runs along one of that island's squares (else a free barrier). */
function edgeIsland(map: SeaMap, key: string): string | null {
  const [r, c, side] = key.split(",");
  const p = { r: Number(r), c: Number(c) };
  const other = side === "N" ? { r: p.r - 1, c: p.c } : { r: p.r, c: p.c - 1 };
  return map.squares[p.r]?.[p.c]?.island ?? map.squares[other.r]?.[other.c]?.island ?? null;
}

/**
 * The circles for land along an edge: a thin sandbar for a free-standing barrier, or for an island's
 * edge a strip that runs the full length so it joins the rest of the island.
 */
function barrierCircles(key: string, size: number, layer: string, joined = false): Circle[] {
  const [a, b] = edgeEnds(key);
  const rand = rng(`${key}:${layer}`);
  const out: Circle[] = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = joined ? i / n : 0.08 + (0.84 * i) / n;
    const wobble = (rand() - 0.5) * 0.06 * S;
    const x = (a.c + (b.c - a.c) * t) * S + (a.c === b.c ? wobble : 0);
    const y = (a.r + (b.r - a.r) * t) * S + (a.r === b.r ? wobble : 0);
    out.push({ x, y, r: (0.17 + rand() * 0.05) * S * size });
  }
  return out;
}

function Circles({ circles }: { circles: Circle[] }) {
  return circles.map((c, i) => <circle key={i} cx={c.x.toFixed(2)} cy={c.y.toFixed(2)} r={c.r.toFixed(2)} />);
}

/** Filters and textures shared by every piece of art. Render once per SVG. */
export function ArtDefs() {
  return (
    <>
      <radialGradient id="pl-sea" cx="50%" cy="45%" r="75%">
        <stop offset="0%" stopColor="#2f5c7e" />
        <stop offset="100%" stopColor="#173149" />
      </radialGradient>
      {/* Wave texture over the sea. */}
      <filter id="pl-waves" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05 0.16" numOctaves={3} seed={7} />
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -0.75" />
      </filter>
      {/* Blur, then cut the alpha off sharply: overlapping circles melt into one smooth shape. */}
      <filter id="pl-surf" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation={2.2} />
      </filter>
      <filter id="pl-sand" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation={1.3} result="b" />
        <feColorMatrix
          in="b"
          type="matrix"
          values="0 0 0 0 0.92  0 0 0 0 0.84  0 0 0 0 0.66  0 0 0 18 -7"
          result="shape"
        />
        <feTurbulence type="fractalNoise" baseFrequency={0.45} numOctaves={2} seed={3} result="n" />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0.72  0 0 0 0 0.6  0 0 0 0 0.42  0 0 0 1.4 -0.55"
          result="speck"
        />
        <feComposite in="speck" in2="shape" operator="in" result="specks" />
        <feMerge>
          <feMergeNode in="shape" />
          <feMergeNode in="specks" />
        </feMerge>
      </filter>
      <filter id="pl-jungle" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation={1.1} result="b" />
        <feColorMatrix
          in="b"
          type="matrix"
          values="0 0 0 0 0.36  0 0 0 0 0.36  0 0 0 0 0.14  0 0 0 18 -7"
          result="shape"
        />
        <feTurbulence type="fractalNoise" baseFrequency={0.6} numOctaves={3} seed={11} result="n" />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0.2  0 0 0 0 0.17  0 0 0 0 0.05  0 0 0 2.6 -0.9"
          result="dark"
        />
        <feComposite in="dark" in2="shape" operator="in" result="shade" />
        <feMerge>
          <feMergeNode in="shape" />
          <feMergeNode in="shade" />
        </feMerge>
      </filter>
    </>
  );
}

/** Open sea `w` × `h` squares, with faint grid lines. */
export function SeaArt({ w, h, tileSize }: { w: number; h: number; tileSize?: number }) {
  const lines: ReactNode[] = [];
  for (let x = 1; x < w; x++) {
    const seam = tileSize && x % tileSize === 0;
    lines.push(<line key={`x${x}`} className={seam ? "pl-seam" : "pl-grid"} x1={x * S} y1={0} x2={x * S} y2={h * S} />);
  }
  for (let y = 1; y < h; y++) {
    const seam = tileSize && y % tileSize === 0;
    lines.push(<line key={`y${y}`} className={seam ? "pl-seam" : "pl-grid"} x1={0} y1={y * S} x2={w * S} y2={y * S} />);
  }
  return (
    <g>
      <rect width={w * S} height={h * S} fill="url(#pl-sea)" />
      <rect width={w * S} height={h * S} filter="url(#pl-waves)" opacity={0.18} />
      {lines}
    </g>
  );
}

/** Every island and land barrier on the map: surf, shallows, sand and jungle. */
export function IslandsArt({ map }: { map: SeaMap }) {
  const islands = [...new Set(map.squares.flat().flatMap((s) => (s.island ? [s.island] : [])))];
  const walls = [...map.walls];
  const owner = new Map(walls.map((w) => [w, edgeIsland(map, w)]));
  const free = walls.filter((w) => !owner.get(w));
  // An island's land: its squares plus the edges that belong to it, drawn as one shape.
  const land = (id: string, size: number, name: string, edgeSize: number) => [
    ...islandCircles(map, id, size, name),
    ...walls.filter((w) => owner.get(w) === id).flatMap((w) => barrierCircles(w, edgeSize, name, true)),
  ];
  const layer = (size: number, name: string, barrierSize: number) => [
    ...islands.map((id) => <Circles key={id} circles={land(id, size, name, barrierSize)} />),
    ...free.map((w) => <Circles key={w} circles={barrierCircles(w, barrierSize, name)} />),
  ];
  return (
    <g>
      <g filter="url(#pl-surf)" fill="#f4fbff" opacity={0.75}>
        {layer(1.45, "surf", 1.7)}
      </g>
      <g filter="url(#pl-surf)" fill="#8fd3df" opacity={0.55}>
        {layer(1.2, "shallow", 1.4)}
      </g>
      {/* All sand first, then all jungle, so an edge's sand never covers an island's jungle. */}
      {islands.map((id) => (
        <g key={id} filter="url(#pl-sand)">
          <Circles circles={land(id, 1, "sand", 1.25)} />
        </g>
      ))}
      {free.map((w) => (
        <g key={w} filter="url(#pl-sand)">
          <Circles circles={barrierCircles(w, 1, "sand")} />
        </g>
      ))}
      {islands.map((id) => (
        <g key={id} filter="url(#pl-jungle)">
          <Circles circles={land(id, 0.72, "jungle", 0.85)} />
        </g>
      ))}
      {free.map((w) => (
        <g key={w} filter="url(#pl-jungle)">
          <Circles circles={barrierCircles(w, 0.45, "jungle")} />
        </g>
      ))}
    </g>
  );
}

function Anchor() {
  const d = "M0 -2.2 L0 2.6 M-1.6 -1 L1.6 -1 M-2.5 1 Q-2.1 2.9 0 2.9 Q2.1 2.9 2.5 1";
  return (
    <g className="pl-icon-anchor">
      <circle className="pl-icon-under" cx={0} cy={-2.9} r={0.8} />
      <path className="pl-icon-under" d={d} />
      <circle cx={0} cy={-2.9} r={0.8} />
      <path d={d} />
    </g>
  );
}

function Skull() {
  return (
    <g className="pl-icon-skull">
      <path className="pl-icon-under" d="M-2 -1.6 L2 2.2 M2 -1.6 L-2 2.2" />
      <path className="pl-bones" d="M-2 -1.6 L2 2.2 M2 -1.6 L-2 2.2" />
      <path
        className="pl-skull-head"
        d="M-1.7 -0.6 A1.7 1.7 0 1 1 1.7 -0.6 L1.7 0.3 Q1.7 0.9 1.1 1 L1.1 1.6 L-1.1 1.6 L-1.1 1 Q-1.7 0.9 -1.7 0.3 Z"
      />
      <circle className="pl-skull-eye" cx={-0.65} cy={-0.5} r={0.45} />
      <circle className="pl-skull-eye" cx={0.65} cy={-0.5} r={0.45} />
    </g>
  );
}

function Barrel() {
  return (
    <g className="pl-icon-barrel">
      <path d="M-1.7 -2.3 Q-2.4 0 -1.7 2.3 L1.7 2.3 Q2.4 0 1.7 -2.3 Z" />
      <path className="pl-barrel-hoop" d="M-2 -1.1 L2 -1.1 M-2 1.1 L2 1.1" />
    </g>
  );
}

/**
 * One square's symbols. In a port the anchor sits toward the open water (upright for a one-way port,
 * tilted for a port with several ways in) and the skulls or barrel sit back on the island.
 */
function FeatureIcons({ f, open }: { f: Feature; open: { x: number; y: number } | null }) {
  const parts: ReactNode[] = [];
  const skulls = f.skulls ?? 0;
  for (let i = 0; i < skulls; i++) parts.push(<Skull key={`s${i}`} />);
  if (f.barrel) parts.push(<Barrel key="b" />);
  const n = parts.length;
  const scale = n <= 1 ? 0.62 : n === 2 ? 0.5 : 0.42;
  const gap = 5.2 * scale;
  // Open all round (no single direction): put the anchor beside the other symbols instead.
  const allRound = !!f.port && !!open && open.x === 0 && open.y === 0 && n > 0;
  const back = allRound
    ? { x: -0.2 * S, y: 0 }
    : open && f.port
      ? { x: -open.x * 0.2 * S, y: -open.y * 0.2 * S }
      : { x: 0, y: 0 };
  const icons = parts.map((p, i) => (
    <g
      key={i}
      transform={`translate(${(back.x + (i - (n - 1) / 2) * gap).toFixed(2)} ${back.y.toFixed(2)}) scale(${scale})`}
    >
      {p}
    </g>
  ));
  if (f.port) {
    const to = allRound
      ? { x: 0.2 * S, y: 0 }
      : open && n
        ? { x: open.x * 0.2 * S, y: open.y * 0.2 * S }
        : { x: 0, y: 0 };
    icons.push(
      <g
        key="anchor"
        transform={`translate(${to.x.toFixed(2)} ${to.y.toFixed(2)}) rotate(${f.port === "diagonal" ? -40 : 0}) scale(0.62)`}
      >
        <Anchor />
      </g>,
    );
  }
  return icons;
}

export function FeaturesArt({ map }: { map: SeaMap }) {
  return (
    <g>
      {map.squares.flatMap((row, y) =>
        row.flatMap((sq, x) =>
          sq.feature
            ? [
                <g key={`${x},${y}`} transform={`translate(${(x + 0.5) * S} ${(y + 0.5) * S})`}>
                  <FeatureIcons f={sq.feature} open={openDir(map, x, y)} />
                </g>,
              ]
            : [],
        ),
      )}
    </g>
  );
}

/**
 * A rules diagram over the art: island squares ships can't enter (red), ports (green outline) with an
 * arrow on each side they can be entered from, and land barriers (thick red edge).
 */
export function SailingOverlay({ map }: { map: SeaMap }) {
  const parts: ReactNode[] = [];
  map.squares.forEach((row, y) =>
    row.forEach((sq, x) => {
      if (sq.half) {
        for (const side of sq.half) {
          const v = VEC[side];
          // The land half tinted, and its blocked edge drawn like a barrier.
          const hx = v.x > 0 ? 0.5 : 0;
          const hy = v.y > 0 ? 0.5 : 0;
          parts.push(
            <rect
              key={`h${x},${y},${side}`}
              className="pl-sail-blocked"
              x={(x + hx) * S}
              y={(y + hy) * S}
              width={v.x ? S / 2 : S}
              height={v.y ? S / 2 : S}
            />,
          );
          const a = { x: x + (v.x > 0 ? 1 : 0), y: y + (v.y > 0 ? 1 : 0) };
          const b = { x: a.x + (v.x ? 0 : 1), y: a.y + (v.y ? 0 : 1) };
          parts.push(
            <line
              key={`hw${x},${y},${side}`}
              className="pl-sail-wall"
              x1={a.x * S}
              y1={a.y * S}
              x2={b.x * S}
              y2={b.y * S}
            />,
          );
        }
      } else if (sq.island && !sq.feature?.port) {
        parts.push(<rect key={`b${x},${y}`} className="pl-sail-blocked" x={x * S} y={y * S} width={S} height={S} />);
      }
      if (sq.feature?.port) {
        parts.push(
          <rect
            key={`p${x},${y}`}
            className="pl-sail-port"
            x={x * S + 0.6}
            y={y * S + 0.6}
            width={S - 1.2}
            height={S - 1.2}
          />,
        );
        for (const side of portSides(map, { r: y, c: x })) {
          const v = VEC[side];
          // A small arrowhead just inside the open edge, pointing into the port.
          const ex = (x + 0.5 + v.x * 0.38) * S;
          const ey = (y + 0.5 + v.y * 0.38) * S;
          const tip = { x: ex - v.x * 1.6, y: ey - v.y * 1.6 };
          const l = { x: ex - v.y * 1.2, y: ey + v.x * 1.2 };
          const r = { x: ex + v.y * 1.2, y: ey - v.x * 1.2 };
          parts.push(
            <path
              key={`a${x},${y},${side}`}
              className="pl-sail-entry"
              d={`M${l.x} ${l.y} L${tip.x} ${tip.y} L${r.x} ${r.y} Z`}
            />,
          );
        }
      }
    }),
  );
  for (const key of map.walls) {
    const [a, b] = edgeEnds(key);
    parts.push(<line key={`w${key}`} className="pl-sail-wall" x1={a.c * S} y1={a.r * S} x2={b.c * S} y2={b.r * S} />);
  }
  return <g>{parts}</g>;
}
