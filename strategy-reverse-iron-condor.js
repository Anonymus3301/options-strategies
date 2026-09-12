// Reverse Iron Condor strategy page — standalone, REST-only.
// Buy the inner put and call (an ATM-ish long strangle), sell the outer put and call
// further out to help fund it. Same 4 legs as an Iron Condor with long/short flipped: a
// net-debit, defined-risk bet on a big move, with a flat loss zone in the middle instead
// of a flat profit plateau.

const CURRENCY = "BTC";

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

function computeReverseIronCondor(innerPct, outerPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);

  const innerWidth = spot * (innerPct / 100);
  const outerWidth = spot * (outerPct / 100);

  const putCandidates = strikes.filter((s) => s < spot);
  const callCandidates = strikes.filter((s) => s > spot);
  const k2 = putCandidates.length ? qClosestStrike(putCandidates, spot - innerWidth) : null;
  const k3 = callCandidates.length ? qClosestStrike(callCandidates, spot + innerWidth) : null;
  if (k2 == null || k3 == null) return { spot };

  const k1Candidates = strikes.filter((s) => s < k2);
  const k4Candidates = strikes.filter((s) => s > k3);
  const k1 = k1Candidates.length ? qClosestStrike(k1Candidates, spot - outerWidth) : null;
  const k4 = k4Candidates.length ? qClosestStrike(k4Candidates, spot + outerWidth) : null;
  if (k1 == null || k4 == null) return { spot, k2, k3 };

  const shortPut = state.summaries.get(bucket.puts.get(k1));
  const longPut = state.summaries.get(bucket.puts.get(k2));
  const longCall = state.summaries.get(bucket.calls.get(k3));
  const shortCall = state.summaries.get(bucket.calls.get(k4));
  if (
    !shortPut || !longPut || !longCall || !shortCall ||
    shortPut.mark_price == null || longPut.mark_price == null || longCall.mark_price == null || shortCall.mark_price == null
  ) {
    return { spot, k1, k2, k3, k4 };
  }

  const shortPutUsd = shortPut.mark_price * spot;
  const longPutUsd = longPut.mark_price * spot;
  const longCallUsd = longCall.mark_price * spot;
  const shortCallUsd = shortCall.mark_price * spot;
  const netCost = longPutUsd + longCallUsd - shortPutUsd - shortCallUsd;
  const maxProfitHigh = (k4 - k3) - netCost;
  const maxProfitLow = (k2 - k1) - netCost;
  const breakevenHigh = k3 + netCost;
  const breakevenLow = k2 - netCost;
  const ivs = [shortPut.mark_iv, longPut.mark_iv, longCall.mark_iv, shortCall.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return {
    spot, k1, k2, k3, k4,
    shortPutUsd, longPutUsd, longCallUsd, shortCallUsd,
    netCost, maxProfitHigh, maxProfitLow, breakevenHigh, breakevenLow, avgIv,
  };
}

function renderReverseIronCondor(ric) {
  $("ricExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = ric && ric.spot != null ? "$" + qFmt(ric.spot, 0) : "—";

  if (!ric || ric.netCost == null) {
    $("strikesStat").textContent = "—";
    $("debitStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for these widths)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(ric.k1, 0)} / ${qFmt(ric.k2, 0)} / ${qFmt(ric.k3, 0)} / ${qFmt(ric.k4, 0)}`;
  $("debitStat").textContent = ric.netCost >= 0 ? `debit $${qFmt(ric.netCost, 0)}` : `credit $${qFmt(-ric.netCost, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(ric.maxProfitLow, 0)} below / +$${qFmt(ric.maxProfitHigh, 0)} above`;
  $("breakevenStat").textContent = `${qFmt(ric.breakevenLow, 0)} / ${qFmt(ric.breakevenHigh, 0)}`;

  const legs = [
    { type: "put", side: "short", strike: ric.k1, premiumUsd: ric.shortPutUsd },
    { type: "put", side: "long", strike: ric.k2, premiumUsd: ric.longPutUsd },
    { type: "call", side: "long", strike: ric.k3, premiumUsd: ric.longCallUsd },
    { type: "call", side: "short", strike: ric.k4, premiumUsd: ric.shortCallUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, ric.spot);

  if ($("popStat")) {
    let pop = null;
    if (ric.avgIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, ric.spot, ric.avgIv / 100, T);
    }
    $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const innerPct = Number($("innerSelect").value);
    const outerPct = Number($("outerSelect").value);
    const ric = computeReverseIronCondor(innerPct, outerPct);
    renderReverseIronCondor(ric);
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
$("innerSelect").addEventListener("change", refresh);
$("outerSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
