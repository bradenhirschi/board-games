# Stonks

A stock market board game, built as a Next.js web app.

```bash
npm install
npm run dev   # http://localhost:3000
```

## The game

Pass-and-play for 2–8 players on one screen, with optional computer players. Click **How to play** on
the start screen for a summary of the rules. Everything in the rulebook is in:

- **Going to work.** Pick one of four occupations. Whenever anyone throws your numbers you're paid. At $1,000
  you must start playing the market.
- **Moving.** Start on any START square (no fee). Each throw, follow the arrow on the square you're leaving;
  START sends odd throws one way and even throws the other.
- **The quotation board.** Landing moves the single market slider. If it hits the top or bottom it bounces
  back. All eight stock prices follow it.
- **Buying and selling.** Buy only right after landing (1 share on LIMIT squares). Sell only right before your
  throw, at the board price. Owning the stock you land on pays its dividend first.
- **Fees and forced sales.** START costs $100 to land on, and broker fee corners cost $10 per share. SELL ALL
  squares, and selling to cover a fee, pay the lowest price on the board. If you can't pay, you go broke and
  back to work.
- **Shareholders' meetings.** Owners can detour in at their stock's entrance. Landing on a space pays that
  many new shares per share owned. You walk through and leave by the far entrance. The slider doesn't move in
  a meeting.
- **Winning.** Be worth the target ($100,000 by default, adjustable) at your turn to roll, or end the game
  early and the richest player wins.

Games save automatically in the browser, so a refresh doesn't lose them.

The quotation board prices in `lib/stocks.ts` were read from the playtest photo where legible and
interpolated between. Replace them with the real rows when you have them.

```bash
npm test      # rules engine tests + simulated bot games
```

## Where things live

| File | What it holds |
| --- | --- |
| `lib/stocks.ts` | Placeholder companies (names, colors) and the price formula for each market level |
| `lib/board.ts` | Every square on the track: company, dividend, market move and arrow direction. Also movement rules |
| `lib/engine.ts` | All game rules: state, turn phases and actions |
| `lib/bot.ts` | Computer player strategy |
| `components/` | Board, price tracker, dice and the game screen |

To rename companies or tweak a square, edit `lib/stocks.ts` or `lib/board.ts`. The board redraws from that data.
