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
  atMerchant,
  attackTargets,
  threatTargets,
  tradePartners,
  waitingOn,
  stormToll,
  canAfford,
  defenseBonus,
  winChance,
  islandsOf,
  points,
  reachable,
  shipSpots,
  startingIslands,
  treasureNeed,
  nudgeReach,
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
import { CrewRow, CrewSide, Standings } from "./Crew";
import TradePanel from "./Trade";
import { TreasureDialog, TreasureResult, boardNeed, treasurePrompt } from "./Treasure";
import {
  COLOR_HEX,
  Flag,
  RESOURCE_NAMES,
  ResourceIcon,
  ShipPiece,
  SkullIcon,
  SquareMark,
  SwordsIcon,
  StormPiece,
  XMark,
} from "./Pieces";

const same = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;
const key = (p: Pos) => `${p.r},${p.c}`;

/** Where to plant an island's flag: one of its land squares that isn't a port. */
function flagSpot(squares: Pos[], ports: Pos[]): Pos {
  return squares.find((p) => !ports.some((q) => same(p, q))) ?? squares[0];
}

type Props = {
  game: GameState;
  /** Apply an action (pass-and-play: locally; online: saved to the room). Dice are already filled in. */
  onAct: (a: Action) => void;
  /** Dismiss the first notice (notices are local: each device clears its own). */
  onDismiss: () => void;
  /** The "New game" button once the game is won (online, for its players: "Play again", back to the lobby). */
  onNewGame: () => void;
  /** Pass-and-play: the person holding the device (after tapping through the hand-over cover). */
  holder?: number | null;
  onHolder?: (player: number) => void;
  /**
   * Online: the seat this device plays (null when only watching). Left out for pass-and-play,
   * where the device plays every person and the bots.
   */
  seat?: number | null;
  /** Online: a move is saving or being replayed, so wait before acting. */
  locked?: boolean;
  /** Shown in the strip, e.g. the room code. */
  note?: string;
  /** The ☰ button over the board on phones (leave the game or room). */
  onMenu: () => void;
};

