// Put Backspread (1x2) strategy page — standalone, REST-only.
// Sell 1 near-ATM put, buy 2 puts at a further OTM (lower) strike. The bearish mirror of
// the Call Backspread page: capped loss at the long strike, large (though floor-bounded)
// profit the further price falls below it.

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

function computePutBackspread(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);

  const shortStrike = qClosestStrike(strikes, spot);
  if (shortStrike == null) return { spot };
  const width = spot * (widthPct / 100);
  const longCandidates = strikes.filter((s) => s < shortStrike);
  const longStrike = longCandidates.length ? qClosestStrike(longCandidates, shortStrike - width) : null;
  if (longStrike == null) return { spot, shortStrike };

  const shortPut = state.summaries.get(bucket.puts.get(shortStrike));
  const longPut = state.summaries.get(bucket.puts.get(longStrike));
  if (!shortPut || !longPut || shortPut.mark_price == null || longPut.mark_price == null) {
    return { spot, shortStrike, longStrike };
  }

  const shortUsd = shortPut.mark_price * spot;
  const longUsd = longPut.mark_price * spot;
  const netCost = 2 * longUsd - shortUsd; // positive = net debit, negative = net credit
  const maxLoss = shortStrike - longStrike + netCost;
  const downsideBreakeven = 2 * longStrike - shortStrike - netCost;
  const ivs = [shortPut.mark_iv, longPut.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, shortStrike, longStrike, shortUsd, longUsd, netCost, maxLoss, downsideBreakeven, avgIv };
}

function renderPutBackspread(bs) {
  $("backspreadExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = bs && bs.spot != null ? "$" + qFmt(bs.spot, 0) : "—";

  if (!bs || bs.netCost == null) {
    $("strikesStat").textContent = "—";
    $("netCostStat").textContent = "—";
    $("maxLossStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(bs.shortStrike, 0)} / ${qFmt(bs.longStrike, 0)}`;
  $("netCostStat").textContent = bs.netCost >= 0 ? `debit $${qFmt(bs.netCost, 0)}` : `credit $${qFmt(-bs.netCost, 0)}`;
  $("maxLossStat").textContent = bs.maxLoss > 0 ? `-$${qFmt(bs.maxLoss, 0)}` : `+$${qFmt(-bs.maxLoss, 0)} (no loss anywhere)`;
  $("breakevenStat").textContent = qFmt(bs.downsideBreakeven, 0);

  const legs = [
    { type: "put", side: "short", strike: bs.shortStrike, premiumUsd: bs.shortUsd },
    { type: "put", side: "long", strike: bs.longStrike, premiumUsd: bs.longUsd, qty: 2 },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, bs.spot, { width: 700 });

  if ($("popStat")) {
    let pop = null;
    if (bs.avgIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, bs.spot, bs.avgIv / 100, T);
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
    const bs = computePutBackspread(widthPct);
    renderPutBackspread(bs);
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
