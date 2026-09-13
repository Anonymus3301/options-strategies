// Multi-Expiry Strategy Builder — standalone, REST-only.
// Every other multi-leg tool here (Strategy Builder, Scenario Analysis, VaR Calculator,
// Portfolio Greeks, Historical Backtest, Vanna & Charm) requires all legs to share one
// expiry. Calendar Spread, Diagonal Spread, and Double Calendar each hand-build a payoff
// for exactly TWO legs across two expiries. This generalizes that same idea — settle an
// expired leg at intrinsic value, reprice a still-alive leg via Black-Scholes at its own
// quoted IV — to up to 4 legs, each with its own independently selectable expiry,
// evaluated at any chosen date.

const CURRENCY = "BTC";
const MAX_LEGS = 4;

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  evalExpiry: null,
  summaries: new Map(),
  legExpiry: [null, null, null, null],
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
  for (let i = 0; i < MAX_LEGS; i++) {
    if (!state.legExpiry[i] || !state.instrumentsByExpiry.has(state.legExpiry[i])) {
      state.legExpiry[i] = state.expiries[0] ?? null;
    }
  }
  if (!state.evalExpiry || !state.expiries.includes(state.evalExpiry)) {
    state.evalExpiry = state.expiries[0] ?? null;
  }
}

function renderLegExpirySelects() {
  for (let i = 1; i <= MAX_LEGS; i++) {
    const sel = $(`leg${i}Expiry`);
    sel.innerHTML = state.expiries
      .map((ts) => `<option value="${ts}" ${ts === state.legExpiry[i - 1] ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
      .join("");
    sel.disabled = false;
  }
}

function renderEvalSelect() {
  const sel = $("evalSelect");
  sel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.evalExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  sel.disabled = false;
}

function renderLegStrikeOptions(i) {
  const expiry = state.legExpiry[i - 1];
  const bucket = state.instrumentsByExpiry.get(expiry);
  const sel = $(`leg${i}Strike`);
  if (!bucket) {
    sel.innerHTML = "";
    return;
  }
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const prev = sel.value;
  sel.innerHTML = strikes.map((s) => `<option value="${s}">${qFmt(s, 0)}</option>`).join("");
  if (strikes.includes(Number(prev))) sel.value = prev;
}

function collectLegs() {
  const anyBucket = state.instrumentsByExpiry.get(state.expiries[0]);
  const spot = anyBucket ? qImpliedSpot(anyBucket, state.summaries) : null;
  if (spot == null) return { spot, legs: [] };
  const legs = [];
  for (let i = 1; i <= MAX_LEGS; i++) {
    if (!$(`leg${i}Enable`).checked) continue;
    const expiry = state.legExpiry[i - 1];
    const bucket = state.instrumentsByExpiry.get(expiry);
    if (!bucket) continue;
    const type = $(`leg${i}Type`).value;
    const side = $(`leg${i}Side`).value;
    const strike = Number($(`leg${i}Strike`).value);
    const qty = Math.max(1, Number($(`leg${i}Qty`).value) || 1);
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_price == null || sum.mark_iv == null) continue;
    legs.push({ type, side, strike, qty, expiry, premiumUsd: sum.mark_price * spot, iv: sum.mark_iv });
  }
  return { spot, legs };
}

// Value of one leg at the evaluation date: intrinsic if that leg has already expired by
// then, otherwise Black-Scholes-repriced at the leg's own currently-quoted IV (held
// constant) for whatever time remains — the same simplification the Calendar Spread page
// already makes and discloses, generalized here to any leg/expiry combination.
function legValueAt(leg, S, evalTs) {
  const remainingT = (leg.expiry - evalTs) / QUANT_YEAR_MS;
  if (remainingT <= 0) {
    return leg.type === "call" ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
  }
  return qBsPrice(leg.type, S, leg.strike, remainingT, leg.iv / 100);
}

function pnlAt(legs, S, evalTs) {
  let total = 0;
  for (const leg of legs) {
    const sign = leg.side === "long" ? 1 : -1;
    total += sign * leg.qty * (legValueAt(leg, S, evalTs) - leg.premiumUsd);
  }
  return total;
}

function buildChart(legs, spot, evalTs) {
  const W = 640, H = 240, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const strikes = legs.map((l) => l.strike);
  const lo = Math.min(spot, ...strikes) * 0.5;
  const hi = Math.max(spot, ...strikes) * 1.8;
  const steps = 120;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, pnl: pnlAt(legs, S, evalTs) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.abs(p.pnl)), 1) * 1.15;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  svg += `<text x="${spotX}" y="${padT - 2}" font-size="9" fill="#f7931a" text-anchor="middle">spot</text>`;
  let d = "";
  pts.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p.pnl).toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="#35d399" stroke-width="2"/>`;
  svg += "</svg>";
  return svg;
}

function render() {
  const { spot, legs } = collectLegs();
  const chartEl = $("payoffChart");
  if (!legs.length || spot == null || state.evalExpiry == null) {
    $("netCostStat").textContent = "—";
    $("pnlTodayStat").textContent = "—";
    $("legsAliveStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">Enable at least one leg to see a payoff</p>';
    return;
  }

  const netCost = legs.reduce((sum, l) => sum + (l.side === "long" ? 1 : -1) * l.qty * l.premiumUsd, 0);
  $("netCostStat").textContent = netCost >= 0 ? `debit $${qFmt(netCost, 0)}` : `credit $${qFmt(-netCost, 0)}`;

  const pnlAtSpot = pnlAt(legs, spot, state.evalExpiry);
  $("pnlTodayStat").textContent = qFmtSigned(pnlAtSpot, 0);

  const aliveCount = legs.filter((l) => l.expiry > state.evalExpiry).length;
  $("legsAliveStat").textContent = `${aliveCount} still alive / ${legs.length - aliveCount} settled at intrinsic (of ${legs.length})`;

  chartEl.innerHTML = buildChart(legs, spot, state.evalExpiry);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderLegExpirySelects();
    renderEvalSelect();
    for (let i = 1; i <= MAX_LEGS; i++) renderLegStrikeOptions(i);
    const anyBucket = state.instrumentsByExpiry.get(state.expiries[0]);
    const spot = anyBucket ? qImpliedSpot(anyBucket, state.summaries) : null;
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

for (let i = 1; i <= MAX_LEGS; i++) {
  $(`leg${i}Expiry`).addEventListener("change", (e) => {
    state.legExpiry[i - 1] = Number(e.target.value);
    renderLegStrikeOptions(i);
    render();
  });
  for (const id of [`leg${i}Enable`, `leg${i}Type`, `leg${i}Side`, `leg${i}Strike`, `leg${i}Qty`]) {
    $(id).addEventListener("change", render);
  }
}
$("evalSelect").addEventListener("change", (e) => {
  state.evalExpiry = Number(e.target.value);
  render();
});

refresh();
setInterval(refresh, 30000);
