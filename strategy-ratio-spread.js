// Call Ratio Spread (1x2) strategy page — standalone, REST-only.
// Buy 1 near-ATM call, sell 2 calls at a further OTM strike. Unlike every other
// multi-leg page here, this one is genuinely undefined-risk above the upper breakeven.

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

function computeRatioSpread(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);

  const longStrike = qClosestStrike(strikes, spot);
  if (longStrike == null) return { spot };
  const width = spot * (widthPct / 100);
  const shortCandidates = strikes.filter((s) => s > longStrike);
  const shortStrike = shortCandidates.length ? qClosestStrike(shortCandidates, longStrike + width) : null;
  if (shortStrike == null) return { spot, longStrike };

  const longCall = state.summaries.get(bucket.calls.get(longStrike));
  const shortCall = state.summaries.get(bucket.calls.get(shortStrike));
  if (!longCall || !shortCall || longCall.mark_price == null || shortCall.mark_price == null) {
    return { spot, longStrike, shortStrike };
  }

  const longUsd = longCall.mark_price * spot;
  const shortUsd = shortCall.mark_price * spot;
  const netCost = longUsd - 2 * shortUsd; // positive = net debit, negative = net credit
  const maxProfit = shortStrike - longStrike - netCost;
  const upperBreakeven = shortStrike + maxProfit;

  return { spot, longStrike, shortStrike, longUsd, shortUsd, netCost, maxProfit, upperBreakeven };
}

function renderRatioSpread(rs) {
  $("ratioExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = rs && rs.spot != null ? "$" + qFmt(rs.spot, 0) : "—";

  if (!rs || rs.netCost == null) {
    $("strikesStat").textContent = "—";
    $("netCostStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(rs.longStrike, 0)} / ${qFmt(rs.shortStrike, 0)}`;
  $("netCostStat").textContent = rs.netCost >= 0 ? `debit $${qFmt(rs.netCost, 0)}` : `credit $${qFmt(-rs.netCost, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(rs.maxProfit, 0)}`;
  $("breakevenStat").textContent = qFmt(rs.upperBreakeven, 0);

  const legs = [
    { type: "call", side: "long", strike: rs.longStrike, premiumUsd: rs.longUsd },
    { type: "call", side: "short", strike: rs.shortStrike, premiumUsd: rs.shortUsd, qty: 2 },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, rs.spot, { width: 700 });
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const rs = computeRatioSpread(widthPct);
    renderRatioSpread(rs);
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
