// Forward Variance (Variance Swap Term Structure) strategy page — standalone, REST-only.
// Bootstraps the model-free implied variance between two expiries from their own
// individually-computed fair variances (see quant.js's qModelFreeVariance / the Variance
// Swap page), the same way a forward interest rate is bootstrapped from two zero rates:
// annualized variance accumulates linearly in time, so
//   ForwardVar(T1,T2) = (T2*Var2 - T1*Var1) / (T2 - T1).

const CURRENCY = "BTC";
const MIN_STRIKES = 6;

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  frontExpiry: null,
  backExpiry: null,
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
  if (!state.frontExpiry || !state.instrumentsByExpiry.has(state.frontExpiry)) {
    state.frontExpiry = state.expiries[0] ?? null;
  }
  if (!state.backExpiry || !state.instrumentsByExpiry.has(state.backExpiry) || state.backExpiry <= state.frontExpiry) {
    state.backExpiry = state.expiries.find((ts) => ts > state.frontExpiry) ?? null;
  }
}

function renderSelects() {
  const frontSel = $("frontSelect"), backSel = $("backSelect");
  frontSel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.frontExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  backSel.innerHTML = state.expiries
    .filter((ts) => ts > state.frontExpiry)
    .map((ts) => `<option value="${ts}" ${ts === state.backExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  frontSel.disabled = false;
  backSel.disabled = false;
}

function fairVolForExpiry(ts) {
  const bucket = state.instrumentsByExpiry.get(ts);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return null;
  const T = Math.max((ts - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const curve = qBuildOtmPriceCurve(bucket, state.summaries, spot);
  if (curve.strikes.length < MIN_STRIKES) return null;
  const variance = qModelFreeVariance(curve.strikes, curve.prices, spot, T);
  return variance != null ? { variance, T, spot } : null;
}

function render() {
  const front = fairVolForExpiry(state.frontExpiry);
  const back = state.backExpiry ? fairVolForExpiry(state.backExpiry) : null;

  $("spotStat").textContent = front && front.spot != null ? "$" + qFmt(front.spot, 0) : "—";
  $("frontVolStat").textContent = front ? qFmt(Math.sqrt(front.variance) * 100, 1) + "%" : "Insufficient data";
  $("backVolStat").textContent = back ? qFmt(Math.sqrt(back.variance) * 100, 1) + "%" : "Insufficient data";

  const barEl = $("barChart");

  if (!front || !back) {
    $("forwardVolStat").textContent = "—";
    $("readStat").textContent = "—";
    barEl.innerHTML = '<p class="loading">Need both expiries to have enough listed strikes</p>';
    return;
  }

  const dT = back.T - front.T;
  if (dT <= 0) {
    $("forwardVolStat").textContent = "—";
    $("readStat").textContent = "Back expiry must be later than front";
    barEl.innerHTML = "";
    return;
  }

  const forwardVar = (back.T * back.variance - front.T * front.variance) / dT;
  if (forwardVar == null || forwardVar <= 0) {
    $("forwardVolStat").textContent = "Insufficient data (inconsistent term structure)";
    $("readStat").textContent = "—";
    barEl.innerHTML = qBuildBarChart(
      ["Front", "Back"],
      [Math.sqrt(front.variance) * 100, Math.sqrt(back.variance) * 100],
      { posColor: "#f7931a" }
    );
    return;
  }

  const forwardVol = Math.sqrt(forwardVar) * 100;
  const frontVol = Math.sqrt(front.variance) * 100;
  const backVol = Math.sqrt(back.variance) * 100;
  $("forwardVolStat").textContent = qFmt(forwardVol, 1) + "%";

  const vsBack = forwardVol - backVol;
  $("readStat").textContent =
    Math.abs(vsBack) < 2
      ? "Roughly flat — the forward period is priced similarly to the back expiry's own vol"
      : vsBack > 0
      ? `Forward period priced ${qFmt(vsBack, 1)}pp richer than the back expiry's own vol — term structure is upward-sloping into this window`
      : `Forward period priced ${qFmt(-vsBack, 1)}pp cheaper than the back expiry's own vol — term structure is downward-sloping into this window`;

  barEl.innerHTML = qBuildBarChart(["Front", "Back", "Forward"], [frontVol, backVol, forwardVol], { posColor: "#f7931a" });
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderSelects();
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("frontSelect").addEventListener("change", (e) => {
  state.frontExpiry = Number(e.target.value);
  if (state.backExpiry <= state.frontExpiry) state.backExpiry = null;
  refresh();
});
$("backSelect").addEventListener("change", (e) => {
  state.backExpiry = Number(e.target.value);
  refresh();
});

refresh();
setInterval(refresh, 30000);
