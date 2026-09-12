// Iron Butterfly strategy page — standalone, REST-only.
// Sell the ATM call and put (the straddle), buy a call and put further out (the wings)
// at a selectable width. Same 4 legs as an Iron Condor, but the short strikes coincide
// at the center instead of sitting apart, so the payoff peaks rather than plateaus.

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

function computeIronButterfly(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const centerStrike = qClosestStrike(strikes, spot);
  if (centerStrike == null) return { spot };

  const shortCall = state.summaries.get(bucket.calls.get(centerStrike));
  const shortPut = state.summaries.get(bucket.puts.get(centerStrike));
  if (!shortCall || !shortPut || shortCall.mark_price == null || shortPut.mark_price == null) {
    return { spot, centerStrike };
  }

  const width = spot * (widthPct / 100);
  const callCandidates = strikes.filter((s) => s > centerStrike);
  const putCandidates = strikes.filter((s) => s < centerStrike);
  const longCallStrike = callCandidates.length ? qClosestStrike(callCandidates, centerStrike + width) : null;
  const longPutStrike = putCandidates.length ? qClosestStrike(putCandidates, centerStrike - width) : null;
  if (longCallStrike == null || longPutStrike == null) return { spot, centerStrike };

  const longCall = state.summaries.get(bucket.calls.get(longCallStrike));
  const longPut = state.summaries.get(bucket.puts.get(longPutStrike));
  if (!longCall || !longPut || longCall.mark_price == null || longPut.mark_price == null) {
    return { spot, centerStrike, longCallStrike, longPutStrike };
  }

  const shortCallUsd = shortCall.mark_price * spot;
  const shortPutUsd = shortPut.mark_price * spot;
  const longCallUsd = longCall.mark_price * spot;
  const longPutUsd = longPut.mark_price * spot;
  const netCredit = shortCallUsd + shortPutUsd - longCallUsd - longPutUsd;
  const callWingWidth = longCallStrike - centerStrike;
  const putWingWidth = centerStrike - longPutStrike;
  const maxLoss = Math.max(callWingWidth, putWingWidth) - netCredit;
  const ivs = [shortCall.mark_iv, shortPut.mark_iv].filter((v) => v != null);
  const centerIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return {
    spot,
    centerStrike,
    longCallStrike,
    longPutStrike,
    shortCallUsd,
    shortPutUsd,
    longCallUsd,
    longPutUsd,
    netCredit,
    maxLoss,
    breakevenLow: centerStrike - netCredit,
    breakevenHigh: centerStrike + netCredit,
    centerIv,
  };
}

function renderIronButterfly(ib) {
  $("ibExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = ib && ib.spot != null ? "$" + qFmt(ib.spot, 0) : "—";

  if (!ib || ib.netCredit == null) {
    $("strikesStat").textContent = "—";
    $("creditStat").textContent = "—";
    $("maxLossStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(ib.longPutStrike, 0)} / ${qFmt(ib.centerStrike, 0)} / ${qFmt(ib.longCallStrike, 0)}`;
  $("creditStat").textContent = `$${qFmt(ib.netCredit, 0)}`;
  $("maxLossStat").textContent = `-$${qFmt(ib.maxLoss, 0)}`;
  $("breakevenStat").textContent = `${qFmt(ib.breakevenLow, 0)} — ${qFmt(ib.breakevenHigh, 0)}`;

  const legs = [
    { type: "put", side: "long", strike: ib.longPutStrike, premiumUsd: ib.longPutUsd },
    { type: "put", side: "short", strike: ib.centerStrike, premiumUsd: ib.shortPutUsd },
    { type: "call", side: "short", strike: ib.centerStrike, premiumUsd: ib.shortCallUsd },
    { type: "call", side: "long", strike: ib.longCallStrike, premiumUsd: ib.longCallUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, ib.spot);

  if ($("popStat")) {
    let pop = null;
    if (ib.centerIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, ib.spot, ib.centerIv / 100, T);
    }
    $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const ib = computeIronButterfly(widthPct);
    renderIronButterfly(ib);
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
$("widthSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
