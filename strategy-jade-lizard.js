// Jade Lizard strategy page — standalone, REST-only.
// Sell an OTM put near 25Δ, sell an OTM call near 20Δ, buy a further-OTM call at the
// selected width above the short call. If total credit covers the call spread's width,
// there's no loss above the short call strike no matter how high price goes.

const CURRENCY = "BTC";
const TARGET_PUT_DELTA = 0.25;
const TARGET_CALL_DELTA = 0.2;

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

function findDeltaStrike(strikes, bucket, type, targetDelta, spot, T) {
  let best = null, bestDiff = Infinity;
  for (const strike of strikes) {
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_iv == null || sum.mark_price == null) continue;
    const sigma = sum.mark_iv / 100;
    const delta = qBsDelta(type, spot, strike, T, sigma);
    const diff = Math.abs(Math.abs(delta) - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike, delta, mark: sum.mark_price, iv: sum.mark_iv };
    }
  }
  return best;
}

function computeJadeLizard(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  const shortPut = findDeltaStrike(strikes, bucket, "put", TARGET_PUT_DELTA, spot, T);
  const shortCall = findDeltaStrike(strikes, bucket, "call", TARGET_CALL_DELTA, spot, T);
  if (!shortPut || !shortCall) return { spot };

  const width = spot * (widthPct / 100);
  const callStrikesAbove = strikes.filter((s) => s > shortCall.strike);
  const longCallStrike = callStrikesAbove.length ? qClosestStrike(callStrikesAbove, shortCall.strike + width) : null;
  if (longCallStrike == null) return { spot, shortPut, shortCall };

  const longCall = state.summaries.get(bucket.calls.get(longCallStrike));
  if (!longCall || longCall.mark_price == null) return { spot, shortPut, shortCall, longCallStrike };

  const shortPutUsd = shortPut.mark * spot;
  const shortCallUsd = shortCall.mark * spot;
  const longCallUsd = longCall.mark_price * spot;
  const totalCredit = shortPutUsd + shortCallUsd - longCallUsd;
  const callSpreadWidth = longCallStrike - shortCall.strike;

  return {
    spot,
    shortPut,
    shortCall,
    longCallStrike,
    shortPutUsd,
    shortCallUsd,
    longCallUsd,
    totalCredit,
    callSpreadWidth,
    noUpsideRisk: totalCredit >= callSpreadWidth,
    downsideBreakeven: shortPut.strike - totalCredit,
  };
}

function renderJadeLizard(jl) {
  $("jlExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = jl && jl.spot != null ? "$" + qFmt(jl.spot, 0) : "—";

  if (!jl || jl.totalCredit == null) {
    $("strikesStat").textContent = "—";
    $("creditStat").textContent = "—";
    $("widthStat").textContent = "—";
    $("upsideRiskStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(jl.shortPut.strike, 0)} / ${qFmt(jl.shortCall.strike, 0)} / ${qFmt(jl.longCallStrike, 0)}`;
  $("creditStat").textContent = `$${qFmt(jl.totalCredit, 0)}`;
  $("widthStat").textContent = `$${qFmt(jl.callSpreadWidth, 0)}`;
  $("upsideRiskStat").textContent = jl.noUpsideRisk
    ? `None — credit covers the ${qFmt(jl.callSpreadWidth, 0)} width`
    : `Yes — credit is $${qFmt(jl.callSpreadWidth - jl.totalCredit, 0)} short of covering the width`;
  $("breakevenStat").textContent = qFmt(jl.downsideBreakeven, 0);

  const legs = [
    { type: "put", side: "short", strike: jl.shortPut.strike, premiumUsd: jl.shortPutUsd },
    { type: "call", side: "short", strike: jl.shortCall.strike, premiumUsd: jl.shortCallUsd },
    { type: "call", side: "long", strike: jl.longCallStrike, premiumUsd: jl.longCallUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, jl.spot);

  if ($("popStat")) {
    let pop = null;
    const ivs = [jl.shortPut.iv, jl.shortCall.iv].filter((v) => v != null);
    const sigmaPct = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
    if (sigmaPct != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, jl.spot, sigmaPct / 100, T);
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
    const jl = computeJadeLizard(widthPct);
    renderJadeLizard(jl);
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
