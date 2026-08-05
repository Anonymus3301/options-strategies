# options-strategies

A live **BTC options ladder** (options chain) with real-time prices, IV, open interest,
and a per-strike order book — built entirely on **free, keyless** market data.

Open `index.html` in a browser (or serve the folder statically) and it connects straight
to Deribit's public API — no backend, no signup, no API key.

```
python3 -m http.server 8000   # then open http://localhost:8000
```

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
   that specific option contract, rendered as a bid/ask depth panel.

All requests are made directly from the browser — Deribit's public REST and WebSocket
endpoints allow anonymous, keyless access and are CORS-enabled for market data.

## Notes / limitations

- This is display-only (no trading, no auth, no order placement).
- REST polling for the chain (5s) is a deliberate tradeoff: subscribing to a WebSocket
  ticker channel per strike would mean hundreds of subscriptions for a single expiry.
  `get_book_summary_by_currency` returns the whole chain in one lightweight call instead.
- If Deribit's API is unreachable from your network (e.g. a restrictive corporate proxy
  or a sandboxed CI environment), the ladder will show a retry message — this was also
  the case in the environment this app was developed in, so it hasn't been exercised
  against live traffic; verify it in a normal browser with unrestricted network access.
