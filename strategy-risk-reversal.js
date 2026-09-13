// Risk Reversal (25-Delta) strategy page — standalone, REST-only.
// A pure directional bet with no assumed underlying position: buy an OTM call and sell an
// OTM put (bullish), or the reverse (bearish), both near 25-delta. Unlike the Synthetic
// Forward's ATM, one-to-one strikes, the gap between the two OTM strikes creates a flat
// "dead zone" with no P&L in between. Verified numerically (scratchpad, bisection root
// find) that the payoff is monotonic on both sides (same-signed slope above and below the
// dead zone), so there is exactly ONE breakeven overall, not two — which one is "real"
// depends on whether the structure nets a debit or a credit.

const CURRENCY = "BTC";
const TARGET_DELTA = 0.25;

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

function computeRiskReversal(direction) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  let callStrike = null, callBestDiff = Infinity, callIv = null;
  for (const [strike, name] of bucket.calls) {
    if (strike <= spot) continue;
    const sum = state.summaries.get(name);
    if (!sum || sum.mark_iv == null) continue;
    const delta = qBsDelta("call", spot, strike, T, sum.mark_iv / 100);
    const diff = Math.abs(delta - TARGET_DELTA);
    if (diff < callBestDiff) {
      callBestDiff = diff;
      callStrike = strike;
      callIv = sum.mark_iv;
    }
  }
  let putStrike = null, putBestDiff = Infinity, putIv = null;
  for (const [strike, name] of bucket.puts) {
    if (strike >= spot) continue;
    const sum = state.summaries.get(name);
    if (!sum || sum.mark_iv == null) continue;
    const delta = qBsDelta("put", spot, strike, T, sum.mark_iv / 100);
    const diff = Math.abs(Math.abs(delta) - TARGET_DELTA);
    if (diff < putBestDiff) {
      putBestDiff = diff;
      putStrike = strike;
      putIv = sum.mark_iv;
    }
  }
  if (callStrike == null || putStrike == null) return { spot };

  const call = state.summaries.get(bucket.calls.get(callStrike));
  const put = state.summaries.get(bucket.puts.get(putStrike));
  if (!call || !put || call.mark_price == null || put.mark_price == null) return { spot, callStrike, putStrike };

  const callPremiumUsd = call.mark_price * spot;
  const putPremiumUsd = put.mark_price * spot;
  const avgIv = (callIv + putIv) / 2;

  let legs, netCost, breakeven;
  if (direction === "bullish") {
    legs = [
      { type: "put", side: "short", strike: putStrike, premiumUsd: putPremiumUsd },
      { type: "call", side: "long", strike: callStrike, premiumUsd: callPremiumUsd },
    ];
    netCost = callPremiumUsd - putPremiumUsd;
    breakeven = netCost >= 0 ? callStrike + netCost : putStrike + netCost;
  } else {
    legs = [
      { type: "put", side: "long", strike: putStrike, premiumUsd: putPremiumUsd },
      { type: "call", side: "short", strike: callStrike, premiumUsd: callPremiumUsd },
    ];
    netCost = putPremiumUsd - callPremiumUsd;
    breakeven = netCost >= 0 ? putStrike - netCost : callStrike - netCost;
  }

  return { spot, callStrike, putStrike, callPremiumUsd, putPremiumUsd, legs, netCost, breakeven, avgIv, T };
}

function renderPayoff(rr, direction) {
  $("payoffExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("payoffChart");
  const popEl = $("popStat");
  if (!rr || rr.spot == null || rr.legs == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    $("strikesStat").textContent = "—";
    $("netCostStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    if (popEl) popEl.textContent = "—";
    return;
  }
  const { spot, callStrike, putStrike, netCost, legs, breakeven, avgIv, T } = rr;
  $("strikesStat").textContent = `${qFmt(putStrike, 0)} / ${qFmt(callStrike, 0)}`;
  $("netCostStat").textContent = netCost >= 0 ? `debit $${qFmt(netCost, 0)}` : `credit $${qFmt(-netCost, 0)}`;
  $("breakevenStat").textContent = qFmt(breakeven, 0);
  const deadZoneVerb = netCost >= 0 ? "loses" : "keeps";
  $("deadZoneStat").textContent = `${qFmt(putStrike, 0)}–${qFmt(callStrike, 0)} (flat, ${deadZoneVerb} $${qFmt(Math.abs(netCost), 0)})`;

  el.innerHTML = qBuildPayoffSvg(legs, spot, { color: direction === "bullish" ? "#35d399" : "#ff5c7c" });

  if (popEl) {
    const pop = avgIv != null ? qComputeProbabilityOfProfit(legs, spot, avgIv / 100, T) : null;
    popEl.textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const direction = $("directionSelect").value;
    const rr = computeRiskReversal(direction);
    $("spotStat").textContent = rr && rr.spot != null ? "$" + qFmt(rr.spot, 0) : "—";
    renderPayoff(rr, direction);
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
$("directionSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
