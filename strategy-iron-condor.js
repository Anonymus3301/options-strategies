// Iron Condor Builder strategy page — standalone, REST-only.
// Short strikes are found via Black-Scholes delta (~0.20) computed from each strike's own
// quoted mark IV; long wings sit at the selected width beyond each short strike.

const CURRENCY = "BTC";
const TARGET_SHORT_DELTA = 0.2;

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
      best = { strike, delta, mark: sum.mark_price };
    }
  }
  return best;
}

function computeCondor(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  const shortCall = findDeltaStrike(strikes, bucket, "call", TARGET_SHORT_DELTA, spot, T);
  const shortPut = findDeltaStrike(strikes, bucket, "put", TARGET_SHORT_DELTA, spot, T);
  if (!shortCall || !shortPut) return { spot };

  const width = spot * (widthPct / 100);
  const longCallTarget = shortCall.strike + width;
  const longPutTarget = shortPut.strike - width;
  const callStrikesAbove = strikes.filter((s) => s > shortCall.strike);
  const putStrikesBelow = strikes.filter((s) => s < shortPut.strike);
  const longCallStrike = callStrikesAbove.length ? qClosestStrike(callStrikesAbove, longCallTarget) : null;
  const longPutStrike = putStrikesBelow.length ? qClosestStrike(putStrikesBelow, longPutTarget) : null;
  if (longCallStrike == null || longPutStrike == null) return { spot, shortCall, shortPut };

  const longCall = state.summaries.get(bucket.calls.get(longCallStrike));
  const longPut = state.summaries.get(bucket.puts.get(longPutStrike));
  if (!longCall || !longPut || longCall.mark_price == null || longPut.mark_price == null) {
    return { spot, shortCall, shortPut, longCallStrike, longPutStrike };
  }

  const shortCallUsd = shortCall.mark * spot, shortPutUsd = shortPut.mark * spot;
  const longCallUsd = longCall.mark_price * spot, longPutUsd = longPut.mark_price * spot;
  const netCredit = shortCallUsd + shortPutUsd - longCallUsd - longPutUsd;
  const callWingWidth = longCallStrike - shortCall.strike;
  const putWingWidth = shortPut.strike - longPutStrike;
  const maxLoss = Math.max(callWingWidth, putWingWidth) - netCredit;

  return {
    spot,
    shortCall,
    shortPut,
    longCallStrike,
    longPutStrike,
    shortCallUsd,
    shortPutUsd,
    longCallUsd,
    longPutUsd,
    netCredit,
    maxLoss,
    breakevenLow: shortPut.strike - netCredit,
    breakevenHigh: shortCall.strike + netCredit,
  };
}

function renderCondor(condor) {
  $("condorExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = condor && condor.spot != null ? "$" + qFmt(condor.spot, 0) : "—";

  if (!condor || condor.netCredit == null) {
    $("strikesStat").textContent = "—";
    $("creditStat").textContent = "—";
    $("maxPnlStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(condor.longPutStrike, 0)} / ${qFmt(condor.shortPut.strike, 0)} / ${qFmt(condor.shortCall.strike, 0)} / ${qFmt(condor.longCallStrike, 0)}`;
  $("creditStat").textContent = `$${qFmt(condor.netCredit, 0)}`;
  $("maxPnlStat").textContent = `+$${qFmt(condor.netCredit, 0)} / -$${qFmt(condor.maxLoss, 0)}`;
  $("breakevenStat").textContent = `${qFmt(condor.breakevenLow, 0)} — ${qFmt(condor.breakevenHigh, 0)}`;

  const legs = [
    { type: "put", side: "long", strike: condor.longPutStrike, premiumUsd: condor.longPutUsd },
    { type: "put", side: "short", strike: condor.shortPut.strike, premiumUsd: condor.shortPutUsd },
    { type: "call", side: "short", strike: condor.shortCall.strike, premiumUsd: condor.shortCallUsd },
    { type: "call", side: "long", strike: condor.longCallStrike, premiumUsd: condor.longCallUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, condor.spot);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const condor = computeCondor(widthPct);
    renderCondor(condor);
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
