import { COLS, ROWS, ROW_LETTERS, gridSize, tilePosition, type Orientation } from "@/games/plunder/lib/board";

/** One tile = U units in the SVG. The border is one tile thick on every side. */
const U = 10;

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

/** The board's border: numbers 1–18 on two sides, letters A–L on the other two. */
function BoardSvg({ orientation }: { orientation: Orientation }) {
  const { w, h } = gridSize(orientation);
  const W = (w + 2) * U;
  const H = (h + 2) * U;

  // Each label lines up with its column or row of tiles.
  const numbers = Array.from({ length: COLS }, (_, i) => i + 1);
  const letters = Array.from({ length: ROWS }, (_, i) => i);
  const labels: { x: number; y: number; text: string }[] = [];
  for (const col of numbers) {
    const p = tilePosition({ col, row: 0 }, orientation);
    const text = String(col);
    if (orientation === "landscape") {
      labels.push({ x: (p.x + 1) * U, y: 0, text }, { x: (p.x + 1) * U, y: H - U, text });
    } else {
      labels.push({ x: 0, y: (p.y + 1) * U, text }, { x: W - U, y: (p.y + 1) * U, text });
    }
  }
  for (const row of letters) {
    const p = tilePosition({ col: 1, row }, orientation);
    const text = ROW_LETTERS[row];
    if (orientation === "landscape") {
      labels.push({ x: 0, y: (p.y + 1) * U, text }, { x: W - U, y: (p.y + 1) * U, text });
    } else {
      labels.push({ x: (p.x + 1) * U, y: 0, text }, { x: (p.x + 1) * U, y: H - U, text });
    }
  }

  return (
    <svg
      className={`pl-board pl-board-${orientation}`}
      viewBox={`-1 -1 ${W + 2} ${H + 2}`}
      role="img"
      aria-label={`Plunder board, columns 1 to ${COLS}, rows A to ${ROW_LETTERS[ROWS - 1]}`}
    >
      <defs>
        <radialGradient id={`pl-sea-${orientation}`} cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#2c5677" />
          <stop offset="100%" stopColor="#152d44" />
        </radialGradient>
      </defs>
      <rect className="pl-frame" x={-0.5} y={-0.5} width={W + 1} height={H + 1} rx={1.5} />
      <rect x={U} y={U} width={W - 2 * U} height={H - 2 * U} fill={`url(#pl-sea-${orientation})`} />
      {labels.map((l) => (
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

/** Both orientations are rendered; CSS shows the one that fits the screen's shape. */
export default function Board() {
  return (
    <div className="pl-board-wrap">
      <BoardSvg orientation="landscape" />
      <BoardSvg orientation="portrait" />
    </div>
  );
}
