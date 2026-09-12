// Skew Arbitrage (25-delta Risk Reversal) strategy page — standalone, REST-only.
// 25-delta strikes are found via Black-Scholes delta computed from each strike's own
// quoted mark IV (no live greeks needed), against an implied spot from put-call parity.

const CURRENCY = "BTC";
const SKEW_HISTORY_KEY = "btc-options-skew-history-v1"; // same key app.js's Skew Rank writes
const SKEW_HISTORY_MAX_DAYS = 400;
const SKEW_HISTORY_MIN_DAYS = 5;

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  selectedExpiry: null,
  summaries: new Map(),
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

function renderExpirySelect() {
  const sel = $("expirySelect");
  sel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.selectedExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  sel.disabled = false;
}

function findDeltaStrike(strikes, bucket, type, targetDelta, spot, T) {
  let best = null, bestDiff = Infinity;
  for (const strike of strikes) {
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_iv == null) continue;
    const sigma = sum.mark_iv / 100;
    const delta = qBsDelta(type, spot, strike, T, sigma);
    const diff = Math.abs(delta - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike, delta, iv: sum.mark_iv, mark: sum.mark_price };
    }
  }
  return best;
}

function computeSkewForExpiry(expiryTs) {
  const bucket = state.instrumentsByExpiry.get(expiryTs);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (spot == null || atm == null) return null;
  const T = Math.max((expiryTs - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const call25 = findDeltaStrike(strikes, bucket, "call", 0.25, spot, T);
  const put25 = findDeltaStrike(strikes, bucket, "put", -0.25, spot, T);
  const atmCall = state.summaries.get(bucket.calls.get(atm));
  const atmPut = state.summaries.get(bucket.puts.get(atm));
  const atmIvs = [atmCall && atmCall.mark_iv, atmPut && atmPut.mark_iv].filter((v) => v != null);
  const atmIv = atmIvs.length ? atmIvs.reduce((a, b) => a + b, 0) / atmIvs.length : null;
  if (!call25 || !put25) return { spot, atmIv, expiry: expiryTs };
  return {
    spot,
    atmIv,
    expiry: expiryTs,
    rr: call25.iv - put25.iv,
    bf: atmIv != null ? (call25.iv + put25.iv) / 2 - atmIv : null,
    call25,
    put25,
  };
}

function updateSkewRankStat(rr) {
  const history = qRecordDailyHistory(SKEW_HISTORY_KEY, "rr", rr, SKEW_HISTORY_MAX_DAYS);
  const values = history.map((h) => h.rr).filter((v) => v != null);
  const res = qComputeRankPercentile(rr, values, SKEW_HISTORY_MIN_DAYS);
  const el = $("skewRankStat");
  if (rr == null || res.days < SKEW_HISTORY_MIN_DAYS) {
    el.textContent = `Collecting history (${res.days}d so far, this browser — need ${SKEW_HISTORY_MIN_DAYS}+)`;
  } else {
    const extreme = res.percentile >= 80 || res.percentile <= 20;
    el.textContent =
      `RR Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)` +
      (extreme ? " — stretched vs. its own recent range" : "");
  }
  return res;
}

function renderRrTermChart(term) {
  const el = $("rrTermChart");
  const rows = term.filter((t) => t.rr != null);
  if (!rows.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const values = rows.map((t) => t.rr);
  el.innerHTML = qBuildSparkline(values, { color: "#f7931a", zeroLine: true });
}

function renderRrInfo(skew) {
  $("rrExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("rrInfo");
  const chartEl = $("payoffChart");
  if (!skew || !skew.call25 || !skew.put25 || skew.spot == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    chartEl.innerHTML = "";
    return;
  }
  const richer = skew.rr < 0 ? "put" : "call";
  const structure =
    richer === "put"
      ? `Puts richer (RR ${qFmtSigned(skew.rr, 1)}pp) → sell the 25Δ put, buy the 25Δ call (bullish risk reversal)`
      : `Calls richer (RR ${qFmtSigned(skew.rr, 1)}pp) → sell the 25Δ call, buy the 25Δ put (bearish risk reversal)`;

  const callPremiumUsd = skew.call25.mark != null ? skew.call25.mark * skew.spot : null;
  const putPremiumUsd = skew.put25.mark != null ? skew.put25.mark * skew.spot : null;
  const netCredit = richer === "put" ? putPremiumUsd - callPremiumUsd : callPremiumUsd - putPremiumUsd;

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Structure</span><span class="scanner-value">${structure}</span></div>
      <div class="scanner-row"><span class="scanner-label">25Δ Call strike (IV)</span><span class="scanner-value">${qFmt(skew.call25.strike, 0)} (${qFmt(skew.call25.iv, 1)}%, Δ${qFmt(skew.call25.delta, 2)})</span></div>
      <div class="scanner-row"><span class="scanner-label">25Δ Put strike (IV)</span><span class="scanner-value">${qFmt(skew.put25.strike, 0)} (${qFmt(skew.put25.iv, 1)}%, Δ${qFmt(skew.put25.delta, 2)})</span></div>
      <div class="scanner-row"><span class="scanner-label">Net premium</span><span class="scanner-value">${netCredit != null ? (netCredit >= 0 ? "credit $" + qFmt(netCredit, 0) : "debit $" + qFmt(-netCredit, 0)) : "—"}</span></div>
    </div>`;

  if (callPremiumUsd != null && putPremiumUsd != null) {
    const legs =
      richer === "put"
        ? [
            { type: "put", side: "short", strike: skew.put25.strike, premiumUsd: putPremiumUsd },
            { type: "call", side: "long", strike: skew.call25.strike, premiumUsd: callPremiumUsd },
          ]
        : [
            { type: "call", side: "short", strike: skew.call25.strike, premiumUsd: callPremiumUsd },
            { type: "put", side: "long", strike: skew.put25.strike, premiumUsd: putPremiumUsd },
          ];
    chartEl.innerHTML = qBuildPayoffSvg(legs, skew.spot);
  } else {
    chartEl.innerHTML = "";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();

    const term = state.expiries.map((ts) => computeSkewForExpiry(ts));
    const front = term.find((t) => t && t.rr != null);
    const selected = term.find((t) => t && t.expiry === state.selectedExpiry);

    $("spotStat").textContent = selected && selected.spot != null ? "$" + qFmt(selected.spot, 0) : "—";
    $("rrStat").textContent = selected && selected.rr != null ? `${qFmtSigned(selected.rr, 1)}pp` : "—";
    $("bfStat").textContent = selected && selected.bf != null ? `${qFmtSigned(selected.bf, 1)}pp` : "—";

    updateSkewRankStat(front ? front.rr : null);
    renderRrTermChart(term.filter(Boolean));
    renderRrInfo(selected);

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
