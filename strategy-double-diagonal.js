// Double Diagonal Spread strategy page — standalone, REST-only.
// A call diagonal and a put diagonal combined: sell front-month OTM call+put (closer to
// spot), buy back-month OTM call+put at wider strikes. Reuses the same front-settles/
// back-reprices math as the Calendar/Diagonal pages, extended to 4 independent legs.

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

function computeDoubleDiagonal(frontWidthPct, backWidthPct) {
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  if (!frontBucket || !backBucket) return null;
  const spot = qImpliedSpot(frontBucket, state.summaries);
  if (spot == null) return { spot };

  const frontWidth = spot * (frontWidthPct / 100);
  const backWidth = spot * (backWidthPct / 100);

  const frontCallCandidates = [...frontBucket.calls.keys()].filter((s) => s > spot);
  const frontPutCandidates = [...frontBucket.puts.keys()].filter((s) => s < spot);
  const frontCallStrike = frontCallCandidates.length ? qClosestStrike(frontCallCandidates, spot + frontWidth) : null;
  const frontPutStrike = frontPutCandidates.length ? qClosestStrike(frontPutCandidates, spot - frontWidth) : null;
  if (frontCallStrike == null || frontPutStrike == null) return { spot };

  const backCallCandidates = [...backBucket.calls.keys()].filter((s) => s > frontCallStrike);
  const backPutCandidates = [...backBucket.puts.keys()].filter((s) => s < frontPutStrike);
  const backCallStrike = backCallCandidates.length ? qClosestStrike(backCallCandidates, spot + backWidth) : null;
  const backPutStrike = backPutCandidates.length ? qClosestStrike(backPutCandidates, spot - backWidth) : null;
  if (backCallStrike == null || backPutStrike == null) return { spot, frontCallStrike, frontPutStrike };

  const frontCall = state.summaries.get(frontBucket.calls.get(frontCallStrike));
  const frontPut = state.summaries.get(frontBucket.puts.get(frontPutStrike));
  const backCall = state.summaries.get(backBucket.calls.get(backCallStrike));
  const backPut = state.summaries.get(backBucket.puts.get(backPutStrike));
  if (
    !frontCall || !frontPut || !backCall || !backPut ||
    frontCall.mark_price == null || frontPut.mark_price == null || backCall.mark_price == null || backPut.mark_price == null
  ) {
    return { spot, frontCallStrike, frontPutStrike, backCallStrike, backPutStrike };
  }

  const frontCallUsd = frontCall.mark_price * spot;
  const frontPutUsd = frontPut.mark_price * spot;
  const backCallUsd = backCall.mark_price * spot;
  const backPutUsd = backPut.mark_price * spot;
  const frontPremium = frontCallUsd + frontPutUsd;
  const backPremium = backCallUsd + backPutUsd;
  const netCost = backPremium - frontPremium;

  const now = Date.now();
  const frontDte = (state.frontExpiry - now) / (24 * 60 * 60 * 1000);
  const backDte = (state.backExpiry - now) / (24 * 60 * 60 * 1000);
  const remainingT = Math.max((backDte - frontDte) / 365.25, 1 / 365 / 24);
  const sigmaBackCall = backCall.mark_iv != null ? backCall.mark_iv / 100 : null;
  const sigmaBackPut = backPut.mark_iv != null ? backPut.mark_iv / 100 : null;

  const ivs = [frontCall.mark_iv, frontPut.mark_iv].filter((v) => v != null);
  const frontIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const frontT = Math.max(frontDte / 365.25, 1 / 365 / 24);

  return {
    spot, frontCallStrike, frontPutStrike, backCallStrike, backPutStrike,
    frontPremium, backPremium, netCost, remainingT, sigmaBackCall, sigmaBackPut, frontIv, frontT,
  };
}

function makePnlAt(frontCallStrike, frontPutStrike, backCallStrike, backPutStrike, remainingT, sigmaBackCall, sigmaBackPut, frontPremium, backPremium) {
  return (S) => {
    const frontPayout = Math.max(S - frontCallStrike, 0) + Math.max(frontPutStrike - S, 0);
    const backValue = qBsPrice("call", S, backCallStrike, remainingT, sigmaBackCall) + qBsPrice("put", S, backPutStrike, remainingT, sigmaBackPut);
    return frontPremium - frontPayout - backPremium + backValue;
  };
}

function buildPayoffSvg(pnlAt, spot, strikes) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.6, hi = spot * 1.5;
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

function render(dd) {
  const chartEl = $("payoffChart");
  $("spotStat").textContent = dd && dd.spot != null ? "$" + qFmt(dd.spot, 0) : "—";

  if (!dd || dd.netCost == null) {
    $("strikesStat").textContent = "—";
    $("frontPremiumStat").textContent = "—";
    $("backPremiumStat").textContent = "—";
    $("netCostStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for these widths)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(dd.backPutStrike, 0)} / ${qFmt(dd.frontPutStrike, 0)} / ${qFmt(dd.frontCallStrike, 0)} / ${qFmt(dd.backCallStrike, 0)}`;
  $("frontPremiumStat").textContent = `$${qFmt(dd.frontPremium, 0)}`;
  $("backPremiumStat").textContent = `$${qFmt(dd.backPremium, 0)}`;
  $("netCostStat").textContent = dd.netCost >= 0 ? `debit $${qFmt(dd.netCost, 0)}` : `credit $${qFmt(-dd.netCost, 0)}`;

  if (dd.sigmaBackCall != null && dd.sigmaBackPut != null) {
    const pnlAt = makePnlAt(dd.frontCallStrike, dd.frontPutStrike, dd.backCallStrike, dd.backPutStrike, dd.remainingT, dd.sigmaBackCall, dd.sigmaBackPut, dd.frontPremium, dd.backPremium);
    chartEl.innerHTML = buildPayoffSvg(pnlAt, dd.spot, [dd.backPutStrike, dd.frontPutStrike, dd.frontCallStrike, dd.backCallStrike]);

    const pop = dd.frontIv != null ? qComputeProbabilityOfProfitFn(pnlAt, dd.spot, dd.frontIv / 100, dd.frontT) : null;
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
    const frontWidthPct = Number($("frontWidthSelect").value);
    const backWidthPct = Number($("backWidthSelect").value);
    const dd = computeDoubleDiagonal(frontWidthPct, backWidthPct);
    render(dd);
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
$("frontWidthSelect").addEventListener("change", refresh);
$("backWidthSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
