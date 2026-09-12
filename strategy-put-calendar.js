// Put Calendar Spread strategy page — standalone, REST-only.
// Sell 1 front-month ATM put, buy 1 back-month put at the same strike — the bearish-
// leaning mirror of the Call Calendar Spread page.

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

function computeCalendar() {
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  if (!frontBucket || !backBucket) return null;
  const spot = qImpliedSpot(frontBucket, state.summaries);
  if (spot == null) return { spot };

  const strikes = [...frontBucket.puts.keys()];
  const strike = qClosestStrike(strikes, spot);
  if (strike == null) return { spot };
  if (!backBucket.puts.has(strike)) return { spot, strike, noBackMatch: true };

  const frontPut = state.summaries.get(frontBucket.puts.get(strike));
  const backPut = state.summaries.get(backBucket.puts.get(strike));
  if (!frontPut || !backPut || frontPut.mark_price == null || backPut.mark_price == null) {
    return { spot, strike };
  }

  const frontUsd = frontPut.mark_price * spot;
  const backUsd = backPut.mark_price * spot;
  const netDebit = backUsd - frontUsd;
  const now = Date.now();
  const frontDte = (state.frontExpiry - now) / (24 * 60 * 60 * 1000);
  const backDte = (state.backExpiry - now) / (24 * 60 * 60 * 1000);
  const sigmaBack = backPut.mark_iv != null ? backPut.mark_iv / 100 : null;
  const sigmaFront = frontPut.mark_iv != null ? frontPut.mark_iv / 100 : null;

  return { spot, strike, frontUsd, backUsd, netDebit, frontDte, backDte, sigmaBack, sigmaFront };
}

function makePnlAt(strike, remainingT, sigmaBack, frontUsd, backUsd) {
  return (S) => frontUsd - Math.max(strike - S, 0) - backUsd + qBsPrice("put", S, strike, remainingT, sigmaBack);
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

function render(c) {
  $("spotStat").textContent = c && c.spot != null ? "$" + qFmt(c.spot, 0) : "—";
  const chartEl = $("payoffChart");

  if (!c || c.netDebit == null) {
    $("setupStat").textContent = "—";
    $("debitStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = c && c.noBackMatch
      ? '<p class="loading">Back expiry doesn\'t list this strike</p>'
      : '<p class="loading">No data</p>';
    return;
  }

  $("setupStat").textContent = `${qFmt(c.strike, 0)} / $${qFmt(c.frontUsd, 0)} / $${qFmt(c.backUsd, 0)}`;
  $("debitStat").textContent = `$${qFmt(c.netDebit, 0)}`;

  if (c.sigmaBack != null) {
    const remainingT = Math.max((c.backDte - c.frontDte) / 365.25, 1 / 365 / 24);
    const pnlAt = makePnlAt(c.strike, remainingT, c.sigmaBack, c.frontUsd, c.backUsd);
    chartEl.innerHTML = buildPayoffSvg(pnlAt, c.spot, c.strike);

    let pop = null;
    if (c.sigmaFront != null) {
      const frontT = Math.max(c.frontDte / 365.25, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfitFn(pnlAt, c.spot, c.sigmaFront, frontT);
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
    const c = computeCalendar();
    render(c);
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
