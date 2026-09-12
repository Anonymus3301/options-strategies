// Options Glossary — static reference content, no network calls. A simple text filter
// searches both term and definition.

const TERMS = [
  { term: "ATM (At-The-Money)", def: "A strike at or very close to the current spot price. Used throughout as the reference strike for straddles, expected move, and ATM IV." },
  { term: "ATM IV", def: "The implied volatility of the at-the-money strike for a given expiry — the single most-watched IV number, since it's the least skew-distorted." },
  { term: "Assignment", def: "When a short option is exercised against you, obligating you to deliver (short call) or buy (short put) the underlying at the strike. Relevant to the Income Scanner and Collar pages." },
  { term: "Backwardation", def: "When a dated future trades below spot/perp (negative basis) — the opposite of contango. See the Carry & Funding page." },
  { term: "Basis", def: "The difference between a dated future's price and spot (or the perpetual, used as a spot proxy here). Positive basis = contango; negative = backwardation." },
  { term: "Box Spread", def: "A call spread plus a put spread at the same two strikes; pays a fixed amount at expiry regardless of outcome, so its price implies a financing rate. See the Box Spread page." },
  { term: "Breakeven", def: "The underlying price at expiry where a position's total P&L (including premium paid/received) is exactly zero." },
  { term: "Butterfly", def: "Buy 1 lower strike, sell 2 middle strikes, buy 1 upper strike (or the put equivalent) — a cheap, defined-risk bet that price finishes near the middle strike." },
  { term: "Calendar Spread", def: "Sell a near-dated option, buy a longer-dated option at the same strike — a bet on the term structure or on the front leg decaying faster than the back leg." },
  { term: "Call", def: "An option giving the right (not obligation) to buy the underlying at the strike price." },
  { term: "Collar", def: "Sell an OTM call to fund an OTM put, producing a near-zero-cost hedge with a capped upside and a defined downside floor." },
  { term: "Contango", def: "When a dated future trades above spot/perp (positive basis) — the normal state in most futures markets. See the Carry & Funding page." },
  { term: "Conversion / Reversal", def: "Arbitrage-adjacent trades comparing a synthetic forward (long call + short put) against an actual futures price for the same expiry. See the Synthetic Forward page." },
  { term: "Cash-Secured Put (CSP)", def: "Selling a put while holding enough cash to buy the underlying at the strike if assigned — an income strategy scanned on the Income Scanner page." },
  { term: "Covered Call", def: "Selling a call against BTC you already hold, collecting premium in exchange for capping your upside above the strike." },
  { term: "Credit / Debit", def: "A credit trade collects net premium upfront; a debit trade pays net premium upfront. Not the same as \"good\" vs. \"bad\" — risk profile matters more." },
  { term: "Delta (Δ)", def: "How much an option's price changes per $1 move in the underlying, roughly 0 to 1 for calls and -1 to 0 for puts. Also used as a rough (not exact) probability of finishing in-the-money." },
  { term: "Defined Risk", def: "A structure whose maximum possible loss is capped and known in advance (e.g. Iron Condor, Butterfly), as opposed to undefined/unlimited risk (e.g. naked short calls, Ratio Spread)." },
  { term: "Diagonal Spread", def: "A calendar spread using two different strikes across the two expiries, adding directional exposure on top of the term-structure bet." },
  { term: "DTE (Days To Expiry)", def: "Calendar days remaining until an option's expiration. A major input to theta decay speed and gamma risk." },
  { term: "Expected Move", def: "The market's implied one-standard-deviation price range by expiry, typically approximated by the ATM straddle's price." },
  { term: "Funding Rate", def: "A periodic payment between long and short perpetual-future holders that keeps the perpetual's price near spot. Positive funding means longs pay shorts." },
  { term: "Gamma (Γ)", def: "How much an option's delta changes per $1 move in the underlying — highest for ATM, short-dated options. Large gamma means delta (and hedging needs) change fast." },
  { term: "Gamma Exposure (GEX)", def: "An estimate of aggregate gamma-weighted open interest by strike, sometimes used to reason about how market makers' hedging might amplify or dampen price moves near certain strikes." },
  { term: "IV (Implied Volatility)", def: "The volatility level, when plugged into an option pricing model, that reproduces the option's current market price. Higher IV = more expensive options." },
  { term: "IV Rank", def: "Where current IV sits between its own historical low and high (0-100 scale). This app builds it from a browser-local daily history, since no free historical-IV endpoint exists." },
  { term: "IV Percentile", def: "The percentage of days in a lookback period where IV was at or below today's level — similar in spirit to IV Rank but less sensitive to single outlier readings." },
  { term: "IV Surface", def: "The full grid of implied volatility across both strike (moneyness) and expiry (tenor) — the skew and term structure combined into one view." },
  { term: "Iron Condor", def: "A short strangle (short OTM call + short OTM put) with protective long wings further out on both sides — defined-risk premium selling." },
  { term: "Jade Lizard", def: "Short OTM put + a call credit spread, structured so that if the total credit covers the call spread's width, there's no risk to the upside at all." },
  { term: "Max Pain", def: "The strike where option OI implies the smallest aggregate payout to option holders (largest to writers) at expiry — a contested theory about where price might gravitate." },
  { term: "Mark Price", def: "An exchange's official reference price for an instrument (distinct from the last-traded price), typically used for margin, P&L, and settlement." },
  { term: "Moneyness", def: "How far a strike is from the current spot price, usually expressed as a percentage. Negative for calls above spot / puts below spot (OTM), positive the other way (ITM)." },
  { term: "OI (Open Interest)", def: "The total number of outstanding (not yet closed or expired) contracts at a given strike/expiry — a rough gauge of how much positioning exists there." },
  { term: "OTM / ITM", def: "Out-of-the-money: a strike with no intrinsic value if exercised now. In-the-money: a strike that would have positive value if exercised now." },
  { term: "P(ITM)", def: "An approximate probability of finishing in-the-money, commonly shorthanded as the absolute value of delta — not an exact risk-neutral probability." },
  { term: "Put", def: "An option giving the right (not obligation) to sell the underlying at the strike price." },
  { term: "Put/Call Ratio (PCR)", def: "Put volume or open interest divided by call volume or open interest. Extreme readings are sometimes read as contrarian sentiment signals — a weak, noisy one." },
  { term: "Protective Put", def: "Buying a put against BTC you hold, to floor your downside — portfolio insurance, priced by the Protective Put page." },
  { term: "Ratio Spread", def: "Buy 1 option, sell 2 further OTM options of the same type — often a small debit or even a credit, but with genuinely unlimited risk on the side with the extra short leg." },
  { term: "Backspread", def: "The mirror image of a ratio spread: sell 1 near-strike option, buy 2 further OTM — capped loss, unlimited profit potential." },
  { term: "Realized Volatility (RVol)", def: "The volatility actually observed in the underlying's price history over some lookback window (e.g. 30 days), as opposed to the market's IMPLIED volatility." },
  { term: "Risk Reversal (RR25)", def: "The IV of a ~25-delta call minus the IV of a ~25-delta put — a standard single-number measure of skew (which side is priced richer)." },
  { term: "Skew", def: "The pattern of implied volatility across different strikes at the same expiry — in BTC, puts are often priced richer than calls (\"put skew\"), reflecting downside-hedging demand." },
  { term: "Straddle", def: "Buying (or selling) both a call and a put at the same strike and expiry — a pure bet on volatility rather than direction." },
  { term: "Strangle", def: "Like a straddle but with the call and put at different (typically both OTM) strikes — cheaper than a straddle, needs a bigger move to profit if long." },
  { term: "Strap / Strip", def: "A weighted straddle (2 calls + 1 put, or 1 call + 2 puts) that keeps long-vol exposure while leaning bullish or bearish." },
  { term: "Synthetic Forward", def: "Long call + short put at the same strike replicates the payoff of a forward contract, via put-call parity." },
  { term: "Term Structure", def: "How ATM IV varies across different expiries — usually upward-sloping (further-dated options pricier in vol terms) but can invert around expected events." },
  { term: "Theta (Θ)", def: "How much an option's price decays per day, all else equal, as it gets closer to expiry — the cost of holding long options, the income of holding short options." },
  { term: "Vega (V)", def: "How much an option's price changes per 1-percentage-point move in implied volatility. Long options have positive vega; short options have negative vega." },
  { term: "Vol Risk Premium", def: "The gap between implied volatility and (subsequently) realized volatility. Historically positive on average, which is the basic rationale behind systematic premium-selling." },
];

TERMS.sort((a, b) => a.term.localeCompare(b.term));

function renderTerms(filter) {
  const el = document.getElementById("glossaryList");
  const f = filter.trim().toLowerCase();
  const matches = f
    ? TERMS.filter((t) => t.term.toLowerCase().includes(f) || t.def.toLowerCase().includes(f))
    : TERMS;

  if (!matches.length) {
    el.innerHTML = '<p class="glossary-empty">No terms match that search.</p>';
    return;
  }

  el.innerHTML = matches
    .map((t) => `<div class="glossary-term"><dt>${t.term}</dt><dd>${t.def}</dd></div>`)
    .join("");
}

document.getElementById("searchInput").addEventListener("input", (e) => renderTerms(e.target.value));
renderTerms("");
