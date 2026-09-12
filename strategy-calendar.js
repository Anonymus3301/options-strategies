// Calendar Spread (term structure trade) strategy page — standalone, REST-only.
// Standard construction: sell the front-month ATM straddle, buy the back-month ATM
// straddle at the same strike. Profits if the front decays faster than the back (the
// normal case) and/or if an elevated front-month IV (event pricing, backwardation)
// normalizes relative to the back month.

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

function atmInfoForExpiry(ts) {
  const bucket = state.instrumentsByExpiry.get(ts);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot, strikes };
  const call = state.summaries.get(bucket.calls.get(atm));
  const put = state.summaries.get(bucket.puts.get(atm));
  const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
  return { spot, strikes, atmStrike: atm, call, put, atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null };
}

function renderTermChart() {
  const term = state.expiries.map((ts) => atmInfoForExpiry(ts)).filter((t) => t && t.atmIv != null);
  const el = $("termChart");
  if (term.length < 2) {
    el.innerHTML = '<p class="loading">Not enough expiries with IV data</p>';
    return;
  }
  el.innerHTML = qBuildSparkline(term.map((t) => t.atmIv), { color: "#f7931a" });
}

function renderCalendar(front, back) {
  const el = $("calInfo");
  const chartEl = $("payoffChart");
  $("calStrike").textContent = front && front.atmStrike != null ? qFmt(front.atmStrike, 0) : "—";
  if (!front || !back || front.atmStrike == null || front.spot == null || !front.call || !front.put) {
    el.innerHTML = '<p class="loading">No data</p>';
    chartEl.innerHTML = "";
    return;
  }
  const strike = front.atmStrike;
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  const backCall = state.summaries.get(backBucket.calls.get(strike));
  const backPut = state.summaries.get(backBucket.puts.get(strike));
  if (!backCall || !backPut || backCall.mark_price == null || backPut.mark_price == null) {
    el.innerHTML = '<p class="loading">Back-month chain has no matching strike</p>';
    chartEl.innerHTML = "";
    return;
  }
  const frontPremiumUsd = (front.call.mark_price + front.put.mark_price) * front.spot;
  const backPremiumUsd = (backCall.mark_price + backPut.mark_price) * front.spot;
  const netDebit = backPremiumUsd - frontPremiumUsd;
  const now = Date.now();
  const frontDte = (state.frontExpiry - now) / (24 * 60 * 60 * 1000);
  const backDte = (state.backExpiry - now) / (24 * 60 * 60 * 1000);
  const backIvs = [backCall.mark_iv, backPut.mark_iv].filter((v) => v != null);
  const sigmaBack = backIvs.length ? (backIvs.reduce((a, b) => a + b, 0) / backIvs.length) / 100 : null;

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Structure</span><span class="scanner-value">Sell front straddle (K=${qFmt(strike, 0)}), buy back straddle (same K)</span></div>
      <div class="scanner-row"><span class="scanner-label">Front premium received</span><span class="scanner-value">$${qFmt(frontPremiumUsd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Back premium paid</span><span class="scanner-value">$${qFmt(backPremiumUsd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Net cost</span><span class="scanner-value">${netDebit >= 0 ? "debit $" + qFmt(netDebit, 0) : "credit $" + qFmt(-netDebit, 0)}</span></div>
    </div>`;

  if (sigmaBack != null) {
    chartEl.innerHTML = buildCalendarPayoffSvg(strike, front.spot, frontDte, backDte, sigmaBack, frontPremiumUsd, backPremiumUsd);
  } else {
    chartEl.innerHTML = "";
  }
}

// P&L at front expiry: front premium collected, minus the front straddle's payout,
// minus back premium paid, plus the back leg's remaining value (BS reprice at its
// current IV, since it hasn't expired yet).
function buildCalendarPayoffSvg(strike, spot, frontDte, backDte, sigmaBack, frontPremiumUsd, backPremiumUsd) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.7, hi = spot * 1.3;
  const remainingT = Math.max((backDte - frontDte) / 365.25, 1 / 365 / 24);
  const steps = 100;
  const pnlAt = (S) => {
    const frontPayout = Math.abs(S - strike);
    const backValue = qBsPrice("call", S, strike, remainingT, sigmaBack) + qBsPrice("put", S, strike, remainingT, sigmaBack);
    return frontPremiumUsd - frontPayout - backPremiumUsd + backValue;
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

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderSelects();

    const front = state.frontExpiry != null ? atmInfoForExpiry(state.frontExpiry) : null;
    const back = state.backExpiry != null ? atmInfoForExpiry(state.backExpiry) : null;

    $("spotStat").textContent = front && front.spot != null ? "$" + qFmt(front.spot, 0) : "—";
    $("frontIvStat").textContent = front && front.atmIv != null ? qFmt(front.atmIv, 1) + "%" : "—";
    $("backIvStat").textContent = back && back.atmIv != null ? qFmt(back.atmIv, 1) + "%" : "—";
    $("slopeStat").textContent =
      front && back && front.atmIv != null && back.atmIv != null
        ? `${qFmtSigned(back.atmIv - front.atmIv, 1)}pp ${back.atmIv < front.atmIv ? "(inverted — front rich)" : "(normal contango)"}`
        : "—";

    renderTermChart();
    renderCalendar(front, back);

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
