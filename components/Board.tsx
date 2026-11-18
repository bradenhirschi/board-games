"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  CAREERS,
  GRID,
  LANES,
  TRACK,
  TRACK_LENGTH,
  arrowFor,
  gridPos,
  sideOf,
  type Career,
  type Lane,
  type Side,
} from "@/lib/board";
import type { Player } from "@/lib/game";
import { STOCKS, priceAt } from "@/lib/stocks";
import PriceTracker from "./PriceTracker";

interface BoardProps {
  players: Player[];
  currentId: number;
  market: number;
  marketDelta: number | null;
  path: number[];
  lastLanding: number | null;
  diceTotal: number | null;
}

const at = (row: number, col: number, rowSpan = 1, colSpan = 1): CSSProperties => ({
  gridRow: `${row + 1} / span ${rowSpan}`,
  gridColumn: `${col + 1} / span ${colSpan}`,
});

export default function Board({ players, currentId, market, marketDelta, path, lastLanding, diceTotal }: BoardProps) {
  const pathSet = new Set(path);
  return (
    <div className="board" style={{ gridTemplateColumns: TEMPLATE, gridTemplateRows: TEMPLATE }}>
      {Array.from({ length: TRACK_LENGTH }, (_, i) => {
        const [r, c] = gridPos(i);
        return (
          <TrackSquare
            key={i}
            index={i}
            style={at(r, c)}
            market={market}
            highlight={pathSet.has(i) ? "path" : lastLanding === i ? "landing" : null}
          >
            <Tokens players={players.filter((p) => p.position === i)} currentId={currentId} />
          </TrackSquare>
        );
      })}

      {LANES.map((lane) => (
        <MeetingLane key={lane.side} lane={lane} />
      ))}

      {CAREERS.map((career) => (
        <CareerCorner key={career.name} career={career} active={diceTotal !== null && career.rolls.includes(diceTotal)} />
      ))}

      <div className="board-center" style={at(3, 3, 7, 7)}>
        <div className="logo">
          STONKS<span className="logo-arrow">↗</span>
        </div>
        <PriceTracker market={market} delta={marketDelta} />
        <div className="logo logo-flipped" aria-hidden>
          STONKS<span className="logo-arrow">↗</span>
        </div>
      </div>
    </div>
  );
}

// Corners are a little larger than regular squares.
const TEMPLATE = `1.45fr repeat(${GRID - 2}, 1fr) 1.45fr`;

function moveLabel(move: number) {
  return move > 0 ? `UP ${move}` : `DOWN ${-move}`;
}

