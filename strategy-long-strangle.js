// Long Strangle strategy page — standalone, REST-only.
// Buy an OTM call above spot and an OTM put below spot, both at a selectable width.
// Cheaper than the Long Volatility page's ATM straddle, but needs a bigger move to
// reach breakeven since both strikes start out-of-the-money.

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

function computeLongStrangle(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const width = spot * (widthPct / 100);

  const callCandidates = [...bucket.calls.keys()].filter((s) => s > spot);
  const putCandidates = [...bucket.puts.keys()].filter((s) => s < spot);
  const callStrike = callCandidates.length ? qClosestStrike(callCandidates, spot + width) : null;
  const putStrike = putCandidates.length ? qClosestStrike(putCandidates, spot - width) : null;
  if (callStrike == null || putStrike == null) return { spot };

  const call = state.summaries.get(bucket.calls.get(callStrike));
  const put = state.summaries.get(bucket.puts.get(putStrike));
  if (!call || !put || call.mark_price == null || put.mark_price == null) return { spot, callStrike, putStrike };

  const callUsd = call.mark_price * spot;
  const putUsd = put.mark_price * spot;
  const cost = callUsd + putUsd;
  const ivs = [call.mark_iv, put.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return {
    spot,
    callStrike,
    putStrike,
    callUsd,
    putUsd,
    cost,
    breakevenLow: putStrike - cost,
    breakevenHigh: callStrike + cost,
    avgIv,
  };
}

function renderLongStrangle(ls) {
  $("strangleExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = ls && ls.spot != null ? "$" + qFmt(ls.spot, 0) : "—";

  if (!ls || ls.cost == null) {
    $("strikesStat").textContent = "—";
    $("costStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(ls.putStrike, 0)} / ${qFmt(ls.callStrike, 0)}`;
  $("costStat").textContent = `$${qFmt(ls.cost, 0)}`;
  $("breakevenStat").textContent = `${qFmt(ls.breakevenLow, 0)} — ${qFmt(ls.breakevenHigh, 0)}`;

  const legs = [
    { type: "put", side: "long", strike: ls.putStrike, premiumUsd: ls.putUsd },
    { type: "call", side: "long", strike: ls.callStrike, premiumUsd: ls.callUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, ls.spot);

  if ($("popStat")) {
    let pop = null;
    if (ls.avgIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, ls.spot, ls.avgIv / 100, T);
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
    const ls = computeLongStrangle(widthPct);
    renderLongStrangle(ls);
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
