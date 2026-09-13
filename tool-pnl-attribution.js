// Greeks P&L Attribution — standalone, REST-only.
// For the same up-to-4-leg combination as the Strategy Builder tool, decomposes an
// assumed price move + days-elapsed into delta/gamma/theta Taylor-expansion contributions
// (P&L ≈ delta*ΔS + 0.5*gamma*ΔS² + theta*days) and compares that estimate against the
// ACTUAL repriced P&L from Black-Scholes at the new spot/time — showing directly how the
// second-order approximation's error grows as the assumed move gets larger, something no
// other page here visualizes (every other page either shows greeks as static snapshots or
// shows only the terminal, at-expiry payoff).

const CURRENCY = "BTC";
const MAX_LEGS = 4;

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
    if (!sum || sum.mark_price == null || sum.mark_iv == null) continue;
    legs.push({ type, side, strike, sigma: sum.mark_iv / 100, qty });
  }
  return { spot, legs };
}

function signedQty(leg) {
  return (leg.side === "long" ? 1 : -1) * leg.qty;
}

function renderResult() {
  const { spot, legs } = collectLegs();
  const movePct = Number($("moveInput").value) / 100;
  const daysElapsed = Number($("daysInput").value);

  if (!legs.length || spot == null || Number.isNaN(movePct) || Number.isNaN(daysElapsed)) {
    for (const id of ["deltaContribStat", "gammaContribStat", "thetaContribStat", "taylorTotalStat", "actualTotalStat", "errorStat"]) {
      $(id).textContent = "—";
    }
    return;
  }

  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const dS = spot * movePct;
  const newSpot = spot + dS;
  const dT = Math.min(daysElapsed / 365.25, T - 1 / 365 / 24);
  const newT = Math.max(T - dT, 1 / 365 / 24);

  let netDelta = 0, netGamma = 0, netThetaPerDay = 0;
  let originalValue = 0, newValue = 0;
  for (const leg of legs) {
    const q = signedQty(leg);
    netDelta += q * qBsDelta(leg.type, spot, leg.strike, T, leg.sigma);
    netGamma += q * qBsGamma(spot, leg.strike, T, leg.sigma);
    netThetaPerDay += q * qBsThetaPerDay(spot, leg.strike, T, leg.sigma);
    originalValue += q * qBsPrice(leg.type, spot, leg.strike, T, leg.sigma);
    newValue += q * qBsPrice(leg.type, newSpot, leg.strike, newT, leg.sigma);
  }

  const deltaContrib = netDelta * dS;
  const gammaContrib = 0.5 * netGamma * dS * dS;
  const thetaContrib = netThetaPerDay * daysElapsed;
  const taylorTotal = deltaContrib + gammaContrib + thetaContrib;
  const actualTotal = newValue - originalValue;
  const error = actualTotal - taylorTotal;

  $("deltaContribStat").textContent = `${qFmtSigned(deltaContrib, 0)} $`;
  $("gammaContribStat").textContent = `${qFmtSigned(gammaContrib, 0)} $`;
  $("thetaContribStat").textContent = `${qFmtSigned(thetaContrib, 0)} $`;
  $("taylorTotalStat").textContent = `${qFmtSigned(taylorTotal, 0)} $`;
  $("actualTotalStat").textContent = `${qFmtSigned(actualTotal, 0)} $`;
  $("errorStat").textContent = `${qFmtSigned(error, 0)} $ (${qFmt(Math.abs(actualTotal) > 1 ? (Math.abs(error) / Math.abs(actualTotal)) * 100 : 0, 1)}% of actual)`;
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
    renderResult();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderLegStrikeOptions();
  renderResult();
});
$("moveInput").addEventListener("input", renderResult);
$("daysInput").addEventListener("input", renderResult);

for (let i = 1; i <= MAX_LEGS; i++) {
  for (const id of [`leg${i}Enable`, `leg${i}Type`, `leg${i}Side`, `leg${i}Strike`, `leg${i}Qty`]) {
    $(id).addEventListener("change", renderResult);
  }
}

refresh();
setInterval(refresh, 30000);