function TrackSquare({
  index,
  style,
  market,
  highlight,
  children,
}: {
  index: number;
  style: CSSProperties;
  market: number;
  highlight: "path" | "landing" | null;
  children: ReactNode;
}) {
  const sq = TRACK[index];
  const side = sideOf(index);
  const cls = ["sq", `sq-${side}`, highlight ? `sq-${highlight}` : ""].join(" ");

  if (sq.kind === "start") {
    return (
      <div className={`${cls} sq-start`} style={style} data-index={index}>
        <div className="sq-title start-title">START</div>
        <div className="sq-small">PAY $100 FEE</div>
        <div className="start-arrows">
          <span>
            {arrowFor(index, "cw")} <small>ODD</small>
          </span>
          <span>
            <small>EVEN</small> {arrowFor(index, "ccw")}
          </span>
        </div>
        {children}
      </div>
    );
  }

  if (sq.kind === "corner") {
    return (
      <div className={`${cls} sq-corner`} style={style} data-index={index}>
        <div className="corner-pay">PAY</div>
        <div className="sq-small">BROKER FEE $10 / SHARE</div>
        <div className="sq-move">
          <span className="sq-arrow">{arrowFor(index, sq.dir)}</span> {moveLabel(sq.move)}
        </div>
        {children}
      </div>
    );
  }

  const stock = STOCKS[sq.stock];
  const colors = { ...style, background: stock.color, color: stock.ink };

  if (sq.kind === "sellAll") {
    return (
      <div className={cls} style={colors} data-index={index}>
        <div className="sq-small strong">SELL ALL</div>
        <div className="sq-title">{stock.short}</div>
        <div className="sq-small">AT ${priceAt(sq.stock, market)}/SH</div>
        <div className="sq-move">
          <span className="sq-arrow">{arrowFor(index, sq.dir)}</span> {moveLabel(sq.move)}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className={cls} style={colors} data-index={index}>
      {sq.entry && <div className={`entry-banner entry-${side}`} title="Shareholders' meeting entrance" />}
      <div className="sq-small">${sq.dividend} DIV</div>
      <div className="sq-title">{stock.short}</div>
      {sq.limitOne && <div className="sq-tiny">LIMIT 1 SHARE</div>}
      <div className="sq-move">
        <span className="sq-arrow">{arrowFor(index, sq.dir)}</span> {moveLabel(sq.move)}
      </div>
      {children}
    </div>
  );
}

function Tokens({ players, currentId }: { players: Player[]; currentId: number }) {
  if (players.length === 0) return null;
  return (
    <div className="tokens">
      {players.map((p) => (
        <div
          key={p.id}
          className={`token ${p.id === currentId ? "token-current" : ""}`}
          style={{ background: p.color }}
          title={p.name}
        >
          {p.name.slice(0, 1).toUpperCase()}
        </div>
      ))}
    </div>
  );
}

const LANE_BOX: Record<Side, { outer: [number, number]; inner: [number, number]; vertical: boolean }> = {
  // [row, col] of the lane's first cell for the row/column nearest the track and nearest the center.
  bottom: { outer: [11, 3], inner: [10, 3], vertical: false },
  top: { outer: [1, 3], inner: [2, 3], vertical: false },
  left: { outer: [3, 1], inner: [3, 2], vertical: true },
  right: { outer: [3, 11], inner: [3, 10], vertical: true },
};

function MeetingLane({ lane }: { lane: Lane }) {
  const box = LANE_BOX[lane.side];
  const cell = (base: [number, number], offset: number, span = 1) =>
    box.vertical ? at(base[0] + offset, base[1], span, 1) : at(base[0], base[1] + offset, 1, span);
  const [a, b] = lane.entries.map((i) => {
    const sq = TRACK[i];
    return sq.kind === "stock" ? STOCKS[sq.stock].short : "";
  });
  return (
    <>
      <div className="lane-cell" style={cell(box.outer, 0)}>
        1 FOR 1
      </div>
      <div className={`lane-label ${box.vertical ? "lane-label-v" : ""}`} style={cell(box.outer, 1, 5)}>
        <span className="lane-sub">
          {a} <span aria-hidden>→</span>
        </span>
        <span className="lane-title">SHAREHOLDERS&apos; MEETING</span>
        <span className="lane-sub">
          <span aria-hidden>←</span> {b}
        </span>
      </div>
      <div className="lane-cell" style={cell(box.outer, 6)}>
        1 FOR 1
      </div>
      {lane.splits.map((n, k) => (
        <div key={k} className="lane-cell lane-split" style={cell(box.inner, k)}>
          {n} FOR 1
        </div>
      ))}
    </>
  );
}

const CAREER_POS: Record<Career["corner"], [number, number]> = {
  tl: [1, 1],
  tr: [1, 10],
  bl: [10, 1],
  br: [10, 10],
};

function CareerCorner({ career, active }: { career: Career; active: boolean }) {
  const [r, c] = CAREER_POS[career.corner];
  return (
    <div className={`career ${active ? "career-active" : ""}`} style={at(r, c, 2, 2)}>
      <div className="career-icon">{career.icon}</div>
      <div className="career-name">{career.name.toUpperCase()}</div>
      <div className="career-rule">
        {career.rolls[0]} OR {career.rolls[1]} PAYS
        <br />${career.salary} SALARY
      </div>
    </div>
  );
}
