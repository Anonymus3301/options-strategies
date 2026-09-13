// Multi-Leg Greeks Forecast — standalone, REST-only.
// The Theta Decay Curve page shows one ATM option's theta accelerating toward expiry.
// Portfolio Greeks shows a custom combination's net delta/gamma/vega/theta as a single
// snapshot. Neither combines both ideas: this walks time-to-expiry down toward zero for
// the same up-to-4-leg combination as the Strategy Builder, holding spot and each leg's
// own IV fixed, and shows how ALL FOUR net greeks evolve together as expiry approaches —
// not just theta, and not just a single option.

const CURRENCY = "BTC";
const MAX_LEGS = 4;
const STEPS = 60;

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

function renderLegStrikeOptions() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return;
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  for (let i = 1; i <= MAX_LEGS; i++) {
    const sel = $(`leg${i}Strike`);
    const prev = sel.value;
    sel.innerHTML = strikes.map((s) => `<option value="${s}">${qFmt(s, 0)}</option>`).join("");
    if (strikes.includes(Number(prev))) sel.value = prev;
  }
}

function collectLegs() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
  if (!bucket || spot == null) return { spot, legs: [] };
  const legs = [];
  for (let i = 1; i <= MAX_LEGS; i++) {
    if (!$(`leg${i}Enable`).checked) continue;
    const type = $(`leg${i}Type`).value;
    const side = $(`leg${i}Side`).value;
    const strike = Number($(`leg${i}Strike`).value);
    const qty = Math.max(1, Number($(`leg${i}Qty`).value) || 1);
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_iv == null) continue;
    legs.push({ type, side, strike, qty, iv: sum.mark_iv });
  }
  return { spot, legs };
}

// Net delta/gamma/theta/vega at a given time-to-expiry T, holding spot and each leg's own
// IV fixed at today's quoted value -- the same simplification the Theta Decay Curve page
// already makes and discloses.
function netGreeksAt(legs, spot, T) {
  let delta = 0, gamma = 0, theta = 0, vega = 0;
  for (const leg of legs) {
    const sign = leg.side === "long" ? 1 : -1;
    const sigma = leg.iv / 100;
    delta += sign * leg.qty * qBsDelta(leg.type, spot, leg.strike, T, sigma);
    gamma += sign * leg.qty * qBsGamma(spot, leg.strike, T, sigma);
    theta += sign * leg.qty * qBsThetaPerDay(spot, leg.strike, T, sigma);
    vega += sign * leg.qty * qBsVega(spot, leg.strike, T, sigma);
  }
  return { delta, gamma, theta, vega };
}

function buildSeries(legs, spot, dte) {
  const minDte = Math.max(dte * 0.02, 0.25); // stop just short of exact expiry
  const series = { dte: [], delta: [], gamma: [], theta: [], vega: [] };
  for (let i = 0; i <= STEPS; i++) {
    const stepDte = dte - ((dte - minDte) * i) / STEPS;
    const T = stepDte / 365.25;
    const g = netGreeksAt(legs, spot, T);
    series.dte.push(stepDte);
    series.delta.push(g.delta);
    series.gamma.push(g.gamma);
    series.theta.push(g.theta);
    series.vega.push(g.vega);
  }
  return series;
}

function render() {
  const { spot, legs } = collectLegs();
  if (!legs.length || spot == null || !state.selectedExpiry) {
    ["deltaChart", "gammaChart", "thetaChart", "vegaChart"].forEach((id) => {
      $(id).innerHTML = '<p class="loading">Enable at least one leg</p>';
    });
    $("deltaTodayStat").textContent = "—";
    $("gammaTodayStat").textContent = "—";
    $("thetaTodayStat").textContent = "—";
    $("vegaTodayStat").textContent = "—";
    return;
  }

  const dte = Math.max((state.selectedExpiry - Date.now()) / (24 * 60 * 60 * 1000), 1);
  const series = buildSeries(legs, spot, dte);

  $("deltaChart").innerHTML = qBuildSparkline(series.delta, { color: "#35d399", zeroLine: true });
  $("gammaChart").innerHTML = qBuildSparkline(series.gamma, { color: "#f7931a", zeroLine: true });
  $("thetaChart").innerHTML = qBuildSparkline(series.theta, { color: "#ff5c7c", zeroLine: true });
  $("vegaChart").innerHTML = qBuildSparkline(series.vega, { color: "#8892a6", zeroLine: true });

  $("deltaTodayStat").textContent = qFmtSigned(series.delta[0], 3);
  $("gammaTodayStat").textContent = qFmtSigned(series.gamma[0], 5);
  $("thetaTodayStat").textContent = qFmtSigned(series.theta[0], 1);
  $("vegaTodayStat").textContent = qFmtSigned(series.vega[0], 1);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    renderLegStrikeOptions();
    const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
    const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderLegStrikeOptions();
  render();
});

for (let i = 1; i <= MAX_LEGS; i++) {
  for (const id of [`leg${i}Enable`, `leg${i}Type`, `leg${i}Side`, `leg${i}Strike`, `leg${i}Qty`]) {
    $(id).addEventListener("change", render);
  }
}

refresh();
setInterval(refresh, 30000);
