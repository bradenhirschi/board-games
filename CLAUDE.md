@AGENTS.md

# Stock Market: notes for Claude

A collection of the owner's board games, built with Next.js. The first is a web version of their
1960s-style stock-market board game ("STOCK MARKET"), served at `/stock-market`. `/` is a game picker (`app/(home)/`). Pass-and-play with bots, plus online play through Firebase. The README covers the game
rules, how online play works, and the file map; read it first.

## Workflow (the owner relies on this)

- **Work on `dev`.** Never push to `main`. Commit to `dev` and push.
- **Whenever `dev` differs from `main`, there must be an open PR `dev` → `main`.** Check after
  every push to `dev` (and at the start of a session): if `dev` is ahead of `main` and no PR is
  open, open one right away (title "dev → main"), without being asked and without waiting for
  more work. Keep its description listing every change since the last release, with the dev
  preview link. The owner merges; never merge yourself.
- **After a merge:** fast-forward `dev` to `main` (`git fetch origin && git merge --ff-only
  origin/main && git push origin dev`).
- **Dev site:** https://braden-board-games-dev.vercel.app (public; Vercel deploys every push to
  `dev`). Live site: https://braden-board-games.vercel.app (deploys from `main`). Both use the
  same Firebase project (same accounts and rooms, and the published `firestore.rules`).
- **Keep `dev` alive.** It's a permanent branch: never delete it, and recreate it from `main` if
  it's ever missing.
- **Firestore rules:** whenever `firestore.rules` changes, tell the owner to publish it in the
  Firebase console (Firestore → Rules → Publish) after merging; the live site uses the published
  copy, not the repo.
- **Look before committing UI changes.** The owner iterates on look and feel. For layout and
  visual work, render it with Playwright (Chromium is preinstalled) and send screenshots or
  mockups. When they ask for a mockup or rendering first, or the change is a big redesign,
  don't commit until they approve. They often reject a version, so make reverting easy.
- **Say "device" in Plunder's UI text,** never "phone" or "computer": it's cross-platform.
- **Phones first.** Most play is on iPhones (Brave, Safari, and the installed Home Screen app).
  Check phone layouts at 390×664 (browser) and 390×800 (installed app); desktop at 1440×900.
  Nothing on a phone may need page scrolling, and the main turn button must always be visible.

## Commands

- `npm run dev` / `npm run build && npm run start`: build with `rm -rf .next` first if CSS
  changes don't show (Turbopack cache has served stale CSS before).
- `npm test`: unit tests (vitest, `games/**/*.test.ts` and `shared/**/*.test.ts`).
- `npm run test:rules`: Firestore security-rules tests against the emulator (Java and
  firebase-tools are installed; tests in `tests/`).
