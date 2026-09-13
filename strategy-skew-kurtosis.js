// Skewness & Kurtosis: Historical vs. Risk-Neutral — standalone, REST-only.
// The Risk-Neutral Density page shows the market-implied distribution's SHAPE visually
// but never reduces it to an actual skewness/kurtosis number; Skew Arbitrage and Convexity
// Arb reduce the smile to RR25/BF25 in vol points, not statistical moments. This page
// computes real numeric skewness and excess kurtosis two ways for the same expiry — from
// the option-implied risk-neutral density (Breeden-Litzenberger, same construction as the
// Risk-Neutral Density page) in log-moneyness space, and from REAL historical BTC-PERPETUAL
// returns over a DTE-matched window (same window-matching idea as the VRP Term Structure
// and Empirical vs. Risk-Neutral POP pages) — then puts the two side by side.

const CURRENCY = "BTC";
const HISTORY_DAYS = 400;

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  selectedExpiry: null,
  summaries: new Map(),
  closes: [],
};

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function loadData() {
  const [instruments, summaries, ohlc] = await Promise.all([
    qFetchInstruments(CURRENCY, "option", false),
    qFetchBookSummary(CURRENCY, "option"),
    qFetchDailyCloses("BTC-PERPETUAL", HISTORY_DAYS),
  ]);
  state.instrumentsByExpiry = qGroupByExpiry(instruments);
  state.expiries = [...state.instrumentsByExpiry.keys()].sort((a, b) => a - b);
  state.summaries = new Map(summaries.map((s) => [s.instrument_name, s]));
  state.closes = ohlc && ohlc.close ? ohlc.close : [];
  if (!state.selectedExpiry || !state.instrumentsByExpiry.has(state.selectedExpiry)) {
    state.selectedExpiry = state.expiries[0] ?? null;
  }
}

function renderExpirySelect() {
  const sel = $("expirySelect");
  sel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.selectedExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  sel.disabled = false;
}

// Trapezoidal-weighted moments of ln(K/spot) under the (unnormalized) risk-neutral
// density f(K), reusing the identical Breeden-Litzenberger construction the Risk-Neutral
// Density page uses (second derivative of the call-equivalent price curve w.r.t. strike).
function riskNeutralMoments() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };

  const { strikes, prices, K0 } = qBuildOtmPriceCurve(bucket, state.summaries, spot);
  if (strikes.length < 9) return { spot, insufficient: true };
  const callEquiv = strikes.map((K, i) => (K >= K0 ? prices[i] : prices[i] + (spot - K)));

  const density = [];
  for (let i = 1; i < strikes.length - 1; i++) {
    const h1 = strikes[i] - strikes[i - 1];
    const h2 = strikes[i + 1] - strikes[i];
    const d2 = (2 / (h1 + h2)) * ((callEquiv[i + 1] - callEquiv[i]) / h2 - (callEquiv[i] - callEquiv[i - 1]) / h1);
    density.push({ x: Math.log(strikes[i] / spot), f: Math.max(d2, 0) });
  }
  if (density.length < 7) return { spot, insufficient: true };

  const moment = (power, center) => {
    let total = 0;
    for (let i = 0; i < density.length - 1; i++) {
      const a = Math.pow(density[i].x - center, power) * density[i].f;
      const b = Math.pow(density[i + 1].x - center, power) * density[i + 1].f;
      total += ((a + b) / 2) * (density[i + 1].x - density[i].x);
    }
    return total;
  };
  const totalMass = moment(0, 0);
  if (!(totalMass > 0)) return { spot, insufficient: true };

  const mean = moment(1, 0) / totalMass;
  const variance = moment(2, mean) / totalMass;
  const std = Math.sqrt(variance);
  const skew = std > 0 ? moment(3, mean) / totalMass / Math.pow(std, 3) : null;
  const kurtExcess = std > 0 ? moment(4, mean) / totalMass / Math.pow(std, 4) - 3 : null;

  return { spot, skew, kurtExcess };
}

// Sample skewness / excess kurtosis of DTE-day cumulative log returns from REAL history —
// the same overlapping-window technique the Empirical POP and Historical Backtest pages
// use, applied here to the 3rd/4th moments instead of a win rate or P&L distribution.
function historicalMoments(closes, dte) {
  const windows = closes.length - dte;
  if (windows < 30) return null;
  const rets = [];
  for (let i = 0; i < windows; i++) rets.push(Math.log(closes[i + dte] / closes[i]));
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const m2 = rets.reduce((sum, r) => sum + (r - mean) ** 2, 0) / n;
  const m3 = rets.reduce((sum, r) => sum + (r - mean) ** 3, 0) / n;
  const m4 = rets.reduce((sum, r) => sum + (r - mean) ** 4, 0) / n;
  const std = Math.sqrt(m2);
  const skew = std > 0 ? m3 / Math.pow(std, 3) : null;
  const kurtExcess = std > 0 ? m4 / Math.pow(std, 4) - 3 : null;
  return { skew, kurtExcess, windows: n };
}

function render() {
  const rn = riskNeutralMoments();
  $("spotStat").textContent = rn && rn.spot != null ? "$" + qFmt(rn.spot, 0) : "—";

  if (!rn || rn.insufficient || rn.spot == null || !state.selectedExpiry) {
    $("rnSkewStat").textContent = "—";
    $("rnKurtStat").textContent = "—";
    $("histSkewStat").textContent = "—";
    $("histKurtStat").textContent = "—";
    $("readStat").textContent = rn && rn.insufficient ? "Insufficient chain data for this expiry" : "—";
    return;
  }

  $("rnSkewStat").textContent = rn.skew != null ? qFmtSigned(rn.skew, 2) : "—";
  $("rnKurtStat").textContent = rn.kurtExcess != null ? qFmtSigned(rn.kurtExcess, 2) : "—";

  const dte = Math.max(1, Math.round((state.selectedExpiry - Date.now()) / (24 * 60 * 60 * 1000)));
  const hist = historicalMoments(state.closes, dte);

  if (!hist) {
    $("histSkewStat").textContent = "Not enough history for this DTE";
    $("histKurtStat").textContent = "—";
    $("readStat").textContent = "—";
    return;
  }

  $("histSkewStat").textContent = `${qFmtSigned(hist.skew, 2)} (${hist.windows} windows)`;
  $("histKurtStat").textContent = qFmtSigned(hist.kurtExcess, 2);

  if (rn.skew != null && hist.skew != null) {
    const sameSign = Math.sign(rn.skew) === Math.sign(hist.skew) || Math.abs(rn.skew) < 0.05 || Math.abs(hist.skew) < 0.05;
    $("readStat").textContent = sameSign
      ? "Risk-neutral and historical skew point the same general direction — the smile's asymmetry roughly agrees with what has actually happened."
      : "Risk-neutral and historical skew point in OPPOSITE directions — the market is pricing a different tail-risk shape than the one that has actually occurred over this lookback.";
  } else {
    $("readStat").textContent = "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadData();
    renderExpirySelect();
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  render();
});

refresh();
setInterval(refresh, 60000);
