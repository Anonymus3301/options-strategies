// Poor Man's Covered Call (PMCC) strategy page — standalone, REST-only.
// Buy a deep ITM call at the furthest listed expiry (a high-delta stand-in for holding
// spot), sell a near-dated OTM call against it. Same shape as the Diagonal Spread page,
// but strikes are chosen at the far ends via delta targeting instead of a width around
// spot, and framed around the capital-efficiency angle that makes this "poor man's."

const CURRENCY = "BTC";

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  backExpiry: null,
  frontExpiry: null,
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
  state.backExpiry = state.expiries.length ? state.expiries[state.expiries.length - 1] : null;
  const frontCandidates = state.expiries.filter((ts) => ts < state.backExpiry);
  if (!state.frontExpiry || !frontCandidates.includes(state.frontExpiry)) {
    state.frontExpiry = frontCandidates.length ? frontCandidates[0] : null;
  }
}

function renderFrontSelect() {
  const sel = $("frontSelect");
  const frontCandidates = state.expiries.filter((ts) => ts < state.backExpiry);
  if (!frontCandidates.length) {
    sel.innerHTML = "<option>No earlier expiry available</option>";
    sel.disabled = true;
    return;
  }
  sel.innerHTML = frontCandidates
    .map((ts) => `<option value="${ts}" ${ts === state.frontExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  sel.disabled = false;
}

function findDeltaStrike(strikes, bucket, spot, T, targetDelta) {
  let best = null, bestDiff = Infinity;
  for (const strike of strikes) {
    const name = bucket.calls.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_iv == null || sum.mark_price == null) continue;
    const sigma = sum.mark_iv / 100;
    const delta = qBsDelta("call", spot, strike, T, sigma);
    const diff = Math.abs(delta - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike, delta, mark: sum.mark_price, iv: sum.mark_iv };
    }
  }
  return best;
}

function computePmcc(backDeltaTarget, frontDeltaTarget) {
  if (!state.backExpiry || !state.frontExpiry) return null;
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  if (!backBucket || !frontBucket) return null;
  const spot = qImpliedSpot(backBucket, state.summaries);
  if (spot == null) return { spot };

  const Tback = Math.max((state.backExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const Tfront = Math.max((state.frontExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  const backStrikes = [...backBucket.calls.keys()].sort((a, b) => a - b);
  const longLeg = findDeltaStrike(backStrikes, backBucket, spot, Tback, backDeltaTarget);
  if (!longLeg) return { spot };

  const frontStrikes = [...frontBucket.calls.keys()].filter((s) => s > 0).sort((a, b) => a - b);
  const shortLeg = findDeltaStrike(frontStrikes, frontBucket, spot, Tfront, frontDeltaTarget);
  if (!shortLeg) return { spot, longLeg };

  const longUsd = longLeg.mark * spot;
  const shortUsd = shortLeg.mark * spot;
  const netDebit = longUsd - shortUsd;
  const remainingT = Math.max((state.backExpiry - state.frontExpiry) / QUANT_YEAR_MS, 1 / 365 / 24);
  const sigmaBack = longLeg.iv / 100;

  const pnlAt = (S) => shortUsd - Math.max(S - shortLeg.strike, 0) - longUsd + qBsPrice("call", S, longLeg.strike, remainingT, sigmaBack);
  const maxProfit = pnlAt(shortLeg.strike);
  const maxLoss = netDebit;

  return { spot, longLeg, shortLeg, longUsd, shortUsd, netDebit, remainingT, sigmaBack, pnlAt, maxProfit, maxLoss, Tfront };
}

function buildPmccPayoffSvg(pnlAt, spot, strikes) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = Math.min(spot, ...strikes) * 0.6, hi = Math.max(spot, ...strikes) * 1.4;
  const steps = 120;
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
  strikes.forEach((K) => {
    const x = xScale(K);
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<text x="${x}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(K, 0)}</text>`;
  });
  let d = "";
  pts.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p.pnl).toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="#35d399" stroke-width="2"/>`;
  svg += "</svg>";
  return svg;
}

function render(p) {
  $("spotStat").textContent = p && p.spot != null ? "$" + qFmt(p.spot, 0) : "—";
  const chartEl = $("payoffChart");

  if (!p || p.netDebit == null) {
    $("strikesStat").textContent = "—";
    $("debitStat").textContent = "—";
    $("capitalStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("maxLossStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (need at least 2 live expiries, and enough chain depth for both delta targets)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(p.longLeg.strike, 0)} (Δ${qFmt(p.longLeg.delta, 2)}) / ${qFmt(p.shortLeg.strike, 0)} (Δ${qFmt(p.shortLeg.delta, 2)})`;
  $("debitStat").textContent = `$${qFmt(p.netDebit, 0)}`;
  $("capitalStat").textContent = `${qFmt((p.netDebit / p.spot) * 100, 1)}% of spot`;
  $("maxProfitStat").textContent = `+$${qFmt(p.maxProfit, 0)}`;
  $("maxLossStat").textContent = `-$${qFmt(p.maxLoss, 0)}`;

  chartEl.innerHTML = buildPmccPayoffSvg(p.pnlAt, p.spot, [p.longLeg.strike, p.shortLeg.strike]);

  const pop = qComputeProbabilityOfProfitFn(p.pnlAt, p.spot, p.shortLeg.iv / 100, p.Tfront);
  $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderFrontSelect();
    const backDeltaTarget = Number($("backDeltaSelect").value);
    const frontDeltaTarget = Number($("frontDeltaSelect").value);
    const p = computePmcc(backDeltaTarget, frontDeltaTarget);
    render(p);
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("frontSelect").addEventListener("change", (e) => {
  state.frontExpiry = Number(e.target.value);
  refresh();
});
$("backDeltaSelect").addEventListener("change", refresh);
$("frontDeltaSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