- `npx tsc --noEmit -p .`, `npx eslint`, `npx prettier --print-width 120`: the codebase uses
  120-column Prettier formatting (don't reformat whole files at 80).

## Architecture in brief

- **Multiple games, one account.** Each game has its own design from scratch: no shared styles or
  UI components. Game code lives in `games/<game>/`; its pages live in a route group
  `app/(<game>)/` with its **own root layout** (own `<html>`, metadata, icons, and CSS import), so
  styles never leak between games. The only shared code is `shared/firebase.ts` (Firebase setup
  and sign-in), so one login carries across games. See "Adding a game" in the README.
- **Games:** Stock Market (`/stock-market`) and **Plunder** (`/plunder`), a pirate game the owner is designing,
  inspired by Poptropica's Skullduggery Island. Keep its names, art and rules the owner's own (no
  Poptropica names, characters or art). The board is six 6×6 tiles traced from the owner's sample
  board (`games/plunder/lib/tiles.ts`). Islands are made of full-land squares (block ships),
  half-land squares (sailable, but the land sides can't be crossed) and edges (block crossing);
  free-standing land barriers are edges too. Ports (anchors) are where ships dock: an upright anchor
  ends up with one way in, a diagonal one with several; anchor squares are always half land (some
  land and some water). Skulls = resource island, barrel = merchant. The gameplay map is a first
  guess the owner will correct. The island **art is traced** from the owner's sample board
  (`games/plunder/art/sample-board.webp`) by `scripts/trace-plunder-tiles.py` into
  `games/plunder/lib/tileArt.ts` (generated, Prettier-ignored); icons are placed per tile in
  `tiles.ts` (`icons`). The owner wants a 1:1 graphical match with the sample: compare silhouettes
  against it when changing the art. `canSail` encodes this. `/plunder/tiles` shows each tile with a
  "Show sailing" overlay. `games/plunder/components/Art.tsx` draws it. Rules engine:
  `games/plunder/lib/engine.ts` (pure reducer like Stock Market's; dice on actions, other luck from
  a seeded generator in the state). Status and open questions are in the README's Plunder section.
  Settled rules: rolling a 1 moves the storm and you still sail 1; new ships go in an empty port of
  an island you own (or beside one of your ships); ships can sail through ports; storm is 3×3;
  sailing over an X collects it (several per turn is fine); X's follow the rulebook's relocation
  rules (README: stacking allowed, one at a time; under your own ship = found again; under an
  opponent's ship = theirs at the start of their turn unless it's sunk first); the first turn has no resource draw;
  attacking costs no moves and can happen before the roll; Treasure cards are the owner's printed deck
  (`lib/treasureCards.ts`), read as listed in the README (all confirmed by the owner; A Pirate's Life
  goes back under the deck like any other card); ships built after the roll can't sail
  but can attack; the app rolls islands' defence; sinking against an unowned island gives no card.
  Trading follows the printed rules: offers go to every eligible player, each answers in seat order
  (pass the device), the offerer picks among those who accepted; counters go back and forth; only
  the current player starts trades, bribes come from the player being attacked; treaties are
  enforced. `waitingOn(state)` says who must act. The trading panel (`components/Trade.tsx`) copies
  the owner's reference layout (want row, two give/get rows, hand, big buttons on the right).
  Bots: `games/plunder/lib/bot.ts` (`botAction`, one action at a time; the UI rolls their dice).
  Online: `lib/online.ts` (resolve/replay, notices are local to each device), `lib/rooms.ts`
  (`plunderRooms`, same pattern and rules as Stock Market's), `components/Online.tsx` (start, lobby,
  game wrapper). `PlunderGame` takes `seat` online (left out for pass-and-play) and `onAct`.
- Stock Market paths below are relative to `games/stock-market/` unless they start with `app/`.

- `lib/engine.ts`: pure rules reducer over a serialisable `GameState` (no clocks or randomness;
  dice come in on the `roll` action). Log entries can carry `sound: "cash" | "loss"`.
- `lib/bot.ts`: computer players; levels `easy` and `normal` (`GameState.botLevel`).
- `lib/online.ts`, `lib/rooms.ts`, `components/OnlineRoom.tsx`: online rooms in Firestore
  (`stockMarketRooms/{code}`), moves saved in transactions and replayed with animation on every
  phone. No server code (Firebase free tier, no Cloud Functions).
- `lib/simultaneous.ts`, `components/SimulGame.tsx`: the online "Simultaneous turns" mode. Each
  player's turn runs on a private copy (`view`) through the normal reducer; `GameState.simul` holds
  the round (stage `sell` 60 s / `act` 60 s, per-seat turns, last round's summary). Settled with
  the owner: salaries for every throw of the round; Phase 2's timer starts at the reveal; the order
  rotates a seat per round; timeouts enter meetings and cover fees by selling the biggest holding;
  richest wins if several reach the target. The room's `stageStartedAt` (server time) drives timers.
- `lib/sound.ts`: Web Audio synthesized sounds (dice, turn bell, ca-ching, "womp womp").
- `components/Game.tsx`: the game screen (`GameView`), local game, turn controls.
- `styles.css`: all Stock Market styles (imported by `app/(stock-market)/stock-market/layout.tsx`). It has many layered phone/desktop overrides appended over time,
  so later rules often win on specificity. Check computed styles when something doesn't apply.
- PWA: each game is its own Home Screen app: `public/manifests/stock-market.webmanifest` (scope
  `/stock-market`), `app/(stock-market)/stock-market/apple-icon.png` and `icon.png`, `public/icons/stock-market/`.
  Plunder and the picker have the same set; their icons come from `scripts/render-icons.mjs`.

## Rules decisions already settled (don't change without asking)

- Market moves bounce off the ends of the ladder (0–50).
- After walking out of a shareholders' meeting you can't turn straight back into that meeting,
  but you can enter a different one on the same roll.
- After the throw you may sell, but only at the lowest board price; the player ends the turn
  manually.
- Fee shortfalls: sell at the lowest price or go broke (the owner said not to change this).

## Open to-do list (as of Nov 2026)

1. **Online moves arrive slowly (~15 s)** between two phones. Likely the Firestore real-time
   connection stalling on mobile browsers (try `initializeFirestore` with
   `experimentalAutoDetectLongPolling` / long-polling in `shared/firebase.ts`). The app logs
   `[stock-market] saving took …ms` and `live update for move N arrived …ms after it saved` to
   the console. Ask which browsers were involved.
2. **2-minute turn timer.** Skips the turn after 2 minutes; show a countdown in the top-right of
   the "Your turn" card only in the last 59 s. Not for occupation picking. Needs an engine
   "timeout" action that finishes the turn from any phase. Online: store the turn start time
   (server timestamp) on the room so others can skip an absent player (rules change + tests).
3. **CI on PRs:** GitHub Actions running eslint, tsc, `npm test` and `npm run test:rules`.
4. **Clean up `games/stock-market/styles.css`:** remove overridden/dead declarations and unused selectors.
   Verify with a computed-style diff across many game states and viewports; there should be no
   visual change.
5. Ideas the owner liked but didn't schedule: "your turn" push notifications for online games,
   a game-over results screen with a rematch button, tapping squares/stocks for details, and
   floating "+$40" money-change labels.
