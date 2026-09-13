// Convexity Arbitrage (25-delta Butterfly) strategy page — standalone, REST-only.
// The convexity-signal companion to the Skew Arbitrage page: that page trades the 25Δ
// Risk Reversal (RR25 = call25 IV - put25 IV) mean-reverting vs. its own range; this page
// trades the 25Δ Butterfly (BF25 = avg(call25 IV, put25 IV) - ATM IV) the same way — a
// standard FX-desk convexity/smile-steepness metric, independent of skew direction.
// Tracks its own rank/percentile history in this browser (a separate localStorage key
// from the Skew Arb page's RR history — app.js itself only computes BF live for display,
// it does not persist a BF history, so this page's history is not shared with it).

const CURRENCY = "BTC";
const BF_HISTORY_KEY = "btc-options-bf25-history-v1";
const BF_HISTORY_MAX_DAYS = 400;
const BF_HISTORY_MIN_DAYS = 5;

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

function computeConvexityForExpiry(expiryTs) {
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
  if (!call25 || !put25 || atmIv == null) return { spot, atmIv, expiry: expiryTs };
  return {
    spot,
    atmIv,
    expiry: expiryTs,
    bf: (call25.iv + put25.iv) / 2 - atmIv,
    call25,
    put25,
    atm,
    atmCallMark: atmCall ? atmCall.mark_price : null,
    atmPutMark: atmPut ? atmPut.mark_price : null,
    T,
  };
}

function updateBfRankStat(bf) {
  const history = qRecordDailyHistory(BF_HISTORY_KEY, "bf", bf, BF_HISTORY_MAX_DAYS);
  const values = history.map((h) => h.bf).filter((v) => v != null);
  const res = qComputeRankPercentile(bf, values, BF_HISTORY_MIN_DAYS);
  const el = $("bfRankStat");
  if (bf == null || res.days < BF_HISTORY_MIN_DAYS) {
    el.textContent = `Collecting history (${res.days}d so far, this browser — need ${BF_HISTORY_MIN_DAYS}+)`;
  } else {
    const extreme = res.percentile >= 80 || res.percentile <= 20;
    el.textContent =
      `BF Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)` +
      (extreme ? " — stretched vs. its own recent range" : "");
  }
  return res;
}

function renderBfTermChart(term) {
  const el = $("bfTermChart");
  const rows = term.filter((t) => t && t.bf != null);
  if (!rows.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  el.innerHTML = qBuildSparkline(rows.map((t) => t.bf), { color: "#f7931a", zeroLine: true });
}

function renderStructure(cv) {
  $("structExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("structInfo");
  const chartEl = $("payoffChart");
  const popEl = $("popStat");
  if (!cv || !cv.call25 || !cv.put25 || cv.spot == null || cv.atmCallMark == null || cv.atmPutMark == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    chartEl.innerHTML = "";
    if (popEl) popEl.textContent = "—";
    return;
  }
  const { spot, call25, put25, atm, atmCallMark, atmPutMark, bf, atmIv, T } = cv;
  const callPremiumUsd = call25.mark * spot;
  const putPremiumUsd = put25.mark * spot;
  const atmCallPremiumUsd = atmCallMark * spot;
  const atmPutPremiumUsd = atmPutMark * spot;

  const sellWings = bf >= 0;
  const legs = sellWings
    ? [
        { type: "call", side: "short", strike: call25.strike, premiumUsd: callPremiumUsd },
        { type: "put", side: "short", strike: put25.strike, premiumUsd: putPremiumUsd },
        { type: "call", side: "long", strike: atm, premiumUsd: atmCallPremiumUsd },
        { type: "put", side: "long", strike: atm, premiumUsd: atmPutPremiumUsd },
      ]
    : [
        { type: "call", side: "long", strike: call25.strike, premiumUsd: callPremiumUsd },
        { type: "put", side: "long", strike: put25.strike, premiumUsd: putPremiumUsd },
        { type: "call", side: "short", strike: atm, premiumUsd: atmCallPremiumUsd },
        { type: "put", side: "short", strike: atm, premiumUsd: atmPutPremiumUsd },
      ];
  const netCost = legs.reduce((sum, l) => sum + (l.side === "long" ? l.premiumUsd : -l.premiumUsd), 0);
  const structure = sellWings
    ? `Wings rich (BF ${qFmtSigned(bf, 1)}pp) → sell the 25Δ strangle, buy the ATM straddle (harvest rich convexity)`
    : `Wings cheap (BF ${qFmtSigned(bf, 1)}pp) → buy the 25Δ strangle, sell the ATM straddle (same shape as the Iron Butterfly page, entered here on the BF signal)`;

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Structure</span><span class="scanner-value">${structure}</span></div>
      <div class="scanner-row"><span class="scanner-label">ATM strike (IV)</span><span class="scanner-value">${qFmt(atm, 0)} (${qFmt(atmIv, 1)}%)</span></div>
      <div class="scanner-row"><span class="scanner-label">25Δ Call / Put strikes (IV)</span><span class="scanner-value">${qFmt(call25.strike, 0)} (${qFmt(call25.iv, 1)}%) / ${qFmt(put25.strike, 0)} (${qFmt(put25.iv, 1)}%)</span></div>
      <div class="scanner-row"><span class="scanner-label">Net cost</span><span class="scanner-value">${netCost >= 0 ? "debit $" + qFmt(netCost, 0) : "credit $" + qFmt(-netCost, 0)}</span></div>
    </div>`;

  chartEl.innerHTML = qBuildPayoffSvg(legs, spot);

  if (popEl) {
    const pop = qComputeProbabilityOfProfit(legs, spot, atmIv / 100, T);
    popEl.textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();

    const term = state.expiries.map((ts) => computeConvexityForExpiry(ts));
    const front = term.find((t) => t && t.bf != null);
    const selected = term.find((t) => t && t.expiry === state.selectedExpiry);

    $("spotStat").textContent = selected && selected.spot != null ? "$" + qFmt(selected.spot, 0) : "—";
    $("bfStat").textContent = selected && selected.bf != null ? `${qFmtSigned(selected.bf, 1)}pp` : "—";

    updateBfRankStat(front ? front.bf : null);
    renderBfTermChart(term.filter(Boolean));
    renderStructure(selected);

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
