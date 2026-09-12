// Put Ratio Spread (1x2) strategy page — standalone, REST-only.
// Buy 1 near-ATM put, sell 2 puts at a further OTM (lower) strike. The bearish mirror of
// the Call Ratio Spread page: risk runs down toward zero instead of up without limit.

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

function computePutRatioSpread(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);

  const longStrike = qClosestStrike(strikes, spot);
  if (longStrike == null) return { spot };
  const width = spot * (widthPct / 100);
  const shortCandidates = strikes.filter((s) => s < longStrike);
  const shortStrike = shortCandidates.length ? qClosestStrike(shortCandidates, longStrike - width) : null;
  if (shortStrike == null) return { spot, longStrike };

  const longPut = state.summaries.get(bucket.puts.get(longStrike));
  const shortPut = state.summaries.get(bucket.puts.get(shortStrike));
  if (!longPut || !shortPut || longPut.mark_price == null || shortPut.mark_price == null) {
    return { spot, longStrike, shortStrike };
  }

  const longUsd = longPut.mark_price * spot;
  const shortUsd = shortPut.mark_price * spot;
  const netCost = longUsd - 2 * shortUsd; // positive = net debit, negative = net credit
  const maxProfit = longStrike - shortStrike - netCost;
  const lowerBreakeven = shortStrike - maxProfit;
  const ivs = [longPut.mark_iv, shortPut.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, longStrike, shortStrike, longUsd, shortUsd, netCost, maxProfit, lowerBreakeven, avgIv };
}

function renderPutRatioSpread(rs) {
  $("ratioExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = rs && rs.spot != null ? "$" + qFmt(rs.spot, 0) : "—";

  if (!rs || rs.netCost == null) {
    $("strikesStat").textContent = "—";
    $("netCostStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(rs.longStrike, 0)} / ${qFmt(rs.shortStrike, 0)}`;
  $("netCostStat").textContent = rs.netCost >= 0 ? `debit $${qFmt(rs.netCost, 0)}` : `credit $${qFmt(-rs.netCost, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(rs.maxProfit, 0)}`;
  $("breakevenStat").textContent = qFmt(rs.lowerBreakeven, 0);

  const legs = [
    { type: "put", side: "long", strike: rs.longStrike, premiumUsd: rs.longUsd },
    { type: "put", side: "short", strike: rs.shortStrike, premiumUsd: rs.shortUsd, qty: 2 },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, rs.spot, { width: 700 });

  if ($("popStat")) {
    let pop = null;
    if (rs.avgIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, rs.spot, rs.avgIv / 100, T);
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
    const rs = computePutRatioSpread(widthPct);
    renderPutRatioSpread(rs);
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
