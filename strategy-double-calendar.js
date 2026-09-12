// Double Calendar Spread strategy page — standalone, REST-only.
// Two calendar spreads stacked at OTM strikes on both sides: sell front-month OTM call +
// put, buy back-month call + put at the same two strikes. Wider, flatter neutral zone than
// the single ATM Calendar Spread page, at a higher cost (two calendars instead of one).

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

function computeDoubleCalendar(widthPct) {
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  if (!frontBucket || !backBucket) return null;
  const spot = qImpliedSpot(frontBucket, state.summaries);
  if (spot == null) return { spot };

  const width = spot * (widthPct / 100);
  const callCandidates = [...frontBucket.calls.keys()].filter((s) => s > spot);
  const putCandidates = [...frontBucket.puts.keys()].filter((s) => s < spot);
  const callStrike = callCandidates.length ? qClosestStrike(callCandidates, spot + width) : null;
  const putStrike = putCandidates.length ? qClosestStrike(putCandidates, spot - width) : null;
  if (callStrike == null || putStrike == null) return { spot };

  if (!backBucket.calls.has(callStrike) || !backBucket.puts.has(putStrike)) {
    return { spot, callStrike, putStrike, noBackMatch: true };
  }

  const frontCall = state.summaries.get(frontBucket.calls.get(callStrike));
  const frontPut = state.summaries.get(frontBucket.puts.get(putStrike));
  const backCall = state.summaries.get(backBucket.calls.get(callStrike));
  const backPut = state.summaries.get(backBucket.puts.get(putStrike));
  if (
    !frontCall || !frontPut || !backCall || !backPut ||
    frontCall.mark_price == null || frontPut.mark_price == null || backCall.mark_price == null || backPut.mark_price == null
  ) {
    return { spot, callStrike, putStrike };
  }

  const frontCallUsd = frontCall.mark_price * spot;
  const frontPutUsd = frontPut.mark_price * spot;
  const backCallUsd = backCall.mark_price * spot;
  const backPutUsd = backPut.mark_price * spot;
  const frontPremium = frontCallUsd + frontPutUsd;
  const backPremium = backCallUsd + backPutUsd;
  const netDebit = backPremium - frontPremium;

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
    spot, callStrike, putStrike, frontCallUsd, frontPutUsd, backCallUsd, backPutUsd,
    frontPremium, backPremium, netDebit, remainingT, sigmaBackCall, sigmaBackPut, frontIv, frontT,
  };
}

function makeDoubleCalendarPnlAt(callStrike, putStrike, remainingT, sigmaBackCall, sigmaBackPut, frontPremium, backPremium) {
  return (S) => {
    const frontPayout = Math.max(S - callStrike, 0) + Math.max(putStrike - S, 0);
    const backValue = qBsPrice("call", S, callStrike, remainingT, sigmaBackCall) + qBsPrice("put", S, putStrike, remainingT, sigmaBackPut);
    return frontPremium - frontPayout - backPremium + backValue;
  };
}

function buildDoubleCalendarPayoffSvg(pnlAt, spot, strikes) {
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

function render(dc) {
  const chartEl = $("payoffChart");
  $("spotStat").textContent = dc && dc.spot != null ? "$" + qFmt(dc.spot, 0) : "—";

  if (!dc || dc.netDebit == null) {
    $("strikesStat").textContent = dc && dc.callStrike != null ? `${qFmt(dc.putStrike, 0)} / ${qFmt(dc.callStrike, 0)}` : "—";
    $("frontPremiumStat").textContent = "—";
    $("backPremiumStat").textContent = "—";
    $("netDebitStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = dc && dc.noBackMatch
      ? '<p class="loading">Back expiry doesn\'t list one of these strikes — try a different width or back expiry</p>'
      : '<p class="loading">No data</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(dc.putStrike, 0)} / ${qFmt(dc.callStrike, 0)}`;
  $("frontPremiumStat").textContent = `$${qFmt(dc.frontPremium, 0)}`;
  $("backPremiumStat").textContent = `$${qFmt(dc.backPremium, 0)}`;
  $("netDebitStat").textContent = dc.netDebit >= 0 ? `debit $${qFmt(dc.netDebit, 0)}` : `credit $${qFmt(-dc.netDebit, 0)}`;

  if (dc.sigmaBackCall != null && dc.sigmaBackPut != null) {
    const pnlAt = makeDoubleCalendarPnlAt(dc.callStrike, dc.putStrike, dc.remainingT, dc.sigmaBackCall, dc.sigmaBackPut, dc.frontPremium, dc.backPremium);
    chartEl.innerHTML = buildDoubleCalendarPayoffSvg(pnlAt, dc.spot, [dc.putStrike, dc.callStrike]);

    const pop = dc.frontIv != null ? qComputeProbabilityOfProfitFn(pnlAt, dc.spot, dc.frontIv / 100, dc.frontT) : null;
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
    const dc = computeDoubleCalendar(widthPct);
    render(dc);
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
