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

- **Options ladder** — full calls/puts chain by expiry: OI (with a live Δ-since-last-poll
  badge), volume, IV, delta, an **edge %** (mark price vs. a Black-Scholes theoretical
  price built from the fitted smile IV — flags contracts trading rich/cheap relative to
  their neighbors), and bid/mark/ask.
- **Live order book** per instrument, plus a dedicated OHLC chart page with every
  resolution Delta Exchange supports (1m through monthly) and an **expiry selector**
  to switch between dates at the same strike/type without going back to the ladder.
- **Chain charts** — price by strike, IV skew (with a fitted smile curve), open interest
  by strike, gamma exposure (GEX) by strike, IV term structure across expiries, a
  **probability cone** (±1σ price fan to expiry, derived from ATM IV via a lognormal
  band), a full **IV surface heatmap** (moneyness × expiry), and a **futures term
  structure / basis curve** from Deribit's dated BTC futures.
- **Market stats strip** — max pain, put/call ratio (volume & OI), 30-day realized
  volatility vs. front-month ATM IV, BTC-PERPETUAL funding rate and basis, **expected
  move** (ATM straddle mark price, in USD and % of spot, for the selected expiry), and
  **25-delta risk reversal / butterfly** (skew quantification: RR is call IV minus put
  IV at the strikes nearest ±0.25 delta; BF is their average minus ATM IV).
- **Recent trades tape** — live feed of BTC option trades, with large prints highlighted.
- **Watchlist** — pin any strike's call/put (★ button) to a panel that shows live
  bid/mark/ask/IV regardless of which expiry tab is active.
- **Alerts** — set a threshold on BTC index price, ATM IV, or chain OI; firing shows a
  browser Notification (if permitted) and plays a beep. Client-side only — it only fires
  while this tab stays open, there's no server to push from.
- **Configurable poll rate** — 2s/5s/10s/30s dropdown for how often the chain refreshes.
- **Strategy builder** — add legs straight from the ladder (+C/+P) and see an illustrative
  payoff diagram with breakeven markers and net portfolio Greeks (Δ/Γ/Θ/Vega). This is a
  simplified USD-equivalent payoff (premiums are converted from Deribit's BTC-denominated
  mark price at the index price when the leg was added) — it does not model Deribit's
  actual inverse/BTC-settled contract mechanics, so treat it as directional intuition,
  not a P&L quote. A **P&L scenario heatmap** (price × time) reprices each leg via
  Black-Scholes at its snapshot IV to show how the position's value could evolve before
  expiry — also illustrative, since it holds volatility fixed.
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
   (`chart.html`) shows that instrument's OHLC history — sourced from **Delta
   Exchange's** public chart API (`cdn.india.deltaex.org/v2/chart/{symbols,history}`),
   not Deribit. The Deribit instrument name is converted into Delta's
   `MARK:{C|P}-{ASSET}-{STRIKE}-{DDMMYY}` symbol convention (e.g. `BTC-29AUG25-60000-C`
   → `MARK:C-BTC-60000-290825`); the resolution dropdown is populated from whatever
   `supported_resolutions` Delta returns for that symbol. Delta Exchange is a different
   options venue from Deribit — if it doesn't list the exact strike/expiry you clicked,
   the page says so rather than showing unrelated or stale data. Unlike the bare
   `{s,t,o,h,l,c,v}` TradingView UDF convention, Delta wraps the `/history` payload in
   the same `{success, result: {...}}` envelope as `/symbols` — confirmed against real
   traffic (this sandbox can't reach `cdn.india.deltaex.org` directly, so this was
   verified from a response captured in a real browser, not by the app fetching it here).
   The chart page's history fetch pages backward, one window at a time, merging results
   until Delta returns nothing more, so it shows everything the exchange has rather than
   an arbitrary slice. Its expiry dropdown is populated separately, from Deribit's
   `get_instruments` (same source as the ladder) filtered to the same strike and
   call/put type — Delta has no "list expiries" endpoint, so Deribit is the source of
   truth for which expiries exist. It queries both `expired=false` and `expired=true`
   (Deribit only allows one at a time) and splits the results into **Upcoming**/**Expired**
   tabs above the dropdown, so past dates are browsable via their own tab rather than
   mixed into one long list. Whether Delta actually has chart data for an already-expired
   contract is untested from here — pick one and see; if it's not listed, the page says so
   rather than showing stale or unrelated data. Separately, the "Expired" tab can come up
   empty even when Delta *would* have data: Deribit's listed strikes shift with spot price
   over time, so an exact strike from today's chain may simply never have existed as a
   past listing on Deribit at all — the tab says so explicitly rather than silently
   showing nothing. Picking any expiry just re-derives the Delta symbol and reloads that
   contract's chart in place.
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
9. **Max pain, put/call ratio, IV term structure, gamma exposure, IV surface, theoretical
   price/edge, OI deltas** are all computed client-side from data already being polled
   above — no extra requests.
10. **Futures term structure** — REST calls to `get_instruments`/`get_book_summary_by_currency`
    with `kind=future`, polled every 30s (dated futures basis moves slowly, so this
    doesn't need 5s granularity).

All requests are made directly from the browser — Deribit's public REST and WebSocket
endpoints allow anonymous, keyless access and are CORS-enabled for market data.

## Notes / limitations

- This is display-only (no trading, no auth, no order placement).
- `app.js`, `chart.js`, and `styles.css` are loaded with a `?v=N` cache-busting query
  string, bumped whenever those files change. GitHub Pages doesn't support custom
  cache-control headers on a static site, so without this a browser can keep serving an
  old cached copy of the script after a deploy. If something looks stale after an update,
  hard-refresh (or check that the page's script tags show the latest `v=`).
- REST polling for the chain (5s by default, adjustable) is a deliberate tradeoff:
  subscribing to a WebSocket ticker channel per strike would mean hundreds of
  subscriptions for a single expiry. `get_book_summary_by_currency` returns the whole
  chain in one lightweight call instead.
- Gamma exposure and delta figures depend on the Greeks WebSocket feed, so they only
  populate once `ticker.*` messages start arriving for the selected expiry (a second or
  two after switching tabs), and only cover that expiry — not the full option chain.
- The edge finder compares mark price to a Black-Scholes price using the fitted smile IV
  (not the contract's own mark IV, which would trivially match) and assumes a 0% risk-free
  rate, matching Deribit's own BTC/ETH options convention. It's a relative-value signal
  against the smoothed smile, not a claim about true fair value.
- OI/volume delta badges only appear after the second poll of a session (there's no
  "previous" snapshot on the very first load).
- Alerts and the poll-rate control are in-memory only — they reset on page reload.
- If Deribit's API is unreachable from your network (e.g. a restrictive corporate proxy
  or a sandboxed CI environment), the ladder will show a retry message — this was also
  the case in the environment this app was developed in, so it hasn't been exercised
  against live traffic; verify it in a normal browser with unrestricted network access.
