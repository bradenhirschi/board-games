# Stonks

A stock market board game, built as a Next.js web app.

```bash
npm install
npm run dev   # http://localhost:3000
```

## What works so far

- **The board**: a 48-square outer track with four START squares, four broker-fee corners, eight placeholder
  companies, the shareholders' meeting lanes, and the four salary careers.
- **Rolling and moving**: two dice. Players start on the four START squares and take turns rolling (button,
  Space or Enter). The square you **start your turn on** decides your direction:
  - stock, sell-all and corner squares move you the way their arrow points;
  - START sends **odd** rolls one way and **even** rolls the other.
- **Price tracker**: one market slider covers every stock. The square you land on moves it (`UP 4`,
  `DOWN 20`, …), and the strip of prices slides under the slider so each company's current price sits in
  the highlighted column. Sell-all squares show the live price.

Not built yet: money, buying/selling, dividends, salaries, broker fees, and entering the shareholders'
meetings. The career for a roll is only highlighted for now.

## Where things live

| File | What it holds |
| --- | --- |
| `lib/stocks.ts` | Placeholder companies (names, colors) and the price formula for each market level |
| `lib/board.ts` | Every square on the track: company, dividend, market move and arrow direction. Also movement rules |
| `lib/game.ts` | Game state and the turn reducer (roll → step → land → move market → next player) |
| `components/` | Board, price tracker, dice and the game screen |

To rename companies or tweak a square, edit `lib/stocks.ts` or `lib/board.ts`. The board redraws from that data.
