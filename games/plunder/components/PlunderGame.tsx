"use client";

import { useMemo, useState } from "react";
import {
  COSTS,
  GOLD_TO_BURY,
  MAX_CANNONS,
  MAX_LIVES,
  MAX_MASTS,
  MAX_SHIPS,
  RESOURCES,
  WIN_POINTS,
  canAfford,
  islandsOf,
  points,
  reachable,
  reducer,
  shipSpots,
  startingIslands,
  type Action,
  type Build,
  type GameState,
  type Notice,
  type Resource,
  type Ship,
} from "@/games/plunder/lib/engine";
import type { Pos } from "@/games/plunder/lib/tiles";
import Board from "./Board";
import { COLOR_HEX, Flag, RESOURCE_NAMES, ResourceIcon, ShipPiece, SquareMark, XMark } from "./Pieces";

const same = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;
const key = (p: Pos) => `${p.r},${p.c}`;

/** Where to plant an island's flag: one of its land squares that isn't a port. */
function flagSpot(squares: Pos[], ports: Pos[]): Pos {
  return squares.find((p) => !ports.some((q) => same(p, q))) ?? squares[0];
}

type Props = { game: GameState; onChange: (g: GameState) => void; onNewGame: () => void };

/**
 * The game on one phone screen: the board on top, then a strip with whose turn it is, their cards
 * and the turn buttons. Players pass the phone; a cover between turns keeps hands private.
 *
 * Render it with a `key` that changes with whose turn it is (see `turnKey`): each turn starts
 * fresh, with nothing selected and the hand-over cover up.
 */
export function turnKey(g: GameState): string {
  const p = g.phase;
  return `${p.t === "pickIsland" ? p.order[p.index] : g.turn}:${p.t}`;
}

