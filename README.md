# Stock Market

A stock market board game, built as a Next.js web app.

```bash
npm install
npm run dev   # http://localhost:3000
```

## The game

Pass-and-play for 2–8 players on one screen, with optional computer players. Click **How to play** on
the start screen for a summary of the rules. Everything in the rulebook is in:

- **Going to work.** Pick one of four occupations. Whenever anyone throws your numbers you're paid. You can't
  play the market until you've earned $1,000; then you must.
- **Moving.** Start on any START square (no fee). Each throw, follow the arrow on the square you're leaving;
  START sends odd throws one way and even throws the other.
- **The quotation board.** Landing moves the single market slider. If it hits the top or bottom it bounces
  back. The eight stocks are four pairs sharing one price ladder, flipped: as the slider moves, one of each
  pair rises and the other falls.
- **Buying and selling.** Buy only right after landing (1 share on LIMIT squares). Sell at the board price
  right before your throw; after the throw you can still sell (say, to afford what you landed on), but only at
  the lowest board price. Owning the stock you land on pays its dividend first. Your turn lasts until you press
  **End turn**.
- **Fees and forced sales.** START costs $100 to land on, and broker fee corners cost $10 per share. SELL ALL
  squares, and selling to cover a fee, pay the lowest price on the board. If you can't pay, you go broke and
  back to work.
- **Shareholders' meetings.** Owners can detour in at their stock's entrance. Landing on a space pays that
  many new shares per share owned. You walk through and leave by the far entrance. The slider doesn't move in
  a meeting.
- **Winning.** Be worth the target ($100,000 by default, adjustable) at your turn to roll.

Games save automatically in the browser, so a refresh doesn't lose them.

The quotation board prices in `games/stock-market/lib/stocks.ts` are copied row for row from the playtest board.

```bash
npm test      # rules engine tests + simulated bot games
```

## Online play

Players can create a room and share its 5-letter code or invite link; friends join from their own
phones. It runs on Firebase's free Spark plan with no game server:

- **Accounts:** everyone gets a guest account automatically (Firebase anonymous sign-in), and can link it to
  Google to keep the same account across devices.
- **Rooms** are Firestore documents (`stockMarketRooms/{code}`). The player whose turn it is applies their move
  with the same rules code, then saves the new state together with the actions it applied; every other phone
  replays those actions so moves animate the same everywhere. Bot turns are played by whichever seated
  player's phone is open (if two try at once, the first save wins).
- **`firestore.rules`** limits who may write: only seated players, one version at a time, on their own turn or
  a bot's turn. Players' phones roll the dice, so a determined player
  could cheat; fine among friends.
- The Firebase web config lives in `shared/firebase.ts` (public values).

```bash
npm run test:rules   # security rules tests against the Firestore emulator
# Run the app against local emulators:
npx firebase emulators:start --project demo-stock-market --only auth,firestore
NEXT_PUBLIC_FIREBASE_EMULATORS=1 npm run dev
```

## Where things live

The repo is set up to hold several board games. Each game has its own design (no shared styles) and lives
in its own folder; the only shared code is the account (Firebase sign-in), so one login works in every game.

| Path | What it holds |
| --- | --- |
| `app/(stock-market)/` | Stock Market's pages: its own root layout (`<html>`, metadata, icons), served at `/` for now |
| `app/manifest.ts` | The site's Home Screen app manifest (one per site) |
| `games/stock-market/styles.css` | All of Stock Market's styles, loaded only by its layout |
| `games/stock-market/lib/stocks.ts` | The eight companies (names, colors) and their quotation board price ladders |
| `games/stock-market/lib/board.ts` | Every square on the track: company, dividend, market move and arrow direction. Also movement rules |
| `games/stock-market/lib/engine.ts` | All game rules: state, turn phases and actions |
| `games/stock-market/lib/bot.ts` | Computer player strategy |
| `games/stock-market/lib/online.ts`, `games/stock-market/lib/rooms.ts` | Online play: resolving moves, rooms in Firestore |
| `games/stock-market/components/` | Board, price tracker, dice, the game screen, and the online lobby/game (`OnlineRoom.tsx`) |
| `shared/firebase.ts` | Firebase setup and the account: guest sign-in, Google sign-in, sign-out, `useFirebaseUser()` |
| `firestore.rules` | Who may read and write online rooms (each game has its own collection) |

To rename companies or tweak a square, edit `games/stock-market/lib/stocks.ts` or `games/stock-market/lib/board.ts`.
The board redraws from that data.

### Adding a game

1. Put its code in `games/<game>/` (rules, components, `styles.css`).
2. Give it a route group with its own root layout, e.g. `app/(<game>)/<game>/layout.tsx` and `page.tsx`. The layout
   renders its own `<html>`/`<body>` and imports only that game's CSS, so no styles leak between games (moving
   between games is a full page load).
3. Use `shared/firebase.ts` for sign-in; give online rooms their own Firestore collection and rules.
