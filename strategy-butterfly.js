// Butterfly Spread (low-vol pinning play) strategy page — standalone, REST-only.
// Built from calls throughout: buy 1 lower-strike call, sell 2 center-strike calls, buy 1
// upper-strike call. A put butterfly at the same three strikes has the same payoff shape
// at expiry, so calls-only keeps this simple without losing generality.

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

function computeMaxPain(strikes, bucket) {
  if (!strikes.length) return null;
  const oiAt = (nameOf) => strikes.map((s) => (state.summaries.get(nameOf(s)) || {}).open_interest || 0);
  const callOi = oiAt((s) => bucket.calls.get(s));
  const putOi = oiAt((s) => bucket.puts.get(s));
  let bestStrike = null, bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    strikes.forEach((k, i) => {
      if (settle > k) pain += (settle - k) * callOi[i];
      if (settle < k) pain += (k - settle) * putOi[i];
    });
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  return bestStrike;
}

function computeButterfly(centerMode, widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);

  const centerTarget = centerMode === "maxpain" ? computeMaxPain(strikes, bucket) : spot;
  const centerStrike = qClosestStrike(strikes, centerTarget);
  if (centerStrike == null) return { spot };

  const width = spot * (widthPct / 100);
  const lowerCandidates = strikes.filter((s) => s < centerStrike);
  const upperCandidates = strikes.filter((s) => s > centerStrike);
  const lowerStrike = lowerCandidates.length ? qClosestStrike(lowerCandidates, centerStrike - width) : null;
  const upperStrike = upperCandidates.length ? qClosestStrike(upperCandidates, centerStrike + width) : null;
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
  const netDebit = lowerUsd + upperUsd - 2 * centerUsd;
  const maxProfit = Math.min(centerStrike - lowerStrike, upperStrike - centerStrike) - netDebit;

  return {
    spot,
    centerStrike,
    lowerStrike,
    upperStrike,
    lowerUsd,
    centerUsd,
    upperUsd,
    netDebit,
    maxProfit,
    breakevenLow: lowerStrike + netDebit,
    breakevenHigh: upperStrike - netDebit,
    centerIv: centerCall.mark_iv,
  };
}

function renderButterfly(fly) {
  $("flyExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = fly && fly.spot != null ? "$" + qFmt(fly.spot, 0) : "—";

  if (!fly || fly.netDebit == null) {
    $("strikesStat").textContent = "—";
    $("debitStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(fly.lowerStrike, 0)} / ${qFmt(fly.centerStrike, 0)} / ${qFmt(fly.upperStrike, 0)}`;
  $("debitStat").textContent = `$${qFmt(fly.netDebit, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(fly.maxProfit, 0)}`;
  $("breakevenStat").textContent = `${qFmt(fly.breakevenLow, 0)} — ${qFmt(fly.breakevenHigh, 0)}`;

  const legs = [
    { type: "call", side: "long", strike: fly.lowerStrike, premiumUsd: fly.lowerUsd },
    { type: "call", side: "short", strike: fly.centerStrike, premiumUsd: fly.centerUsd, qty: 2 },
    { type: "call", side: "long", strike: fly.upperStrike, premiumUsd: fly.upperUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, fly.spot);

  if ($("popStat")) {
    let pop = null;
    if (fly.centerIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, fly.spot, fly.centerIv / 100, T);
    }
    $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const centerMode = $("centerSelect").value;
    const widthPct = Number($("widthSelect").value);
    const fly = computeButterfly(centerMode, widthPct);
    renderButterfly(fly);
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
$("centerSelect").addEventListener("change", refresh);
$("widthSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
