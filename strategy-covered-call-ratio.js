// Covered Call Overwrite (2:1 Ratio Write) strategy page — standalone, REST-only.
// For an assumed long BTC position: sell 2 OTM calls per 1 BTC held instead of 1 (a plain
// covered call). Below the strike this just doubles the premium cushion — but above the
// strike the position flips from flat (a plain covered call's capped-but-safe upside) to
// net SHORT one call, with unlimited loss as price keeps rising. Verified numerically
// (scratchpad): payoff slope above the strike is exactly -1 for the 2:1 write vs. exactly
// 0 for a plain covered call at the same strike.

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

function computeRatioWrite(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const width = spot * (widthPct / 100);

  const callCandidates = [...bucket.calls.keys()].filter((s) => s > spot);
  const callStrike = callCandidates.length ? qClosestStrike(callCandidates, spot + width) : null;
  if (callStrike == null) return { spot };

  const call = state.summaries.get(bucket.calls.get(callStrike));
  if (!call || call.mark_price == null) return { spot, callStrike };

  const premiumUsd = call.mark_price * spot;
  const maxProfit = callStrike - spot + 2 * premiumUsd;
  const downsideBreakeven = spot - 2 * premiumUsd;
  const unlimitedRiskBreakeven = 2 * callStrike - spot + 2 * premiumUsd;

  return { spot, callStrike, premiumUsd, maxProfit, downsideBreakeven, unlimitedRiskBreakeven, iv: call.mark_iv };
}

function renderPayoff(rw) {
  $("payoffExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("payoffChart");
  const popEl = $("popStat");
  if (!rw || rw.spot == null || rw.callStrike == null || rw.premiumUsd == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    $("strikeStat").textContent = "—";
    $("premiumStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("downsideBeStat").textContent = "—";
    $("riskBeStat").textContent = "—";
    if (popEl) popEl.textContent = "—";
    return;
  }

  const { spot, callStrike, premiumUsd, maxProfit, downsideBreakeven, unlimitedRiskBreakeven, iv } = rw;
  $("strikeStat").textContent = qFmt(callStrike, 0);
  $("premiumStat").textContent = `$${qFmt(premiumUsd, 0)} × 2 = $${qFmt(2 * premiumUsd, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(maxProfit, 0)}`;
  $("downsideBeStat").textContent = qFmt(downsideBreakeven, 0);
  $("riskBeStat").textContent = qFmt(unlimitedRiskBreakeven, 0);

  const unhedgedPnl = (S) => S - spot;
  const coveredCallPnl = (S) => (S - spot) + premiumUsd - Math.max(S - callStrike, 0);
  const ratioWritePnl = (S) => (S - spot) + 2 * premiumUsd - 2 * Math.max(S - callStrike, 0);

  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.5, hi = spot * 1.5;
  const steps = 100;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, unhedged: unhedgedPnl(S), covered: coveredCallPnl(S), ratio: ratioWritePnl(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs =
    Math.max(...pts.map((p) => Math.max(Math.abs(p.unhedged), Math.abs(p.covered), Math.abs(p.ratio))), 1) * 1.1;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  const kx = xScale(callStrike);
  svg += `<line x1="${kx}" y1="${padT}" x2="${kx}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
  svg += `<text x="${kx}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(callStrike, 0)}</text>`;
  const lineFor = (key, color) => {
    let d = "";
    pts.forEach((p, i) => {
      d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p[key]).toFixed(1)} `;
    });
    return `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"/>`;
  };
  svg += lineFor("unhedged", "#8892a6");
  svg += lineFor("covered", "#35d399");
  svg += lineFor("ratio", "#ff5c7c");
  svg += "</svg>";
  el.innerHTML = svg;

  if (popEl) {
    let pop = null;
    if (iv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfitFn(ratioWritePnl, spot, iv / 100, T);
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
    const rw = computeRatioWrite(widthPct);
    $("spotStat").textContent = rw && rw.spot != null ? "$" + qFmt(rw.spot, 0) : "—";
    renderPayoff(rw);
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
