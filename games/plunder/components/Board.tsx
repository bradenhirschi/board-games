"use client";

import { memo, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { COLS, ROWS, ROW_LETTERS, tilePosition } from "@/games/plunder/lib/board";
import { DEFAULT_LAYOUT, TILE_SIZE, type Placement, type Pos } from "@/games/plunder/lib/tiles";
import { ArtDefs, IslandsArt, S, SeaArt, placeLayout } from "./Art";

/** One square = U units in the SVG. The border is one square thick on every side. */
const U = S;
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

/** The sea and islands for a layout. Memoised: it only changes with the layout, not every move. */
const BoardArt = memo(function BoardArt({ layout }: { layout: Placement[] }) {
  const placed = useMemo(() => placeLayout(layout), [layout]);
  return (
    <>
      <SeaArt w={COLS} h={ROWS} tileSize={TILE_SIZE} />
      <IslandsArt placed={placed} />
    </>
  );
});

function BoardSvg({ layout, children }: { layout: Placement[]; children?: ReactNode }) {
  return (
    <svg
      className="pl-board"
      viewBox={`-1 -1 ${W + 2} ${H + 2}`}
      role="img"
      aria-label={`Plunder board, columns 1 to ${COLS}, rows A to ${ROW_LETTERS[ROWS - 1]}`}
    >
      <defs>
        <ArtDefs />
      </defs>
      <rect className="pl-frame" x={-0.5} y={-0.5} width={W + 1} height={H + 1} rx={1.5} />
      <g transform={`translate(${U} ${U})`}>
        <BoardArt layout={layout} />
        {children}
      </g>
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

/** A swipe this far (px) always flips sides; shorter drags snap to the nearer side. */
const SWIPE_FLIP = 40;
/** Movement (px) before a touch counts as a drag rather than a tap. */
const DRAG_START = 8;

type BoardProps = {
  layout?: Placement[];
  /** Pieces and highlights, drawn over the art in square units (S per square) from the top-left square. */
  children?: ReactNode;
  /** A tap (not a swipe) on a square of the play area. */
  onSquareTap?: (p: Pos) => void;
  /** Slide to show this square if it's off screen (e.g. the selected ship). */
  focus?: Pos | null;
};

/**
 * The board, drawn wider than a phone screen so it stays readable. Swipe it, or tap the
 * button below it, to slide between its left and right side. On wide screens it all fits.
 */
export default function Board({ layout = DEFAULT_LAYOUT, children, onSquareTap, focus }: BoardProps) {
  // Columns 1–12 show on the left side and 7–18 on the right: slide only when the focus (e.g. the
  // selected ship) would be off screen. Adjusted during render when the focus moves.
  const sideFor = (p: Pos | null | undefined, current: "left" | "right") =>
    !p ? current : p.c < 6 ? "left" : p.c > 11 ? "right" : current;
  const [side, setSide] = useState<"left" | "right">(() => sideFor(focus, "left"));
  const focusKey = focus ? `${focus.r},${focus.c}` : null;
  const [lastFocus, setLastFocus] = useState(focusKey);
  if (focusKey !== lastFocus) {
    setLastFocus(focusKey);
    setSide(sideFor(focus, side));
  }
  /** While a finger is dragging the board: its offset in px (0 = left side, -max = right side). */
  const [drag, setDrag] = useState<{ offset: number; max: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; base: number; max: number; moved: boolean } | null>(null);

  function onPointerDown(e: PointerEvent) {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    // max is 0 when the whole board fits: then it never slides, but taps still count.
    const max = Math.max(0, track.offsetWidth - viewport.clientWidth);
    gesture.current = { id: e.pointerId, x: e.clientX, base: side === "left" ? 0 : -max, max, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    if (!g.moved) {
      if (Math.abs(dx) < DRAG_START || g.max === 0) return;
      g.moved = true;
      viewportRef.current?.setPointerCapture(e.pointerId);
    }
    setDrag({ offset: Math.min(0, Math.max(-g.max, g.base + dx)), max: g.max });
  }

  function onPointerEnd(e: PointerEvent) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.moved) {
      if (e.type === "pointerup") tap(e);
      return;
    }
    const dx = e.clientX - g.x;
    const offset = g.base + dx;
    if (dx <= -SWIPE_FLIP) setSide("right");
    else if (dx >= SWIPE_FLIP) setSide("left");
    else setSide(offset < -g.max / 2 ? "right" : "left");
    setDrag(null);
  }

  /** Which square a tap landed on, from the SVG's own coordinates. */
  function tap(e: PointerEvent) {
    const svg = trackRef.current?.querySelector("svg");
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm || !onSquareTap) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const c = Math.floor((pt.x - U) / U);
    const r = Math.floor((pt.y - U) / U);
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) onSquareTap({ r, c });
  }

  // How far across the board the view is, 0 (left side) to 1 (right side), for the button's indicator.
  const progress = drag ? -drag.offset / drag.max : side === "left" ? 0 : 1;
  const toRight = side === "left";

  return (
    <>
      <div
        ref={viewportRef}
        className="pl-board-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          ref={trackRef}
          className={`pl-board-track pl-show-${side}${drag ? " pl-dragging" : ""}`}
          style={drag ? { transform: `translateX(${drag.offset}px)` } : undefined}
        >
          <BoardSvg layout={layout}>{children}</BoardSvg>
        </div>
      </div>
      <div className={`pl-slide-bar${drag ? " pl-dragging" : ""}`}>
        <button
          className="pl-slide"
          aria-label={toRight ? "Show the right side of the board" : "Show the left side of the board"}
          onClick={() => setSide(toRight ? "right" : "left")}
        >
          <svg className={`pl-slide-arrow${toRight ? "" : " on"}`} viewBox="0 0 10 10" aria-hidden="true">
            <path d="M6.5 1.5 L3 5 L6.5 8.5" />
          </svg>
          <span className="pl-slide-rail" aria-hidden="true">
            <span className="pl-slide-thumb" style={{ left: `${progress * 31}%` }} />
          </span>
          <svg className={`pl-slide-arrow${toRight ? " on" : ""}`} viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3.5 1.5 L7 5 L3.5 8.5" />
          </svg>
        </button>
      </div>
    </>
  );
}
