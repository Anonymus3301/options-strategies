// Naked Call Writing strategy page — standalone, REST-only.
// Sell 1 OTM call with nothing behind it: no held BTC (unlike a covered call), no
// protective long call (unlike a Bear Call Spread). Genuinely unlimited risk.

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

function computeNakedCall(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const width = spot * (widthPct / 100);
  const candidates = [...bucket.calls.keys()].filter((s) => s > spot);
  const strike = candidates.length ? qClosestStrike(candidates, spot + width) : null;
  if (strike == null) return { spot };

  const call = state.summaries.get(bucket.calls.get(strike));
  if (!call || call.mark_price == null) return { spot, strike };

  const premiumUsd = call.mark_price * spot;
  const breakeven = strike + premiumUsd;

  return { spot, strike, premiumUsd, breakeven, iv: call.mark_iv };
}

function render(nc) {
  $("callExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = nc && nc.spot != null ? "$" + qFmt(nc.spot, 0) : "—";

  if (!nc || nc.premiumUsd == null) {
    $("strikeStat").textContent = "—";
    $("premiumStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    return;
  }

  $("strikeStat").textContent = qFmt(nc.strike, 0);
  $("premiumStat").textContent = `$${qFmt(nc.premiumUsd, 0)}`;
  $("breakevenStat").textContent = qFmt(nc.breakeven, 0);

  const legs = [{ type: "call", side: "short", strike: nc.strike, premiumUsd: nc.premiumUsd }];
  chartEl.innerHTML = qBuildPayoffSvg(legs, nc.spot);

  let pop = null;
  if (nc.iv != null && state.selectedExpiry) {
    const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
    pop = qComputeProbabilityOfProfit(legs, nc.spot, nc.iv / 100, T);
  }
  $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const nc = computeNakedCall(widthPct);
    render(nc);
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
