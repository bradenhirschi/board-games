"use client";

import { useState } from "react";
import {
  RESOURCES,
  cardsText,
  type Cards,
  type Found,
  type GameState,
  type Resource,
  type TreasureAction,
  type TreasureNeed,
} from "@/games/plunder/lib/engine";
import { TREASURE_CARDS, type TreasureId } from "@/games/plunder/lib/treasureCards";
import { COLOR_HEX, RESOURCE_NAMES, ResourceIcon } from "./Pieces";

/** A Treasure card as printed: a red brushed banner with the title, the story in italics, then what to do. */
export function TreasureCard({ card, small }: { card: TreasureId; small?: boolean }) {
  const c = TREASURE_CARDS[card];
  return (
    <div className={`pl-tcard${small ? " pl-tcard-small" : ""}`} role="img" aria-label={`Treasure card: ${c.title}`}>
      <div className="pl-tcard-rule" aria-hidden />
      <div className="pl-tcard-banner">
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
          <path d="M0 6 C8 2 14 7 22 4 S38 1 46 5 S62 2 70 4 S88 1 100 5 L100 25 C92 29 84 23 76 27 S58 24 50 28 S32 23 24 27 S8 24 0 26 Z" />
        </svg>
        <span>{c.title}</span>
      </div>
      <p className="pl-tcard-flavor">{c.flavor}</p>
      <div className="pl-tcard-text">
        {c.text.map((line, i) =>
          line === "OR" ? (
            <span key={i} className="pl-tcard-or">
              OR
            </span>
          ) : (
            <span key={i}>{line}</span>
          ),
        )}
      </div>
      <div className="pl-tcard-rule pl-tcard-rule-bottom" aria-hidden />
    </div>
  );
}

/** Does this need get answered by tapping the board (ships, squares, islands)? */
export function boardNeed(n: TreasureNeed | null): boolean {
  return !!n && ["ship", "shipTo", "square", "shipSquare", "shipPath", "islands"].includes(n.k);
}

/** What to tap, for the status line while a Treasure card is answered on the board. */
export function treasurePrompt(n: TreasureNeed, picked: { ship?: number; island?: string }): string {
  switch (n.k) {
    case "ship":
      return n.enemy ? "Tap an enemy ship to lose a life" : "Tap the ship that gets it";
    case "shipTo":
      return picked.ship === undefined
        ? "Tap the enemy ship to steal a life from"
        : "Tap your ship to give it the life";
    case "square":
      return "Tap a green port to sail your ship there";
    case "shipSquare":
      return picked.ship === undefined ? "Tap an enemy ship" : "Tap a green square in the storm";
    case "shipPath":
      return picked.ship === undefined ? "Tap an enemy ship to drive off" : "Tap where it goes (up to 3 squares)";
    case "islands":
      return picked.island === undefined ? "Tap one of your islands to give up" : "Tap the enemy island you take";
    default:
      return "";
  }
}

const ROLL_MS = 550;
const d6 = () => 1 + Math.floor(Math.random() * 6);

/**
 * The Treasure card waiting on a choice. On this device's turn to choose it shows the card with the
 * choice (or, for choices made on the board, a button to go and make it); otherwise it just shows
 * who is choosing.
 */
