// Bear Call Spread strategy page — standalone, REST-only.
// Sell 1 near-ATM call, buy 1 call at a further OTM strike, same expiry. Defined-risk
// credit spread, the capped cousin of a naked short call.

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

function computeSpread(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...bucket.calls.keys()].sort((a, b) => a - b);

  const shortStrike = qClosestStrike(strikes, spot);
  if (shortStrike == null) return { spot };
  const width = spot * (widthPct / 100);
  const longCandidates = strikes.filter((s) => s > shortStrike);
  const longStrike = longCandidates.length ? qClosestStrike(longCandidates, shortStrike + width) : null;
  if (longStrike == null) return { spot, shortStrike };

  const shortCall = state.summaries.get(bucket.calls.get(shortStrike));
  const longCall = state.summaries.get(bucket.calls.get(longStrike));
  if (!shortCall || !longCall || shortCall.mark_price == null || longCall.mark_price == null) {
    return { spot, shortStrike, longStrike };
  }

  const shortUsd = shortCall.mark_price * spot;
  const longUsd = longCall.mark_price * spot;
  const netCredit = shortUsd - longUsd;
  const maxLoss = longStrike - shortStrike - netCredit;
  const breakeven = shortStrike + netCredit;
  const ivs = [shortCall.mark_iv, longCall.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, shortStrike, longStrike, shortUsd, longUsd, netCredit, maxLoss, breakeven, avgIv };
}

function render(sp) {
  $("spreadExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = sp && sp.spot != null ? "$" + qFmt(sp.spot, 0) : "—";

  if (!sp || sp.netCredit == null) {
    $("strikesStat").textContent = "—";
    $("creditStat").textContent = "—";
    $("maxLossStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(sp.shortStrike, 0)} / ${qFmt(sp.longStrike, 0)}`;
  $("creditStat").textContent = `$${qFmt(sp.netCredit, 0)}`;
  $("maxLossStat").textContent = `-$${qFmt(sp.maxLoss, 0)}`;
  $("breakevenStat").textContent = qFmt(sp.breakeven, 0);

  const legs = [
    { type: "call", side: "short", strike: sp.shortStrike, premiumUsd: sp.shortUsd },
    { type: "call", side: "long", strike: sp.longStrike, premiumUsd: sp.longUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, sp.spot);

  let pop = null;
  if (sp.avgIv != null && state.selectedExpiry) {
    const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
    pop = qComputeProbabilityOfProfit(legs, sp.spot, sp.avgIv / 100, T);
  }
  $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const sp = computeSpread(widthPct);
    render(sp);
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
