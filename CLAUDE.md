@AGENTS.md

# Stock Market: notes for Claude

A collection of the owner's board games, built with Next.js. The first is a web version of their
1960s-style stock-market board game ("STOCK MARKET"), served at `/` for now. Pass-and-play with bots, plus online play through Firebase. The README covers the game
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
- **Dev preview:** https://stonks-git-dev-bradenhirschi29s-projects.vercel.app (Vercel builds
  every push to `dev`; it's behind Vercel login). Live site: https://stonks-henna.vercel.app
  (deploys from `main`).
- **Firestore rules:** whenever `firestore.rules` changes, tell the owner to publish it in the
  Firebase console (Firestore → Rules → Publish) after merging; the live site uses the published
  copy, not the repo.
- **Look before committing UI changes.** The owner iterates on look and feel. For layout and
  visual work, render it with Playwright (Chromium is preinstalled) and send screenshots or
  mockups. When they ask for a mockup or rendering first, or the change is a big redesign,
  don't commit until they approve. They often reject a version, so make reverting easy.
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
- Stock Market paths below are relative to `games/stock-market/` unless they start with `app/`.

- `lib/engine.ts`: pure rules reducer over a serialisable `GameState` (no clocks or randomness;
  dice come in on the `roll` action). Log entries can carry `sound: "cash" | "loss"`.
- `lib/bot.ts`: computer players; levels `easy` and `normal` (`GameState.botLevel`).
- `lib/online.ts`, `lib/rooms.ts`, `components/OnlineRoom.tsx`: online rooms in Firestore
  (`stockMarketRooms/{code}`), moves saved in transactions and replayed with animation on every
  phone. No server code (Firebase free tier, no Cloud Functions).
- `lib/sound.ts`: Web Audio synthesized sounds (dice, turn bell, ca-ching, "womp womp").
- `components/Game.tsx`: the game screen (`GameView`), local game, turn controls.
- `styles.css`: all Stock Market styles (imported by `app/(stock-market)/layout.tsx`). It has many layered phone/desktop overrides appended over time,
  so later rules often win on specificity. Check computed styles when something doesn't apply.
- PWA: `app/manifest.ts` (site-wide), `app/(stock-market)/apple-icon.png`, `app/(stock-market)/icon.png`,
  `public/icons/`.

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
