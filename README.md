# Stock Market

A stock market board game, built as a Next.js web app.

```bash
npm install
npm run dev   # http://localhost:3000
```

## The game

Pass-and-play for 2–8 players on one screen, with optional computer players.

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

Enter a room code with at least three letters or numbers and tap **Join**. The first player to use a new code becomes its host.
Friends use the same code or the invite link from the lobby. Online play runs on Firebase’s free Spark
plan with no game server:

- **Accounts:** everyone gets a guest account automatically (Firebase anonymous sign-in), and can link it to
  Google to keep the same account across devices.
- **Rooms** are Firestore documents (`stockMarketRooms/{code}`). The player whose turn it is applies their move
  with the same rules code, then saves the new state together with the actions it applied; every other phone
  replays those actions so moves animate the same everywhere. Bot turns are played by whichever seated
  player's phone is open (if two try at once, the first save wins).
- **`firestore.rules`** limits who may write: only seated players, one version at a time, on their own turn or
  a bot's turn. Players' phones roll the dice, so a determined player
  could cheat; fine among friends.
- The home screen shows recent players from `stockMarketPresence`. Keep `firestore.rules` in sync with
  the app deployment so presence and custom codes work.
- The Firebase web config lives in `shared/firebase.ts` (public values).

**Simultaneous turns** (a lobby setting, online only): everyone plays each round at once, privately
(`games/stock-market/lib/simultaneous.ts`, `components/SimulGame.tsx`).

1. **Sell, then roll** (60 s): sell at the board price, change occupation or go to market, then press
   Roll. The dice keep tumbling while you wait for the others. Out of time: you roll without selling,
   and your turn enters any shareholders' meeting it passes.
2. **Reveal:** each player sees only their own throw; their token walks and their own copy of the
   market moves by their landing alone. Workers are paid for every throw of the round.
