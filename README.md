# options-strategies

An **advanced BTC options dashboard** — live chain/ladder, Greeks, volatility analytics,
positioning stats, a trade tape, and a strategy payoff builder — built entirely on
**free, keyless** market data.

Open `index.html` in a browser (or serve the folder statically) and it connects straight
to Deribit's public API — no backend, no signup, no API key.

```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Features

- **Options ladder** — full calls/puts chain by expiry: OI, volume, IV, delta, bid/mark/ask.
- **Live order book** per instrument, plus a dedicated 1-minute OHLC chart page.
- **Chain charts** — price by strike, IV skew (with a fitted smile curve), open interest
  by strike, gamma exposure (GEX) by strike, and IV term structure across expiries.
- **Market stats strip** — max pain, put/call ratio (volume & OI), 30-day realized
  volatility vs. front-month ATM IV, BTC-PERPETUAL funding rate and basis.
- **Recent trades tape** — live feed of BTC option trades, with large prints highlighted.
- **Strategy builder** — add legs straight from the ladder (+C/+P) and see an illustrative
  payoff diagram. This is a simplified USD-equivalent payoff (premiums are converted from
  Deribit's BTC-denominated mark price at the index price when the leg was added) — it
  does not model Deribit's actual inverse/BTC-settled contract mechanics, so treat it as
  directional intuition, not a P&L quote.
- **CSV export** of the currently displayed chain.

## What's deliberately not included

A few items from a "full" advanced dashboard were left out because Deribit's free public
API doesn't support them without a backend/persistent storage or materially larger scope:

- **IV rank/percentile** — needs a stored history of past IV readings; there's no
  historical-IV endpoint to reconstruct it from.
- **Cross-exchange comparison** (OKX, Bybit, etc.) — would need separate integrations
  against different APIs/domains; out of scope for a single-exchange static site.
- **Historical replay / time-travel** through past chain snapshots — needs a database.
- **Portfolio-level P&L / margin** — would require an authenticated account; this app
  only ever reads public market data.

## Where to get free live BTC options data

| Source | Cost | Auth | Data available | Live updates | Notes |
|---|---|---|---|---|---|
| **Deribit** | Free | None for public/market data | Full option chain (all strikes/expiries), order book, greeks, mark IV, OI, volume, index price, trades | REST polling + WebSocket push (`wss://www.deribit.com/ws/api/v2`) | **~75-80% of global crypto options volume/OI** trades here, so its chain is the de-facto reference. Used by this app. Docs: https://docs.deribit.com |
| **OKX** | Free | None for public market data | BTC options chain, order book, tickers | WebSocket push | Good secondary/cross-check source, similar public/private split as Deribit. Docs: https://www.okx.com/docs-v5/en |
| **Bybit** | Free | None for public market data | BTC options chain (smaller OI than Deribit/OKX) | WebSocket push | Useful if you want a third venue for comparison. Docs: https://bybit-exchange.github.io/docs/v5/intro |
| **CoinGlass** | Free tier (paid tier for higher limits/history) | API key for REST | Aggregated OI, max pain, options flow across venues | REST (polling) | Good for cross-exchange aggregate stats, not a raw order book. |
| **Laevitas** | Free tier (paid for deep history/analytics) | API key | Aggregated options analytics, term structure, skew | REST | More of an analytics layer than a raw feed. |
| **Binance Options** | Discontinued | — | — | — | Binance shut down its BTC/ETH European options in 2023 — no longer usable. |

**Why this app uses Deribit:** it's the only venue above where every endpoint needed for
a full chain + order book — instrument list, book summary, per-instrument order book,
and index price — is public, free, requires no API key, and is pushed live over
WebSocket. It's also where the majority of BTC options liquidity actually is, so its
prices/IV are the most representative.

## How the app is built

Static site, no build step, no backend:

- `index.html` / `styles.css` — layout and dark trading-terminal theme.
- `app.js` — all data fetching and rendering logic.

Data flow:

1. **Instrument list** — `GET /public/get_instruments?currency=BTC&kind=option&expired=false`
   once at load (and every 5 min) to know every live strike/expiry.
2. **Chain prices** — `GET /public/get_book_summary_by_currency?currency=BTC&kind=option`
   polled every 5s. One call returns bid/ask/mark price, mark IV, volume, and open
   interest for *every* BTC option instrument, which is what fills the ladder.
3. **Live index price** — WebSocket subscription to `deribit_price_index.btc_usd`,
   used for the price chart and to highlight the at-the-money strike row in real time.
4. **Order book** — clicking any row in the ladder opens a WebSocket subscription to
   `book.{instrument_name}.none.10.100ms` (top-10 depth, full snapshot every 100ms) for
   that specific option contract, rendered as a bid/ask depth panel. A separate page
   (`chart.html`) shows that instrument's 1-minute OHLC history via REST polling of
   `get_tradingview_chart_data`.
5. **Greeks** — WebSocket subscriptions to `ticker.{instrument_name}.100ms` for every
   instrument in the *currently selected* expiry only (unsubscribed/resubscribed on
   expiry switch), which is where delta/gamma/theta/vega come from. This is bounded to
   one expiry's worth of channels (tens, not hundreds) to stay lightweight.
6. **Funding & basis** — WebSocket subscription to `ticker.BTC-PERPETUAL.100ms` for the
   perpetual's funding rate and mark price; basis is perp mark price minus index price.
7. **Recent trades** — WebSocket subscription to `trades.option.BTC.100ms`, a live tape
   of every BTC option trade, with prints ≥ 5 contracts highlighted as "large."
8. **Realized volatility** — REST call to `get_tradingview_chart_data` for
   `BTC-PERPETUAL` at daily resolution over the last 30 days, refreshed every 5 minutes;
   annualized from the standard deviation of daily log returns.
9. **Max pain, put/call ratio, IV term structure, gamma exposure** are all computed
   client-side from data already being polled above — no extra requests.

All requests are made directly from the browser — Deribit's public REST and WebSocket
endpoints allow anonymous, keyless access and are CORS-enabled for market data.

## Notes / limitations

- This is display-only (no trading, no auth, no order placement).
- REST polling for the chain (5s) is a deliberate tradeoff: subscribing to a WebSocket
  ticker channel per strike would mean hundreds of subscriptions for a single expiry.
  `get_book_summary_by_currency` returns the whole chain in one lightweight call instead.
- Gamma exposure and delta figures depend on the Greeks WebSocket feed, so they only
  populate once `ticker.*` messages start arriving for the selected expiry (a second or
  two after switching tabs), and only cover that expiry — not the full option chain.
- If Deribit's API is unreachable from your network (e.g. a restrictive corporate proxy
  or a sandboxed CI environment), the ladder will show a retry message — this was also
  the case in the environment this app was developed in, so it hasn't been exercised
  against live traffic; verify it in a normal browser with unrestricted network access.
