"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { botAction, fillDice } from "@/games/plunder/lib/bot";
import { tileName } from "@/games/plunder/lib/board";
import {
  COSTS,
  GOLD_TO_BURY,
  MAX_CANNONS,
  MAX_LIVES,
  MAX_MASTS,
  MAX_SHIPS,
  RESOURCES,
  STORM_TOLL,
  WIN_POINTS,
  attackTargets,
  stormToll,
  canAfford,
  defenseBonus,
  winChance,
  islandsOf,
  points,
  reachable,
  reducer,
  shipSpots,
  startingIslands,
  type Action,
  type Battle,
  type Build,
  type GameState,
  type Notice,
  type Resource,
  type Ship,
  type ShipVia,
  type Target,
} from "@/games/plunder/lib/engine";
import type { Pos } from "@/games/plunder/lib/tiles";
import Board from "./Board";
import { COLOR_HEX, Flag, RESOURCE_NAMES, ResourceIcon, ShipPiece, SquareMark, StormPiece, XMark } from "./Pieces";

const same = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;
const key = (p: Pos) => `${p.r},${p.c}`;

/** Where to plant an island's flag: one of its land squares that isn't a port. */
function flagSpot(squares: Pos[], ports: Pos[]): Pos {
  return squares.find((p) => !ports.some((q) => same(p, q))) ?? squares[0];
}

type Props = {
  game: GameState;
  onChange: (g: GameState) => void;
  onNewGame: () => void;
  /** The human who has the phone (after tapping through the hand-over cover). */
  holder: number | null;
  onHolder: (player: number) => void;
};

/** How long a bot pauses before each move, so people can follow it. */
const BOT_STEP_MS = 750;
/** How long a bot's news stays on screen before it carries on. */
const BOT_NOTICE_MS: Record<Notice["t"], number> = {
  treasure: 1600,
  battle: 2600,
  doubles: 1600,
  drew: 0,
  storm: 1800,
};
/** How long dice tumble before they land. */
const ROLL_MS = 550;
/** How long a ship takes to sail one square. */
const SAIL_STEP_MS = 190;

const d6 = () => 1 + Math.floor(Math.random() * 6);

/** A board square's name, like "C7". */
const squareName = (p: Pos) => tileName({ col: p.c + 1, row: p.r });

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