3. **Buy & sell, then end turn** (60 s, starting at the reveal): buy at your updated price, sell at
   the lowest price, as usual. Out of time: the turn ends without trading (a fee you can't pay sells
   your biggest holding at the lowest price, or you go broke if that isn't enough).
4. **Results:** each player's turn is shown in a box, one at a time, in a fixed order that rotates
   by one seat each round, and their market move is applied to the real market in that order
   (bounces included). Then the next round starts for everyone. A winner is checked at the start of
   each round; if several players reach the target, the richest wins.

Every phone plays its own part and saves it to the room; the save that completes a stage moves the
round on (bots play their part in the same save). Timers run on server time (`stageStartedAt`), and
once a stage's time is up any seated phone plays for whoever is still out. Everyone's choices are in
the room document, so the privacy is only on screen, like the dice.

```bash
npm run test:rules   # security rules tests against the Firestore emulator
# Run the app against local emulators:
npx firebase emulators:start --project demo-stock-market --only auth,firestore
NEXT_PUBLIC_FIREBASE_EMULATORS=1 npm run dev
```

## Plunder (in progress)

A pirate board game at `/plunder`, built from the owner's rules document. 2–6 players, any of them
bots: pass-and-play on one device, or online (each player on their own device).

**Built so far:** a shuffled, randomly turned board; picking one-skull starting islands (highest roll
picks first, the last to pick starts); a ship in each player's port and three resource cards each;
turns (a resource card per owned island, roll, sail the fleet with one shared roll plus a square per
mast, build ships/masts/cannons/lives, bury five gold for a Plunder Point, end turn);
battles (attack a resource island from its port, or an enemy ship next door: die + cannons vs die +
cannons or skulls, ties to the attacker; the loser loses a life; sinking a ship earns a Plunder Point
card; attacking costs no moves, and each ship can attack each target once a turn); a captain without
a ship (free card if no islands or Plunder Points, roll for doubles, or build / pay 5 gold / trade a
Plunder Point card / give up an island; one ship per turn this way);
the storm (a 3×3 square, first placed off the one-skull islands' ports; rolling a 1 moves it and you
still sail 1; sailing in or out costs 2 cards of your choice, so a ship with nothing to pay is trapped;
no attacks, treasure or new-ship placement across its edge; islands with every port inside give no
card); X-marks-the-spot tokens (sailing over one collects it, so a ship can collect several in a turn; after
its card the X moves at once. Several X's may share a square, collected one at a time, and a card can
stop the next being collected. An X that moves under one of your own ships counts as found again;
under an opponent's ship it waits until that ship is sunk or its owner collects it at the start of
their turn. An X under a ship shows as a small badge on it, and stacked X's show a count);
Plunder Points (ships + islands + Plunder Point cards) and winning at 10.

**Treasure cards** (`games/plunder/lib/treasureCards.ts` for the printed text, `resolveFind` in
`engine.ts` for what they do): the owner's 55-card deck (51 different, five of A Pirate's Life),
shuffled at the start. Sailing over an X draws the top card; it's carried out once the ship stops,
then goes under the deck. Cards that need a choice wait for it (`treasureNeed`): an enemy player, a
resource, a die roll, cards to lose, yes/no, or something tapped on the board (a ship, a port, a
square in the storm, an island). White Flag asks its target for a bribe on their own device. How the
cards are read (all confirmed by the owner): "your ship" is the ship that found the X; "steal"
takes random cards; "enemy" means any other player without a treaty with you this turn; "accessible
port" is any empty port the ship could reach by water, however far, ignoring the storm; cards move
ships without tolls and without collecting treasure; a card that ends the turn ends it after the
rest of that sail's treasure; losing your last ship to a card ends your turn, and a ship sunk by a
card earns nobody a Plunder Point; A Pirate's Life gives a Plunder Point and
goes back under the deck like any other card (so it can come up again); Notorious still takes the
life from the enemy ship when none of yours has room for it; taking White Flag's bribe also makes a
treaty with that player for the rest of the turn; Plunder can steal any Plunder Point card, including
one earned by burying gold. Basic bots
(`games/plunder/lib/bot.ts`): they pick roomy starting islands, bury gold, repair and build, attack
when the odds are good, sail for islands worth conquering or treasure, and recover when sunk.

Trading: the current player offers a trade to everyone they may trade with (ship in their port or
they in yours, ships side by side, or anyone when either is docked at a merchant island; not through
a port the storm covers or across its edge); each answers in turn (passing the device), accepting,
declining or countering, and the offerer picks one who accepted. Counter-offers can go back and
forth. Merchant islands swap any two cards for one. Threats (a demand to a player in your port or
beside you) and bribes (offered by a player you attack, before the dice; raise after a refusal, or
fight) work the same way. Any deal that goes through makes a treaty for the rest of the turn: no
attacks between those two. Bots answer by what they need, counter, bribe when it matters and make
one offer a turn.

**Online play** works like Stock Market's: rooms in Firestore at `plunderRooms/{code}`
(`games/plunder/lib/rooms.ts`), opened or joined by any code of 3+ letters and numbers (the first to use a
new code hosts), or by invite link (`/plunder?room=CODE`); who's online is in `plunderPresence`. The device the
game waits on applies the move with the shared rules and saves the new state plus the actions it
applied, in a transaction; every other device replays them (other players' ships sail square by
square, and each device shows the news itself: battles, treasure, its own card draws). The game can
wait on someone mid-turn (answering a trade, deciding on a bribe), and `currentUid` follows that.
Bots are played by any seated device; the room keeps the first save. Saved states hold no notices
(`games/plunder/lib/online.ts`).

**Not built yet:** smarter bots and difficulty levels.

**Not decided yet** (placeholders in the code):

- **Resource card counts:** the deck is a placeholder 40 of each resource (wood, iron, rum, gold),
  `CARDS_PER_RESOURCE` in `games/plunder/lib/engine.ts`.

**Art credits:** the skull and crossbones, the X (drawn red in the game), the anchor and the crossed
swords (`games/plunder/art/*.svg`) are from [OpenMoji](https://openmoji.org), licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Where things live

The repo is set up to hold several board games. Each game has its own design (no shared styles) and lives
in its own folder; the only shared code is the account (Firebase sign-in), so one login works in every game.

| Path | What it holds |
| --- | --- |
| `app/(home)/` | The game picker at `/`: its own root layout, styles (`home.css`) and Home Screen icon |
| `app/(stock-market)/stock-market/` | Stock Market's pages: its own root layout (`<html>`, metadata, icons), served at `/stock-market` (old `/?room=CODE` links redirect there, see `next.config.ts`) |
| `public/manifests/`, `public/icons/<game>/` | One Home Screen app manifest and icon set per game (and one for the picker), so each game installs as its own app |
| `scripts/render-icons.mjs` | Renders Plunder's and the picker's icons with Playwright (Stock Market's are hand-made) |
| `games/stock-market/styles.css` | All of Stock Market's styles, loaded only by its layout |
| `games/stock-market/lib/stocks.ts` | The eight companies (names, colors) and their quotation board price ladders |
| `games/stock-market/lib/board.ts` | Every square on the track: company, dividend, market move and arrow direction. Also movement rules |
| `games/stock-market/lib/engine.ts` | All game rules: state, turn phases and actions |
| `games/stock-market/lib/bot.ts` | Computer player strategy |
| `games/stock-market/lib/online.ts`, `games/stock-market/lib/rooms.ts` | Online play: resolving moves, rooms in Firestore |
| `games/stock-market/components/` | Board, price tracker, dice, the game screen, and the online lobby/game (`OnlineRoom.tsx`) |
| `app/(plunder)/plunder/`, `games/plunder/` | Plunder, a pirate game in progress, served at `/plunder` (`/plunder/tiles` shows each tile) |
| `games/plunder/lib/tiles.ts` | Plunder's six board tiles: gameplay map (land, half land, edges, ports, skulls, barrels) and icon positions |
| `games/plunder/components/Crew.tsx` | Plunder's scoreboard: on phones a chip per other player over the board (tap for the standings sheet), on wide screens a card per player in the sidebar |
| `games/plunder/lib/tileArt.ts` | Plunder's island outlines, traced from `games/plunder/art/sample-board.webp` by `scripts/trace-plunder-tiles.py` (generated; rerun the script to change) |
| `shared/firebase.ts` | Firebase setup and the account: guest sign-in, Google sign-in, sign-out, `useFirebaseUser()` |
| `firestore.rules` | Who may read and write online rooms (each game has its own collection) |

To rename companies or tweak a square, edit `games/stock-market/lib/stocks.ts` or `games/stock-market/lib/board.ts`.
The board redraws from that data.

### Adding a game

1. Put its code in `games/<game>/` (rules, components, `styles.css`).
2. Give it a route group with its own root layout, e.g. `app/(<game>)/<game>/layout.tsx` and `page.tsx`. The layout
   renders its own `<html>`/`<body>` and imports only that game's CSS, so no styles leak between games (moving
   between games is a full page load).
3. Give it its own Home Screen app: icons (`icon.png`, `apple-icon.png`) next to its layout, a manifest in
   `public/manifests/<game>.webmanifest` (`start_url` and `scope` set to the game's path) with icons in
   `public/icons/<game>/`, and `manifest` in the layout's metadata. Add it to the picker in `app/(home)/page.tsx`.
4. Use `shared/firebase.ts` for sign-in; give online rooms their own Firestore collection and rules.
5. Lay out its home screens like every other game's (Stock Market's is the standard; Plunder follows it), in the
   game's own components and styles:
   - **Home:** one card. Header: the title and a line about the game on the left, the account menu (a profile
     picture opening "Signed in as … / Playing as guest" and Sign in with Google / Sign out) on the right. Then
     **Online | On this device** tabs (Online first, remembered per device).
   - **Online tab:** "Your name", then "Room code" with **Join** (any code of 3+ letters and numbers: a new code
     opens a room and you host it, an existing one joins it; hint "Pick a code to open a room, or enter the code
     your friends are using."), then "N online now" (a presence collection like `stockMarketPresence`).
   - **On this device tab:** a "Game in progress · names" row with **Continue** when there's a saved game, then
     **New local game**, which opens the setup page.
   - **Setup page:** "Back to home", the title "New local game", a row per player (token, name, Human / Bot, ✕),
     "+ Add player" and "+ Add bot", the game's own settings, then a big **Start game**.
   - **Lobby:** the header, the room code, **Share invite** and **Copy link**, "Players" (token, name, BOT / HOST
     tags, "(you)", ✕ for the host), a name field and **Join game** for someone who arrived by link, then for the
     host "+ Add bot", the settings and **Start game** (others see "Waiting for the host to start…"), then "Leave
     room" and "Back to menu".
