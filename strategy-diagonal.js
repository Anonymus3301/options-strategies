// Diagonal Spread (bullish call) strategy page — standalone, REST-only.
// Buy a back-month ATM call, sell a front-month call at a higher strike (selectable
// offset above spot). Combines the Calendar Spread's term-structure bet with a bullish
// directional lean, since the two legs sit at different strikes.

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

  const backStrikes = [...backBucket.calls.keys()].sort((a, b) => a - b);
  const longStrike = qClosestStrike(backStrikes, spot);
  if (longStrike == null) return { spot };
  const backCall = state.summaries.get(backBucket.calls.get(longStrike));
  if (!backCall || backCall.mark_price == null) return { spot, longStrike };

  const width = spot * (widthPct / 100);
  const frontStrikes = [...frontBucket.calls.keys()].filter((s) => s > longStrike);
  const shortStrike = frontStrikes.length ? qClosestStrike(frontStrikes, longStrike + width) : null;
  if (shortStrike == null) return { spot, longStrike };
  const frontCall = state.summaries.get(frontBucket.calls.get(shortStrike));
  if (!frontCall || frontCall.mark_price == null) return { spot, longStrike, shortStrike };

  const backUsd = backCall.mark_price * spot;
  const frontUsd = frontCall.mark_price * spot;
  const netDebit = backUsd - frontUsd;
  const now = Date.now();
  const frontDte = (state.frontExpiry - now) / (24 * 60 * 60 * 1000);
  const backDte = (state.backExpiry - now) / (24 * 60 * 60 * 1000);
  const sigmaBack = backCall.mark_iv != null ? backCall.mark_iv / 100 : null;

  return { spot, longStrike, shortStrike, backUsd, frontUsd, netDebit, frontDte, backDte, sigmaBack };
}

function buildDiagonalPayoffSvg(longStrike, shortStrike, spot, frontDte, backDte, sigmaBack, backUsd, frontUsd) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.6, hi = spot * 1.5;
  const remainingT = Math.max((backDte - frontDte) / 365.25, 1 / 365 / 24);
  const steps = 100;
  const pnlAt = (S) => {
    const frontPayout = Math.max(S - shortStrike, 0);
    const backValue = qBsPrice("call", S, longStrike, remainingT, sigmaBack);
    return frontUsd - frontPayout - backUsd + backValue;
  };
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
  [longStrike, shortStrike].forEach((K) => {
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

function renderDiagonal(diag) {
  $("spotStat").textContent = diag && diag.spot != null ? "$" + qFmt(diag.spot, 0) : "—";
  const chartEl = $("payoffChart");

  if (!diag || diag.netDebit == null) {
    $("strikesStat").textContent = "—";
    $("debitStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(diag.longStrike, 0)} / ${qFmt(diag.shortStrike, 0)}`;
  $("debitStat").textContent = `$${qFmt(diag.netDebit, 0)}`;

  if (diag.sigmaBack != null) {
    chartEl.innerHTML = buildDiagonalPayoffSvg(
      diag.longStrike, diag.shortStrike, diag.spot, diag.frontDte, diag.backDte, diag.sigmaBack, diag.backUsd, diag.frontUsd
    );
  } else {
    chartEl.innerHTML = "";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderSelects();
    const widthPct = Number($("widthSelect").value);
    const diag = computeDiagonal(widthPct);
    renderDiagonal(diag);
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
