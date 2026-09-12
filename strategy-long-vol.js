// Long Volatility (cheap vol / event play) strategy page — standalone, REST-only.
// Inverts the Premium Selling scanner's scoring: favors buying when IV Rank is low, IV
// sits below realized vol, and the expiry is short-dated (cheap convexity per dollar).

const CURRENCY = "BTC";
const IV_HISTORY_KEY = "btc-options-iv-history-v1"; // same key app.js's IV Rank writes
const IV_HISTORY_MAX_DAYS = 400;
const IV_HISTORY_MIN_DAYS = 5;
const RVOL_WINDOWS = [7, 14, 30];

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  selectedExpiry: null,
  summaries: new Map(),
  rvolWindows: {},
};

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function loadChain() {
  const [instruments, summaries] = await Promise.all([
    qFetchInstruments(CURRENCY, "option", false),
    qFetchBookSummary(CURRENCY, "option"),
  ]);
  state.instrumentsByExpiry = qGroupByExpiry(instruments);
  state.expiries = [...state.instrumentsByExpiry.keys()].sort((a, b) => a - b);
  state.summaries = new Map(summaries.map((s) => [s.instrument_name, s]));
  if (!state.selectedExpiry || !state.instrumentsByExpiry.has(state.selectedExpiry)) {
    state.selectedExpiry = state.expiries[0] ?? null;
  }
}

function atmInfoForExpiry(ts) {
  const bucket = state.instrumentsByExpiry.get(ts);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot, strikes };
  const call = state.summaries.get(bucket.calls.get(atm));
  const put = state.summaries.get(bucket.puts.get(atm));
  const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
  return { spot, strikes, atmStrike: atm, call, put, atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null };
}

function computeTermStructure() {
  return state.expiries.map((ts) => ({ expiry: ts, ...atmInfoForExpiry(ts) }));
}

function renderExpirySelect() {
  const sel = $("expirySelect");
  sel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.selectedExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  sel.disabled = false;
}

async function refreshRealizedVol() {
  const ohlc = await qFetchDailyCloses("BTC-PERPETUAL", 31);
  const closes = ohlc && ohlc.close ? ohlc.close : [];
  const out = {};
  for (const w of RVOL_WINDOWS) out[w] = closes.length >= w + 1 ? qAnnualizedVol(closes.slice(-(w + 1))) : null;
  return out;
}

function computeStraddleCost(info) {
  if (!info || !info.call || !info.put || info.call.mark_price == null || info.put.mark_price == null || info.spot == null)
    return null;
  const usd = (info.call.mark_price + info.put.mark_price) * info.spot;
  return { usd, pct: (usd / info.spot) * 100 };
}

function updateIvRankStat(currentIv) {
  const history = qRecordDailyHistory(IV_HISTORY_KEY, "atmIv", currentIv, IV_HISTORY_MAX_DAYS);
  const values = history.map((h) => h.atmIv).filter((v) => v != null);
  const res = qComputeRankPercentile(currentIv, values, IV_HISTORY_MIN_DAYS);
  const el = $("ivRankStat");
  if (currentIv == null || res.days < IV_HISTORY_MIN_DAYS) {
    el.textContent = `Collecting history (${res.days}d so far, this browser — need ${IV_HISTORY_MIN_DAYS}+)`;
  } else {
    el.textContent = `Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)`;
  }
  return res;
}

