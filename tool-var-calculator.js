// Options Portfolio VaR / CVaR Calculator — standalone, REST-only.
// Every Probability of Profit stat on this site answers "how likely is a loss," a binary
// read. It never answers "how bad could that loss actually be." This tool does: given the
// same kind of up-to-4-leg combination the Strategy Builder tool lets you assemble, it
// numerically integrates the payoff against the lognormal terminal-price distribution
// (same risk-neutral, driftless-in-log convention as qComputeProbabilityOfProfit) to find
// Value-at-Risk (the loss threshold at a confidence level) and Conditional VaR / Expected
// Shortfall (the average loss given you're already in that tail) at 95% and 99%.

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
  let ivSum = 0, ivCount = 0;
  for (let i = 1; i <= MAX_LEGS; i++) {
    if (!$(`leg${i}Enable`).checked) continue;
    const type = $(`leg${i}Type`).value;
    const side = $(`leg${i}Side`).value;
    const strike = Number($(`leg${i}Strike`).value);
    const qty = Math.max(1, Number($(`leg${i}Qty`).value) || 1);
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_price == null) continue;
    const premiumUsd = sum.mark_price * spot;
    legs.push({ type, side, strike, premiumUsd, qty });
    if (sum.mark_iv != null) {
      ivSum += sum.mark_iv;
      ivCount++;
    }
  }
  return { spot, legs, avgIv: ivCount ? ivSum / ivCount : null };
}

// Numerically integrates the payoff against the lognormal terminal-price density (same
// convention as qComputeProbabilityOfProfitFn), builds a (price, density, pnl) grid, sorts
// by pnl ascending, then walks from the worst outcome forward accumulating probability
// mass to find the VaR threshold and the mass-weighted average loss beyond it (CVaR).
function computeVarCvar(legs, spot, sigma, T, confidence) {
  const steps = 6000;
  const sd = sigma * Math.sqrt(T);
  const lo = spot * Math.exp(-8 * sd);
  const hi = spot * Math.exp(8 * sd);
  const dS = (hi - lo) / steps;
  const points = [];
  let totalMass = 0;
  for (let i = 0; i < steps; i++) {
    const S = lo + (i + 0.5) * dS;
    const density = qLognormalPdf(S, spot, sigma, T) * dS;
    totalMass += density;
    points.push({ pnl: qLegsPnlAt(legs, S), density });
  }
  points.sort((a, b) => a.pnl - b.pnl);

  const tailMassTarget = (1 - confidence) * totalMass;
  let cumMass = 0, varThreshold = points[0].pnl, tailMassSum = 0, tailPnlSum = 0;
  for (const p of points) {
    if (cumMass < tailMassTarget) {
      tailMassSum += p.density;
      tailPnlSum += p.pnl * p.density;
      varThreshold = p.pnl;
    }
    cumMass += p.density;
  }
  const cvar = tailMassSum > 0 ? tailPnlSum / tailMassSum : varThreshold;
  return { var: varThreshold, cvar };
}

function renderResult() {
  const { spot, legs, avgIv } = collectLegs();
  if (!legs.length || spot == null || avgIv == null) {
    for (const id of ["var95Stat", "cvar95Stat", "var99Stat", "cvar99Stat"]) $(id).textContent = "—";
    return;
  }
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const sigma = avgIv / 100;

  const r95 = computeVarCvar(legs, spot, sigma, T, 0.95);
  const r99 = computeVarCvar(legs, spot, sigma, T, 0.99);

  const fmtLoss = (pnl) => (pnl < 0 ? `-$${qFmt(-pnl, 0)}` : `+$${qFmt(pnl, 0)} (no loss in this tail)`);
  $("var95Stat").textContent = fmtLoss(r95.var);
  $("cvar95Stat").textContent = fmtLoss(r95.cvar);
  $("var99Stat").textContent = fmtLoss(r99.var);
  $("cvar99Stat").textContent = fmtLoss(r99.cvar);
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

for (let i = 1; i <= MAX_LEGS; i++) {
  for (const id of [`leg${i}Enable`, `leg${i}Type`, `leg${i}Side`, `leg${i}Strike`, `leg${i}Qty`]) {
    $(id).addEventListener("change", renderResult);
  }
}

refresh();
setInterval(refresh, 30000);