export default function PlunderGame({ game, onChange, onNewGame }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  /** The player who has the phone (after tapping through the hand-over cover). */
  const [holder, setHolder] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);

  const s = game;
  const act = (a: Action) => onChange(reducer(s, a));
  const phase = s.phase;
  const current = phase.t === "pickIsland" ? phase.order[phase.index] : s.turn;
  const me = s.players[current];
  const myShips = s.ships.filter((sh) => sh.owner === current);
  const ship: Ship | undefined = s.ships.find((sh) => sh.id === selected && sh.owner === current) ?? undefined;
  const covered = holder !== current && phase.t !== "gameOver";

  const reach = useMemo(
    () => (ship && phase.t === "turn" ? reachable(s, ship) : new Map<string, Pos[]>()),
    [s, ship, phase.t],
  );
  const spots = useMemo(() => (placing ? shipSpots(s, current) : []), [s, placing, current]);
  const startIsles = useMemo(
    () => (phase.t === "pickIsland" ? startingIslands(s.layout).filter((i) => s.owners[i.id] === undefined) : []),
    [s, phase.t],
  );
  const allIslands = useMemo(() => islandsOf(s.layout), [s.layout]);

  function onSquareTap(p: Pos) {
    if (covered) return;
    if (phase.t === "pickIsland") {
      const isl = startIsles.find((i) => i.squares.some((q) => same(q, p)) || i.ports.some((q) => same(q, p)));
      if (isl) act({ t: "pickIsland", island: isl.id });
      return;
    }
    if (phase.t !== "turn") return;
    if (placing) {
      if (spots.some((q) => same(q, p))) {
        act({ t: "build", item: "ship", at: p });
        setPlacing(false);
      }
      return;
    }
    const tapped = s.ships.find((sh) => same(sh.pos, p));
    if (tapped && tapped.owner === current) {
      setSelected(tapped.id === selected ? null : tapped.id);
      return;
    }
    const path = reach.get(key(p));
    if (ship && path) act({ t: "sail", ship: ship.id, path });
  }

  function roll() {
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      act({ t: "roll", die: 1 + Math.floor(Math.random() * 6) });
      if (!selected && myShips.length) setSelected(myShips[0].id);
    }, 550);
  }

  const notice: Notice | undefined = covered ? undefined : s.notices[0];
  const focus = ship?.pos ?? (phase.t === "turn" && myShips[0] ? myShips[0].pos : null);

  // What the strip under the board says.
  let status: string;
  if (phase.t === "pickIsland") status = "Pick your starting island";
  else if (phase.t === "gameOver") status = `${s.players[phase.winner].name} wins!`;
  else if (placing) status = "Tap a green square for your new ship";
  else if (phase.roll === null) status = "Roll to sail, or build first";
  else if (!myShips.length) status = "No ships to sail";
  else if (!ship) status = "Tap one of your ships";
  else {
    const moves = phase.moves + ship.mastMoves;
    status = ship.docked
      ? "This ship was just built: it sails next turn"
      : moves
        ? `${moves} square${moves === 1 ? "" : "s"} to sail`
        : "No moves left";
  }

  return (
    <>
      <Board layout={s.layout} onSquareTap={onSquareTap} focus={focus}>
        {allIslands.map((isl) =>
          s.owners[isl.id] !== undefined ? (
            <Flag key={isl.id} at={flagSpot(isl.squares, isl.ports)} color={s.players[s.owners[isl.id]].color} />
          ) : null,
        )}
        {startIsles.map((isl) => isl.ports.map((p) => <SquareMark key={`s${key(p)}`} at={p} kind="start" />))}
        {[...reach.values()].map((path) => (
          <SquareMark key={`r${key(path[path.length - 1])}`} at={path[path.length - 1]} kind="reach" />
        ))}
        {spots.map((p) => (
          <SquareMark key={`p${key(p)}`} at={p} kind="place" />
        ))}
        {s.xs.map((x, i) => (
          <XMark key={`x${i}`} at={x} />
        ))}
        {s.ships.map((sh) => (
          <ShipPiece key={sh.id} ship={sh} color={s.players[sh.owner].color} selected={sh.id === ship?.id} />
        ))}
      </Board>

      <section className="pl-controls" aria-label="Your turn">
        <div className="pl-strip">
          <span className="pl-dot" style={{ background: COLOR_HEX[me.color] }} />
          <span className="pl-strip-name">{me.name}</span>
          <span className="pl-strip-points">
            {points(s, current)}/{WIN_POINTS} pts
          </span>
          {phase.t === "turn" && phase.roll !== null && <Die value={phase.roll} />}
        </div>
        <p className="pl-status">{status}</p>

        {phase.t !== "pickIsland" && (
          <div className="pl-hand" aria-label="Your cards">
            {RESOURCES.map((r) => (
              <span key={r} className="pl-card-count" title={RESOURCE_NAMES[r]}>
                <ResourceIcon r={r} />
                <b>{covered ? "–" : me.hand[r]}</b>
              </span>
            ))}
          </div>
        )}

        {phase.t === "turn" && (
          <div className="pl-actions">
            {placing ? (
              <button className="pl-btn pl-btn-wide" onClick={() => setPlacing(false)}>
                Cancel
              </button>
            ) : (
              <>
                <button className="pl-btn" onClick={() => setBuildOpen(true)}>
                  Build
                </button>
                {phase.roll === null ? (
                  <button className="pl-btn pl-btn-main" disabled={rolling} onClick={roll}>
                    {rolling ? "Rolling…" : "Roll"}
                  </button>
                ) : (
                  <button className="pl-btn pl-btn-main" onClick={() => act({ t: "endTurn" })}>
                    End turn
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {phase.t === "gameOver" && (
          <div className="pl-actions">
            <button className="pl-btn pl-btn-main pl-btn-wide" onClick={onNewGame}>
              New game
            </button>
          </div>
        )}
      </section>

      {buildOpen && phase.t === "turn" && (
        <BuildSheet
          game={s}
          player={current}
          ship={ship ?? myShips[0]}
          ships={myShips}
          onPickShip={(id) => setSelected(id)}
          onBuild={(item, target) => {
            if (item === "ship") {
              setBuildOpen(false);
              setPlacing(true);
            } else if (target) act({ t: "build", item, ship: target.id });
          }}
          onBury={() => act({ t: "bury" })}
          onClose={() => setBuildOpen(false)}
        />
      )}

      {covered && (
        <div className="pl-cover" role="dialog" aria-label="Pass the phone">
          <span className="pl-dot pl-dot-big" style={{ background: COLOR_HEX[me.color] }} />
          <p className="pl-cover-title">Pass the phone to {me.name}</p>
          <button className="pl-btn pl-btn-main" onClick={() => setHolder(current)}>
            I&rsquo;m {me.name}
          </button>
        </div>
      )}

      {notice && <NoticeDialog notice={notice} game={s} onOk={() => onChange({ ...s, notices: s.notices.slice(1) })} />}
    </>
  );
}

function Die({ value }: { value: number }) {
  const pips: Record<number, [number, number][]> = {
    1: [[5, 5]],
    2: [
      [2.6, 2.6],
      [7.4, 7.4],
    ],
    3: [
      [2.6, 2.6],
      [5, 5],
      [7.4, 7.4],
    ],
    4: [
      [2.6, 2.6],
      [7.4, 2.6],
      [2.6, 7.4],
      [7.4, 7.4],
    ],
    5: [
      [2.6, 2.6],
      [7.4, 2.6],
      [5, 5],
      [2.6, 7.4],
      [7.4, 7.4],
    ],
    6: [
      [2.6, 2.4],
      [7.4, 2.4],
      [2.6, 5],
      [7.4, 5],
      [2.6, 7.6],
      [7.4, 7.6],
    ],
  };
  return (
    <svg className="pl-die" viewBox="0 0 10 10" aria-label={`Rolled ${value}`}>
      <rect x={0.4} y={0.4} width={9.2} height={9.2} rx={1.8} />
      {pips[value].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={0.95} />
      ))}
    </svg>
  );
}

function Cost({ cost }: { cost: Partial<Record<Resource, number>> }) {
  return (
    <span className="pl-cost">
      {RESOURCES.flatMap((r) =>
        Array.from({ length: cost[r] ?? 0 }, (_, i) => <ResourceIcon key={`${r}${i}`} r={r} size={15} />),
      )}
    </span>
  );
}

const BUILD_ITEMS: { item: Build; name: string; what: string }[] = [
  { item: "ship", name: "Ship", what: "A new ship, in your port or beside one of your ships" },
  { item: "mast", name: "Mast", what: "Sail one extra square a turn" },
  { item: "cannon", name: "Cannon", what: "+1 to this ship's battle rolls" },
  { item: "life", name: "Life", what: "Restore a life" },
];

function BuildSheet({
  game,
  player,
  ship,
  ships,
  onPickShip,
  onBuild,
  onBury,
  onClose,
}: {
  game: GameState;
  player: number;
  ship: Ship | undefined;
  ships: Ship[];
  onPickShip: (id: number) => void;
  onBuild: (item: Build, ship: Ship | undefined) => void;
  onBury: () => void;
  onClose: () => void;
}) {
  const hand = game.players[player].hand;
  const why = (item: Build): string | null => {
    if (item === "ship") {
      if (ships.length >= MAX_SHIPS) return `${MAX_SHIPS} ships max`;
      if (!shipSpots(game, player).length) return "Nowhere to place it";
    } else {
      if (!ship) return "No ship";
      if (item === "mast" && ship.masts >= MAX_MASTS) return `${MAX_MASTS} masts max`;
      if (item === "cannon" && ship.cannons >= MAX_CANNONS) return `${MAX_CANNONS} cannons max`;
      if (item === "life" && ship.lives >= MAX_LIVES) return "Lives full";
    }
    if (!canAfford(hand, COSTS[item])) return "Not enough";
    return null;
  };
  return (
    <div className="pl-sheet-backdrop" onClick={onClose}>
      <div className="pl-build" role="dialog" aria-label="Build" onClick={(e) => e.stopPropagation()}>
        <div className="pl-build-head">
          <b>Build</b>
          <div className="pl-hand pl-hand-small">
            {RESOURCES.map((r) => (
              <span key={r} className="pl-card-count">
                <ResourceIcon r={r} size={15} />
                <b>{hand[r]}</b>
              </span>
            ))}
          </div>
          <button className="pl-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {ships.length > 1 && (
          <div className="pl-build-ships">
            Upgrades for:
            {ships.map((sh, i) => (
              <button
                key={sh.id}
                className={`pl-chip${sh.id === ship?.id ? " on" : ""}`}
                onClick={() => onPickShip(sh.id)}
              >
                Ship {i + 1}
              </button>
            ))}
          </div>
        )}
        {BUILD_ITEMS.map(({ item, name, what }) => {
          const blocked = why(item);
          return (
            <div key={item} className="pl-build-row">
              <div className="pl-build-text">
                <b>{name}</b> <Cost cost={COSTS[item]} />
                <small>{what}</small>
              </div>
              <button className="pl-btn pl-btn-small" disabled={!!blocked} onClick={() => onBuild(item, ship)}>
                {blocked ?? (item === "ship" ? "Place" : "Build")}
              </button>
            </div>
          );
        })}
        <div className="pl-build-row">
          <div className="pl-build-text">
            <b>Bury treasure</b> <Cost cost={{ gold: GOLD_TO_BURY }} />
            <small>Trade {GOLD_TO_BURY} gold for a Plunder Point card</small>
          </div>
          <button className="pl-btn pl-btn-small" disabled={hand.gold < GOLD_TO_BURY} onClick={onBury}>
            {hand.gold < GOLD_TO_BURY ? "Not enough" : "Bury"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeDialog({ notice, game, onOk }: { notice: Notice; game: GameState; onOk: () => void }) {
  return (
    <div className="pl-sheet-backdrop pl-centered">
      <div className="pl-dialog" role="alertdialog">
        {notice.t === "treasure" ? (
          <>
            <p className="pl-dialog-title">Treasure!</p>
            <p>
              {game.players[notice.player].name} found a Treasure card. Treasure cards haven&rsquo;t been made yet, so
              nothing happens for now.
            </p>
          </>
        ) : (
          <>
            <p className="pl-dialog-title">Start of your turn</p>
            <p>You drew:</p>
            <div className="pl-hand">
              {notice.cards.map((c, i) => (
                <span key={i} className="pl-card-count">
                  <ResourceIcon r={c} />
                  {RESOURCE_NAMES[c]}
                </span>
              ))}
            </div>
          </>
        )}
        <button className="pl-btn pl-btn-main pl-btn-wide" onClick={onOk}>
          OK
        </button>
      </div>
    </div>
  );
}
