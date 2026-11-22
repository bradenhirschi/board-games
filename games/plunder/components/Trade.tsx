"use client";

import { useState } from "react";
import {
  RESOURCES,
  atMerchant,
  cardCount,
  hasCards,
  threatTargets,
  tradePartners,
  waitingOn,
  type Action,
  type Cards,
  type GameState,
  type Hand,
  type Resource,
} from "@/games/plunder/lib/engine";
import { COLOR_HEX, RESOURCE_NAMES, ResourceIcon } from "./Pieces";

/**
 * The trading panel, laid out like a phone card-game trade screen: a row of resources to ask for,
 * two rows showing what each side gives, the player's own hand to offer from, and a column of big
 * buttons on the right. It covers the lower part of the screen; a chevron folds it down to its
 * header to look at the board.
 *
 * Modes:
 * - compose: the current player builds a trade (or a threat), or anyone builds a counter-offer.
 * - bribe: a player about to be attacked builds a bribe, or chooses to fight.
 * - respond: the player being asked accepts, declines or counters.
 * - review: the offerer picks one of those who accepted, or withdraws.
 * - watch: someone else (often a bot) is answering.
 */

type Compose = { mode: "trade" | "threat" | "counter"; want: Cards; give: Cards; threatTo: number | null };

const add = (c: Cards, r: Resource, d: number): Cards => ({ ...c, [r]: Math.max(0, (c[r] ?? 0) + d) });
const minus = (hand: Hand, c: Cards): Hand => {
  const out = { ...hand };
  for (const r of RESOURCES) out[r] -= c[r] ?? 0;
  return out;
};

/** A row of card tiles (tap one to take it back out). */
function CardRow({ cards, onTap, empty }: { cards: Cards; onTap?: (r: Resource) => void; empty?: string }) {
  const tiles = RESOURCES.filter((r) => cards[r]);
  if (!tiles.length) return empty ? <span className="pl-tr-empty">{empty}</span> : null;
  return (
    <div className="pl-tr-cards">
      {tiles.map((r) => (
        <button
          key={r}
          className={`pl-tr-card${onTap ? "" : " pl-tr-static"}`}
          disabled={!onTap}
          onClick={() => onTap?.(r)}
          aria-label={RESOURCE_NAMES[r]}
        >
          <ResourceIcon r={r} size={26} />
          <b>{cards[r]}</b>
        </button>
      ))}
    </div>
  );
}

