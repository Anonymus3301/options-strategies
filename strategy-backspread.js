// Call Backspread (1x2) strategy page — standalone, REST-only.
// Sell 1 near-ATM call, buy 2 calls at a further OTM strike. Mirror image of the Ratio
// Spread page: capped loss (worst case sits at the long strike), unlimited profit above
// the upside breakeven.

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

function computeBackspread(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);

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
  const netCost = 2 * longUsd - shortUsd; // positive = net debit, negative = net credit
  const maxLoss = longStrike - shortStrike + netCost;
  const upsideBreakeven = 2 * longStrike - shortStrike + netCost;

  return { spot, shortStrike, longStrike, shortUsd, longUsd, netCost, maxLoss, upsideBreakeven };
}

function renderBackspread(bs) {
  $("backspreadExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = bs && bs.spot != null ? "$" + qFmt(bs.spot, 0) : "—";

  if (!bs || bs.netCost == null) {
    $("strikesStat").textContent = "—";
    $("netCostStat").textContent = "—";
    $("maxLossStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(bs.shortStrike, 0)} / ${qFmt(bs.longStrike, 0)}`;
  $("netCostStat").textContent = bs.netCost >= 0 ? `debit $${qFmt(bs.netCost, 0)}` : `credit $${qFmt(-bs.netCost, 0)}`;
  $("maxLossStat").textContent = bs.maxLoss > 0 ? `-$${qFmt(bs.maxLoss, 0)}` : `+$${qFmt(-bs.maxLoss, 0)} (no loss anywhere)`;
  $("breakevenStat").textContent = qFmt(bs.upsideBreakeven, 0);

  const legs = [
    { type: "call", side: "short", strike: bs.shortStrike, premiumUsd: bs.shortUsd },
    { type: "call", side: "long", strike: bs.longStrike, premiumUsd: bs.longUsd, qty: 2 },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, bs.spot, { width: 700 });
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const bs = computeBackspread(widthPct);
    renderBackspread(bs);
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
