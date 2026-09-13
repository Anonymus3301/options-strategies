// Strategy Hub — an index/overview page for all 57 standalone strategy pages, plus a
// small live market snapshot (front-month IV, realized vol, vol risk premium, IV Rank)
// computed the same way the other pages do, standalone/REST-only.

const CURRENCY = "BTC";
const IV_HISTORY_KEY = "btc-options-iv-history-v1"; // same key app.js's IV Rank writes
const IV_HISTORY_MIN_DAYS = 5;

const $ = (id) => document.getElementById(id);

const CATEGORIES = [
  {
    title: "Directional Spreads (Verticals)",
    items: [
      { href: "strategy-bull-call-spread.html", title: "Bull Call Spread", desc: "Buy near-ATM call, sell further-OTM call — the most basic bullish debit spread.", risk: "defined" },
      { href: "strategy-bear-call-spread.html", title: "Bear Call Spread", desc: "Sell near-ATM call, buy further-OTM call — a defined-risk bearish/neutral credit spread.", risk: "defined" },
      { href: "strategy-bull-put-spread.html", title: "Bull Put Spread", desc: "Sell near-ATM put, buy further-OTM put — a defined-risk bullish/neutral credit spread.", risk: "defined" },
      { href: "strategy-bear-put-spread.html", title: "Bear Put Spread", desc: "Buy near-ATM put, sell further-OTM put — the most basic bearish debit spread.", risk: "defined" },
    ],
  },
  {
    title: "Volatility Selling",
    items: [
      { href: "strategy-premium-selling.html", title: "Premium Selling", desc: "Short strangle when IV is rich vs. realized vol.", risk: "undefined" },
      { href: "strategy-iron-condor.html", title: "Iron Condor Builder", desc: "Defined-risk version: short 20Δ strikes + protective wings.", risk: "defined" },
      { href: "strategy-butterfly.html", title: "Butterfly Spread", desc: "Cheap, defined-risk bet that price pins near a center strike.", risk: "defined" },
      { href: "strategy-jade-lizard.html", title: "Jade Lizard", desc: "Short put + call credit spread — checks if credit kills upside risk.", risk: "undefined" },
      { href: "strategy-broken-wing.html", title: "Broken Wing Butterfly", desc: "Asymmetric butterfly, often net credit — checks both flat regions honestly.", risk: "defined" },
      { href: "strategy-iron-butterfly.html", title: "Iron Butterfly", desc: "Short straddle + long wings — a single peak instead of the Condor's flat top.", risk: "defined" },
      { href: "strategy-broken-wing-condor.html", title: "Broken Wing Iron Condor", desc: "Independent put/call wing widths — an intentional lean instead of symmetric risk.", risk: "defined" },
      { href: "strategy-call-condor.html", title: "Call Condor Spread", desc: "All-calls 4-strike condor — a wider, flatter-topped cousin of the Butterfly.", risk: "defined" },
      { href: "strategy-put-condor.html", title: "Put Condor Spread", desc: "All-puts version of the Call Condor — identical payoff at the same 4 strikes.", risk: "defined" },
    ],
  },
  {
    title: "Volatility Buying",
    items: [
      { href: "strategy-long-vol.html", title: "Long Volatility", desc: "Long ATM straddle when IV looks cheap vs. realized vol.", risk: "defined" },
      { href: "strategy-long-strangle.html", title: "Long Strangle", desc: "Cheaper than a straddle, but needs a bigger move to pay off.", risk: "defined" },
      { href: "strategy-guts.html", title: "Guts (ITM Strangle)", desc: "Same shape as a strangle, with a guaranteed value locked in between strikes.", risk: "defined" },
      { href: "strategy-strap-strip.html", title: "Strap / Strip", desc: "Weighted straddle with a bullish or bearish lean.", risk: "defined" },
      { href: "strategy-backspread.html", title: "Call Backspread", desc: "Capped loss, unlimited upside — mirror of the Ratio Spread.", risk: "defined" },
      { href: "strategy-put-backspread.html", title: "Put Backspread", desc: "Capped loss, large downside profit — the bearish mirror of the Call Backspread.", risk: "defined" },
      { href: "strategy-reverse-iron-condor.html", title: "Reverse Iron Condor", desc: "Buy an inner strangle, sell an outer one — a capped-both-ways bet on a big move.", risk: "defined" },
    ],
  },
  {
    title: "Hedging & Income",
    items: [
      { href: "strategy-protective-put.html", title: "Protective Put", desc: "Cost of downside insurance at a selectable floor.", risk: "defined" },
      { href: "strategy-collar.html", title: "Collar", desc: "Near-zero-cost hedge: sell a call to fund a put.", risk: "defined" },
      { href: "strategy-covered-strangle.html", title: "Covered Strangle", desc: "Covered call plus a short put — extra income, but doubled downside below the put strike.", risk: "undefined" },
      { href: "strategy-covered-put.html", title: "Covered Put", desc: "For a short position: sell a put for income — capped profit, unlimited risk if price rises.", risk: "undefined" },
      { href: "strategy-income.html", title: "Covered Call / CSP Income", desc: "Scans the chain for the best annualized yield by delta band.", risk: "defined" },
      { href: "strategy-seagull.html", title: "Seagull Spread", desc: "3-leg Collar refinement: cheaper floor, but only partial protection below it.", risk: "defined" },
      { href: "strategy-wheel.html", title: "The Wheel Strategy", desc: "Sell CSPs, then covered calls if assigned, then repeat — illustrated as one live cycle.", risk: "defined" },
      { href: "strategy-covered-call-ratio.html", title: "Covered Call Overwrite (2:1)", desc: "2 short calls per 1 BTC held — flips a covered call's flat upside into unlimited loss above the strike.", risk: "undefined" },
      { href: "strategy-covered-put-ratio.html", title: "Covered Put Overwrite (2:1)", desc: "2 short puts per 1 BTC short — adds growing downside loss to a covered put's existing unlimited upside risk.", risk: "undefined" },
    ],
  },
  {
    title: "Term Structure & Skew",
    items: [
      { href: "strategy-skew-arb.html", title: "Skew Arbitrage", desc: "25Δ risk reversal mean-reversion vs. its own recent range.", risk: "defined" },
      { href: "strategy-calendar.html", title: "Calendar Spread", desc: "Sell front straddle, buy back straddle, same strike.", risk: "defined" },
      { href: "strategy-diagonal.html", title: "Diagonal Spread", desc: "Calendar spread with a directional lean via different strikes.", risk: "defined" },
      { href: "strategy-put-diagonal.html", title: "Put Diagonal Spread", desc: "Bearish mirror of the Diagonal Spread.", risk: "defined" },
      { href: "strategy-call-calendar.html", title: "Call Calendar Spread", desc: "Single-leg, cheaper cousin of the straddle Calendar Spread — mild bullish lean.", risk: "defined" },
      { href: "strategy-put-calendar.html", title: "Put Calendar Spread", desc: "Bearish-leaning mirror of the Call Calendar Spread.", risk: "defined" },
    ],
  },
  {
    title: "Carry & Arbitrage-Adjacent",
    items: [
      { href: "strategy-carry.html", title: "Carry & Funding", desc: "Dated-futures basis and perpetual funding-rate farming.", risk: "defined" },
      { href: "strategy-box-spread.html", title: "Box Spread", desc: "Fixed-payout structure whose price implies a financing rate.", risk: "defined" },
      { href: "strategy-synthetic.html", title: "Synthetic Forward", desc: "Options-implied forward vs. the actual dated future.", risk: "defined" },
      { href: "strategy-jelly-roll.html", title: "Jelly Roll", desc: "Front/back synthetic forwards at one strike — reveals cross-expiry forward inconsistency.", risk: "defined" },
    ],
  },
  {
    title: "Cross-Asset & Sentiment",
    items: [
      { href: "strategy-cross-asset.html", title: "BTC/ETH Vol Pair", desc: "Relative-value vol read across BTC and ETH.", risk: "defined" },
      { href: "strategy-maxpain.html", title: "Max Pain / Pin Risk", desc: "OI-implied pinning level — a contested theory, shown as data.", risk: "defined" },
      { href: "strategy-pcr.html", title: "PCR Contrarian Sentiment", desc: "Whole-chain put/call ratio vs. its own recent range.", risk: "defined" },
    ],
  },
  {
    title: "Undefined-Risk (flagged)",
    items: [
      { href: "strategy-ratio-spread.html", title: "Call Ratio Spread (1×2)", desc: "Often a credit, but genuinely unlimited risk above breakeven.", risk: "undefined" },
      { href: "strategy-call-ladder.html", title: "Call Ladder (Christmas Tree)", desc: "Cheaper bull spread that flips into an uncapped short above the top strike.", risk: "undefined" },
      { href: "strategy-put-ratio-spread.html", title: "Put Ratio Spread (1×2)", desc: "Bearish mirror of the Call Ratio Spread — severe risk toward zero below breakeven.", risk: "undefined" },
      { href: "strategy-put-ladder.html", title: "Put Ladder (Christmas Tree)", desc: "Bearish mirror of the Call Ladder — loses its floor below the lowest strike.", risk: "undefined" },
      { href: "strategy-naked-call.html", title: "Naked Call Writing", desc: "Sell a call with nothing behind it — the highest-risk-per-dollar structure here.", risk: "undefined" },
      { href: "strategy-naked-put.html", title: "Naked Put Writing", desc: "Sell a put on margin instead of fully cash-secured — capital-efficient, leverage risk.", risk: "undefined" },
    ],
  },
  {
    title: "Advanced / Quant Techniques",
    items: [
      { href: "strategy-variance-swap.html", title: "Variance Swap", desc: "Model-free implied vol (VIX/DVOL-style) from the whole chain, not just ATM IV.", risk: "defined" },
      { href: "strategy-gamma-scalping.html", title: "Gamma Scalping", desc: "Backtests a daily-rehedged long straddle over real price history.", risk: "defined" },
      { href: "strategy-pmcc.html", title: "Poor Man's Covered Call", desc: "Deep-ITM long-dated call stands in for spot — capital-efficient, risk-defined.", risk: "defined" },
      { href: "strategy-pmcp.html", title: "Poor Man's Covered Put", desc: "Bearish mirror of the PMCC — deep-ITM long-dated put stands in for a short.", risk: "defined" },
      { href: "strategy-double-calendar.html", title: "Double Calendar Spread", desc: "Two calendars stacked at OTM strikes for a wider neutral profit zone.", risk: "defined" },
      { href: "strategy-double-diagonal.html", title: "Double Diagonal Spread", desc: "A call diagonal + a put diagonal — cheaper than the Double Calendar for a similar range.", risk: "defined" },
      { href: "strategy-forward-variance.html", title: "Forward Variance", desc: "Bootstraps the implied vol for the period between two expiries, not just each endpoint.", risk: "defined" },
      { href: "strategy-vega-neutral-calendar.html", title: "Vega-Neutral Calendar", desc: "Sizes the back leg so net vega ≈ 0, isolating the theta/gamma bet.", risk: "defined" },
      { href: "strategy-hedged-risk-reversal.html", title: "Delta-Hedged Risk Reversal", desc: "Skew Arbitrage plus a hedge sized to null the initial directional lean.", risk: "defined" },
    ],
  },
];

