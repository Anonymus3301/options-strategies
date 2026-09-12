// Seagull Spread strategy page — standalone, REST-only.
// For holders: buy a put at K2 (floor), sell a further-OTM put at K1 < K2 (cheapens the
// floor), sell a call at K3 (finances the rest). A 3-option-leg refinement of the Collar
// page's 2-leg structure — full protection only between K1 and K2, not below K1.

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

function computeSeagull(floorPct, extraPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };

  const putStrikes = [...bucket.puts.keys()].sort((a, b) => a - b);
  const k2Target = spot * (1 - floorPct / 100);
  const k2 = qClosestStrike(putStrikes, k2Target);
  if (k2 == null) return { spot };
  const put2 = state.summaries.get(bucket.puts.get(k2));
  if (!put2 || put2.mark_price == null) return { spot, k2 };

  const k1Candidates = putStrikes.filter((s) => s < k2);
  const k1Target = spot * (1 - (floorPct + extraPct) / 100);
  const k1 = k1Candidates.length ? qClosestStrike(k1Candidates, k1Target) : null;
  if (k1 == null) return { spot, k2 };
  const put1 = state.summaries.get(bucket.puts.get(k1));
  if (!put1 || put1.mark_price == null) return { spot, k2, k1 };

  const put2Usd = put2.mark_price * spot;
  const put1Usd = put1.mark_price * spot;
  const putSpreadCost = put2Usd - put1Usd;

  const callStrikes = [...bucket.calls.keys()].filter((s) => s > spot).sort((a, b) => a - b);
  let k3 = null, bestDiff = Infinity, call3Usd = null, call3Iv = null;
  for (const strike of callStrikes) {
    const call = state.summaries.get(bucket.calls.get(strike));
    if (!call || call.mark_price == null) continue;
    const usd = call.mark_price * spot;
    const diff = Math.abs(usd - putSpreadCost);
    if (diff < bestDiff) {
      bestDiff = diff;
      k3 = strike;
      call3Usd = usd;
      call3Iv = call.mark_iv;
    }
  }
  if (k3 == null) return { spot, k2, k1, putSpreadCost };

  const netCost = putSpreadCost - call3Usd;
  const ivs = [put1.mark_iv, put2.mark_iv, call3Iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, k1, k2, k3, put1Usd, put2Usd, call3Usd, netCost, avgIv };
}

function renderPayoff(sg) {
  $("payoffExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("payoffChart");
  const popEl = $("popStat");
  if (!sg || sg.spot == null || sg.k1 == null || sg.k2 == null || sg.k3 == null || sg.netCost == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    $("strikesStat").textContent = "—";
    $("netCostStat").textContent = "—";
    $("bandStat").textContent = "—";
    if (popEl) popEl.textContent = "—";
    return;
  }

  const { spot, k1, k2, k3, netCost, avgIv } = sg;
  $("strikesStat").textContent = `${qFmt(k1, 0)} / ${qFmt(k2, 0)} / ${qFmt(k3, 0)}`;
  $("netCostStat").textContent = netCost >= 0 ? `debit $${qFmt(netCost, 0)}` : `credit $${qFmt(-netCost, 0)}`;
  $("bandStat").textContent = `${qFmt(k1, 0)} — ${qFmt(k2, 0)}`;

  const hedgedPnl = (S) => (S - spot) + Math.max(k2 - S, 0) - Math.max(k1 - S, 0) - Math.max(S - k3, 0) - netCost;
  const unhedgedPnl = (S) => S - spot;

  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.5, hi = spot * 1.5;
  const steps = 100;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, hedged: hedgedPnl(S), unhedged: unhedgedPnl(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.max(Math.abs(p.hedged), Math.abs(p.unhedged))), 1) * 1.1;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  [k1, k2, k3].forEach((K) => {
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
  svg += lineFor("hedged", "#35d399");
  svg += "</svg>";
  el.innerHTML = svg;

  if (popEl) {
    let pop = null;
    if (avgIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfitFn(hedgedPnl, spot, avgIv / 100, T);
    }
    popEl.textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const floorPct = Number($("floorSelect").value);
    const extraPct = Number($("extraSelect").value);
    const sg = computeSeagull(floorPct, extraPct);
    $("spotStat").textContent = sg && sg.spot != null ? "$" + qFmt(sg.spot, 0) : "—";
    renderPayoff(sg);
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
$("extraSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
