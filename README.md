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
  the lowest board price. Owning the stock you land on pays its dividend first.
- **Fees and forced sales.** START costs $100 to land on, and broker fee corners cost $10 per share. SELL ALL
  squares, and selling to cover a fee, pay the lowest price on the board. If you can't pay, you go broke and
  back to work.
- **Shareholders' meetings.** Owners can detour in at their stock's entrance. Landing on a space pays that
  many new shares per share owned. You walk through and leave by the far entrance. The slider doesn't move in
  a meeting.
- **Winning.** Be worth the target ($100,000 by default, adjustable) at your turn to roll, or end the game
  early and the richest player wins.

Games save automatically in the browser, so a refresh doesn't lose them.

The quotation board prices in `lib/stocks.ts` are copied row for row from the playtest board.

```bash
npm test      # rules engine tests + simulated bot games
```

## Where things live

| File | What it holds |
| --- | --- |
| `lib/stocks.ts` | The eight companies (names, colors) and their quotation board price ladders |
| `lib/board.ts` | Every square on the track: company, dividend, market move and arrow direction. Also movement rules |
| `lib/engine.ts` | All game rules: state, turn phases and actions |
| `lib/bot.ts` | Computer player strategy |
| `components/` | Board, price tracker, dice and the game screen |

To rename companies or tweak a square, edit `lib/stocks.ts` or `lib/board.ts`. The board redraws from that data.
