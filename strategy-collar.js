// Collar Strategy (zero-cost hedge) strategy page — standalone, REST-only.
// Finds the put nearest the selected floor, then scans OTM calls for the strike whose
// premium most closely offsets the put's — a "zero-cost" collar by construction.

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

function computeCollar(floorPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };

  const putStrikes = [...bucket.puts.keys()].sort((a, b) => a - b);
  const floorTarget = spot * (1 - floorPct / 100);
  const floorStrike = qClosestStrike(putStrikes, floorTarget);
  const put = floorStrike != null ? state.summaries.get(bucket.puts.get(floorStrike)) : null;
  if (!put || put.mark_price == null) return { spot, floorStrike };
  const putPremiumUsd = put.mark_price * spot;

  const callStrikes = [...bucket.calls.keys()].filter((k) => k > spot).sort((a, b) => a - b);
  let capStrike = null, bestDiff = Infinity, capPremiumUsd = null, capIv = null;
  for (const strike of callStrikes) {
    const call = state.summaries.get(bucket.calls.get(strike));
    if (!call || call.mark_price == null) continue;
    const premiumUsd = call.mark_price * spot;
    const diff = Math.abs(premiumUsd - putPremiumUsd);
    if (diff < bestDiff) {
      bestDiff = diff;
      capStrike = strike;
      capPremiumUsd = premiumUsd;
      capIv = call.mark_iv;
    }
  }

  const ivs = [put.mark_iv, capIv].filter((v) => v != null);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, floorStrike, putPremiumUsd, capStrike, capPremiumUsd, atmIv };
}

function renderPayoff(collar) {
  $("payoffExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("payoffChart");
  const popEl = $("popStat");
  if (!collar || collar.spot == null || collar.floorStrike == null || collar.capStrike == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    if (popEl) popEl.textContent = "—";
    return;
  }
  const { spot, floorStrike, putPremiumUsd, capStrike, capPremiumUsd, atmIv } = collar;
  const netCost = putPremiumUsd - capPremiumUsd;
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.5, hi = spot * 1.5;
  const steps = 100;
  const collaredPnl = (S) => (S - spot) + Math.max(floorStrike - S, 0) - Math.max(S - capStrike, 0) - netCost;
  const unhedgedPnl = (S) => S - spot;
  if (popEl) {
    let pop = null;
    if (atmIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfitFn(collaredPnl, spot, atmIv / 100, T);
    }
    popEl.textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, collared: collaredPnl(S), unhedged: unhedgedPnl(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.max(Math.abs(p.collared), Math.abs(p.unhedged))), 1) * 1.1;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  [floorStrike, capStrike].forEach((K) => {
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
  svg += lineFor("collared", "#35d399");
  svg += "</svg>";
  el.innerHTML = svg;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const floorPct = Number($("floorSelect").value);
    const collar = computeCollar(floorPct);

    $("spotStat").textContent = collar && collar.spot != null ? "$" + qFmt(collar.spot, 0) : "—";
    $("floorStat").textContent = collar && collar.floorStrike != null ? qFmt(collar.floorStrike, 0) : "—";
    $("capStat").textContent = collar && collar.capStrike != null ? qFmt(collar.capStrike, 0) : "—";
    if (collar && collar.putPremiumUsd != null && collar.capPremiumUsd != null) {
      const netCost = collar.putPremiumUsd - collar.capPremiumUsd;
      $("netCostStat").textContent = netCost >= 0 ? `debit $${qFmt(netCost, 0)}` : `credit $${qFmt(-netCost, 0)}`;
    } else {
      $("netCostStat").textContent = "—";
    }

    renderPayoff(collar);

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
$("floorSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
