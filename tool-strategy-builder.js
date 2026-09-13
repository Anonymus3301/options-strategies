// Custom Multi-Leg Strategy Builder — standalone, REST-only.
// Every one of the 66 strategy pages on this site is a fixed, named structure. quant.js's
// generic qBuildPayoffSvg/qComputeProbabilityOfProfit/qLegsPnlAt already support ANY
// same-expiry combination of legs — this tool is just a UI on top of those existing
// primitives, letting a visitor combine up to 4 legs from the live chain freely instead
// of only using the named structures elsewhere. Same-expiry only, by design: mixing
// expiries needs the bespoke front-settles/back-reprices math each calendar/diagonal page
// already has, which is out of scope for a generic builder.

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

function tailSlope(legs, x1, x2) {
  return (qLegsPnlAt(legs, x2) - qLegsPnlAt(legs, x1)) / (x2 - x1);
}

function renderResult() {
  const { spot, legs, avgIv } = collectLegs();
  const el = $("payoffChart");
  const popEl = $("popStat");
  if (!legs.length || spot == null) {
    el.innerHTML = '<p class="loading">Enable at least one leg to see a payoff</p>';
    $("netCostStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("maxLossStat").textContent = "—";
    if (popEl) popEl.textContent = "—";
    return;
  }

  const netCost = legs.reduce((sum, l) => sum + (l.side === "long" ? l.premiumUsd : -l.premiumUsd) * l.qty, 0);
  $("netCostStat").textContent = netCost >= 0 ? `debit $${qFmt(netCost, 0)}` : `credit $${qFmt(-netCost, 0)}`;

  const strikes = legs.map((l) => l.strike);
  const lo = Math.min(spot, ...strikes) * 0.5;
  const hi = Math.max(spot, ...strikes) * 2;
  const EPS = 0.5; // $/unit-price slope threshold to call a tail "flat"

  // Slope = dPnL/dS at each tail. A negative left-tail slope means pnl keeps RISING as S
  // falls further (unlimited profit to the downside); a positive one means pnl keeps
  // FALLING (unlimited loss to the downside) — and the mirror image on the right tail.
  const leftSlope = tailSlope(legs, lo * 0.5, lo);
  const rightSlope = tailSlope(legs, hi, hi * 2);
  const unlimitedProfit = leftSlope < -EPS || rightSlope > EPS;
  const unlimitedLoss = leftSlope > EPS || rightSlope < -EPS;

  const steps = 400;
  let gridMax = -Infinity, gridMin = Infinity;
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    const pnl = qLegsPnlAt(legs, S);
    if (pnl > gridMax) gridMax = pnl;
    if (pnl < gridMin) gridMin = pnl;
  }

  $("maxProfitStat").textContent = unlimitedProfit ? "Unlimited (uncapped)" : `+$${qFmt(gridMax, 0)} (appears capped)`;
  $("maxLossStat").textContent = unlimitedLoss ? "Unlimited (uncapped)" : `$${qFmt(gridMin, 0)} (appears capped)`;

  el.innerHTML = qBuildPayoffSvg(legs, spot);

  if (popEl) {
    const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
    const pop = avgIv != null ? qComputeProbabilityOfProfit(legs, spot, avgIv / 100, T) : null;
    popEl.textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
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
