"use client";

import { MARKET_MAX, MARKET_MIN, STOCKS, STOCK_ORDER, priceAt } from "@/lib/stocks";

const LEVELS = Array.from({ length: MARKET_MAX - MARKET_MIN + 1 }, (_, i) => MARKET_MIN + i);

/**
 * A strip of prices (one column per market level) that slides under a fixed
 * slider, like the physical tracker in the middle of the board.
 */
export default function PriceTracker({ market, delta }: { market: number; delta: number | null }) {
  const offset = { transform: `translateX(calc(${-(market - MARKET_MIN + 0.5)} * var(--col-w)))` };
  return (
    <div className="tracker" aria-label={`Stock price tracker, market level ${market}`}>
      <div className="tracker-names">
        <div className="tracker-head">MARKET</div>
        {STOCK_ORDER.map((id) => (
          <div key={id} className="tracker-name" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
            {STOCKS[id].short}
          </div>
        ))}
      </div>
      <div className="tracker-window">
        <div className="tracker-strip" style={offset}>
          <div className="tracker-row tracker-levels">
            {LEVELS.map((l) => (
              <div key={l} className="tracker-cell">
                {l}
              </div>
            ))}
          </div>
          {STOCK_ORDER.map((id) => (
            <div key={id} className="tracker-row" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
              {LEVELS.map((l) => (
                <div key={l} className="tracker-cell">
                  {priceAt(id, l)}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="tracker-slider" />
      </div>
      <div className="tracker-status">
        <span>
          Market level <b>{market}</b>
        </span>
        {delta !== null && delta !== 0 && (
          <span key={`${market}-${delta}`} className={`delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
            {delta > 0 ? `▲ UP ${delta}` : `▼ DOWN ${-delta}`}
          </span>
        )}
        <span className="gauge" aria-hidden>
          <span className="gauge-fill" style={{ left: `${((market - MARKET_MIN) / (MARKET_MAX - MARKET_MIN)) * 100}%` }} />
        </span>
      </div>
    </div>
  );
}
