// Broken Wing Butterfly (call) strategy page — standalone, REST-only.
// Like the Butterfly Spread page but with independently selectable inner/outer wing
// widths. Buy 1 lower-strike call, sell 2 center-strike calls, buy 1 upper-strike call —
// when the outer wing is wider than the inner one, this is often financed for a net
// credit, which can (but doesn't automatically) eliminate risk above the upper wing.

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

function computeBrokenWing(innerPct, outerPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const centerStrike = qClosestStrike(strikes, spot);
  if (centerStrike == null) return { spot };

  const innerWidth = spot * (innerPct / 100);
  const outerWidth = spot * (outerPct / 100);
  const lowerCandidates = strikes.filter((s) => s < centerStrike);
  const upperCandidates = strikes.filter((s) => s > centerStrike);
  const lowerStrike = lowerCandidates.length ? qClosestStrike(lowerCandidates, centerStrike - innerWidth) : null;
  const upperStrike = upperCandidates.length ? qClosestStrike(upperCandidates, centerStrike + outerWidth) : null;
  if (lowerStrike == null || upperStrike == null) return { spot, centerStrike };

  const lowerCall = state.summaries.get(bucket.calls.get(lowerStrike));
  const centerCall = state.summaries.get(bucket.calls.get(centerStrike));
  const upperCall = state.summaries.get(bucket.calls.get(upperStrike));
  if (!lowerCall || !centerCall || !upperCall || lowerCall.mark_price == null || centerCall.mark_price == null || upperCall.mark_price == null) {
    return { spot, centerStrike, lowerStrike, upperStrike };
  }

  const lowerUsd = lowerCall.mark_price * spot;
  const centerUsd = centerCall.mark_price * spot;
  const upperUsd = upperCall.mark_price * spot;
  const netCost = lowerUsd + upperUsd - 2 * centerUsd;
  const maxProfit = centerStrike - lowerStrike - netCost;
  const belowLowerFlat = -netCost;
  const aboveUpperFlat = 2 * centerStrike - lowerStrike - upperStrike - netCost;

  return {
    spot,
    centerStrike,
    lowerStrike,
    upperStrike,
    lowerUsd,
    centerUsd,
    upperUsd,
    netCost,
    maxProfit,
    belowLowerFlat,
    aboveUpperFlat,
    centerIv: centerCall.mark_iv,
  };
}

function renderBrokenWing(bwb) {
  $("bwbExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = bwb && bwb.spot != null ? "$" + qFmt(bwb.spot, 0) : "—";

  if (!bwb || bwb.netCost == null) {
    $("strikesStat").textContent = "—";
    $("costStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("upsideRiskStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for these widths)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(bwb.lowerStrike, 0)} / ${qFmt(bwb.centerStrike, 0)} / ${qFmt(bwb.upperStrike, 0)}`;
  $("costStat").textContent = bwb.netCost >= 0 ? `debit $${qFmt(bwb.netCost, 0)}` : `credit $${qFmt(-bwb.netCost, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(bwb.maxProfit, 0)}`;
  $("upsideRiskStat").textContent =
    bwb.aboveUpperFlat >= 0
      ? `None — flat at +$${qFmt(bwb.aboveUpperFlat, 0)} above ${qFmt(bwb.upperStrike, 0)}`
      : `Yes — flat at -$${qFmt(-bwb.aboveUpperFlat, 0)} above ${qFmt(bwb.upperStrike, 0)}`;

  const legs = [
    { type: "call", side: "long", strike: bwb.lowerStrike, premiumUsd: bwb.lowerUsd },
    { type: "call", side: "short", strike: bwb.centerStrike, premiumUsd: bwb.centerUsd, qty: 2 },
    { type: "call", side: "long", strike: bwb.upperStrike, premiumUsd: bwb.upperUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, bwb.spot, { width: 700 });

  if ($("popStat")) {
    let pop = null;
    if (bwb.centerIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, bwb.spot, bwb.centerIv / 100, T);
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
    const bwb = computeBrokenWing(innerPct, outerPct);
    renderBrokenWing(bwb);
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