export default function PlunderGame({ game, onChange, onNewGame, holder, onHolder }: Props) {
  // Each turn starts with the player's first ship selected (this component remounts every turn).
  const [selected, setSelected] = useState<number | null>(
    () => game.ships.find((sh) => sh.owner === game.turn)?.id ?? null,
  );
  const [otherWays, setOtherWays] = useState(false);
  /** A sail that crosses the storm, waiting for the player to choose the cards to pay. */
  const [toll, setToll] = useState<{ ship: number; path: Pos[]; cards: number } | null>(null);
  /** A ship sailing along its route, square by square: where it is drawn right now. */
  const [moving, setMoving] = useState<{ ship: number; pos: Pos } | null>(null);
  const sailTimer = useRef<number | null>(null);
  useEffect(() => () => window.clearInterval(sailTimer.current ?? undefined), []);

  /** Show a ship sailing its route one square at a time, then apply the move. */
  function animateSail(shipId: number, path: Pos[], done: () => void) {
    let i = 0;
    setMoving({ ship: shipId, pos: path[0] });
    sailTimer.current = window.setInterval(() => {
      i++;
      if (i < path.length) return setMoving({ ship: shipId, pos: path[i] });
      window.clearInterval(sailTimer.current ?? undefined);
      sailTimer.current = null;
      done();
      setMoving(null);
    }, SAIL_STEP_MS);
  }
  const [placing, setPlacing] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [rolling, setRolling] = useState(false);

  const s = game;
  const act = (a: Action) => onChange(reducer(s, a));
  const phase = s.phase;
  const current = phase.t === "pickIsland" ? phase.order[phase.index] : s.turn;
  const me = s.players[current];
  const myShips = s.ships.filter((sh) => sh.owner === current);
  const ship: Ship | undefined = s.ships.find((sh) => sh.id === selected && sh.owner === current) ?? undefined;
  const isBot = !!me.isBot;
  const humans = s.players.filter((p) => !p.isBot).length;
  // Cover the screen when the phone passes between people. Bots don't need it, nor does a lone human.
  const covered = !isBot && phase.t !== "gameOver" && humans > 1 && holder !== current;
  const notice: Notice | undefined = covered ? undefined : s.notices[0];
  const botNotice = notice && s.players[notice.player].isBot;

  // Bots play by themselves, one visible step at a time.
  useEffect(() => {
    if (!isBot || phase.t === "gameOver" || rolling || moving) return;
    if (notice) {
      // A bot's news (treasure, battles, doubles) shows for a moment; what it drew stays private.
      const t = window.setTimeout(() => onChange({ ...s, notices: s.notices.slice(1) }), BOT_NOTICE_MS[notice.t]);
      return () => window.clearTimeout(t);
    }
    const a = botAction(s);
    if (!a) return;
    const t = window.setTimeout(() => {
      if (a.t === "sail") return animateSail(a.ship, a.path, () => onChange(reducer(s, a)));
      const filled = fillDice(a, d6);
      if (filled === a) return onChange(reducer(s, a));
      // Dice to roll: let them tumble first.
      setRolling(true);
      window.setTimeout(() => {
        setRolling(false);
        onChange(reducer(s, filled));
      }, ROLL_MS);
    }, BOT_STEP_MS);
    return () => window.clearTimeout(t);
  }, [s, isBot, phase.t, notice, onChange, rolling, moving]);

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
  const targets = useMemo(() => (ship && !isBot ? attackTargets(s, ship) : []), [s, ship, isBot]);
  // A captain without a ship (and not yet back on the water).
  const captain = phase.t === "turn" && !myShips.length ? (s.captain ?? null) : null;
  const captainSpots = captain?.spots ?? [];

  /** Where a target is on the board: the enemy ship's square, or the island's squares. */
  function targetSquares(t: Target): Pos[] {
    if (t.kind === "ship") return s.ships.filter((sh) => sh.id === t.id).map((sh) => sh.pos);
    return allIslands.find((i) => i.id === t.id)?.squares ?? [];
  }

  function attack(t: Target) {
    if (!ship || rolling) return;
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      act({ t: "attack", ship: ship.id, target: t, attackDie: d6(), defenseDie: d6() });
    }, ROLL_MS);
  }

  function rollDoubles() {
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      act({ t: "rollDoubles", dice: [d6(), d6()] });
    }, ROLL_MS);
  }

  function onSquareTap(p: Pos) {
    if (covered || isBot || rolling || moving) return;
    if (captainSpots.some((q) => same(q, p))) {
      act({ t: "placeShip", at: p });
      return;
    }
    // Tapping something you can attack attacks it.
    const target = targets.find((t) => targetSquares(t).some((q) => same(q, p)));
    if (target) {
      attack(target);
      return;
    }
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
    if (ship && path) {
      const id = ship.id;
      const cards = stormToll(s, ship.pos, path);
      if (cards) setToll({ ship: id, path, cards });
      else animateSail(id, path, () => act({ t: "sail", ship: id, path }));
    }
  }

  function roll() {
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      act({ t: "roll", die: d6() });
      if (!selected && myShips.length) setSelected(myShips[0].id);
    }, ROLL_MS);
  }

  const focus = ship?.pos ?? (phase.t === "turn" && myShips[0] ? myShips[0].pos : null);

  // What the strip under the board says.
  let status: string;
  if (isBot && phase.t !== "gameOver")
    status = rolling ? "Rolling…" : phase.t === "pickIsland" ? "Choosing an island…" : "Thinking…";
  else if (phase.t === "pickIsland") status = "Pick your starting island";
  else if (phase.t === "gameOver") status = `${s.players[phase.winner].name} wins!`;
  else if (rolling) status = "Rolling…";
  else if (placing || captainSpots.length) status = "Tap a green square for your new ship";
  else if (captain)
    status = !captain.rolled ? "No ship! Roll doubles for a free one" : "No doubles. Get a ship another way?";
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
        {s.storm && <StormPiece at={s.storm} />}
        {[...(moving ? [] : reach.values())].map((path) => (
          <SquareMark
            key={`r${key(path[path.length - 1])}`}
            at={path[path.length - 1]}
            kind={ship && stormToll(s, ship.pos, path) ? "reach-toll" : "reach"}
          />
        ))}
        {[...spots, ...captainSpots].map((p) => (
          <SquareMark key={`p${key(p)}`} at={p} kind="place" />
        ))}
        {targets.flatMap((t) =>
          targetSquares(t).map((p) => <SquareMark key={`a${t.kind}${t.id}${key(p)}`} at={p} kind="attack" />),
        )}
        {s.xs.map((x, i) => (
          <XMark key={`x${i}`} at={x} />
        ))}
        {s.ships.map((sh) => (
          <ShipPiece
            key={sh.id}
            ship={sh}
            color={s.players[sh.owner].color}
            selected={sh.id === ship?.id}
            at={moving?.ship === sh.id ? moving.pos : undefined}
          />
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
        {/* While there's something to attack, the attack buttons say it all (and the space is needed). */}
        {!(targets.length > 0 && !placing) && <p className="pl-status">{status}</p>}

        {phase.t !== "pickIsland" && (
          <div className="pl-hand" aria-label="Your cards">
            {RESOURCES.map((r) => (
              <span key={r} className="pl-card-count" title={RESOURCE_NAMES[r]}>
                <ResourceIcon r={r} />
                <b>{covered || isBot ? "–" : me.hand[r]}</b>
              </span>
            ))}
          </div>
        )}

        {targets.length > 0 && !placing && (
          <div className="pl-attacks">
            {targets.map((t) => {
              const chance = Math.round(winChance(ship!.cannons, defenseBonus(s, t)) * 100);
              const isl = t.kind === "island" ? allIslands.find((i) => i.id === t.id) : undefined;
              const owner = t.kind === "ship" ? s.ships.find((sh) => sh.id === t.id)!.owner : s.owners[t.id];
              const label =
                t.kind === "ship"
                  ? `${s.players[owner!].name}'s ship`
                  : `${owner === undefined ? "Island" : `${s.players[owner].name}'s island`} (${isl?.skulls ?? 0}☠)`;
              return (
                <button
                  key={`${t.kind}${t.id}`}
                  className="pl-btn pl-btn-attack"
                  disabled={rolling}
                  onClick={() => attack(t)}
                >
                  ⚔ {label} <small>{chance}%</small>
                </button>
              );
            })}
          </div>
        )}

        {captain && !isBot && !captainSpots.length && (
          <div className="pl-actions">
            {!captain.acquired && (
              <button className="pl-btn" onClick={() => setOtherWays(true)}>
                Other ways
              </button>
            )}
            {!captain.rolled && !captain.acquired ? (
              <button className="pl-btn pl-btn-main" disabled={rolling} onClick={rollDoubles}>
                {rolling ? "Rolling…" : "Roll for doubles"}
              </button>
            ) : (
              <button className="pl-btn pl-btn-main" onClick={() => act({ t: "endTurn" })}>
                End turn
              </button>
            )}
          </div>
        )}

        {phase.t === "turn" && !isBot && !captain && (
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
        <div className="pl-cover" role="dialog" aria-label="Pass the device">
          <span className="pl-dot pl-dot-big" style={{ background: COLOR_HEX[me.color] }} />
          <p className="pl-cover-title">Pass the device to {me.name}</p>
          <button className="pl-btn pl-btn-main" onClick={() => onHolder(current)}>
            I&rsquo;m {me.name}
          </button>
        </div>
      )}

      {captain?.freeCard && !isBot && !covered && !notice && (
        <FreeCardDialog onPick={(r) => act({ t: "freeCard", resource: r })} />
      )}

      {toll && (
        <TollDialog
          need={toll.cards}
          hand={me.hand}
          onPay={(pay) => {
            const { ship: id, path } = toll;
            setToll(null);
            animateSail(id, path, () => act({ t: "sail", ship: id, path, pay }));
          }}
          onCancel={() => setToll(null)}
        />
      )}

      {otherWays && captain && !captain.acquired && (
        <OtherWaysSheet
          game={s}
          player={current}
          onPick={(via) => {
            setOtherWays(false);
            act({ t: "getShip", via });
          }}
          onClose={() => setOtherWays(false)}
        />
      )}

      {notice && botNotice && notice.t === "treasure" && (
        <div className="pl-toast" role="status">
          {s.players[notice.player].name} found a Treasure card
        </div>
      )}
      {notice && botNotice && notice.t === "doubles" && (
        <div className="pl-toast" role="status">
          {s.players[notice.player].name} rolled {notice.dice[0]} and {notice.dice[1]}
          {notice.dice[0] === notice.dice[1] ? ": doubles!" : ""}
        </div>
      )}
      {notice && botNotice && notice.t === "battle" && (
        <div className="pl-sheet-backdrop pl-centered pl-passive">
          <BattleCard battle={notice} game={s} />
        </div>
      )}
      {notice && !botNotice && (
        <NoticeDialog notice={notice} game={s} onOk={() => onChange({ ...s, notices: s.notices.slice(1) })} />
      )}
    </>
  );
}

function Die({ value, kind }: { value: number; kind?: "attack" | "defense" }) {
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
    <svg className={`pl-die${kind ? ` pl-die-${kind}` : ""}`} viewBox="0 0 10 10" aria-label={`Rolled ${value}`}>
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

/** A battle's dice and outcome, told from the attacker's side. */
function BattleCard({ battle: b, game, children }: { battle: Battle; game: GameState; children?: ReactNode }) {
  const name = (p: number | null) => (p === null ? "The island" : game.players[p].name);
  const attacker = game.players[b.player];
  const isle = b.target.kind === "island";
  const defenderLabel = isle
    ? b.defender === null
      ? "Unowned island"
      : `${name(b.defender)}'s island`
    : `${name(b.defender)}'s ship`;
  let outcome: string;
  if (b.won) {
    if (isle) outcome = `${attacker.name} conquers the island!`;
    else if (b.sunk) outcome = `${attacker.name} sinks ${name(b.defender)}'s ship and gains a Plunder Point!`;
    else outcome = `${name(b.defender)}'s ship loses a life.`;
  } else if (b.sunk) {
    outcome =
      b.pointTo === null
        ? `${attacker.name}'s ship sinks.`
        : `${attacker.name}'s ship sinks. ${name(b.pointTo)} gains a Plunder Point!`;
  } else outcome = `${attacker.name}'s ship loses a life.`;
  const total = (side: Battle["attack"]) => side.die + side.bonus;
  return (
    <div className="pl-dialog pl-battle" role="alertdialog">
      <p className="pl-dialog-title">{b.won ? "Victory!" : "Defeated!"}</p>
      <div className="pl-battle-sides">
        <div>
          <small>{attacker.name}</small>
          <Die value={b.attack.die} kind="attack" />
          <span>
            {b.attack.bonus ? `+${b.attack.bonus} cannon${b.attack.bonus > 1 ? "s" : ""} = ` : ""}
            <b>{total(b.attack)}</b>
          </span>
        </div>
        <span className="pl-battle-vs">vs</span>
        <div>
          <small>{defenderLabel}</small>
          <Die value={b.defense.die} kind="defense" />
          <span>
            {b.defense.bonus
              ? `+${b.defense.bonus} ${isle ? "skull" : "cannon"}${b.defense.bonus > 1 ? "s" : ""} = `
              : ""}
            <b>{total(b.defense)}</b>
          </span>
        </div>
      </div>
      {total(b.attack) === total(b.defense) && <p className="pl-battle-tie">Ties go to the attacker.</p>}
      <p>{outcome}</p>
      {children}
    </div>
  );
}

/** Choose the cards to pay the storm: STORM_TOLL for each time the route crosses its border. */
function TollDialog({
  need,
  hand,
  onPay,
  onCancel,
}: {
  need: number;
  hand: Record<Resource, number>;
  onPay: (cards: Resource[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Record<Resource, number>>({ wood: 0, iron: 0, rum: 0, gold: 0 });
  const total = RESOURCES.reduce((n, r) => n + picked[r], 0);
  const change = (r: Resource, d: number) =>
    setPicked((p) => ({ ...p, [r]: Math.max(0, Math.min(hand[r], p[r] + d)) }));
  return (
    <div className="pl-sheet-backdrop pl-centered">
      <div className="pl-dialog" role="alertdialog">
        <p className="pl-dialog-title">Storm toll</p>
        <p>
          Sailing {need > STORM_TOLL ? "into and out of" : "across the edge of"} the storm costs {need} cards. Choose
          which to give up.
        </p>
        <div className="pl-toll">
          {RESOURCES.map((r) => (
            <div key={r} className="pl-toll-row">
              <ResourceIcon r={r} />
              <span className="pl-toll-name">
                {RESOURCE_NAMES[r]} <small>({hand[r]})</small>
              </span>
              <button
                className="pl-close"
                aria-label={`One less ${r}`}
                disabled={!picked[r]}
                onClick={() => change(r, -1)}
              >
                −
              </button>
              <b>{picked[r]}</b>
              <button
                className="pl-close"
                aria-label={`One more ${r}`}
                disabled={picked[r] >= hand[r] || total >= need}
                onClick={() => change(r, 1)}
              >
                +
              </button>
            </div>
          ))}
        </div>
        <div className="pl-actions">
          <button className="pl-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="pl-btn pl-btn-main"
            disabled={total !== need}
            onClick={() => onPay(RESOURCES.flatMap((r) => Array<Resource>(picked[r]).fill(r)))}
          >
            Pay {total}/{need}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A captain with no islands and no Plunder Point cards picks a free resource card. */
function FreeCardDialog({ onPick }: { onPick: (r: Resource) => void }) {
  return (
    <div className="pl-sheet-backdrop pl-centered">
      <div className="pl-dialog" role="alertdialog">
        <p className="pl-dialog-title">Take a free card</p>
        <p>No ships, islands or Plunder Points: choose any resource card.</p>
        <div className="pl-hand">
          {RESOURCES.map((r) => (
            <button key={r} className="pl-card-count pl-card-pick" onClick={() => onPick(r)}>
              <ResourceIcon r={r} />
              {RESOURCE_NAMES[r]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ways for a captain without a ship to get one besides doubles. */
function OtherWaysSheet({
  game,
  player,
  onPick,
  onClose,
}: {
  game: GameState;
  player: number;
  onPick: (via: ShipVia) => void;
  onClose: () => void;
}) {
  const me = game.players[player];
  const owned = islandsOf(game.layout).filter((i) => game.owners[i.id] === player);
  return (
    <div className="pl-sheet-backdrop" onClick={onClose}>
      <div className="pl-build" role="dialog" aria-label="Get a ship" onClick={(e) => e.stopPropagation()}>
        <div className="pl-build-head">
          <b>Get a ship</b>
          <div className="pl-hand pl-hand-small">
            {RESOURCES.map((r) => (
              <span key={r} className="pl-card-count">
                <ResourceIcon r={r} size={15} />
                <b>{me.hand[r]}</b>
              </span>
            ))}
          </div>
          <button className="pl-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="pl-build-row">
          <div className="pl-build-text">
            <b>Build one</b> <Cost cost={COSTS.ship} />
          </div>
          <button
            className="pl-btn pl-btn-small"
            disabled={!canAfford(me.hand, COSTS.ship)}
            onClick={() => onPick("build")}
          >
            {canAfford(me.hand, COSTS.ship) ? "Build" : "Not enough"}
          </button>
        </div>
        <div className="pl-build-row">
          <div className="pl-build-text">
            <b>Pay gold</b> <Cost cost={{ gold: GOLD_TO_BURY }} />
          </div>
          <button className="pl-btn pl-btn-small" disabled={me.hand.gold < GOLD_TO_BURY} onClick={() => onPick("gold")}>
            {me.hand.gold < GOLD_TO_BURY ? "Not enough" : "Pay"}
          </button>
        </div>
        <div className="pl-build-row">
          <div className="pl-build-text">
            <b>Trade a Plunder Point card</b>
            <small>You have {me.plunderCards}</small>
          </div>
          <button className="pl-btn pl-btn-small" disabled={me.plunderCards < 1} onClick={() => onPick("plunder")}>
            {me.plunderCards < 1 ? "None" : "Trade"}
          </button>
        </div>
        <div className="pl-build-row">
          <div className="pl-build-text">
            <b>Give up an island</b>
            <small>Remove your flag from one of your islands</small>
          </div>
          {!owned.length && (
            <button className="pl-btn pl-btn-small" disabled>
              None
            </button>
          )}
        </div>
        {owned.length > 0 && (
          <div className="pl-build-ships">
            {owned.map((i) => (
              <button key={i.id} className="pl-chip" onClick={() => onPick({ disown: i.id })}>
                Island at {squareName(i.squares[0])} ({i.skulls}☠)
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoticeDialog({ notice, game, onOk }: { notice: Notice; game: GameState; onOk: () => void }) {
  if (notice.t === "battle") {
    return (
      <div className="pl-sheet-backdrop pl-centered">
        <BattleCard battle={notice} game={game}>
          <button className="pl-btn pl-btn-main pl-btn-wide" onClick={onOk}>
            OK
          </button>
        </BattleCard>
      </div>
    );
  }
  return (
    <div className="pl-sheet-backdrop pl-centered">
      <div className="pl-dialog" role="alertdialog">
        {notice.t === "doubles" ? (
          <>
            <p className="pl-dialog-title">{notice.dice[0] === notice.dice[1] ? "Doubles!" : "No doubles"}</p>
            <div className="pl-battle-dice">
              <Die value={notice.dice[0]} />
              <Die value={notice.dice[1]} />
            </div>
            <p>
              {notice.dice[0] === notice.dice[1]
                ? "You get a new ship. Tap a green square to place it."
                : "You can still get a ship another way, or end your turn."}
            </p>
          </>
        ) : notice.t === "storm" ? (
          <>
            <p className="pl-dialog-title">The storm moves!</p>
            <p>A 1 was rolled, so the storm moves to {squareName(notice.at)}. You still sail 1 square.</p>
          </>
        ) : notice.t === "treasure" ? (
          <>
            <p className="pl-dialog-title">Treasure!</p>
            <p>
              {game.players[notice.player].name} found a Treasure card. Treasure cards haven&rsquo;t been made yet, so
              nothing happens for now.
            </p>
          </>
        ) : notice.t === "drew" ? (
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
        ) : null}
        <button className="pl-btn pl-btn-main pl-btn-wide" onClick={onOk}>
          OK
        </button>
      </div>
    </div>
  );
}
