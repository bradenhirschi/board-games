"use client";

import { useState } from "react";
import { COLS, ROWS, ROW_LETTERS, tilePosition } from "@/games/plunder/lib/board";

/** One tile = U units in the SVG. The border is one tile thick on every side. */
const U = 10;
const W = (COLS + 2) * U;
const H = (ROWS + 2) * U;

function Corner({ x, y }: { x: number; y: number }) {
  const c = U / 2;
  return (
    <g className="pl-corner" transform={`translate(${x} ${y})`}>
      <rect width={U} height={U} />
      <path d={`M${c} 1.6 L${U - 1.6} ${c} L${c} ${U - 1.6} L1.6 ${c} Z`} />
      <circle cx={c} cy={c} r={1.1} />
    </g>
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="pl-cell" width={U} height={U} />
      <text className="pl-label" x={U / 2} y={U / 2} dy="0.35em">
        {text}
      </text>
    </g>
  );
}

/** Each label lines up with its column or row of tiles, on both sides of the board. */
const LABELS = [
  ...Array.from({ length: COLS }, (_, i) => {
    const col = i + 1;
    const x = (tilePosition({ col, row: 0 }).x + 1) * U;
    return [
      { x, y: 0, text: String(col) },
      { x, y: H - U, text: String(col) },
    ];
  }).flat(),
  ...ROW_LETTERS.map((text, row) => {
    const y = (tilePosition({ col: 1, row }).y + 1) * U;
    return [
      { x: 0, y, text },
      { x: W - U, y, text },
    ];
  }).flat(),
];

function BoardSvg() {
  return (
    <svg
      className="pl-board"
      viewBox={`-1 -1 ${W + 2} ${H + 2}`}
      role="img"
      aria-label={`Plunder board, columns 1 to ${COLS}, rows A to ${ROW_LETTERS[ROWS - 1]}`}
    >
      <defs>
        <radialGradient id="pl-sea" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#2c5677" />
          <stop offset="100%" stopColor="#152d44" />
        </radialGradient>
      </defs>
      <rect className="pl-frame" x={-0.5} y={-0.5} width={W + 1} height={H + 1} rx={1.5} />
      <rect x={U} y={U} width={W - 2 * U} height={H - 2 * U} fill="url(#pl-sea)" />
      {LABELS.map((l) => (
        <Label key={`${l.x},${l.y}`} {...l} />
      ))}
      <Corner x={0} y={0} />
      <Corner x={W - U} y={0} />
      <Corner x={0} y={H - U} />
      <Corner x={W - U} y={H - U} />
      <rect className="pl-inner-edge" x={U} y={U} width={W - 2 * U} height={H - 2 * U} />
    </svg>
  );
}

/**
 * The board, drawn wider than a phone screen so it stays readable. A small button on the edge
 * slides it to show the left or the right side.
 */
export default function Board() {
  const [side, setSide] = useState<"left" | "right">("left");
  const toRight = side === "left";
  return (
    <div className="pl-board-viewport">
      <div className={`pl-board-track pl-show-${side}`}>
        <BoardSvg />
      </div>
      <button
        className={`pl-slide pl-slide-${toRight ? "right" : "left"}`}
        aria-label={toRight ? "Show the right side of the board" : "Show the left side of the board"}
        onClick={() => setSide(toRight ? "right" : "left")}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d={toRight ? "M3.5 1.5 L7 5 L3.5 8.5" : "M6.5 1.5 L3 5 L6.5 8.5"} />
        </svg>
      </button>
    </div>
  );
}