/** How long a bot pauses before each move, so people can follow it. */
const BOT_STEP_MS = 750;
/** How long a bot's news stays on screen before it carries on. */
const BOT_NOTICE_MS: Record<Notice["t"], number> = {
  deal: 1800,
  noDeal: 1600,
  treasure: 3400,
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

export default function PlunderGame({
  game,
  onAct,
  onDismiss,
  onNewGame,
  holder = null,
  onHolder = () => {},
  seat,
  locked = false,
  note,
  onMenu,
}: Props) {
  const online = seat !== undefined;
  /** Can the person at this device act for player `p`? */
  const canControl = (p: number) => (online ? p === seat : !game.players[p].isBot);
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
  /** An upgrade chosen in the build sheet, waiting for the player to tap the ship it goes on. */
  const [upgrading, setUpgrading] = useState<"mast" | "cannon" | "life" | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [standings, setStandings] = useState(false);

  const s = game;
  // Online, the room holds back a move made during a replay until the board has caught up.
  const act = (a: Action) => onAct(a);
  const phase = s.phase;
  const current = phase.t === "pickIsland" ? phase.order[phase.index] : s.turn;
  const me = s.players[current];
  const myShips = s.ships.filter((sh) => sh.owner === current);
  const ship: Ship | undefined = s.ships.find((sh) => sh.id === selected && sh.owner === current) ?? undefined;
  // "isBot": the current player isn't played from this device (a bot, or online someone else).
  const isBot = !canControl(current);
  // Who the game is waiting on: usually the current player, but someone answering an offer or
  // deciding on a bribe acts in the middle of another player's turn.
  const actor = phase.t === "gameOver" ? current : waitingOn(s);
  const actorBot = !!s.players[actor].isBot;
  // Online, bots are played by any seated device (the room keeps only the first save).
  const drivesBots = !online || seat !== null;
  const humans = s.players.filter((p) => !p.isBot).length;
  // Cover the screen when the device passes between people. Bots don't need it, nor does a lone human.
  const covered = !online && !actorBot && phase.t !== "gameOver" && humans > 1 && holder !== actor;
  const notice: Notice | undefined = covered ? undefined : s.notices[0];
  // News that shows for a moment and moves on: anything from a bot's turn, and finished deals.
  // News about someone not played from this device also passes by on its own (a bot's card draw
  // at the start of its turn isn't shown at all).
  const botNotice = !!notice && !canControl(notice.player);
  const passing = !!notice && (botNotice || notice.t === "deal" || notice.t === "noDeal");
  const negotiating = !!s.trade || s.pendingAttack?.stage === "bribe";
  // A Treasure card waiting on a choice (this device's, or someone else's to watch).
  const found = phase.t === "turn" ? (s.found?.[0] ?? null) : null;
  const tNeed = useMemo(() => (found ? treasureNeed(s) : null), [s, found]);
  const myTreasure = !!found && !!tNeed && canControl(actor) && !covered;
  // Choices made on the board: the card steps aside, and a first tap (an enemy ship, your island) is
  // remembered here until the second. Reset whenever a different card (or stage) is up.
  const tKey = found ? `${s.log.length}:${found.card}:${found.stage ?? ""}:${found.lose ?? ""}` : "";
  const [tPickState, setTPick] = useState<{ key: string; onBoard: boolean; ship?: number; island?: string }>({
    key: "",
    onBoard: false,
  });
  const tPick = tPickState.key === tKey ? tPickState : { key: tKey, onBoard: false };
  const pickOnBoard = myTreasure && boardNeed(tNeed) && tPick.onBoard;
  const [tradeOpen, setTradeOpen] = useState(false);

  useEffect(() => {
    if (!passing) return;
    const t = window.setTimeout(onDismiss, BOT_NOTICE_MS[notice!.t]);
    return () => window.clearTimeout(t);
  }, [passing, notice, onDismiss]);

  // Bots play by themselves, one visible step at a time (including answering offers on others' turns).
  useEffect(() => {
    if (!actorBot || !drivesBots || locked || phase.t === "gameOver" || rolling || moving || notice) return;
    const a = botAction(s);
    if (!a) return;
    const t = window.setTimeout(
      () => {
        // Online, every device animates the bot's move as it arrives, so just send it.
        if (online) return onAct(fillDice(a, d6));
        if (a.t === "sail") return animateSail(a.ship, a.path, () => onAct(a));
        const filled = fillDice(a, d6);
        if (filled === a) return onAct(a);
        // Dice to roll: let them tumble first.
        setRolling(true);
        window.setTimeout(() => {
          setRolling(false);
          onAct(filled);
        }, ROLL_MS);
      },
      // Online, several devices may try to play the bot: spread them out a little.
      online ? BOT_STEP_MS + Math.random() * 600 : BOT_STEP_MS,
    );
    return () => window.clearTimeout(t);
  }, [s, actorBot, drivesBots, locked, online, phase.t, notice, onAct, rolling, moving]);

  // A person's attack on a player who chose to fight (or whose bribe was refused): roll it.
  const fight = s.pendingAttack?.stage === "fight" && !isBot && actor === s.turn ? s.pendingAttack : null;
  useEffect(() => {
    // Wait until the device has caught up (online, the other player's choice may still be replaying).
    if (!fight || rolling || covered || locked) return;
    const t = window.setTimeout(() => {
      setRolling(true);
      window.setTimeout(() => {
        setRolling(false);
        act({ t: "attack", ship: fight.ship, target: fight.target, attackDie: d6(), defenseDie: d6() });
      }, ROLL_MS);
    }, 300);
    return () => window.clearTimeout(t);
    // `act` is recreated each render; the fight is keyed by the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, fight, rolling, covered, locked]);

  const reach = useMemo(
    // Only for ships played from this device.
    () => (ship && phase.t === "turn" && !isBot && !found ? reachable(s, ship) : new Map<string, Pos[]>()),
    [s, ship, phase.t, isBot, found],
  );
  const spots = useMemo(() => (placing ? shipSpots(s, current) : []), [s, placing, current]);
  // The player's ships that can take the chosen upgrade.
  const upgradable = upgrading ? myShips.filter((sh) => canUpgrade(sh, upgrading)) : [];
  const startIsles = useMemo(
    () => (phase.t === "pickIsland" ? startingIslands(s.layout).filter((i) => s.owners[i.id] === undefined) : []),
    [s, phase.t],
  );
  const allIslands = useMemo(() => islandsOf(s.layout), [s.layout]);
  const targets = useMemo(() => (ship && !isBot && !found ? attackTargets(s, ship) : []), [s, ship, isBot, found]);
  // X tokens by square (several can share one). One under a ship shows as a badge on the ship.
  const xStacks = useMemo(() => {
    const stacks = new Map<string, { at: Pos; count: number; underShip: boolean }>();
    for (const x of s.xs) {
      const st = stacks.get(key(x));
      if (st) st.count++;
      else stacks.set(key(x), { at: x, count: 1, underShip: s.ships.some((sh) => same(sh.pos, x)) });
    }
    return [...stacks.values()];
  }, [s.xs, s.ships]);
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
    // Attacking a player: they get to offer a bribe first (the dice roll only if they fight).
    const victim = t.kind === "ship" ? s.ships.find((sh) => sh.id === t.id)?.owner : s.owners[t.id];
    if (victim !== undefined) return act({ t: "attack", ship: ship.id, target: t, attackDie: 1, defenseDie: 1 });
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

  /** Squares to highlight while a Treasure card is answered on the board. */
  const tMarks = useMemo((): { at: Pos; kind: "place" | "attack" | "reach" }[] => {
    if (!pickOnBoard || !tNeed) return [];
    const shipPos = (ids: number[], kind: "place" | "attack") =>
      s.ships.filter((sh) => ids.includes(sh.id)).map((sh) => ({ at: sh.pos, kind }));
    const isles = (ids: string[], kind: "place" | "attack") =>
      allIslands.filter((i) => ids.includes(i.id)).flatMap((i) => i.squares.map((at) => ({ at, kind })));
    switch (tNeed.k) {
      case "ship":
        return shipPos(tNeed.ships, tNeed.enemy ? "attack" : "place");
      case "shipTo":
        return tPick.ship === undefined ? shipPos(tNeed.ships, "attack") : shipPos(tNeed.to, "place");
      case "square":
        return tNeed.squares.map((at) => ({ at, kind: "place" }));
      case "shipSquare":
        return tPick.ship === undefined
          ? shipPos(tNeed.ships, "attack")
          : tNeed.squares.map((at) => ({ at, kind: "place" }));
      case "shipPath":
        return tPick.ship === undefined
          ? shipPos(tNeed.ships, "attack")
          : [...nudgeReach(s, tPick.ship).values()].map((path) => ({ at: path[path.length - 1], kind: "reach" }));
      case "islands":
        return tPick.island === undefined ? isles(tNeed.mine, "place") : isles(tNeed.theirs, "attack");
      default:
        return [];
    }
  }, [s, pickOnBoard, tNeed, tPick.ship, tPick.island, allIslands]);

  /** A tap on the board while answering a Treasure card there. */
  function treasureTap(p: Pos) {
    if (!tNeed) return;
    const tapped = s.ships.find((sh) => same(sh.pos, p));
    const send = (a: Omit<Extract<Action, { t: "treasure" }>, "t">) => act({ t: "treasure", ...a });
    const remember = (patch: { ship?: number; island?: string }) => setTPick({ ...tPick, ...patch });
    switch (tNeed.k) {
      case "ship":
        if (tapped && tNeed.ships.includes(tapped.id)) send({ ship: tapped.id });
        return;
      case "shipTo":
        if (tapped && tNeed.ships.includes(tapped.id)) {
          if (!tNeed.to.length) send({ ship: tapped.id });
          else remember({ ship: tapped.id });
        } else if (tapped && tPick.ship !== undefined && tNeed.to.includes(tapped.id))
          send({ ship: tPick.ship, to: tapped.id });
        return;
      case "square":
        if (tNeed.squares.some((q) => same(q, p))) send({ at: p });
        return;
      case "shipSquare":
        if (tapped && tNeed.ships.includes(tapped.id)) remember({ ship: tapped.id });
        else if (tPick.ship !== undefined && tNeed.squares.some((q) => same(q, p))) send({ ship: tPick.ship, at: p });
        return;
      case "shipPath": {
        if (tapped && tNeed.ships.includes(tapped.id)) return remember({ ship: tapped.id });
        const path = tPick.ship !== undefined ? nudgeReach(s, tPick.ship).get(key(p)) : undefined;
        if (path) send({ ship: tPick.ship, path });
        return;
      }
      case "islands": {
        const isl = allIslands.find((i) => i.squares.some((q) => same(q, p)) || i.ports.some((q) => same(q, p)));
        if (!isl) return;
        if (tNeed.mine.includes(isl.id)) remember({ island: isl.id });
        else if (tPick.island !== undefined && tNeed.theirs.includes(isl.id))
          send({ island: tPick.island, theirs: isl.id });
        return;
      }
    }
  }

  function onSquareTap(p: Pos) {
    if (pickOnBoard && !locked && !moving) {
      treasureTap(p);
      return;
    }
    if (found) return;
    if (covered || isBot || locked || rolling || moving || negotiating || tradeOpen) return;
    if (captainSpots.some((q) => same(q, p))) {
      act({ t: "placeShip", at: p });
      return;
    }
    // Choosing a ship to upgrade or a spot for a new ship: taps only do that. (Checked before
    // attacks: a ship in an island's port sits on one of the island's squares.)
    if (phase.t === "turn" && upgrading) {
      const target = upgradable.find((sh) => same(sh.pos, p));
      if (target) {
        act({ t: "build", item: upgrading, ship: target.id });
        setUpgrading(null);
      }
      return;
    }
    if (phase.t === "turn" && placing) {
      if (spots.some((q) => same(q, p))) {
        act({ t: "build", item: "ship", at: p });
        setPlacing(false);
      }
      return;
    }
    // Tapping your own ship selects it, even in the port of an island you could attack.
    const tapped = s.ships.find((sh) => same(sh.pos, p));
    if (phase.t === "turn" && tapped && tapped.owner === current) {
      setSelected(tapped.id === selected ? null : tapped.id);
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

  // The cards shown: online, always your own; pass-and-play, the current person's (hidden behind the cover).
  const viewerHand = online
    ? seat !== null && seat !== undefined
      ? s.players[seat].hand
      : null
    : covered || isBot
      ? null
      : me.hand;

  const focus = ship?.pos ?? (phase.t === "turn" && myShips[0] ? myShips[0].pos : null);

  // What the strip under the board says.
  let status: string;
  if (isBot && phase.t !== "gameOver" && !me.isBot) status = `${me.name}'s turn${note ? ` · ${note}` : ""}`;
  else if (isBot && phase.t !== "gameOver")
    status = rolling ? "Rolling…" : phase.t === "pickIsland" ? "Choosing an island…" : "Thinking…";
  else if (phase.t === "pickIsland") status = "Pick your starting island";
  else if (phase.t === "gameOver") status = `${s.players[phase.winner].name} wins!`;
  else if (rolling) status = "Rolling…";
  else if (pickOnBoard && tNeed) status = treasurePrompt(tNeed, tPick);
  else if (found) status = "Treasure!";
  else if (upgrading) status = `Tap a ship to give it ${upgrading === "life" ? "an extra life" : `a ${upgrading}`}`;
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

  // Online, "you" is this device's seat; pass-and-play, the chips leave out whoever the strip shows.
  const you = online ? (seat ?? null) : null;

  return (
    <>
      <CrewRow game={s} hide={online ? you : current} onMenu={onMenu} onOpen={() => setStandings(true)} />
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
        {upgradable.map((sh) => (
          <SquareMark key={`u${sh.id}`} at={sh.pos} kind="place" />
        ))}
        {[...spots, ...captainSpots].map((p) => (
          <SquareMark key={`p${key(p)}`} at={p} kind="place" />
        ))}
        {targets.flatMap((t) =>
          targetSquares(t).map((p) => <SquareMark key={`a${t.kind}${t.id}${key(p)}`} at={p} kind="attack" />),
        )}
        {tMarks.map((m) => (
          <SquareMark key={`t${key(m.at)}`} at={m.at} kind={m.kind} />
        ))}
        {xStacks
          .filter((st) => !st.underShip)
          .map((st) => (
            <XMark key={`x${key(st.at)}`} at={st.at} count={st.count} />
          ))}
        {s.ships.map((sh) => (
          <ShipPiece
            key={sh.id}
            ship={sh}
            color={s.players[sh.owner].color}
            selected={!isBot && sh.id === ship?.id}
            at={moving?.ship === sh.id ? moving.pos : undefined}
          />
        ))}
        {xStacks
          .filter((st) => st.underShip)
          .map((st) => (
            <XMark key={`xb${key(st.at)}`} at={st.at} count={st.count} badge />
          ))}
      </Board>

      <section className="pl-controls" aria-label="Your turn">
        <div className="pl-strip">
          <span className="pl-dot" style={{ background: COLOR_HEX[me.color] }} />
          <span className="pl-strip-name">{me.name}</span>
          <button className="pl-strip-points" onClick={() => setStandings(true)} aria-label="Show the standings">
            {points(s, current)}/{WIN_POINTS} pts
          </button>
          {phase.t === "turn" && phase.roll !== null && <Die value={phase.roll} />}
        </div>
        {/* While there's something to attack, the attack buttons say it all (and the space is needed). */}
        {!(targets.length > 0 && !placing && !upgrading) && <p className="pl-status">{status}</p>}

        {phase.t !== "pickIsland" && (
          <div className="pl-hand" aria-label="Your cards">
            {/* Online, the cards are always yours: say so while someone else is playing. */}
            {online && seat !== null && seat !== undefined && seat !== current && (
              <span className="pl-hand-you">
                <span className="pl-dot" style={{ background: COLOR_HEX[s.players[seat].color] }} />
                You
              </span>
            )}
            {RESOURCES.map((r) => (
              <span key={r} className="pl-card-count" title={RESOURCE_NAMES[r]}>
                <ResourceIcon r={r} />
                <b>{viewerHand ? viewerHand[r] : "–"}</b>
              </span>
            ))}
          </div>
        )}

        {targets.length > 0 && !placing && !upgrading && (
          <div className="pl-attacks">
            {targets.map((t) => {
              const chance = Math.round(winChance(ship!.cannons, defenseBonus(s, t)) * 100);
              const isl = t.kind === "island" ? allIslands.find((i) => i.id === t.id) : undefined;
              const owner = t.kind === "ship" ? s.ships.find((sh) => sh.id === t.id)!.owner : s.owners[t.id];
              const label =
                t.kind === "ship" ? (
                  `${s.players[owner!].name}'s ship`
                ) : (
                  <>
                    {owner === undefined ? "Island" : `${s.players[owner].name}'s island`} ({isl?.skulls ?? 0}
                    <SkullIcon />)
                  </>
                );
              return (
                <button
                  key={`${t.kind}${t.id}`}
                  className="pl-btn pl-btn-attack"
                  disabled={rolling}
                  onClick={() => attack(t)}
                >
                  <SwordsIcon /> {label} <small>{chance}%</small>
                </button>
              );
            })}
          </div>
        )}

        {pickOnBoard && tNeed && (
          <div className="pl-actions">
            <button className="pl-btn" onClick={() => setTPick({ key: tKey, onBoard: false })}>
              See the card
            </button>
            {tNeed.k === "islands" && (
              <button className="pl-btn" onClick={() => act({ t: "treasure", accept: false })}>
                Keep my islands
              </button>
            )}
            {tNeed.k === "shipPath" && tPick.ship !== undefined && (
              <button className="pl-btn" onClick={() => act({ t: "treasure", ship: tPick.ship, path: [] })}>
                Leave it
              </button>
            )}
          </div>
        )}

        {captain && !isBot && !captainSpots.length && !found && (
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

        {phase.t === "turn" && !isBot && !captain && !found && (
          <div className="pl-actions">
            {placing || upgrading ? (
              <button
                className="pl-btn pl-btn-wide"
                onClick={() => {
                  setPlacing(false);
                  setUpgrading(null);
                }}
              >
                Cancel
              </button>
            ) : (
              <>
                <button className="pl-btn" onClick={() => setBuildOpen(true)}>
                  Build
                </button>
                <button
                  className="pl-btn"
                  disabled={
                    !tradePartners(s, current).length && !atMerchant(s, current) && !threatTargets(s, current).length
                  }
                  onClick={() => setTradeOpen(true)}
                >
                  Trade
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
              {online && seat !== null ? "Play again" : "New game"}
            </button>
          </div>
        )}
        <CrewSide game={s} you={you} />
      </section>

      {standings && <Standings game={s} you={you} onClose={() => setStandings(false)} />}

      {buildOpen && phase.t === "turn" && (
        <BuildSheet
          game={s}
          player={current}
          ships={myShips}
          onBuild={(item) => {
            setBuildOpen(false);
            if (item === "ship") setPlacing(true);
            else setUpgrading(item);
          }}
          onBury={() => act({ t: "bury" })}
          onClose={() => setBuildOpen(false)}
        />
      )}

      {(tradeOpen || negotiating) && !covered && phase.t === "turn" && (
        <TradePanel
          key={`${actor}:${s.trade?.kind}:${s.trade?.from}:${s.trade ? JSON.stringify(s.trade.answers) : ""}:${tradeOpen}`}
          game={s}
          viewer={online ? (seat ?? null) : actor}
          start={tradeOpen && !negotiating ? "trade" : null}
          onAct={act}
          onClose={() => setTradeOpen(false)}
        />
      )}

      {covered && (
        <div className="pl-cover" role="dialog" aria-label="Pass the device">
          <span className="pl-dot pl-dot-big" style={{ background: COLOR_HEX[s.players[actor].color] }} />
          <p className="pl-cover-title">Pass the device to {s.players[actor].name}</p>
          {actor !== current && (
            <p className="pl-cover-sub">
              {found
                ? `${me.name} played White Flag on you. Bribe, or lose a life?`
                : s.trade
                  ? `${s.players[s.trade.from].name} has an offer for you.`
                  : `${me.name} is attacking you! Bribe or fight?`}
            </p>
          )}
          <button className="pl-btn pl-btn-main" onClick={() => onHolder(actor)}>
            I&rsquo;m {s.players[actor].name}
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

      {found && tNeed && !notice && !covered && !pickOnBoard && (
        <TreasureDialog
          key={tKey}
          game={s}
          found={found}
          need={tNeed}
          canChoose={myTreasure && !locked}
          onAct={act}
          onBoard={() => setTPick({ key: tKey, onBoard: true })}
        />
      )}
      {notice && notice.t === "treasure" && (
        <TreasureResult
          game={s}
          card={notice.card}
          player={notice.player}
          result={notice.result}
          onOk={botNotice ? undefined : onDismiss}
        />
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
      {notice && (notice.t === "deal" || notice.t === "noDeal") && (
        <div className="pl-toast" role="status">
          {notice.t === "deal"
            ? notice.kind === "bribe"
              ? `${s.players[notice.with].name} took ${s.players[notice.player].name}'s bribe`
              : notice.kind === "threat"
                ? `${s.players[notice.with].name} gave in to ${s.players[notice.player].name}`
                : `${s.players[notice.player].name} traded with ${s.players[notice.with].name}`
            : notice.kind === "bribe"
              ? "Bribe refused!"
              : notice.kind === "threat"
                ? "Threat refused!"
                : `Nobody took ${s.players[notice.player].name}'s offer`}
        </div>
      )}
      {notice && !botNotice && !passing && <NoticeDialog notice={notice} game={s} onOk={onDismiss} />}
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

/** Can this ship take another of this upgrade? */
function canUpgrade(ship: Ship, item: "mast" | "cannon" | "life"): boolean {
  if (item === "mast") return ship.masts < MAX_MASTS;
  if (item === "cannon") return ship.cannons < MAX_CANNONS;
  return ship.lives < MAX_LIVES;
}

function BuildSheet({
  game,
  player,
  ships,
  onBuild,
  onBury,
  onClose,
}: {
  game: GameState;
  player: number;
  ships: Ship[];
  onBuild: (item: Build) => void;
  onBury: () => void;
  onClose: () => void;
}) {
  const hand = game.players[player].hand;
  const why = (item: Build): string | null => {
    if (item === "ship") {
      if (ships.length >= MAX_SHIPS) return `${MAX_SHIPS} ships max`;
      if (!shipSpots(game, player).length) return "Nowhere to place it";
    } else {
      // An upgrade needs at least one ship with room for it (the player then taps which).
      if (!ships.length) return "No ship";
      if (!ships.some((sh) => canUpgrade(sh, item))) {
        return item === "mast"
          ? `${MAX_MASTS} masts max`
          : item === "cannon"
            ? `${MAX_CANNONS} cannons max`
            : "Lives full";
      }
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
        {BUILD_ITEMS.map(({ item, name, what }) => {
          const blocked = why(item);
          return (
            <div key={item} className="pl-build-row">
              <div className="pl-build-text">
                <b>{name}</b> <Cost cost={COSTS[item]} />
                <small>{what}</small>
              </div>
              <button className="pl-btn pl-btn-small" disabled={!!blocked} onClick={() => onBuild(item)}>
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
                Island at {squareName(i.squares[0])} ({i.skulls}
                <SkullIcon />)
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoticeDialog({ notice, game, onOk }: { notice: Notice; game: GameState; onOk: () => void }) {
  if (notice.t === "treasure") return null;
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
