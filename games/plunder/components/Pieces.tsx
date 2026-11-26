import type { PlayerColor, Resource, Ship } from "@/games/plunder/lib/engine";
import type { Pos } from "@/games/plunder/lib/tiles";
import { S, SkullShapes, SwordsShapes } from "./Art";

/** Player colours, matching the physical game's ships and flags. */
export const COLOR_HEX: Record<PlayerColor, string> = {
  red: "#c0392b",
  purple: "#7d3c98",
  yellow: "#d4a514",
  green: "#3f7a2a",
  grey: "#7d8a8c",
  brown: "#7b4a26",
};

const centre = (p: Pos) => ({ x: (p.c + 0.5) * S, y: (p.r + 0.5) * S });

/** A sail across the deck at height `y`: a billowing curve with a yard (spar) and a shaded half. */
function Sail({ y, width, color }: { y: number; width: number; color: string }) {
  const w = width / 2;
  return (
    <g transform={`translate(0 ${y})`}>
      {/* A full sheet billowing forward from its yard. */}
      <path
        className="pl-ship-sail"
        fill={color}
        d={`M${-w} 0.1 C${-w * 0.75} -1.9 ${w * 0.75} -1.9 ${w} 0.1 C${w * 0.5} -0.45 ${-w * 0.5} -0.45 ${-w} 0.1 Z`}
      />
      <path
        className="pl-ship-sail-shade"
        d={`M0 -1.4 C${w * 0.45} -1.42 ${w * 0.8} -1.0 ${w} 0.1 C${w * 0.55} -0.38 ${w * 0.25} -0.34 0 -0.33 Z`}
      />
      <path
        className="pl-ship-sail-seam"
        d={`M${-w * 0.33} -1.05 Q${-w * 0.3} -0.6 ${-w * 0.28} -0.36 M${w * 0.33} -1.05 Q${w * 0.3} -0.6 ${w * 0.28} -0.36`}
      />
      <line className="pl-ship-yard" x1={-w - 0.25} y1={0} x2={w + 0.25} y2={0} />
      <circle className="pl-ship-masthead" r={0.42} />
    </g>
  );
}

/**
 * A ship from above, bow up: a wooden hull with deck planks, rails and a bowsprit, and sails in its
 * owner's colour (one main sail, plus one for each mast built). Cannons poke out of the sides; the
 * lives show as pegs on the stern deck.
 */
export function ShipPiece({
  ship,
  color,
  selected,
  at,
}: {
  ship: Ship;
  color: PlayerColor;
  selected?: boolean;
  /** Draw it here instead of at `ship.pos` (while it's sailing along its route). */
  at?: Pos;
}) {
  const { x, y } = centre(at ?? ship.pos);
  const hex = COLOR_HEX[color];
  const hull =
    "M0 -4.5 C2.2 -3.4 2.75 -1.4 2.7 1.6 C2.65 3.3 2.1 4.2 1.2 4.3 L-1.2 4.3 C-2.1 4.2 -2.65 3.3 -2.7 1.6 C-2.75 -1.4 -2.2 -3.4 0 -4.5 Z";
  const deck =
    "M0 -3.6 C1.65 -2.7 2.05 -1.2 2.0 1.5 C1.95 2.8 1.6 3.45 0.95 3.5 L-0.95 3.5 C-1.6 3.45 -1.95 2.8 -2.0 1.5 C-2.05 -1.2 -1.65 -2.7 0 -3.6 Z";
  // Sails, bow to stern: the main sail amidships, then the masts' sails fore and aft.
  const sails = [
    { y: 0.9, w: 7.2 },
    { y: -1.7, w: 5.6 },
    { y: 2.75, w: 5.8 },
  ].slice(0, 1 + ship.masts);
  // Cannons: a pair (one each side) per cannon.
  const guns = [-0.9, 1.1].slice(0, ship.cannons);
  return (
    // Positioned with a CSS transform (SVG user units), so each step along a route glides.
    <g
      style={{ transform: `translate(${x}px, ${y}px)` }}
      className={`pl-ship pl-ink${selected ? " pl-ship-selected" : ""}${ship.docked ? " pl-ship-docked" : ""}`}
    >
      {selected && <circle className="pl-ship-ring" r={4.9} />}
      <ellipse className="pl-ship-wake" cx={0.35} cy={0.5} rx={3.1} ry={4.6} />
      <line className="pl-ship-bowsprit" x1={0} y1={-4.2} x2={0} y2={-5.3} />
      {guns.map((gy) => (
        <g key={gy}>
          <rect className="pl-ship-cannon" x={-3.35} y={gy - 0.32} width={1.1} height={0.64} rx={0.25} />
          <rect className="pl-ship-cannon" x={2.25} y={gy - 0.32} width={1.1} height={0.64} rx={0.25} />
        </g>
      ))}
      <path className="pl-ship-hull" d={hull} />
      <path className="pl-ship-deck" d={deck} />
      <path className="pl-ship-planks" d="M-1 -2.9 V3.4 M0 -3.5 V3.5 M1 -2.9 V3.4" />
      {/* The owner's colour runs along the rail too, so it shows even under full sail. */}
      <path className="pl-ship-rail" stroke={hex} d={hull} />
      {Array.from({ length: 3 }, (_, i) => (
        <circle
          key={`l${i}`}
          className={i < ship.lives ? "pl-ship-life" : "pl-ship-life lost"}
          cx={(i - 1) * 0.95}
          cy={3.75}
          r={0.42}
        />
      ))}
      {sails.map((sl) => (
        <Sail key={sl.y} y={sl.y} width={sl.w} color={hex} />
      ))}
    </g>
  );
}