export function TreasureDialog({
  game,
  found,
  need,
  canChoose,
  onAct,
  onBoard,
}: {
  game: GameState;
  found: Found;
  need: TreasureNeed;
  /** This device makes the choice (otherwise the card just shows who's deciding). */
  canChoose: boolean;
  onAct: (a: TreasureAction) => void;
  /** Hide the card to pick on the board. */
  onBoard: () => void;
}) {
  const [rolling, setRolling] = useState(false);
  const [picked, setPicked] = useState<Cards>({});
  const finder = game.players[found.player];
  const chooser = need.k === "bribe" ? game.players[need.from] : finder;
  const roll = (a: (dice: [number, number]) => TreasureAction) => {
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      onAct(a([d6(), d6()]));
    }, ROLL_MS);
  };
  const name = (p: number) => game.players[p].name;
  const dot = (p: number) => <span className="pl-dot" style={{ background: COLOR_HEX[game.players[p].color] }} />;

  let body: React.ReactNode = null;
  if (!canChoose) {
    body = <p className="pl-tcard-wait">{chooser.name} is deciding…</p>;
  } else if (boardNeed(need)) {
    body = (
      <div className="pl-actions">
        {need.k === "islands" && (
          <button className="pl-btn" onClick={() => onAct({ t: "treasure", accept: false })}>
            Keep my islands
          </button>
        )}
        <button className="pl-btn pl-btn-main" onClick={onBoard}>
          Choose on the board
        </button>
      </div>
    );
  } else if (need.k === "player") {
    body = (
      <>
        <p>{need.roll ? "Who do you challenge?" : "Choose an enemy player:"}</p>
        <div className="pl-tcard-players">
          {need.players.map((p) => (
            <button
              key={p}
              className="pl-btn"
              disabled={rolling}
              onClick={() =>
                need.roll ? roll((dice) => ({ t: "treasure", player: p, dice })) : onAct({ t: "treasure", player: p })
              }
            >
              {dot(p)} {name(p)}
            </button>
          ))}
        </div>
        {rolling && <p>Rolling…</p>}
      </>
    );
  } else if (need.k === "resource") {
    body = (
      <>
        <p>Which resource do they hand over?</p>
        <div className="pl-hand">
          {RESOURCES.map((r) => (
            <button
              key={r}
              className="pl-card-count pl-card-pick"
              onClick={() => onAct({ t: "treasure", resource: r })}
            >
              <ResourceIcon r={r} />
              {RESOURCE_NAMES[r]}
            </button>
          ))}
        </div>
      </>
    );
  } else if (need.k === "roll") {
    body = (
      <button
        className="pl-btn pl-btn-main pl-btn-wide"
        disabled={rolling}
        onClick={() => roll((dice) => ({ t: "treasure", dice }))}
      >
        {rolling ? "Rolling…" : "Roll the die"}
      </button>
    );
  } else if (need.k === "choose") {
    body = (
      <>
        {found.offer && (
          <p>
            {name(found.target!)} offers {cardsText(found.offer)}.
          </p>
        )}
        <div className="pl-tcard-choices">
          <button className="pl-btn" onClick={() => onAct({ t: "treasure", accept: true })}>
            {need.yes}
          </button>
          <button className="pl-btn" onClick={() => onAct({ t: "treasure", accept: false })}>
            {need.no}
          </button>
        </div>
      </>
    );
  } else if (need.k === "cards" || need.k === "bribe") {
    const hand = game.players[need.k === "bribe" ? need.from : found.player].hand;
    const total = RESOURCES.reduce((n, r) => n + (picked[r] ?? 0), 0);
    const max = need.k === "cards" ? need.n : Infinity;
    const change = (r: Resource, d: number) =>
      setPicked((p) => ({ ...p, [r]: Math.max(0, Math.min(hand[r], (p[r] ?? 0) + d)) }));
    body = (
      <>
        <p>
          {need.k === "cards"
            ? `You rolled ${found.lose}: choose ${need.n} cards to lose.`
            : `${name(need.to)} played White Flag on you. Offer a bribe, or one of your ships loses a life.`}
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
              <b>{picked[r] ?? 0}</b>
              <button
                className="pl-close"
                aria-label={`One more ${r}`}
                disabled={(picked[r] ?? 0) >= hand[r] || total >= max}
                onClick={() => change(r, 1)}
              >
                +
              </button>
            </div>
          ))}
        </div>
        <div className="pl-actions">
          {need.k === "bribe" && (
            <button className="pl-btn" onClick={() => onAct({ t: "treasure", accept: false })}>
              No bribe
            </button>
          )}
          <button
            className="pl-btn pl-btn-main"
            disabled={need.k === "cards" ? total !== need.n : total === 0}
            onClick={() =>
              need.k === "cards"
                ? onAct({ t: "treasure", cards: RESOURCES.flatMap((r) => Array<Resource>(picked[r] ?? 0).fill(r)) })
                : onAct({ t: "treasure", give: picked })
            }
          >
            {need.k === "cards" ? `Lose ${total}/${need.n}` : "Offer bribe"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className={`pl-sheet-backdrop pl-centered${canChoose ? "" : " pl-passive"}`}>
      <div className="pl-dialog pl-tdialog" role="alertdialog" aria-label="Treasure card">
        <p className="pl-tdialog-who">
          {dot(found.player)} {finder.name} found treasure!
        </p>
        {/* The bribe form needs the room on a phone; the card is shown in brief there. */}
        {need.k === "bribe" && canChoose ? (
          <p className="pl-dialog-title">{TREASURE_CARDS[found.card].title}</p>
        ) : (
          <TreasureCard card={found.card} small={need.k === "cards"} />
        )}
        {body}
      </div>
    </div>
  );
}

/** The card and what came of it. */
export function TreasureResult({
  game,
  card,
  player,
  result,
  onOk,
}: {
  game: GameState;
  card: TreasureId;
  player: number;
  result: string[];
  onOk?: () => void;
}) {
  return (
    <div className={`pl-sheet-backdrop pl-centered${onOk ? "" : " pl-passive"}`}>
      <div className="pl-dialog pl-tdialog" role="alertdialog" aria-label="Treasure card">
        <p className="pl-tdialog-who">
          <span className="pl-dot" style={{ background: COLOR_HEX[game.players[player].color] }} />{" "}
          {game.players[player].name} found treasure!
        </p>
        <TreasureCard card={card} small />
        <div className="pl-tdialog-result">
          {result.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        {onOk && (
          <button className="pl-btn pl-btn-main pl-btn-wide" onClick={onOk}>
            OK
          </button>
        )}
      </div>
    </div>
  );
}
