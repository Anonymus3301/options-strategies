// Covered Strangle strategy page — standalone, REST-only.
// For BTC holders: sell an OTM call and an OTM put against a held position. The call
// behaves like a plain covered call (caps upside, keeps the premium if not assigned).
// The put does not — being short a put on top of an existing long position doubles the
// effective downside slope below the put strike, since it obligates buying more BTC there.

const CURRENCY = "BTC";

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

function computeCoveredStrangle(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const width = spot * (widthPct / 100);

  const callCandidates = [...bucket.calls.keys()].filter((s) => s > spot);
  const putCandidates = [...bucket.puts.keys()].filter((s) => s < spot);
  const callStrike = callCandidates.length ? qClosestStrike(callCandidates, spot + width) : null;
  const putStrike = putCandidates.length ? qClosestStrike(putCandidates, spot - width) : null;
  if (callStrike == null || putStrike == null) return { spot };

  const call = state.summaries.get(bucket.calls.get(callStrike));
  const put = state.summaries.get(bucket.puts.get(putStrike));
  if (!call || !put || call.mark_price == null || put.mark_price == null) return { spot, callStrike, putStrike };

  const callUsd = call.mark_price * spot;
  const putUsd = put.mark_price * spot;
  const totalCredit = callUsd + putUsd;
  const maxProfit = callStrike - spot + totalCredit;
  const breakevenMid = spot - totalCredit; // valid if this lands at/above putStrike
  const breakevenLow = (spot + putStrike - totalCredit) / 2; // valid if breakevenMid would fall below putStrike
  const ivs = [call.mark_iv, put.mark_iv].filter((v) => v != null);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, callStrike, putStrike, callUsd, putUsd, totalCredit, maxProfit, breakevenMid, breakevenLow, atmIv };
}

function renderPayoff(cs) {
  $("payoffExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("payoffChart");
  const popEl = $("popStat");
  if (!cs || cs.spot == null || cs.callStrike == null || cs.putStrike == null || cs.totalCredit == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    $("strikesStat").textContent = "—";
    $("creditStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    if (popEl) popEl.textContent = "—";
    return;
  }

  const { spot, callStrike, putStrike, totalCredit, maxProfit, breakevenMid, breakevenLow, atmIv } = cs;
  $("strikesStat").textContent = `${qFmt(putStrike, 0)} / ${qFmt(callStrike, 0)}`;
  $("creditStat").textContent = `$${qFmt(totalCredit, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(maxProfit, 0)}`;
  const usedMid = breakevenMid >= putStrike;
  $("breakevenStat").textContent = usedMid
    ? `n/a (credit covers any dip to the put strike) / ${qFmt(breakevenMid, 0)}`
    : `${qFmt(breakevenLow, 0)} / n/a (already profitable at the put strike)`;

  const coveredPnl = (S) => (S - spot) + totalCredit - Math.max(S - callStrike, 0) - Math.max(putStrike - S, 0);
  const unhedgedPnl = (S) => S - spot;

  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.5, hi = spot * 1.5;
  const steps = 100;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, covered: coveredPnl(S), unhedged: unhedgedPnl(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.max(Math.abs(p.covered), Math.abs(p.unhedged))), 1) * 1.1;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  [putStrike, callStrike].forEach((K) => {
    const x = xScale(K);
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<text x="${x}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(K, 0)}</text>`;
  });
  const lineFor = (key, color) => {
    let d = "";
    pts.forEach((p, i) => {
      d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p[key]).toFixed(1)} `;
    });
    return `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"/>`;
  };
  svg += lineFor("unhedged", "#8892a6");
  svg += lineFor("covered", "#35d399");
  svg += "</svg>";
  el.innerHTML = svg;

  if (popEl) {
    let pop = null;
    if (atmIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfitFn(coveredPnl, spot, atmIv / 100, T);
    }
    popEl.textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const cs = computeCoveredStrangle(widthPct);
    $("spotStat").textContent = cs && cs.spot != null ? "$" + qFmt(cs.spot, 0) : "—";
    renderPayoff(cs);
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  refresh();
});
$("widthSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
