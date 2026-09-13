// Historical Backtest (Custom Strategy) — standalone, REST-only.
// Every POP/VaR/CVaR stat on this site prices off the risk-neutral lognormal distribution
// implied by quoted IV, and the Scenario Analysis tool lets a user type in their own
// subjective probabilities instead. This tool uses neither: for the same up-to-4-leg
// combination as the Strategy Builder, it walks ~400 days of REAL BTC-PERPETUAL daily
// closes, and for every historical window matching the selected expiry's DTE, applies
// that window's ACTUAL % price move to today's spot and reprices the position there —
// building an empirical P&L distribution from what really happened in the market, the
// same historical-window technique the Empirical vs. Risk-Neutral POP page uses, but
// generalized from a single ATM straddle to any custom combination.

const CURRENCY = "BTC";
const MAX_LEGS = 4;
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

function renderLegStrikeOptions() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return;
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  for (let i = 1; i <= MAX_LEGS; i++) {
    const sel = $(`leg${i}Strike`);
    const prev = sel.value;
    sel.innerHTML = strikes.map((s) => `<option value="${s}">${qFmt(s, 0)}</option>`).join("");
    if (strikes.includes(Number(prev))) sel.value = prev;
  }
}

function collectLegs() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
  if (!bucket || spot == null) return { spot, legs: [] };
  const legs = [];
  for (let i = 1; i <= MAX_LEGS; i++) {
    if (!$(`leg${i}Enable`).checked) continue;
    const type = $(`leg${i}Type`).value;
    const side = $(`leg${i}Side`).value;
    const strike = Number($(`leg${i}Strike`).value);
    const qty = Math.max(1, Number($(`leg${i}Qty`).value) || 1);
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_price == null) continue;
    legs.push({ type, side, strike, premiumUsd: sum.mark_price * spot, qty });
  }
  return { spot, legs };
}

function percentile(sortedVals, p) {
  if (!sortedVals.length) return null;
  const idx = (p / 100) * (sortedVals.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedVals[lo];
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (idx - lo);
}

function runBacktest(legs, spot, dte) {
  const windows = state.closes.length - dte;
  if (windows < 20) return null;
  const pnls = [];
  for (let i = 0; i < windows; i++) {
    const movePct = state.closes[i + dte] / state.closes[i] - 1;
    const S = spot * (1 + movePct);
    pnls.push(qLegsPnlAt(legs, S));
  }
  const sorted = [...pnls].sort((a, b) => a - b);
  const wins = pnls.filter((p) => p > 0).length;
  return {
    windows: pnls.length,
    winRate: (wins / pnls.length) * 100,
    median: percentile(sorted, 50),
    p5: percentile(sorted, 5),
    p95: percentile(sorted, 95),
    best: sorted[sorted.length - 1],
    worst: sorted[0],
  };
}

function riskNeutralPop(legs, spot, dte) {
  const ivs = legs.map((l) => {
    const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
    const name = l.type === "call" ? bucket.calls.get(l.strike) : bucket.puts.get(l.strike);
    const sum = name ? state.summaries.get(name) : null;
    return sum && sum.mark_iv != null ? sum.mark_iv : null;
  }).filter((v) => v != null);
  if (!ivs.length) return null;
  const avgIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
  const T = dte / 365.25;
  return qComputeProbabilityOfProfit(legs, spot, avgIv / 100, T);
}

function render() {
  const { spot, legs } = collectLegs();
  const dte = state.selectedExpiry ? Math.max(1, Math.round((state.selectedExpiry - Date.now()) / (24 * 60 * 60 * 1000))) : null;

  if (!legs.length || spot == null || dte == null) {
    $("winRateStat").textContent = "—";
    $("medianStat").textContent = "—";
    $("rangeStat").textContent = "—";
    $("bestWorstStat").textContent = "—";
    $("riskNeutralStat").textContent = "—";
    $("windowsStat").textContent = "—";
    return;
  }

  const bt = runBacktest(legs, spot, dte);
  const rn = riskNeutralPop(legs, spot, dte);

  if (!bt) {
    $("winRateStat").textContent = "Not enough history for this DTE";
    $("medianStat").textContent = "—";
    $("rangeStat").textContent = "—";
    $("bestWorstStat").textContent = "—";
    $("riskNeutralStat").textContent = rn != null ? qFmt(rn, 0) + "%" : "—";
    $("windowsStat").textContent = "0";
    return;
  }

  $("winRateStat").textContent = `${qFmt(bt.winRate, 1)}%`;
  $("medianStat").textContent = qFmtSigned(bt.median, 0);
  $("rangeStat").textContent = `${qFmtSigned(bt.p5, 0)} — ${qFmtSigned(bt.p95, 0)}`;
  $("bestWorstStat").textContent = `${qFmtSigned(bt.best, 0)} / ${qFmtSigned(bt.worst, 0)}`;
  $("riskNeutralStat").textContent = rn != null ? qFmt(rn, 0) + "%" : "—";
  $("windowsStat").textContent = `${bt.windows} (${dte}d each, ${HISTORY_DAYS}d history)`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadData();
    renderExpirySelect();
    renderLegStrikeOptions();
    const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
    const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderLegStrikeOptions();
  render();
});

for (let i = 1; i <= MAX_LEGS; i++) {
  for (const id of [`leg${i}Enable`, `leg${i}Type`, `leg${i}Side`, `leg${i}Strike`, `leg${i}Qty`]) {
    $(id).addEventListener("change", render);
  }
}

refresh();
setInterval(refresh, 60000);