function renderHubGrid() {
  const el = $("hubGrid");
  el.innerHTML = CATEGORIES.map(
    (cat) => `
    <div class="hub-category">
      <h3>${cat.title}</h3>
      <div class="hub-links">
        ${cat.items
          .map(
            (item) => `
          <a class="hub-link" href="${item.href}">
            <span class="hub-link-title">${item.title}</span>
            <span class="hub-risk-tag hub-risk-${item.risk}">${item.risk}</span>
            <span class="hub-link-desc">${item.desc}</span>
          </a>`
          )
          .join("")}
      </div>
    </div>`
  ).join("");
}

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function fetchFrontMonthAtmIv() {
  const [instruments, summaries] = await Promise.all([
    qFetchInstruments(CURRENCY, "option", false),
    qFetchBookSummary(CURRENCY, "option"),
  ]);
  const byExpiry = qGroupByExpiry(instruments);
  const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
  const expiries = [...byExpiry.keys()].sort((a, b) => a - b);
  for (const ts of expiries) {
    const bucket = byExpiry.get(ts);
    const spot = qImpliedSpot(bucket, summaryMap);
    if (spot == null) continue;
    const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])];
    const atm = qClosestStrike(strikes, spot);
    if (atm == null) continue;
    const call = summaryMap.get(bucket.calls.get(atm));
    const put = summaryMap.get(bucket.puts.get(atm));
    const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
    if (!ivs.length) continue;
    return { atmIv: ivs.reduce((a, b) => a + b, 0) / ivs.length, spot };
  }
  return null;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [front, ohlc] = await Promise.all([fetchFrontMonthAtmIv(), qFetchDailyCloses("BTC-PERPETUAL", 31)]);

    $("spotStat").textContent = front && front.spot != null ? "$" + qFmt(front.spot, 0) : "—";
    $("ivStat").textContent = front && front.atmIv != null ? qFmt(front.atmIv, 1) + "%" : "—";

    const rvol30 = ohlc && ohlc.close ? qAnnualizedVol(ohlc.close.slice(-31)) : null;
    $("rvolStat").textContent = rvol30 != null ? qFmt(rvol30, 1) + "%" : "—";

    const atmIv = front ? front.atmIv : null;
    if (atmIv != null && rvol30 != null) {
      const premium = atmIv - rvol30;
      $("premiumStat").textContent = `${qFmtSigned(premium, 1)}pp — ${premium > 5 ? "favors selling (Premium Selling / Iron Condor)" : premium < -5 ? "favors buying (Long Volatility)" : "roughly balanced"}`;
    } else {
      $("premiumStat").textContent = "—";
    }

    const history = qRecordDailyHistory(IV_HISTORY_KEY, "atmIv", atmIv, 400);
    const values = history.map((h) => h.atmIv).filter((v) => v != null);
    const res = qComputeRankPercentile(atmIv, values, IV_HISTORY_MIN_DAYS);
    $("ivRankStat").textContent =
      atmIv == null || res.days < IV_HISTORY_MIN_DAYS
        ? `Collecting history (${res.days}d so far, this browser — need ${IV_HISTORY_MIN_DAYS}+)`
        : `Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)`;

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

renderHubGrid();
refresh();
setInterval(refresh, 60000);
