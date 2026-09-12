// Covered Put strategy page — standalone, REST-only.
// For a short BTC position (assumed notional, same abstraction as the Protective Put and
// Collar pages' assumed long position): sell an OTM put for extra income. The bearish
// mirror of a covered call — profit caps once price falls to the put strike (the position
// is effectively closed out there), while a rally carries unlimited loss like any short.

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

function computeCoveredPut(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const width = spot * (widthPct / 100);

  const putCandidates = [...bucket.puts.keys()].filter((s) => s < spot);
  const putStrike = putCandidates.length ? qClosestStrike(putCandidates, spot - width) : null;
  if (putStrike == null) return { spot };

  const put = state.summaries.get(bucket.puts.get(putStrike));
  if (!put || put.mark_price == null) return { spot, putStrike };

  const premiumUsd = put.mark_price * spot;
  const maxProfit = spot - putStrike + premiumUsd;
  const upsideBreakeven = spot + premiumUsd;

  return { spot, putStrike, premiumUsd, maxProfit, upsideBreakeven, iv: put.mark_iv };
}

function renderPayoff(cp) {
  $("payoffExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("payoffChart");
  const popEl = $("popStat");
  if (!cp || cp.spot == null || cp.putStrike == null || cp.premiumUsd == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    $("strikeStat").textContent = "—";
    $("premiumStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    if (popEl) popEl.textContent = "—";
    return;
  }

  const { spot, putStrike, premiumUsd, maxProfit, upsideBreakeven, iv } = cp;
  $("strikeStat").textContent = qFmt(putStrike, 0);
  $("premiumStat").textContent = `$${qFmt(premiumUsd, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(maxProfit, 0)}`;
  $("breakevenStat").textContent = qFmt(upsideBreakeven, 0);

  const coveredPnl = (S) => (spot - S) + premiumUsd - Math.max(putStrike - S, 0);
  const unhedgedPnl = (S) => spot - S;

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
  const kx = xScale(putStrike);
  svg += `<line x1="${kx}" y1="${padT}" x2="${kx}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
  svg += `<text x="${kx}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(putStrike, 0)}</text>`;
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
    if (iv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfitFn(coveredPnl, spot, iv / 100, T);
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
    const cp = computeCoveredPut(widthPct);
    $("spotStat").textContent = cp && cp.spot != null ? "$" + qFmt(cp.spot, 0) : "—";
    renderPayoff(cp);
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