/**
 * The X-marks-the-spot cross: OpenMoji's "heavy multiplication x" (openmoji.org, CC BY-SA 4.0),
 * from games/plunder/art/x-mark.svg, in red. Its 72-unit square, with the cross from 18 to 54.
 */
const X_POINTS = "30,36 18,24 24,18 36,30 48,18 54,24 42,36 54,48 48,54 36,42 24,54 18,48";

/** An X-marks-the-spot token on the board. */
/**
 * An X-marks-the-spot token. `count`: how many X's share the square (shown when more than one).
 * `badge`: a small X in the square's corner, drawn over a ship that has X's beneath it.
 */
export function XMark({ at, count = 1, badge = false }: { at: Pos; count?: number; badge?: boolean }) {
  const c = centre(at);
  const x = badge ? c.x + S * 0.3 : c.x;
  const y = badge ? c.y - S * 0.3 : c.y;
  return (
    <g className="pl-x-mark">
      <g transform={`translate(${x} ${y}) scale(${badge ? 0.075 : 0.16}) translate(-36 -36)`} className="pl-x pl-ink">
        <polygon className="pl-x-fill" points={X_POINTS} />
        <polygon className="pl-x-line" points={X_POINTS} />
      </g>
      {count > 1 && (
        <text className="pl-x-count" x={c.x + S * 0.42} y={c.y + S * (badge ? -0.08 : 0.44)} textAnchor="end">
          ×{count}
        </text>
      )}
    </g>
  );
}

/** The skull and crossbones as an inline icon, sized to the text around it. */
export function SkullIcon({ size = "1.1em" }: { size?: string | number }) {
  return (
    <svg className="pl-skull-icon pl-ink" viewBox="9 8 54 54" width={size} height={size} aria-hidden="true">
      <SkullShapes />
    </svg>
  );
}

/** A flag planted on an owned island. */
export function Flag({ at, color }: { at: Pos; color: PlayerColor }) {
  const { x, y } = centre(at);
  return (
    <g transform={`translate(${x - 1.2} ${y - 0.6})`} className="pl-flag pl-ink">
      <ellipse className="pl-flag-shadow" cx={0.4} cy={2.7} rx={1.3} ry={0.45} />
      {/* A swallowtail pennant on a pole, inked like the rest of the map. */}
      <path
        className="pl-flag-cloth"
        fill={COLOR_HEX[color]}
        d="M0.25 -3.6 L4.1 -3.15 L3.0 -2.35 L4.1 -1.55 L0.25 -1.1 Z"
      />
      <line className="pl-flag-pole" x1={0} y1={-3.9} x2={0} y2={2.6} />
      <circle className="pl-flag-knob" cx={0} cy={-4.05} r={0.38} />
    </g>
  );
}

/** A highlighted square: where a ship can sail, or where something can be placed. */
export function SquareMark({ at, kind }: { at: Pos; kind: "reach" | "reach-toll" | "place" | "start" | "attack" }) {
  return (
    <rect
      className={`pl-mark pl-mark-${kind}`}
      x={at.c * S + 0.8}
      y={at.r * S + 0.8}
      width={S - 1.6}
      height={S - 1.6}
      rx={1.6}
    />
  );
}

/** A resource card's symbol: wood plank, iron ingot, rum bottle, gold coin. */
export function ResourceIcon({ r, size = 18 }: { r: Resource; size?: number }) {
  return (
    <svg className={`pl-res-icon pl-ink pl-res-${r}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {r === "wood" && (
        <>
          <rect x={2} y={5} width={16} height={10} rx={1.5} />
          <path className="pl-res-line" d="M4 8.5 H15 M5 11.5 H16" />
        </>
      )}
      {r === "iron" && <path d="M3 14 L6 6 H14 L17 14 Z" />}
      {r === "rum" && (
        <>
          <rect x={8} y={2} width={4} height={5} rx={1} />
          <path d="M6 8 Q6 6.5 8 6.5 H12 Q14 6.5 14 8 V17 Q14 18 13 18 H7 Q6 18 6 17 Z" />
        </>
      )}
      {r === "gold" && (
        <>
          <circle cx={10} cy={10} r={7.5} />
          <circle className="pl-res-line" cx={10} cy={10} r={4.5} />
        </>
      )}
    </svg>
  );
}

export const RESOURCE_NAMES: Record<Resource, string> = { wood: "Wood", iron: "Iron", rum: "Rum", gold: "Gold" };

/** The storm: a 3×3 square of dark, swirling cloud inside a rope border, centred on `at`. */
export function StormPiece({ at }: { at: Pos }) {
  const x = (at.c - 1) * S;
  const y = (at.r - 1) * S;
  const size = 3 * S;
  return (
    <g className="pl-storm" aria-label="The storm">
      <rect className="pl-storm-dark" x={x} y={y} width={size} height={size} />
      <rect className="pl-storm-cloud" x={x} y={y} width={size} height={size} filter="url(#pl-storm-swirl)" />
      <rect className="pl-storm-rain" x={x} y={y} width={size} height={size} />
      <rect className="pl-storm-rope" x={x + 0.6} y={y + 0.6} width={size - 1.2} height={size - 1.2} rx={0.8} />
      <rect className="pl-storm-rope-twist" x={x + 0.6} y={y + 0.6} width={size - 1.2} height={size - 1.2} rx={0.8} />
    </g>
  );
}

/** Crossed swords as an inline icon, sized to the text around it. */
export function SwordsIcon({ size = "1.1em" }: { size?: string | number }) {
  return (
    <svg className="pl-skull-icon pl-ink" viewBox="12 9 48 54" width={size} height={size} aria-hidden="true">
      <SwordsShapes />
    </svg>
  );
}