function computeScanner(front, ivRank, rvolWindows) {
  const components = [];

  if (ivRank && ivRank.rank != null) {
    const score = ivRank.rank <= 30 ? 1 : ivRank.rank >= 60 ? -1 : 0;
    components.push({ label: "IV Rank (low favors buying)", value: `${qFmt(ivRank.rank, 0)} (${ivRank.days}d history)`, score });
  } else {
    components.push({ label: "IV Rank (low favors buying)", value: `Collecting history (${ivRank ? ivRank.days : 0}d so far)`, score: null });
  }

  const rvol30 = rvolWindows[30];
  const atmIv = front ? front.atmIv : null;
  if (atmIv != null && rvol30 != null) {
    const premium = atmIv - rvol30;
    const score = premium < -5 ? 1 : premium > 5 ? -1 : 0;
    components.push({
      label: "Vol Risk Premium (negative favors buying)",
      value: `${qFmtSigned(premium)}pp (IV ${qFmt(atmIv, 1)}% − RVol30 ${qFmt(rvol30, 1)}%)`,
      score,
    });
  } else {
    components.push({ label: "Vol Risk Premium (negative favors buying)", value: "—", score: null });
  }

  const dte = state.selectedExpiry != null ? (state.selectedExpiry - Date.now()) / (24 * 60 * 60 * 1000) : null;
  if (dte != null) {
    const score = dte <= 10 ? 1 : dte > 30 ? -1 : 0;
    components.push({ label: "Days to Expiry (shorter = more gamma per $)", value: `${qFmt(dte, 0)}d`, score });
  } else {
    components.push({ label: "Days to Expiry (shorter = more gamma per $)", value: "—", score: null });
  }

  const term = computeTermStructure();
  const allIvs = term.map((t) => t.atmIv).filter((v) => v != null);
  if (atmIv != null && allIvs.length >= 2) {
    const sorted = [...allIvs].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    const richness = atmIv - median;
    const score = richness < -3 ? 1 : richness > 3 ? -1 : 0;
    components.push({ label: "Term-Structure Cheapness", value: `${qFmtSigned(richness)}pp vs. curve median`, score });
  } else {
    components.push({ label: "Term-Structure Cheapness", value: "—", score: null });
  }

  const scored = components.filter((c) => c.score != null);
  const verdictScore = scored.length ? scored.reduce((a, c) => a + c.score, 0) / scored.length : null;
  let verdict, level;
  if (verdictScore == null) {
    verdict = "Insufficient data";
    level = "na";
  } else if (verdictScore >= 0.5) {
    verdict = "Conditions favor buying volatility";
    level = "favorable";
  } else if (verdictScore <= -0.5) {
    verdict = "Vol looks rich — buying looks unfavorable here";
    level = "unfavorable";
  } else {
    verdict = "Mixed / neutral signals";
    level = "neutral";
  }
  return { components, verdict, level };
}

function renderScanner(scanner) {
  const dotClass = (s) => (s == null ? "scanner-dot-na" : s > 0 ? "scanner-dot-green" : s < 0 ? "scanner-dot-red" : "scanner-dot-yellow");
  $("scannerBody").innerHTML = `
    <div class="scanner-verdict scanner-${scanner.level}">${scanner.verdict}</div>
    <div class="scanner-rows">
      ${scanner.components
        .map((c) => `<div class="scanner-row"><span class="scanner-dot ${dotClass(c.score)}"></span><span class="scanner-label">${c.label}</span><span class="scanner-value">${c.value}</span></div>`)
        .join("")}
    </div>`;
}

function renderStraddle(front) {
  $("straddleExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const cost = computeStraddleCost(front);
  const el = $("straddleInfo");
  const chartEl = $("payoffChart");
  if (!front || !front.spot || !cost || front.atmStrike == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    chartEl.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Buy call + put strike</span><span class="scanner-value">${qFmt(front.atmStrike, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Total premium paid</span><span class="scanner-value">$${qFmt(cost.usd, 0)} (${qFmt(cost.pct, 1)}% of spot)</span></div>
      <div class="scanner-row"><span class="scanner-label">Breakevens</span><span class="scanner-value">${qFmt(front.atmStrike - cost.usd, 0)} — ${qFmt(front.atmStrike + cost.usd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Needs a move of</span><span class="scanner-value">≥ ${qFmt(cost.pct, 1)}% either direction to profit at expiry</span></div>
    </div>`;
  const legs = [
    { type: "call", side: "long", strike: front.atmStrike, premiumUsd: front.call.mark_price * front.spot },
    { type: "put", side: "long", strike: front.atmStrike, premiumUsd: front.put.mark_price * front.spot },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, front.spot);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const term = computeTermStructure();
    const front = term.find((t) => t.expiry === state.selectedExpiry);
    const frontMonth = term.find((t) => t.atmIv != null);

    $("spotStat").textContent = front && front.spot != null ? "$" + qFmt(front.spot, 0) : "—";
    $("atmIvStat").textContent = front && front.atmIv != null ? qFmt(front.atmIv, 1) + "%" : "—";

    state.rvolWindows = await refreshRealizedVol();
    $("rvolStat").textContent = RVOL_WINDOWS.map((w) => `${w}D ${state.rvolWindows[w] != null ? qFmt(state.rvolWindows[w], 1) : "—"}`).join(" · ");

    const rvol30 = state.rvolWindows[30];
    const atmIv = frontMonth ? frontMonth.atmIv : null;
    $("premiumStat").textContent = atmIv != null && rvol30 != null ? `${qFmtSigned(atmIv - rvol30)}pp` : "—";

    const ivRank = updateIvRankStat(atmIv);

    const cost = computeStraddleCost(front);
    $("expectedMoveStat").textContent = cost != null ? `$${qFmt(cost.usd, 0)} (±${qFmt(cost.pct, 1)}%)` : "—";

    const scanner = computeScanner(frontMonth, ivRank, state.rvolWindows);
    renderScanner(scanner);
    renderStraddle(front);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  refresh();
});

refresh();
setInterval(refresh, 30000);
