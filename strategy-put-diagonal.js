// Put Diagonal Spread strategy page — standalone, REST-only.
// Buy a back-month put at a higher (near-ATM) strike, sell a front-month put at a lower
// strike. The bearish mirror of strategy-diagonal.js's bullish call construction — same
// front-settles/back-reprices math, mirrored to puts.

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

function computeDiagonal(widthPct) {
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  if (!backBucket || !frontBucket) return null;
  const spot = qImpliedSpot(backBucket, state.summaries);
  if (spot == null) return { spot };

  const backStrikes = [...backBucket.puts.keys()].sort((a, b) => a - b);
  const longStrike = qClosestStrike(backStrikes, spot);
  if (longStrike == null) return { spot };
  const backPut = state.summaries.get(backBucket.puts.get(longStrike));
  if (!backPut || backPut.mark_price == null) return { spot, longStrike };

  const width = spot * (widthPct / 100);
  const frontStrikes = [...frontBucket.puts.keys()].filter((s) => s < longStrike);
  const shortStrike = frontStrikes.length ? qClosestStrike(frontStrikes, longStrike - width) : null;
  if (shortStrike == null) return { spot, longStrike };
  const frontPut = state.summaries.get(frontBucket.puts.get(shortStrike));
  if (!frontPut || frontPut.mark_price == null) return { spot, longStrike, shortStrike };

  const backUsd = backPut.mark_price * spot;
  const frontUsd = frontPut.mark_price * spot;
  const netDebit = backUsd - frontUsd;
  const now = Date.now();
  const frontDte = (state.frontExpiry - now) / (24 * 60 * 60 * 1000);
  const backDte = (state.backExpiry - now) / (24 * 60 * 60 * 1000);
  const sigmaBack = backPut.mark_iv != null ? backPut.mark_iv / 100 : null;
  const sigmaFront = frontPut.mark_iv != null ? frontPut.mark_iv / 100 : null;

  return { spot, longStrike, shortStrike, backUsd, frontUsd, netDebit, frontDte, backDte, sigmaBack, sigmaFront };
}

function makeDiagonalPnlAt(longStrike, shortStrike, remainingT, sigmaBack, backUsd, frontUsd) {
  return (S) => {
    const frontPayout = Math.max(shortStrike - S, 0);
    const backValue = qBsPrice("put", S, longStrike, remainingT, sigmaBack);
    return frontUsd - frontPayout - backUsd + backValue;
  };
}

function buildPayoffSvg(pnlAt, spot, strikes) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.6, hi = spot * 1.5;
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

function render(diag) {
  $("spotStat").textContent = diag && diag.spot != null ? "$" + qFmt(diag.spot, 0) : "—";
  const chartEl = $("payoffChart");

  if (!diag || diag.netDebit == null) {
    $("strikesStat").textContent = "—";
    $("debitStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(diag.longStrike, 0)} / ${qFmt(diag.shortStrike, 0)}`;
  $("debitStat").textContent = `$${qFmt(diag.netDebit, 0)}`;

  if (diag.sigmaBack != null) {
    const remainingT = Math.max((diag.backDte - diag.frontDte) / 365.25, 1 / 365 / 24);
    const pnlAt = makeDiagonalPnlAt(diag.longStrike, diag.shortStrike, remainingT, diag.sigmaBack, diag.backUsd, diag.frontUsd);
    chartEl.innerHTML = buildPayoffSvg(pnlAt, diag.spot, [diag.longStrike, diag.shortStrike]);

    let pop = null;
    if (diag.sigmaFront != null) {
      const frontT = Math.max(diag.frontDte / 365.25, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfitFn(pnlAt, diag.spot, diag.sigmaFront, frontT);
    }
    $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  } else {
    chartEl.innerHTML = "";
    $("popStat").textContent = "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderSelects();
    const widthPct = Number($("widthSelect").value);
    const diag = computeDiagonal(widthPct);
    render(diag);
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
$("widthSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
