import type { PlayerColor, Resource, Ship } from "@/games/plunder/lib/engine";
import type { Pos } from "@/games/plunder/lib/tiles";
import { S } from "./Art";

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

/** A ship from above, in its owner's colour, with a peg for each life, its masts and its cannons. */
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
  return (
    // Positioned with a CSS transform (SVG user units), so each step along a route glides.
    <g
      style={{ transform: `translate(${x}px, ${y}px)` }}
      className={`pl-ship${selected ? " pl-ship-selected" : ""}${ship.docked ? " pl-ship-docked" : ""}`}
    >
      {selected && <circle className="pl-ship-ring" r={4.9} />}
      <path
        className="pl-ship-hull"
        fill={COLOR_HEX[color]}
        d="M0 -4.3 C2.7 -2.9 3.1 -0.4 2.9 3.6 L-2.9 3.6 C-3.1 -0.4 -2.7 -2.9 0 -4.3 Z"
      />
      {Array.from({ length: ship.cannons }, (_, i) => (
        <rect
          key={`c${i}`}
          className="pl-ship-cannon"
          x={i === 0 ? -3.9 : 2.7}
          y={0.2}
          width={1.2}
          height={1.6}
          rx={0.3}
        />
      ))}
      {Array.from({ length: ship.masts }, (_, i) => (
        <rect key={`m${i}`} className="pl-ship-mast" x={-2} y={-2.3 + i * 1.5} width={4} height={0.7} rx={0.3} />
      ))}
      {Array.from({ length: 3 }, (_, i) => (
        <circle
          key={`l${i}`}
          className={i < ship.lives ? "pl-ship-life" : "pl-ship-life lost"}
          cx={(i - 1) * 1.6}
          cy={2.2}
          r={0.65}
        />
      ))}
    </g>
  );
}

/** An X-marks-the-spot token. */
export function XMark({ at }: { at: Pos }) {
  const { x, y } = centre(at);
  return (
    <g transform={`translate(${x} ${y})`} className="pl-x">
      <path d="M-2.6 -2.6 L2.6 2.6 M2.6 -2.6 L-2.6 2.6" />
    </g>
  );
}

/** A flag planted on an owned island. */
export function Flag({ at, color }: { at: Pos; color: PlayerColor }) {
  const { x, y } = centre(at);
  return (
    <g transform={`translate(${x - 1.5} ${y - 1})`} className="pl-flag">
      <line x1={0} y1={-3.2} x2={0} y2={2.4} />
      <path d="M0.2 -3.2 L3.4 -2.2 L0.2 -1 Z" fill={COLOR_HEX[color]} />
      <ellipse cx={0} cy={2.5} rx={1.1} ry={0.45} />
    </g>
  );
}

/** A highlighted square: where a ship can sail, or where something can be placed. */
export function SquareMark({ at, kind }: { at: Pos; kind: "reach" | "place" | "start" | "attack" }) {
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
    <svg className={`pl-res-icon pl-res-${r}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
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