/** The two rows: what comes to me (green, down) and what goes from me (red, up). */
function Rows({
  inLabel,
  inCards,
  outLabel,
  outCards,
  inColor,
  outColor,
  onTapIn,
  onTapOut,
}: {
  inLabel: string;
  inCards: Cards;
  outLabel: string;
  outCards: Cards;
  inColor?: string;
  outColor?: string;
  onTapIn?: (r: Resource) => void;
  onTapOut?: (r: Resource) => void;
}) {
  // A row with no cards says so, unless its label already says what it means ("calls off the attack").
  const emptyText = (label: string) => (/attack|nothing/i.test(label) ? undefined : "Nothing yet");
  return (
    <div className="pl-tr-rows">
      <div className="pl-tr-row">
        {inColor ? (
          <span className="pl-tr-who" style={{ background: inColor }} title={inLabel} />
        ) : (
          <span className="pl-tr-who pl-tr-group" title={inLabel}>
            {/* Other players: a little group of heads. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="8" cy="9" r="3.2" />
              <circle cx="16" cy="9" r="3.2" />
              <path d="M2.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5zM10.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5z" />
            </svg>
          </span>
        )}
        <span className="pl-tr-arrow in" aria-hidden="true">
          ▼
        </span>
        <div className="pl-tr-row-body">
          <small>{inLabel}</small>
          <CardRow cards={inCards} onTap={onTapIn} empty={emptyText(inLabel)} />
        </div>
      </div>
      <div className="pl-tr-row">
        <span className="pl-tr-who" style={outColor ? { background: outColor } : undefined} title={outLabel} />
        <span className="pl-tr-arrow out" aria-hidden="true">
          ▲
        </span>
        <div className="pl-tr-row-body">
          <small>{outLabel}</small>
          <CardRow cards={outCards} onTap={onTapOut} empty={emptyText(outLabel)} />
        </div>
      </div>
    </div>
  );
}

/** The player's hand along the bottom; tapping a card offers it. */
function HandRow({ hand, onTap }: { hand: Hand; onTap?: (r: Resource) => void }) {
  return (
    <div className="pl-tr-hand" aria-label="Your cards">
      {RESOURCES.map((r) => (
        <button
          key={r}
          className={`pl-tr-card${onTap || hand[r] <= 0 ? "" : " pl-tr-static"}`}
          disabled={!onTap || hand[r] <= 0}
          onClick={() => onTap?.(r)}
        >
          <ResourceIcon r={r} size={26} />
          <b>{hand[r]}</b>
        </button>
      ))}
    </div>
  );
}

function BigButton({
  icon,
  label,
  onClick,
  disabled,
  kind,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  kind?: "ok" | "no" | "edit";
}) {
  return (
    <button className={`pl-tr-big ${kind ?? ""}`} disabled={disabled} onClick={onClick} aria-label={label}>
      <span aria-hidden="true">{icon}</span>
      <small>{label}</small>
    </button>
  );
}

function Header({
  color,
  title,
  folded,
  onFold,
}: {
  color: string;
  title: string;
  folded: boolean;
  onFold: () => void;
}) {
  return (
    <button className="pl-tr-head" onClick={onFold} aria-expanded={!folded}>
      <span className="pl-dot" style={{ background: color }} />
      <b>{title}</b>
      <span className="pl-tr-chevron" aria-hidden="true">
        {folded ? "▲" : "▼"}
      </span>
    </button>
  );
}

type Props = {
  game: GameState;
  /** Start composing (the Trade button was tapped); null when the panel opened for an answer. */
  start: "trade" | null;
  onAct: (a: Action) => void;
  onClose: () => void;
};

export default function TradePanel({ game: s, start, onAct, onClose }: Props) {
  const actor = waitingOn(s);
  const t = s.trade ?? null;
  const pa = s.pendingAttack ?? null;
  const me = s.players[actor];
  const [folded, setFolded] = useState(false);
  const [compose, setCompose] = useState<Compose | null>(
    start ? { mode: "trade", want: {}, give: {}, threatTo: null } : null,
  );
  const [bribe, setBribe] = useState<Cards>({});
  const name = (p: number) => s.players[p].name;
  const color = (p: number) => COLOR_HEX[s.players[p].color];

  // ---- Composing a trade, threat or counter-offer
  if (compose) {
    const c = compose;
    const handLeft = minus(me.hand, c.give);
    const partners = tradePartners(s, actor);
    const threatened = threatTargets(s, actor);
    const merchant = c.mode === "trade" && atMerchant(s, actor);
    const set = (patch: Partial<Compose>) => setCompose({ ...c, ...patch });
    const merchantOk = merchant && cardCount(c.give) === 2 && cardCount(c.want) === 1;
    const tradeOk = cardCount(c.want) > 0 && cardCount(c.give) > 0 && hasCards(me.hand, c.give);
    const title =
      c.mode === "counter" ? `Counter-offer to ${name(t!.from)}` : c.mode === "threat" ? "Make a threat" : "Trade";
    return (
      <div className="pl-tr" role="dialog" aria-label={title}>
        <Header color={color(actor)} title={title} folded={folded} onFold={() => setFolded(!folded)} />
        {!folded && (
          <div className="pl-tr-body">
            <div className="pl-tr-main">
              {c.mode !== "counter" && threatened.length > 0 && (
                <div className="pl-tr-tabs" role="tablist">
                  <button
                    role="tab"
                    aria-selected={c.mode === "trade"}
                    onClick={() => set({ mode: "trade", give: {} })}
                  >
                    Trade
                  </button>
                  <button
                    role="tab"
                    aria-selected={c.mode === "threat"}
                    onClick={() => set({ mode: "threat", give: {}, threatTo: threatened[0] })}
                  >
                    ☠ Threaten
                  </button>
                </div>
              )}
              {c.mode === "threat" && (
                <div className="pl-tr-targets">
                  {threatened.map((p) => (
                    <button
                      key={p}
                      className={`pl-chip${c.threatTo === p ? " on" : ""}`}
                      onClick={() => set({ threatTo: p })}
                    >
                      <span className="pl-dot" style={{ background: color(p) }} /> {name(p)}
                    </button>
                  ))}
                </div>
              )}
              <div className="pl-tr-pick" aria-label="Ask for">
                {RESOURCES.map((r) => (
                  <button key={r} className="pl-tr-card" onClick={() => set({ want: add(c.want, r, 1) })}>
                    <ResourceIcon r={r} size={26} />
                    <small>+</small>
                  </button>
                ))}
              </div>
              <Rows
                inLabel={
                  c.mode === "threat"
                    ? `${c.threatTo !== null ? name(c.threatTo) : "They"} must hand over`
                    : c.mode === "counter"
                      ? `${name(t!.from)} gives`
                      : "Players give"
                }
                inCards={c.want}
                onTapIn={(r) => set({ want: add(c.want, r, -1) })}
                outLabel={c.mode === "threat" ? "You give nothing" : "You give"}
                outCards={c.give}
                outColor={color(actor)}
                onTapOut={(r) => set({ give: add(c.give, r, -1) })}
              />
              <HandRow
                hand={handLeft}
                onTap={c.mode === "threat" ? undefined : (r) => set({ give: add(c.give, r, 1) })}
              />
            </div>
            <div className="pl-tr-side">
              {merchant && (
                <BigButton
                  icon="⚖"
                  label="Merchant 2:1"
                  kind="ok"
                  disabled={!merchantOk}
                  onClick={() => {
                    const give = RESOURCES.flatMap((r) => Array<Resource>(c.give[r] ?? 0).fill(r)) as [
                      Resource,
                      Resource,
                    ];
                    const get = RESOURCES.find((r) => c.want[r])!;
                    onAct({ t: "merchant", give, get });
                    setCompose({ ...c, want: {}, give: {} });
                  }}
                />
              )}
              {c.mode === "trade" && (
                <BigButton
                  icon="✓"
                  label={partners.length ? "Offer" : "No one near"}
                  kind="ok"
                  disabled={!tradeOk || !partners.length}
                  onClick={() => {
                    onAct({ t: "offer", kind: "trade", give: c.give, get: c.want });
                    setCompose(null);
                  }}
                />
              )}
              {c.mode === "threat" && (
                <BigButton
                  icon="☠"
                  label="Threaten"
                  kind="ok"
                  disabled={!cardCount(c.want) || c.threatTo === null}
                  onClick={() => {
                    onAct({ t: "offer", kind: "threat", to: c.threatTo!, get: c.want });
                    setCompose(null);
                  }}
                />
              )}
              {c.mode === "counter" && (
                <BigButton
                  icon="✓"
                  label="Send"
                  kind="ok"
                  disabled={!tradeOk}
                  onClick={() => {
                    onAct({ t: "counter", give: c.give, get: c.want });
                    setCompose(null);
                  }}
                />
              )}
              <BigButton
                icon="✕"
                label={c.mode === "counter" ? "Back" : "Close"}
                kind="no"
                onClick={() => (c.mode === "counter" ? setCompose(null) : onClose())}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- A bribe to decide (the defender of a pending attack)
  if (pa?.stage === "bribe" && !t && actor === pa.defender) {
    const what = pa.target.kind === "ship" ? "your ship" : "your island";
    const handLeft = minus(me.hand, bribe);
    return (
      <div className="pl-tr" role="dialog" aria-label="Offer a bribe">
        <Header
          color={color(s.turn)}
          title={`${name(s.turn)} is attacking ${what}!`}
          folded={folded}
          onFold={() => setFolded(!folded)}
        />
        {!folded && (
          <div className="pl-tr-body">
            <div className="pl-tr-main">
              <p className="pl-tr-note">
                {pa.bribes
                  ? "Your bribe was refused. Offer more, or fight."
                  : "Offer a bribe to call it off, or fight."}
              </p>
              <Rows
                inLabel={`${name(s.turn)} calls off the attack`}
                inCards={{}}
                inColor={color(s.turn)}
                outLabel="Your bribe"
                outCards={bribe}
                outColor={color(actor)}
                onTapOut={(r) => setBribe(add(bribe, r, -1))}
              />
              <HandRow hand={handLeft} onTap={(r) => setBribe(add(bribe, r, 1))} />
            </div>
            <div className="pl-tr-side">
              <BigButton
                icon="✓"
                label="Bribe"
                kind="ok"
                disabled={!cardCount(bribe)}
                onClick={() => {
                  onAct({ t: "bribe", give: bribe });
                  setBribe({});
                }}
              />
              <BigButton icon="⚔" label="Fight" kind="no" onClick={() => onAct({ t: "noBribe" })} />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!t) return null;

  // ---- Someone answering (a person passes the device here; bots answer by themselves)
  const answering = actor !== t.from;
  const others = t.to.filter((p) => p !== actor);
  const statusChips = (list: number[]) => (
    <div className="pl-tr-status">
      {list.map((p) => (
        <span key={p} className={`pl-tr-status-chip ${t.answers[p] ?? "waiting"}`} title={name(p)}>
          <span className="pl-dot" style={{ background: color(p) }} />
          <i aria-hidden="true">{t.answers[p] === "accept" ? "✓" : t.answers[p] === "decline" ? "✕" : "…"}</i>
        </span>
      ))}
    </div>
  );

  if (answering && !me.isBot) {
    const canAccept = hasCards(me.hand, t.get);
    const title =
      t.kind === "threat"
        ? `${name(t.from)} threatens you!`
        : t.kind === "bribe"
          ? `${name(t.from)} offers a bribe`
          : `${name(t.from)} offers a trade`;
    return (
      <div className="pl-tr" role="dialog" aria-label={title}>
        <Header color={color(t.from)} title={title} folded={folded} onFold={() => setFolded(!folded)} />
        {!folded && (
          <div className="pl-tr-body">
            <div className="pl-tr-main">
              {t.kind === "threat" && <p className="pl-tr-note">Hand these over, or risk being attacked.</p>}
              {t.kind === "bribe" && <p className="pl-tr-note">Take it and call off your attack?</p>}
              {others.length > 0 && statusChips(others)}
              <Rows
                inLabel={`${name(t.from)} gives`}
                inCards={t.give}
                inColor={color(t.from)}
                outLabel={t.kind === "bribe" ? "You call off the attack" : "You give"}
                outCards={t.get}
                outColor={color(actor)}
              />
              <HandRow hand={me.hand} />
            </div>
            <div className="pl-tr-side">
              {t.kind === "trade" && (
                <BigButton
                  icon="✎"
                  label="Counter"
                  kind="edit"
                  onClick={() => setCompose({ mode: "counter", want: t.give, give: t.get, threatTo: null })}
                />
              )}
              <BigButton icon="✕" label="Decline" kind="no" onClick={() => onAct({ t: "answer", accept: false })} />
              <BigButton
                icon="✓"
                label={canAccept ? "Accept" : "Can't pay"}
                kind="ok"
                disabled={!canAccept}
                onClick={() => onAct({ t: "answer", accept: true })}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- The offerer looks at the answers and picks (or someone else is still answering)
  const mine = actor === t.from && !me.isBot;
  const accepted = t.to.filter((p) => t.answers[p] === "accept");
  return (
    <div className="pl-tr" role="dialog" aria-label="Your offer">
      <Header
        color={color(t.from)}
        title={mine ? "Your offer" : `${name(actor)} is answering…`}
        folded={folded}
        onFold={() => setFolded(!folded)}
      />
      {!folded && (
        <div className="pl-tr-body">
          <div className="pl-tr-main">
            {statusChips(t.to)}
            <Rows
              inLabel="They give"
              inCards={t.get}
              outLabel={`${name(t.from)} gives`}
              outCards={t.give}
              outColor={color(t.from)}
            />
            {mine && (
              <div className="pl-tr-pickers">
                {accepted.length ? (
                  accepted.map((p) => (
                    <button
                      key={p}
                      className="pl-btn pl-btn-small pl-tr-with"
                      onClick={() => onAct({ t: "pickTrade", with: p })}
                    >
                      <span className="pl-dot" style={{ background: color(p) }} /> Trade with {name(p)}
                    </button>
                  ))
                ) : (
                  <span className="pl-tr-empty">Nobody accepted.</span>
                )}
              </div>
            )}
          </div>
          <div className="pl-tr-side">
            {mine && <BigButton icon="✕" label="Withdraw" kind="no" onClick={() => onAct({ t: "cancelTrade" })} />}
          </div>
        </div>
      )}
    </div>
  );
}
