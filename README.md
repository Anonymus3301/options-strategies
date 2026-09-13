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
  badge), volume, IV, delta, a **P(ITM)** column (≈ |delta|, the standard desk shorthand
  for probability of finishing in the money — not an exact risk-neutral probability), an
  **edge %** (mark price vs. a Black-Scholes theoretical price built from the fitted
  smile IV — flags contracts trading rich/cheap relative to their neighbors), and
  bid/mark/ask.
- **Live order book** per instrument, plus a dedicated OHLC chart page with every
  resolution Delta Exchange supports (1m through monthly) and an **expiry selector**
  to switch between dates at the same strike/type without going back to the ladder.
- **Chain charts** — price by strike, IV skew (with a fitted smile curve), open interest
  by strike, gamma exposure (GEX) by strike, IV term structure across expiries, a
  **probability cone** (±1σ price fan to expiry, derived from ATM IV via a lognormal
  band), a full **IV surface heatmap** (moneyness × expiry), and a **futures term
  structure / basis curve** from Deribit's dated BTC futures.
- **Market stats strip** — max pain, put/call ratio (volume & OI), **multi-window
  realized volatility** (7D/14D/30D/60D/90D annualized, from daily BTC-PERPETUAL closes)
  vs. front-month ATM IV, BTC-PERPETUAL funding rate and basis, **expected move** (ATM
  straddle mark price, in USD and % of spot, for the selected expiry), **25-delta risk
  reversal / butterfly** (skew quantification: RR is call IV minus put IV at the strikes
  nearest ±0.25 delta; BF is their average minus ATM IV), and **order flow sentiment**
  (net call vs. put premium bought, accumulated client-side from the live trades tape
  since the tab was opened — not a historical/server-side figure).
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
- **IV Rank / Percentile** — where front-month ATM IV currently sits relative to its own
  recent range. Deribit's free API has no historical-IV endpoint, so this is built from a
  one-reading-per-day snapshot kept in the browser's own `localStorage` — it only reflects
  what this specific browser has observed since first loading the page, not an
  authoritative multi-year rank, and resets if that browser's storage is cleared. Shows
  "collecting history" until at least 5 days of readings have accumulated.
