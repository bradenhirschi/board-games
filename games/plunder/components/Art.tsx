import type { ReactNode } from "react";
import type { Feature, Square } from "@/games/plunder/lib/tiles";

/**
 * Plunder's sea and island art, drawn as SVG from the square map, one square = S units.
 * Islands are clusters of overlapping circles (with a little seeded jitter so coastlines look
 * organic) run through a "goo" filter that melts them into one smooth blob, layered like the
 * printed tiles: white surf, shallow water, sand, then jungle. The same map always draws the same.
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

/** The circles for one layer of one island. `size` scales the whole layer (sand 1, jungle smaller). */
function islandCircles(squares: Square[][], island: string, size: number, layer: string): Circle[] {
  const out: Circle[] = [];
  const at = (x: number, y: number) => squares[y]?.[x]?.island;
  squares.forEach((row, y) =>
    row.forEach((sq, x) => {
      if (sq.island !== island) return;
      const cx = (x + 0.5) * S;
      const cy = (y + 0.5) * S;
      // Squares that touch a different island keep further back, so the two stay apart.
      const crowded = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].some((i) => i && i !== island);
      const k = size * (crowded ? 0.8 : 1);
      const rand = rng(`${island}:${x},${y}:${layer}`);
      out.push({ x: cx, y: cy, r: (0.34 + rand() * 0.08) * S * k });
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2;
        const d = (0.1 + rand() * 0.24) * S * k;
        out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: (0.14 + rand() * 0.16) * S * k });
      }
      // Bridge to the same island's neighbours so it reads as one landmass, and fill the middle of
      // any 2×2 block of it (otherwise the four squares' circles leave a hole there).
      const right = at(x + 1, y) === island;
      const down = at(x, y + 1) === island;
      if (right) out.push({ x: cx + S / 2 + (rand() - 0.5) * S * 0.2, y: cy, r: (0.32 + rand() * 0.08) * S * size });
      if (down) out.push({ x: cx, y: cy + S / 2 + (rand() - 0.5) * S * 0.2, r: (0.32 + rand() * 0.08) * S * size });
      if (right && down && at(x + 1, y + 1) === island) {
        out.push({ x: cx + S / 2, y: cy + S / 2, r: 0.5 * S * size });
      }
    }),
  );
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

/** Every island on the map: surf, shallows, sand and jungle. */
export function IslandsArt({ squares }: { squares: Square[][] }) {
  const islands = [...new Set(squares.flat().flatMap((s) => (s.island ? [s.island] : [])))];
  return (
    <g>
      <g filter="url(#pl-surf)" fill="#f4fbff" opacity={0.75}>
        {islands.map((id) => (
          <Circles key={id} circles={islandCircles(squares, id, 1.45, "surf")} />
        ))}
      </g>
      <g filter="url(#pl-surf)" fill="#8fd3df" opacity={0.55}>
        {islands.map((id) => (
          <Circles key={id} circles={islandCircles(squares, id, 1.2, "shallow")} />
        ))}
      </g>
      {islands.map((id) => (
        <g key={id}>
          <g filter="url(#pl-sand)">
            <Circles circles={islandCircles(squares, id, 1, "sand")} />
          </g>
          <g filter="url(#pl-jungle)">
            <Circles circles={islandCircles(squares, id, 0.72, "jungle")} />
          </g>
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

function Chest() {
  return (
    <g className="pl-icon-chest">
      <rect x={-2.3} y={-1.6} width={4.6} height={3.2} rx={0.5} />
      <path d="M-2.3 -0.3 L2.3 -0.3" />
      <rect className="pl-chest-lock" x={-0.45} y={-0.7} width={0.9} height={0.9} rx={0.15} />
    </g>
  );
}

/** One square's symbols, arranged to share the square when there are several. */
function FeatureIcons({ f }: { f: Feature }) {
  const parts: ReactNode[] = [];
  const skulls = f.skulls ?? 0;
  for (let i = 0; i < skulls; i++) parts.push(<Skull key={`s${i}`} />);
  if (f.chest) parts.push(<Chest key="c" />);
  if (f.anchor) parts.push(<Anchor key="a" />);
  const n = parts.length;
  const scale = n === 1 ? 0.72 : n === 2 ? 0.58 : 0.46;
  const gap = 5.2 * scale;
  return parts.map((p, i) => (
    <g key={i} transform={`translate(${((i - (n - 1) / 2) * gap).toFixed(2)} 0) scale(${scale})`}>
      {p}
    </g>
  ));
}

export function FeaturesArt({ squares }: { squares: Square[][] }) {
  return (
    <g>
      {squares.flatMap((row, y) =>
        row.flatMap((sq, x) =>
          sq.feature
            ? [
                <g key={`${x},${y}`} transform={`translate(${(x + 0.5) * S} ${(y + 0.5) * S})`}>
                  <FeatureIcons f={sq.feature} />
                </g>,
              ]
            : [],
        ),
      )}
    </g>
  );
}
