// Vega-Neutral Calendar Spread strategy page — standalone, REST-only.
// Same ATM straddle calendar as the plain Calendar Spread page, but the back-month
// quantity is scaled by vegaFront/vegaBack so net vega at inception is (approximately)
// zero, isolating the theta/gamma bet a calendar is usually meant to express.

const CURRENCY = "BTC";

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

function compute() {
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  if (!frontBucket || !backBucket) return null;
  const spot = qImpliedSpot(frontBucket, state.summaries);
  if (spot == null) return { spot };

  const strikes = [...new Set([...frontBucket.calls.keys(), ...frontBucket.puts.keys()])];
  const strike = qClosestStrike(strikes, spot);
  if (strike == null) return { spot };

  const frontCall = state.summaries.get(frontBucket.calls.get(strike));
  const frontPut = state.summaries.get(frontBucket.puts.get(strike));
  if (!backBucket.calls.has(strike) || !backBucket.puts.has(strike)) return { spot, strike, noBackMatch: true };
  const backCall = state.summaries.get(backBucket.calls.get(strike));
  const backPut = state.summaries.get(backBucket.puts.get(strike));
  if (
    !frontCall || !frontPut || !backCall || !backPut ||
    frontCall.mark_price == null || frontPut.mark_price == null || backCall.mark_price == null || backPut.mark_price == null ||
    frontCall.mark_iv == null || frontPut.mark_iv == null || backCall.mark_iv == null || backPut.mark_iv == null
  ) {
    return { spot, strike };
  }

  const now = Date.now();
  const Tfront = Math.max((state.frontExpiry - now) / QUANT_YEAR_MS, 1 / 365 / 24);
  const Tback = Math.max((state.backExpiry - now) / QUANT_YEAR_MS, 1 / 365 / 24);

  const vegaFront = qBsVega(spot, strike, Tfront, frontCall.mark_iv / 100) + qBsVega(spot, strike, Tfront, frontPut.mark_iv / 100);
  const vegaBackUnit = qBsVega(spot, strike, Tback, backCall.mark_iv / 100) + qBsVega(spot, strike, Tback, backPut.mark_iv / 100);
  if (vegaBackUnit <= 0) return { spot, strike };
  const ratio = vegaFront / vegaBackUnit;

  const frontPremiumUsd = (frontCall.mark_price + frontPut.mark_price) * spot;
  const backPremiumUsd = (backCall.mark_price + backPut.mark_price) * spot;
  const netCost = ratio * backPremiumUsd - frontPremiumUsd;
  const netVegaRemaining = ratio * vegaBackUnit - vegaFront;

  const remainingT = Math.max((state.backExpiry - state.frontExpiry) / QUANT_YEAR_MS, 1 / 365 / 24);
  const sigmaBackCall = backCall.mark_iv / 100, sigmaBackPut = backPut.mark_iv / 100;

  const pnlAt = (S) =>
    frontPremiumUsd - Math.abs(S - strike) - ratio * backPremiumUsd +
    ratio * (qBsPrice("call", S, strike, remainingT, sigmaBackCall) + qBsPrice("put", S, strike, remainingT, sigmaBackPut));

  return { spot, strike, vegaFront, vegaBackUnit, ratio, frontPremiumUsd, backPremiumUsd, netCost, netVegaRemaining, pnlAt };
}

function buildPayoffSvg(pnlAt, spot, strike) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.7, hi = spot * 1.3;
  const steps = 100;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, pnl: pnlAt(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.abs(p.pnl)), 1) * 1.15;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  const kx = xScale(strike);
  svg += `<line x1="${kx}" y1="${padT}" x2="${kx}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
  svg += `<text x="${kx}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(strike, 0)}</text>`;
  let d = "";
  pts.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p.pnl).toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="#35d399" stroke-width="2"/>`;
  svg += "</svg>";
  return svg;
}

function render(r) {
  $("spotStat").textContent = r && r.spot != null ? "$" + qFmt(r.spot, 0) : "—";
  const chartEl = $("payoffChart");

  if (!r || r.ratio == null) {
    $("vegaStat").textContent = "—";
    $("ratioStat").textContent = "—";
    $("costStat").textContent = "—";
    $("netVegaStat").textContent = "—";
    chartEl.innerHTML = r && r.noBackMatch
      ? '<p class="loading">Back expiry doesn\'t list this strike</p>'
      : '<p class="loading">No data</p>';
    return;
  }

  $("vegaStat").textContent = `${qFmt(r.strike, 0)} / $${qFmt(r.vegaFront / 100, 0)} per vol-pt / $${qFmt(r.vegaBackUnit / 100, 0)} per vol-pt`;
  $("ratioStat").textContent = `${qFmt(r.ratio, 2)} back straddles per 1 front sold`;
  $("costStat").textContent = r.netCost >= 0 ? `debit $${qFmt(r.netCost, 0)}` : `credit $${qFmt(-r.netCost, 0)}`;
  $("netVegaStat").textContent = `$${qFmt(r.netVegaRemaining / 100, 2)} per vol-pt`;

  chartEl.innerHTML = buildPayoffSvg(r.pnlAt, r.spot, r.strike);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderSelects();
    const r = compute();
    render(r);
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