- **Strategy Scanner** — a heuristic "conditions for selling premium" read for the
  selected expiry, combining four signals already computed elsewhere on the page: IV
  Rank, the vol risk premium (this expiry's ATM IV minus 30D realized vol), days to
  expiry (scored against the classic 15-45d theta/gamma sweet spot), and how this
  expiry's IV compares to the rest of the term structure (a local "hump" often reverts).
  Each shows green/yellow/red and rolls up into an overall verdict. It only reflects this
  dashboard's own free public data, says nothing about which side (if any) to sell, and
  is not a trade signal or financial advice — hover a row to see what it measures.
- **Skew Rank / Percentile** — the same localStorage-history idea as IV Rank, applied to
  the front-month 25-delta risk reversal instead of ATM IV, for gauging when skew itself
  is stretched vs. its own recent range (the read a skew mean-reversion trade would use).
  Anchored to the front-month expiry regardless of which expiry is selected in the ladder,
  so switching expiries in the UI doesn't corrupt the daily history with unrelated
  readings. Same "collecting history" / per-browser caveats as IV Rank.
- **BTC/ETH Vol Spread & Realized Correlation** — front-month ATM IV for BTC vs. ETH side
  by side (Deribit lists ETH options too, on the same free endpoints already used for
  BTC), plus their 30-day realized-return correlation. This is a two-asset relative-value
  vol read, not true index dispersion trading (that needs an index priced against 3+
  constituents, which doesn't exist for crypto) — labeled honestly rather than
  overclaiming. ETH's ATM strike/IV is derived without an unverified `underlying_price`
  field: it backs out an implied spot from put-call parity (`S = K / (1 - (C - P))` at
  r=0, the same convention this app's own Black-Scholes pricer already uses) across ETH's
  near-dated strikes, using only the `mark_price`/`mark_iv` fields already relied on for
  BTC. Refreshed every 60s, independent of the main chain poll.

## Standalone Strategy Pages

Sixty-nine dedicated pages plus a [Strategy Hub](strategy-hub.html) index, each buildable
purely from Deribit's free public REST API (no
WebSocket, no auth, no dependency on the main ladder page being open — every page fetches
its own data). Linked from a shared nav strip (`strategy-nav.js`) on the main ladder page
and on each strategy page itself, and built on a shared `quant.js` (fetch helpers,
Black-Scholes, rank/percentile, payoff-diagram SVG). Every page opens with a "Strategy
Explained" card (construction, market view, why trade it, max profit/loss/breakeven, and
the key risk) before its live stats, so a page is understandable on its own without
already knowing the strategy. All are explicitly labeled as heuristics/informational, not
financial advice, and each page's own disclaimer spells out its specific limitations.

- **[Premium Selling](strategy-premium-selling.html)** — vol risk premium harvesting: the
  same 4-signal scanner as the main dashboard's widget (recomputed independently here),
  plus a suggested short strangle at ±1 expected move with a payoff diagram.
- **[Skew Arbitrage](strategy-skew-arb.html)** — 25Δ risk reversal, found via
  Black-Scholes delta from each strike's own quoted IV (no live greeks needed), a Skew
  Rank/Percentile, an RR25 term-structure sparkline, and a suggested risk-reversal
  structure (sell the richer 25Δ option, buy the cheaper one). Labeled as relative-value
  skew-reversion, not riskless arbitrage.
- **[Convexity Arbitrage (25Δ Butterfly)](strategy-convexity-arb.html)** — the convexity
  companion to Skew Arbitrage: tracks BF25 (wing IV vs. ATM IV) against its own recent
  range with an independent rank/percentile history, and suggests selling the 25Δ
  strangle + buying the ATM straddle when wings are rich, or the reverse when cheap.
- **[Long Volatility](strategy-long-vol.html)** — the mirror image of Premium Selling:
  favors buying an ATM straddle when IV Rank is low, IV sits below realized vol, and the
  expiry is short-dated (more gamma per dollar).
- **[Carry & Funding](strategy-carry.html)** — cash-and-carry basis trade (annualized
  basis per dated future vs. the perpetual's own mark as a spot proxy) and perpetual
  funding-rate farming, with a this-browser funding-rate history sparkline.
- **[Covered Call / CSP Income Scanner](strategy-income.html)** — scans every live
  expiry's chain for OTM strikes in a selectable delta band (10-20Δ / 15-30Δ / 25-40Δ),
  ranked by annualized premium yield, for both covered calls and cash-secured puts.
- **[BTC/ETH Vol Pair Trade](strategy-cross-asset.html)** — front-month ATM IV for BTC vs.
  ETH (each via its own put-call-parity implied spot), 30D realized correlation, a spread
  history/rank, and a suggested pair structure. Named a "pair trade," not "dispersion" —
  true index dispersion needs 3+ constituents, which doesn't exist in crypto.
- **[BTC/ETH Correlation Cone](strategy-correlation-cone.html)** — the cross-asset
  counterpart to the Realized Volatility Cone: today's rolling BTC/ETH correlation at
  14/30/60/90-day windows against its own full historical distribution, computed from
  ~400 days of real daily closes for both assets. Verified with a synthetic price history
  carrying a deliberate correlation breakdown: current readings correctly land in the
  0th-26th percentile after the break, across every window.
- **[Max Pain / Pin Risk](strategy-maxpain.html)** — max pain strike and OI-by-strike
  chart per expiry, plus a table across every live expiry. Explicitly flagged as a
  contested theory with weak empirical support, not a forecast.
- **[Gamma Exposure (GEX) by Strike](strategy-gamma-exposure.html)** — a different
  OI-weighted positioning read from Max Pain: Net GEX(K) = (call OI × call gamma − put OI
  × put gamma) × spot² × 0.01, under the standard (unverifiable on this venue) heuristic
  that dealers are net long calls/short puts. Verified with a synthetic chain carrying
  heavy call OI at one strike: correctly reports a large positive Net GEX there.
- **[Calendar Spread](strategy-calendar.html)** — sell the front-month ATM straddle, buy
  the back-month ATM straddle at the same strike; independent front/back expiry pickers,
  an ATM IV term-structure sparkline, and a payoff-at-front-expiry chart that reprices the
  still-alive back leg via Black-Scholes at its current IV (disclosed as a simplification).
- **[Protective Put](strategy-protective-put.html)** — for holders, not sellers: cost of
  downside insurance at a selectable floor (-5%/-10%/-20%/-30%) across every live expiry,
  annualized so tenors are comparable, with a hedged-vs-unhedged payoff comparison.
- **[Collar](strategy-collar.html)** — sells an OTM call to fund an OTM put at a
  selectable floor, picking the call strike whose premium most closely offsets the put's
  for a near-zero-cost hedge; shows the resulting floor/cap and a payoff comparison.
- **[Iron Condor Builder](strategy-iron-condor.html)** — defined-risk premium selling:
  short strikes near 20Δ (Black-Scholes delta from quoted IV), long wings at a selectable
  width, with net credit, max profit/loss, breakevens, and a 4-leg payoff diagram.
- **[PCR Contrarian Sentiment](strategy-pcr.html)** — whole-chain put/call ratio (every
  live expiry combined), tracked vs. its own recent range (this-browser localStorage) and
  read as a contrarian signal at extremes — flagged explicitly as weak and noisy.
- **[Butterfly Spread](strategy-butterfly.html)** — long call butterfly (buy 1 lower
  strike, sell 2 center strikes, buy 1 upper strike) centered on ATM or the max-pain
  strike, with a selectable wing width; a cheap, defined-risk bet on low realized volatility.
- **[Jade Lizard](strategy-jade-lizard.html)** — sell a ~25Δ put plus a call credit spread
  (~20Δ short call, long a further-OTM call); reports whether the total credit actually
  covers the call spread's width, the defining feature of "no upside risk."
- **[Box Spread](strategy-box-spread.html)** — a call spread + put spread at the same two
  strikes pays a fixed amount at expiry regardless of outcome; comparing that payout to
  what the chain's current mark prices say it costs implies an annualized financing rate.
- **[Synthetic Forward](strategy-synthetic.html)** — long call + short put at the ATM
  strike replicates a long forward; compares that options-implied forward against the
  actual dated future's mark price for the matching expiry (a different cross-check than
  Carry & Funding, which compares dated futures against the perpetual instead).
- **[Ratio Spread](strategy-ratio-spread.html)** — a 1×2 call ratio spread (buy 1 near-ATM
  call, sell 2 further-OTM calls); the one page in this set with genuinely unlimited risk
  above its upper breakeven, and labeled as such rather than implied to be defined-risk.
- **[Diagonal Spread](strategy-diagonal.html)** — a bullish call diagonal: buy a back-month
  call, sell a front-month call at a higher strike. Combines the Calendar Spread's
  term-structure bet with directional exposure, since the legs sit at different strikes.
- **[Call Backspread](strategy-backspread.html)** — sell 1 near-ATM call, buy 2
  further-OTM calls; the mirror image of the Ratio Spread page — capped loss, unlimited
  profit above the upside breakeven.
- **[Strap / Strip](strategy-strap-strip.html)** — a weighted ATM straddle (2 calls + 1
  put, or 1 call + 2 puts) for a directionally-leaning long-vol position.
- **[Broken Wing Butterfly](strategy-broken-wing.html)** — an asymmetric butterfly with
  independently selectable inner/outer wing widths; explicitly reports both outside-the-
  wings flat values rather than assuming a net credit means one side is risk-free.
- **[Iron Butterfly](strategy-iron-butterfly.html)** — short the ATM straddle, buy
  protective wings at a selectable width; the same 4 legs as an Iron Condor but the short
  strikes coincide at the center, so the payoff peaks instead of plateauing.
- **[Long Strangle](strategy-long-strangle.html)** — buy an OTM call and put at a
  selectable width; cheaper than the Long Volatility page's ATM straddle, at the cost of
  needing a bigger move to reach breakeven.
- **[Guts (ITM Strangle)](strategy-guts.html)** — buy an in-the-money call and put; between
  the two strikes their intrinsic values sum to a constant, a "locked-in" minimum value
  baked into the cost. Cross-checks exactly against Long Strangle by put-call parity: cost
  above the locked-in value equals what an equivalent OTM strangle at the same strikes
  would cost.
- **[Call Ladder (Christmas Tree)](strategy-call-ladder.html)** — buy 1 near-ATM call, sell
  1 further-OTM call, sell 1 even further-OTM call; cheaper than a plain bull call spread,
  but the second short call removes the cap, so it becomes an uncapped short position above
  the top strike.
- **[Covered Strangle](strategy-covered-strangle.html)** — for holders: sell an OTM call
  and an OTM put against a held position. The call behaves like a covered call; the put
  does not — it doubles the effective downside slope below the put strike, flagged
  explicitly as not a hedge.
- **[Put Ratio Spread](strategy-put-ratio-spread.html)** — buy 1 near-ATM put, sell 2
  further-OTM puts; the bearish mirror of the Call Ratio Spread, with severe (though
  floor-bounded) risk below breakeven instead of literally unlimited risk above it.
- **[Put Backspread](strategy-put-backspread.html)** — sell 1 near-ATM put, buy 2
  further-OTM puts; the bearish mirror of the Call Backspread. Cross-checks exactly against
  Put Ratio Spread at the same strikes: the two portfolios are exact negations of each
  other, so their costs, breakevens, and probabilities of profit (which sum to 100%) all
  match algebraically.
- **[Put Ladder (Christmas Tree)](strategy-put-ladder.html)** — buy 1 near-ATM put, sell 1
  further-OTM put, sell 1 even further-OTM put; the bearish mirror of the Call Ladder, with
  a profit plateau that gives way to severe losses toward zero below the lowest strike.
- **[Reverse Iron Condor](strategy-reverse-iron-condor.html)** — buy an inner strangle,
  sell an outer strangle to help fund it; the debit mirror of the Iron Condor, with a flat
  loss zone between the inner strikes instead of a flat profit plateau, and capped gains
  outside the outer strikes.
- **[Covered Put](strategy-covered-put.html)** — for a short BTC position: sell an OTM put
  for extra income, the bearish mirror of a covered call. Profit caps at the put strike;
  a rally carries unlimited loss, same as any naked short.
- **[Variance Swap](strategy-variance-swap.html)** — the model-free implied volatility
  (the same "log contract" replication behind the CBOE VIX and Deribit's own DVOL): a
  static portfolio of options weighted 1/K² across the whole chain, aggregating skew and
  smile into one fair volatility number instead of a single ATM IV reading. Verified
  against a synthetic flat-IV chain (recovers the input IV within ~0.03pp) and against a
  skewed one (correctly reads richer than ATM IV when puts are bid up).
- **[Gamma Scalping](strategy-gamma-scalping.html)** — backtests a daily-rehedged long ATM
  straddle over a trailing window of actual BTC-PERPETUAL closes, decomposing the result
  into cumulative hedge P&L (gamma) and the option's own mark-to-market change (theta).
  Uses today's ATM IV as a constant assumed vol throughout, since no historical IV series
  is available — disclosed as a simplification.
- **[Poor Man's Covered Call](strategy-pmcc.html)** — a deep-ITM, far-dated call stands in
  for holding BTC; sell a near-dated OTM call against it. Max profit is computed exactly
  (verified numerically: the payoff's true peak sits exactly at the short strike, slightly
  above the naive "strike width minus debit" estimate due to the long leg's remaining time
  value there) and max loss is capped at the net debit — a real edge over an actual covered
  call, whose downside is only bounded by BTC reaching zero.
- **[Poor Man's Covered Put](strategy-pmcp.html)** — the bearish mirror of the PMCC: a
  deep-ITM, far-dated put stands in for a short position, with a near-dated OTM put sold
  against it.
- **[Double Calendar Spread](strategy-double-calendar.html)** — two calendar spreads
  stacked at OTM strikes on both sides (call side and put side), trading the single ATM
  Calendar Spread's narrow peak for a wider, flatter neutral profit zone at a higher cost.
- **[Forward Variance](strategy-forward-variance.html)** — bootstraps the model-free
  implied vol for the period *between* two expiries from their own individual fair
  variances, the same way a forward interest rate is bootstrapped from two zero rates —
  the actual vol exposure a Calendar Spread between those two dates is really a bet on.
- **[Vega-Neutral Calendar Spread](strategy-vega-neutral-calendar.html)** — sizes the
  back-month quantity via each leg's Black-Scholes vega so net vega ≈ 0 at inception,
  isolating the theta/gamma bet from the plain Calendar Spread's mixed vega exposure.
- **[Seagull Spread](strategy-seagull.html)** — a 3-leg refinement of the Collar for
  holders: sell a further-OTM put to cheapen the floor, sell a call to finance the rest —
  full protection only in a band, partial protection beyond it, an intentional trade-off
  common in FX/commodity hedging books.
- **[Broken Wing Iron Condor](strategy-broken-wing-condor.html)** — the same 4-leg Iron
  Condor with put-side and call-side wing widths set independently, reporting both
  (now-unequal) max-loss figures honestly, the same idea as the Broken Wing Butterfly
  applied to a Condor.
- **[Delta-Hedged Risk Reversal](strategy-hedged-risk-reversal.html)** — the Skew
  Arbitrage page's risk reversal plus a spot hedge sized to null its initial directional
  lean; shows the resulting same-day mark-to-market sensitivity (not a payoff-at-expiry
  chart) hedged vs. unhedged, with an explicit caveat that the hedge is a one-time
  snapshot, not continuously maintained.
- **[Bull Call Spread](strategy-bull-call-spread.html)**, **[Bear Call Spread](strategy-bear-call-spread.html)**,
  **[Bull Put Spread](strategy-bull-put-spread.html)**, **[Bear Put Spread](strategy-bear-put-spread.html)** —
  the four basic vertical spreads, oddly absent until now despite being the most commonly
  traded options structures. Bull Call / Bear Call share identical strikes and are exact
  portfolio negations of each other (verified: their debit/credit, max profit/loss, and
  breakeven all match exactly, and their probabilities of profit sum to 100%) — same for
  Bull Put / Bear Put.
- **[Call Condor Spread](strategy-call-condor.html)** — buy the outer wings, sell the inner
  body, all calls, four strikes instead of the Butterfly's three: a wider, flatter-topped
  profit zone. Verified numerically that both tails are exactly equal (given equal wing
  widths) and the whole flat top is a single constant.
- **[Put Condor Spread](strategy-put-condor.html)** — the same structure built from puts;
  verified to produce an identical payoff to the Call Condor at the same four strikes,
  point for point.
- **[Naked Call Writing](strategy-naked-call.html)** — a single short call with nothing
  behind it: no held BTC, no protective long call. The highest risk-per-dollar-of-margin
  structure on this site, flagged as such explicitly.
- **[Naked Put Writing](strategy-naked-put.html)** — a single short put sold on margin
  rather than fully cash-secured, contrasted directly against the Income Scanner's
  cash-backed CSP framing.
- **[Put Diagonal Spread](strategy-put-diagonal.html)** — the bearish mirror of the
  Diagonal Spread: buy a back-month put, sell a front-month put at a lower strike.
- **[Call Calendar Spread](strategy-call-calendar.html)** / **[Put Calendar Spread](strategy-put-calendar.html)** —
  single-leg (call-only or put-only) versions of the plain straddle Calendar Spread, half
  the cost and legs, with a mild directional lean instead of pure neutrality.
- **[Jelly Roll](strategy-jelly-roll.html)** — sells the front-month synthetic forward,
  buys the back-month one at the same strike; the entry cash flow reduces (by put-call
  parity) to the gap between the two expiries' own implied forwards. Explicitly framed as
  a pricing-consistency signal rather than a riskless payoff, since the front leg settles
  before the back one does — unlike the Box Spread's single, clean terminal payout.
- **[Conversion/Reversal Arbitrage Scanner](strategy-conversion-scanner.html)** — the
  whole-chain version of the Box Spread page's single selected strike pair: scans every
  strike across every live expiry for put-call parity deviations from the chain's own
  aggregated median spot, ranked by implied edge. Verified with a deliberately-mispriced
  synthetic strike: correctly surfaces it first with the right Conversion/Reversal label.
- **[Cross-Market Spot Consistency Check](strategy-spot-consistency.html)** — closes a
  gap the Conversion/Reversal Scanner explicitly disclosed: that page only checks parity
  within one options chain against its own median, never against an outside price. This
  page compares the options-implied spot directly against the perpetual's independent
  mark, with the nearest dated future shown for context (its own basis is expected carry,
  not a dislocation, unlike a gap between options and the perpetual). Verified with a
  synthetic 1.67% options-vs-perp divergence: correctly flags it while reporting the
  future's own +8.1% annualized basis separately as expected, not flagged.
- **[Empirical vs. Risk-Neutral POP Backtest](strategy-empirical-pop.html)** — the one
  page that steps outside the risk-neutral lognormal assumption behind every other POP
  stat on this site: walks ~400 days of real BTC-PERPETUAL closes to find the empirical
  frequency that an ATM straddle's own breakeven move has actually happened over windows
  matching its DTE, then compares that directly against the risk-neutral POP for the
  identical structure. Verified with a synthetic price history built to match its own
  quoted IV: the computed breakeven (±12.6% for a 30-day ATM straddle at 55% IV) matches
  the standard 0.8·σ·√T approximation almost exactly, and both win-rate figures compute
  correctly and land in a sensible range.
- **[Double Diagonal Spread](strategy-double-diagonal.html)** — a call diagonal and a put
  diagonal combined: sell front-month OTM call+put closer to spot, buy back-month call+put
  at wider strikes. Cheaper than the Double Calendar's identical-strike construction for a
  similar-sized neutral range, completing the calendar/diagonal family alongside the
  straddle, single-leg, and double variants already on this site.
- **[The Wheel Strategy](strategy-wheel.html)** — Phase 1 scans for the best-yield
  cash-secured put using the Income Scanner's own delta-band methodology; Phase 2
  illustrates a covered call sold at the assumed post-assignment cost basis, using the
  next listed expiry, plus a simple-average "illustrated full-cycle" yield. Phase 2 is
  explicitly disclosed as hypothetical — it can't know whether Phase 1 will actually be
  assigned.
- **[Covered Call Overwrite (2:1 Ratio Write)](strategy-covered-call-ratio.html)** — sell
  2 OTM calls per 1 BTC held instead of 1; a 3-line chart (unhedged spot / plain covered
  call / ratio write) makes explicit that the payoff slope above the strike flips from 0
  (a plain covered call's flat cap) to -1 (unlimited loss), not just "a lower cap."
- **[Covered Put Overwrite (2:1 Ratio Write)](strategy-covered-put-ratio.html)** — the
  bearish mirror: sell 2 OTM puts per 1 BTC short instead of 1, adding a growing loss
  below the strike (slope +1) on top of the short position's pre-existing unlimited
  upside risk.
- **[Risk Reversal (25-Delta)](strategy-risk-reversal.html)** — no assumed underlying:
  buy an OTM call and sell an OTM put near 25-delta (or the reverse), leaving a flat
  "dead zone" between the two strikes. Verified numerically (bisection root-finding) that
  the payoff is monotonic on both outer segments, so there's exactly one real breakeven,
  not two — which side it falls on flips with the net debit/credit sign, a subtlety the
  page gets right after an initial wrong assumption caught before shipping.
- **[Risk-Neutral Density](strategy-risk-neutral-density.html)** — Breeden-Litzenberger:
  the second derivative of the call price curve with respect to strike recovers the
  market's whole implied probability distribution, not just a variance number like the
  Variance Swap page. Plots it against a lognormal reference at the same ATM IV so
  skew/fat-tail divergence from the Black-Scholes assumption is visible directly.
  Verified against a synthetic flat-IV chain: recovers the true lognormal density to
  within a few percent pointwise.
- **[Realized Volatility Cone](strategy-vol-cone.html)** — today's realized vol at each
  of 7/14/30/60/90-day windows against its own full historical distribution (min/25th/
  median/75th/max) computed from ~400 days of real daily closes, not a single point
  estimate the way every other realized-vol mention on this site shows it. Verified with
  a synthetic regime-shift price history (vol doubling in the recent half): current
  readings correctly land in the 81st-95th percentile across every window.
- **[IV Term Structure Curve](strategy-term-structure.html)** — ATM IV plotted against
  days-to-expiry across every live expiry at once, complementing the Forward Variance
  page's two-point bootstrap with the whole curve shape (contango vs. backwardation) in
  one view. Verified against a deliberately-sloped synthetic chain: correctly classifies
  contango.
- **[Volatility Smile Curve](strategy-vol-smile.html)** — IV plotted against strike for
  one selected expiry, the actual curve the Skew Arbitrage (RR25) and Convexity Arb
  (BF25) pages each reduce to a single number, with the ATM/25Δ-call/25Δ-put points
  marked. Verified against a deliberately-skewed synthetic chain: correctly reports a
  negative RR25 (puts richer) and positive BF25 (wings rich vs. ATM).
- **[Vol Risk Premium Term Structure](strategy-vrp-term-structure.html)** — combines two
  ideas already on this site that had never been put together: each expiry's ATM IV (like
  the Term Structure Curve) minus a realized vol lookback matched to that expiry's own
  DTE (using the Volatility Cone's real daily-close history), answering "which specific
  expiry is richest to sell" rather than Premium Selling's "is IV rich in general."
  Verified with a synthetic rich-front/cheap-back chain: correctly ranks the 7-day expiry
  richest (+17.6pp) and the 60-day expiry cheapest (-14.2pp). Also tracks the front
  expiry's VRP day-over-day in this browser for a Rank/Percentile read, completing a trio
  with the Skew Arbitrage and Convexity Arb pages' own RR25/BF25 rank tracking.

**[Strategy Hub](strategy-hub.html)** ties the set together: a live market snapshot
(front-month ATM IV, realized vol, vol risk premium, IV Rank) plus every strategy page
above, grouped into nine categories (Directional Spreads/Verticals, Volatility Selling,
Volatility Buying, Hedging & Income, Term Structure & Skew, Carry & Arbitrage-Adjacent,
Cross-Asset & Sentiment, Undefined-Risk, and Advanced/Quant Techniques) with a one-line
description and a defined/undefined-risk tag for each — a directory, not a recommendation
engine.

Several pages share `localStorage` keys with the main dashboard's own IV Rank / Skew
Rank features (same key names), so history accumulates regardless of which page — or how
many of them — a visitor has open in that browser.

### Live Probability of Profit

Forty-five of the pages above show a live **Probability of Profit** stat, recomputed on
every refresh from that page's own strikes, premiums, and quoted IV: Premium Selling,
Skew Arbitrage, Long Volatility, Calendar Spread, Protective Put, Collar, Iron Condor,
Butterfly, Jade Lizard, Ratio Spread, Diagonal Spread, Call Backspread, Strap/Strip,
Broken Wing Butterfly, Iron Butterfly, Long Strangle, Guts, Call Ladder, Covered
Strangle, Put Ratio Spread, Put Backspread, Put Ladder, Reverse Iron Condor, Covered
Put, Poor Man's Covered Call, Poor Man's Covered Put, Double Calendar Spread, Seagull
Spread, Broken Wing Iron Condor, Bull Call Spread, Bear Call Spread, Bull Put Spread,
Bear Put Spread, Call Condor Spread, Put Condor Spread, Naked Call Writing, Naked
Put Writing, Put Diagonal Spread, Call Calendar Spread, Put Calendar Spread, Double
Diagonal Spread, Covered Call Overwrite (2:1), Covered Put Overwrite (2:1), Risk
Reversal (25-Delta), and Convexity Arbitrage (25Δ Butterfly).

It's computed by numerically integrating each structure's own PnL-at-expiry function
against the lognormal price distribution implied by the page's IV and time-to-expiry —
the same risk-neutral, driftless-in-log convention (`r = 0`) as every Black-Scholes price
already shown throughout this app. **This is a risk-neutral probability derived from
current option prices, not a real-world/objective forecast of where price will end up** —
the same honesty caveat already attached to the P(ITM) column and Probability Cone
elsewhere in this project. Every page shows it with a tooltip repeating that caveat.

Eighteen pages deliberately don't have it: Carry & Funding and the Income Scanner are
linear/yield-harvest trades where delta-band selection already serves the purpose; the
Income Scanner's table format has no single constructed position to score; The Wheel
Strategy is the same table-scanner format across two hypothetical phases, with no single
constructed position to score either; BTC/ETH Vol Pair Trade would need a joint two-asset
distribution, out of scope for this pass; Max Pain and PCR Sentiment are
informational/contested-theory pages with no constructed position; Box Spread and
Synthetic Forward have fixed or near-fixed payoffs at expiry where a profit probability
isn't a meaningful concept; Risk-Neutral Density and the IV Term Structure Curve are both
measurements of a distribution/curve shape, not a constructed position either; and the
Conversion/Reversal Scanner is a ranked table across many strikes, the same table-format
reason as the Income Scanner; the Spot Consistency Check is a cross-market measurement
with no constructed position; the Empirical vs. Risk-Neutral POP Backtest computes its
own risk-neutral figure inline as part of a two-column comparison rather than the
standard single "Probability of Profit (live)" stat used elsewhere; the Volatility Smile Curve is a whole-curve measurement
the same way its Term Structure Curve sibling is; Gamma Exposure is an
informational positioning read with no constructed position, the same reason as Max Pain;
the Realized Volatility Cone is a historical-distribution measurement, not a
constructed position either; the BTC/ETH Correlation Cone is the same kind of
measurement for a different underlying metric; and the Vol Risk Premium Term Structure is
an informational per-expiry comparison, not a constructed position.

## Tools

Fifteen utility pages that complement the strategy suite rather than adding another
strategy, reachable via their own nav strip (`#toolsNav`, also rendered by
`strategy-nav.js`) on every strategy page and the main ladder:

- **[Risk & Position Sizing Calculator](tool-risk-calculator.html)** — pure client-side
  arithmetic: given an account size, risk-per-trade %, and a max-loss-per-contract figure
  (read off any strategy page), computes how many contracts fit the risk budget, an
  optional margin/capital constraint, and which one binds. A separate section gives
  full/half/quarter-Kelly position sizing from a win probability and win/loss amounts.
- **[Unusual Options Activity Scanner](tool-unusual-activity.html)** — tracks open
  interest and volume changes entirely client-side (no historical-OI endpoint exists): a
  baseline snapshot (reset on load or on demand) and the prior poll's snapshot are diffed
  against each new chain fetch to surface the biggest OI/volume movers.
- **[Options Glossary](tool-glossary.html)** — a searchable static reference covering 52
  terms used across the dashboard and strategy pages, no network calls.
- **[Trade Journal](tool-journal.html)** — logs real or paper trades (strategy, entry
  spot, net cost, max profit/loss, notes) and tracks them to close with a realized P&L,
  entirely in `localStorage`; CSV export for external record-keeping. Not synced anywhere
  — clearing site data or switching browsers loses it.
- **[Option Chain Greeks Explorer](tool-greeks-table.html)** — every listed strike's
  delta/gamma/vega/theta for one expiry, calls and puts side by side, computed from each
  strike's own quoted IV the same way every other page here does. A raw reference table,
  not a strategy or suggested position.
- **[Liquidity / Bid-Ask Spread Explorer](tool-liquidity-explorer.html)** — bid-ask
  spread as a % of mid per strike for one expiry, using the `bid_price`/`ask_price`
  fields already present in Deribit's book summary. Every strategy page here prices off
  mark, which hides how wide or thin a given strike actually is to trade — this is the
  one page that surfaces that directly.
- **[Custom Multi-Leg Strategy Builder](tool-strategy-builder.html)** — combine up to 4
  same-expiry legs from the live chain freely, built directly on quant.js's existing
  generic `qBuildPayoffSvg`/`qComputeProbabilityOfProfit` primitives (the same ones every
  named strategy page already uses under the hood). Estimates max profit/loss by checking
  the payoff's slope far outside the plotted range to tell a capped tail from a genuinely
  unlimited one — a bug in that check's sign (an uncapped-loss tail was first mislabeled
  "unlimited profit") was caught and fixed by testing a naked short call before shipping.
- **[Options Portfolio VaR / CVaR Calculator](tool-var-calculator.html)** — every
  Probability of Profit stat on this site answers "how likely is a loss"; this answers
  "how bad could it actually be," computing VaR and CVaR (Expected Shortfall) at 95%/99%
  confidence for the same up-to-4-leg combination as the Strategy Builder, via the same
  lognormal integration behind every POP stat. Verified with a naked short call (VaR99 ≥
  VaR95, CVaR ≥ VaR at each level, all confirmed) and a defined-risk spread, where all
  four figures correctly collapse to exactly its max loss.
- **[ATM Theta Decay Curve](tool-theta-decay-curve.html)** — every page that shows theta
  (the Greeks Table included) shows a single snapshot number; this holds spot and IV
  fixed at today's live values and walks time-to-expiry down toward zero to show the
  well-known but never-visualized-here fact that decay accelerates near expiry, not
  linearly. An indexing bug (comparing the wrong end of the computed curve to itself)
  initially showed decay *slowing* near expiry — caught by checking the ratio against the
  theoretical √(T₁/T₂) scaling before shipping, which the fixed version matches almost
  exactly (3.17 observed vs. 3.16 theoretical).
- **[Defined-Risk Structure Optimizer (Iron Condor)](tool-condor-optimizer.html)** — the
  Iron Condor page commits to one 20Δ short strike; this scans 10Δ-40Δ at a chosen wing
  width and ranks every candidate's net credit, max loss, reward:risk, and POP side by
  side. A real bug caught before shipping: max loss was computed from the *narrower* of
  the two wings (`Math.min`) instead of the wider one, understating risk on an
  asymmetric condor — verified against a hand-checked case (904 shown vs. 1,904 actual)
  and fixed to `Math.max`, then re-verified against two live scanned rows matching by
  hand exactly.
- **[Income Yield Heatmap](tool-yield-heatmap.html)** — the same CSP/covered-call scan
  as the Income Scanner page, organized as a delta-band × expiry grid instead of one flat
  ranked list, so a term-structure-of-yield pattern is visible at a glance. Verified with
  a 4-expiry synthetic chain: all 16 cells in each grid populate correctly, with yield
  rising by delta band and falling by tenor exactly as expected.
- **[Greeks P&L Attribution](tool-pnl-attribution.html)** — decomposes an assumed price
  move + days-elapsed into delta/gamma/theta Taylor-expansion contributions for the same
  up-to-4-leg combination as the Strategy Builder, then compares that estimate against
  the actual Black-Scholes-repriced P&L. No other page here shows how the second-order
  approximation's error grows with move size. First verified with a deep-ITM leg by
  accident, which showed exactly 0% error at any move size (delta pinned near 1, gamma
  near 0) — not a bug, but a non-representative test caught before drawing the wrong
  conclusion from it; re-verified with an explicit ATM leg, where a small move (0.5%)
  shows ~0% error and a large move (20%) shows a real, visible 6.1% Taylor-vs-actual gap.
- **[Synthetic Equivalents Explorer](tool-synthetic-equivalents.html)** — put-call parity
  means every one of the 6 basic positions (long/short stock, call, put) has an exact
  synthetic build from the other two; pick one and see its live-priced equivalent plus a
  parity-consistency check, reframing the same identity the Box Spread and Synthetic
  Forward pages already use for arbitrage-hunting as a pedagogical reference instead.
  Verified by cycling through all 6 recipes at both a trivial deep-ITM strike and a
  representative ATM one (call = put = $3,769): every parity check reads exactly 0.
- **[Portfolio Greeks Dashboard](tool-portfolio-greeks.html)** — net delta/gamma/vega/theta
  for the same up-to-4-leg combination as the Strategy Builder, plus a delta-hedge
  suggestion. None of the Greeks Table, Strategy Builder, VaR Calculator, or P&L
  Attribution tools show a custom combination's raw net greeks. Verified with a long ATM
  call: delta (+0.531) and theta (-62.7 $/day) match exactly what the independent Greeks
  Table and Theta Decay Curve pages compute for the identical synthetic setup, the
  delta-hedge suggestion has the correct sign ("Sell" for positive delta), and adding an
  offsetting short call at the same strike nets delta to exactly 0.
- **[Roll Analyzer](tool-roll-analyzer.html)** — closing a near-dated option and opening
  a farther-dated one, a common real action for anyone running the Income Scanner or
  Wheel Strategy pages that nothing else here prices directly. Computes the net cash flow
  of both legs together. Verified with a short ATM call rolled from 7d to 30d: the credit
  ($1,947) matches the premium difference exactly (3,769 − 1,822), and toggling to the
  long side flips the same trade to an exact -$1,947 debit, confirming the sign convention
  is internally consistent.

## What's deliberately not included

A few items from a "full" advanced dashboard were left out because Deribit's free public
API doesn't support them without a backend/persistent storage or materially larger scope:

- **Cross-exchange comparison** (OKX, Bybit, etc.) — would need separate integrations
  against different APIs/domains; out of scope for a single-exchange static site.
- **Historical replay / time-travel** through past chain snapshots — needs a database.
- **Portfolio-level P&L / margin** — would require an authenticated account; this app
  only ever reads public market data.
- **Structured-product flow hedging** — depends on banks'/dealers' own OTC issuance and
  hedging books, which isn't published anywhere for free (or at all, publicly).
- **True index dispersion trading** — needs an index priced against 3+ constituents;
  crypto has no such instrument. The BTC/ETH Vol Pair page is the closest honest analog
  with two assets.

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

- `index.html` / `styles.css` — layout and dark trading-terminal theme, shared by every
  page in this project.
- `app.js` — all data fetching and rendering logic for the main ladder page.
- `quant.js` / `strategy-nav.js` — shared fetch/math helpers and the cross-page nav strip
  used by the seven standalone strategy pages (`strategy-*.html` / `strategy-*.js`,
  documented above). Deliberately does not share code with `app.js`'s own copies of
  similar functions (Black-Scholes, rank/percentile, etc.) — `app.js` is the
  already-tested main dashboard, and a little duplication is a safer tradeoff than
  risking a regression there.

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
