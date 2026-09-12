// Delta-Hedged Risk Reversal strategy page — standalone, REST-only.
// Same 25-delta risk reversal construction as strategy-skew-arb.js, plus a spot hedge
// sized to null the combined position's delta at inception. Shows same-day mark-to-market
// sensitivity (Black-Scholes reprice at each leg's current IV, not a payoff-at-expiry
// chart) with and without that hedge — the correct scope for what a one-time delta hedge
// actually achieves.

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

function findDeltaStrike(strikes, bucket, type, targetDelta, spot, T) {
  let best = null, bestDiff = Infinity;
  for (const strike of strikes) {
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_iv == null) continue;
    const sigma = sum.mark_iv / 100;
    const delta = qBsDelta(type, spot, strike, T, sigma);
    const diff = Math.abs(delta - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike, delta, iv: sum.mark_iv };
    }
  }
  return best;
}

function compute() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  const call25 = findDeltaStrike(strikes, bucket, "call", 0.25, spot, T);
  const put25 = findDeltaStrike(strikes, bucket, "put", -0.25, spot, T);
  if (!call25 || !put25) return { spot };

  const richer = call25.iv - put25.iv < 0 ? "put" : "call";
  const sigmaCall = call25.iv / 100, sigmaPut = put25.iv / 100;

  // richer === "put": sell put, buy call. richer === "call": sell call, buy put.
  const shortDelta = richer === "put" ? put25.delta : call25.delta;
  const longDelta = richer === "put" ? call25.delta : put25.delta;
  const netOptionDelta = -shortDelta + longDelta;
  const hedgeShares = -netOptionDelta;

  const optionsMtmPnl = (S) => {
    const callVal0 = qBsPrice("call", spot, call25.strike, T, sigmaCall);
    const putVal0 = qBsPrice("put", spot, put25.strike, T, sigmaPut);
    const callValS = qBsPrice("call", S, call25.strike, T, sigmaCall);
    const putValS = qBsPrice("put", S, put25.strike, T, sigmaPut);
    return richer === "put" ? -(putValS - putVal0) + (callValS - callVal0) : -(callValS - callVal0) + (putValS - putVal0);
  };
  const hedgedMtmPnl = (S) => optionsMtmPnl(S) + hedgeShares * (S - spot);

  const structure =
    richer === "put"
      ? `Puts richer → sell 25Δ put (${qFmt(put25.strike, 0)}), buy 25Δ call (${qFmt(call25.strike, 0)})`
      : `Calls richer → sell 25Δ call (${qFmt(call25.strike, 0)}), buy 25Δ put (${qFmt(put25.strike, 0)})`;

  return { spot, call25, put25, richer, structure, netOptionDelta, hedgeShares, optionsMtmPnl, hedgedMtmPnl };
}

function buildSensitivitySvg(unhedgedFn, hedgedFn, spot) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.85, hi = spot * 1.15;
  const steps = 100;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, unhedged: unhedgedFn(S), hedged: hedgedFn(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.max(Math.abs(p.unhedged), Math.abs(p.hedged))), 1) * 1.1;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  svg += `<text x="${spotX}" y="${padT - 2}" font-size="9" fill="#f7931a" text-anchor="middle">spot</text>`;
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
  return svg;
}

function render(r) {
  $("spotStat").textContent = r && r.spot != null ? "$" + qFmt(r.spot, 0) : "—";
  const chartEl = $("barChart");

  if (!r || r.netOptionDelta == null) {
    $("structureStat").textContent = "—";
    $("netDeltaStat").textContent = "—";
    $("hedgeStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data</p>';
    return;
  }

  $("structureStat").textContent = r.structure;
  $("netDeltaStat").textContent = qFmtSigned(r.netOptionDelta, 3);
  $("hedgeStat").textContent = `${r.hedgeShares >= 0 ? "Long" : "Short"} ${qFmt(Math.abs(r.hedgeShares), 3)} BTC-equivalent`;

  chartEl.innerHTML = buildSensitivitySvg(r.optionsMtmPnl, r.hedgedMtmPnl, r.spot);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const r = compute();
    render(r);
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

refresh();
setInterval(refresh, 30000);
