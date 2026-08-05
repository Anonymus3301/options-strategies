// BTC Options Ladder — live data from Deribit's free public API.
// REST is used to build/refresh the full chain (one call fetches every strike),
// WebSocket is used for the live index price feed and the per-instrument order book.

const CURRENCY = "BTC";
const REST_BASE = "https://www.deribit.com/api/v2/public";
const WS_URL = "wss://www.deribit.com/ws/api/v2";
const CHAIN_POLL_MS = 5000;
const INSTRUMENTS_REFRESH_MS = 5 * 60 * 1000;
const REALIZED_VOL_REFRESH_MS = 5 * 60 * 1000;
const LARGE_TRADE_THRESHOLD = 5; // contracts
const COLOR_CALL = "#35d399";
const COLOR_PUT = "#ff5c7c";
const COLOR_ACCENT = "#f7931a";
const COLOR_BORDER = "#232a3a";
const COLOR_DIM = "#8892a6";

const state = {
  instrumentsByExpiry: new Map(), // expiryTs -> { calls: Map(strike->name), puts: Map(strike->name) }
  expiries: [], // sorted [expiryTs]
  selectedExpiry: null,
  summaries: new Map(), // instrument_name -> summary object
  greeks: new Map(), // instrument_name -> { delta, gamma, theta, vega, rho }
  greeksChannels: [], // currently-subscribed ticker.* channels, so we can unsubscribe on expiry switch
  indexPrice: null,
  obInstrument: null,
  perp: { markPrice: null, fundingRate: null },
  realizedVol: null,
  recentTrades: [],
  strategyLegs: [], // { instrument, strike, type, side, qty, premiumUsd }
};

let mainWs = null;
let obWs = null;
let mainWsRetryDelay = 1000;
let rpcId = 1;
let chart, chartSeries;
let greeksRenderPending = false;
let tradesRenderPending = false;

const $ = (id) => document.getElementById(id);

function rpcSend(ws, method, params) {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }));
}

function fmtNum(n, digits = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function fmtStrike(n) {
  return Number(n).toLocaleString();
}

// ---------- REST: build & refresh the chain ----------

async function fetchInstruments() {
  const res = await fetch(`${REST_BASE}/get_instruments?currency=${CURRENCY}&kind=option&expired=false`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function fetchBookSummary() {
  const res = await fetch(`${REST_BASE}/get_book_summary_by_currency?currency=${CURRENCY}&kind=option`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function fetchRealizedVolInput() {
  const end = Date.now();
  const start = end - 30 * 24 * 60 * 60 * 1000;
  const url = `${REST_BASE}/get_tradingview_chart_data?instrument_name=BTC-PERPETUAL&start_timestamp=${start}&end_timestamp=${end}&resolution=1D`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function computeRealizedVol(ohlc) {
  if (!ohlc || !ohlc.close || ohlc.close.length < 3) return null;
  const closes = ohlc.close;
  const returns = [];
  for (let i = 1; i < closes.length; i++) returns.push(Math.log(closes[i] / closes[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

async function refreshRealizedVol() {
  try {
    state.realizedVol = computeRealizedVol(await fetchRealizedVolInput());
    updateVolStat();
  } catch (err) {
    console.error("realized vol fetch failed", err);
  }
}

function indexInstruments(list) {
  state.instrumentsByExpiry.clear();
  for (const inst of list) {
    const expiry = inst.expiration_timestamp;
    if (!state.instrumentsByExpiry.has(expiry)) {
      state.instrumentsByExpiry.set(expiry, { calls: new Map(), puts: new Map() });
    }
    const bucket = state.instrumentsByExpiry.get(expiry);
    const side = inst.option_type === "call" ? bucket.calls : bucket.puts;
    side.set(inst.strike, inst.instrument_name);
  }
  state.expiries = [...state.instrumentsByExpiry.keys()].sort((a, b) => a - b);
  if (!state.selectedExpiry || !state.instrumentsByExpiry.has(state.selectedExpiry)) {
    state.selectedExpiry = state.expiries[0] ?? null;
  }
}

function indexSummaries(list) {
  for (const s of list) state.summaries.set(s.instrument_name, s);
}

async function refreshInstruments() {
  try {
    const hadExpiry = state.selectedExpiry;
    indexInstruments(await fetchInstruments());
    renderExpiryTabs();
    if (state.selectedExpiry !== hadExpiry) subscribeGreeksForExpiry(state.selectedExpiry);
  } catch (err) {
    console.error("get_instruments failed", err);
  }
}

async function refreshChain() {
  try {
    indexSummaries(await fetchBookSummary());
    $("lastUpdate").textContent = new Date().toLocaleTimeString();
    renderLadder();
  } catch (err) {
    console.error("get_book_summary_by_currency failed", err);
    $("ladderBody").innerHTML =
      `<tr><td colspan="15" class="loading">Couldn't reach Deribit's REST API (${err.message}). Retrying…</td></tr>`;
  }
}

// ---------- Rendering: expiry tabs + ladder ----------

function expiryLabel(ts) {
  const d = new Date(ts);
  const days = Math.max(0, Math.round((ts - Date.now()) / 86400000));
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" })} (${days}d)`;
}

function renderExpiryTabs() {
  const el = $("expiryTabs");
  el.innerHTML = "";
  for (const ts of state.expiries) {
    const btn = document.createElement("button");
    btn.className = "expiry-tab" + (ts === state.selectedExpiry ? " active" : "");
    btn.textContent = expiryLabel(ts);
    btn.onclick = () => {
      state.selectedExpiry = ts;
      renderExpiryTabs();
      subscribeGreeksForExpiry(ts);
      renderLadder();
    };
    el.appendChild(btn);
  }
}

function closestStrike(strikes) {
  if (state.indexPrice == null || strikes.length === 0) return null;
  return strikes.reduce((best, s) =>
    Math.abs(s - state.indexPrice) < Math.abs(best - state.indexPrice) ? s : best
  );
}

function renderLadder() {
  const body = $("ladderBody");
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  $("expiryLabel").textContent = state.selectedExpiry ? expiryLabel(state.selectedExpiry) : "—";

  if (!bucket) {
    body.innerHTML = `<tr><td colspan="15" class="loading">Loading instruments from Deribit…</td></tr>`;
    return;
  }

  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = closestStrike(strikes);

  body.innerHTML = "";
  for (const strike of strikes) {
    const callName = bucket.calls.get(strike);
    const putName = bucket.puts.get(strike);
    const call = callName ? state.summaries.get(callName) : null;
    const put = putName ? state.summaries.get(putName) : null;
    const callGreeks = callName ? state.greeks.get(callName) : null;
    const putGreeks = putName ? state.greeks.get(putName) : null;

    const tr = document.createElement("tr");
    tr.className = "option-row" + (strike === atm ? " atm-row" : "");

    tr.innerHTML = `
      <td class="call-cell">${call ? fmtNum(call.open_interest, 0) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.volume, 0) : "—"}</td>
      <td class="call-cell">${call && call.mark_iv != null ? fmtNum(call.mark_iv, 1) : "—"}</td>
      <td class="call-cell">${callGreeks && callGreeks.delta != null ? fmtNum(callGreeks.delta, 3) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.bid_price, 4) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.mark_price, 4) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.ask_price, 4) : "—"}</td>
      <td class="strike-cell">
        <div class="strike-value">${fmtStrike(strike)}</div>
        <div class="strike-actions">
          ${callName ? `<button type="button" class="leg-btn leg-btn-call" data-instrument="${callName}" title="Add ${callName} (long) to strategy">+C</button>` : ""}
          ${putName ? `<button type="button" class="leg-btn leg-btn-put" data-instrument="${putName}" title="Add ${putName} (long) to strategy">+P</button>` : ""}
        </div>
      </td>
      <td class="put-cell">${put ? fmtNum(put.bid_price, 4) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.mark_price, 4) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.ask_price, 4) : "—"}</td>
      <td class="put-cell">${putGreeks && putGreeks.delta != null ? fmtNum(putGreeks.delta, 3) : "—"}</td>
      <td class="put-cell">${put && put.mark_iv != null ? fmtNum(put.mark_iv, 1) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.volume, 0) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.open_interest, 0) : "—"}</td>
    `;

    tr.addEventListener("click", () => {
      // Prefer whichever side was clicked closer to; default to the call leg.
      const target = callName || putName;
      if (target) openOrderBook(target);
    });
    tr.querySelectorAll(".leg-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        addStrategyLeg(btn.dataset.instrument);
      });
    });
    body.appendChild(tr);
  }

  renderPriceByStrikeChart(strikes, bucket, atm);
  renderIvSkewChart(strikes, bucket, atm);
  renderOiChart(strikes, bucket);
  renderGexChart(strikes, bucket);
  renderIvTermChart();
  renderMarketStats(strikes, bucket);
}

// ---------- Chain charts: IV skew + open interest by strike (SVG, no extra API calls) ----------

function buildLineChartSvg(xValues, series, opts = {}) {
  const W = 600, H = 200, padL = 42, padR = 12, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xMin = Math.min(...xValues), xMax = Math.max(...xValues);
  const xScale = (x) => padL + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);

  const allVals = series.flatMap((s) => s.data).filter((v) => v != null);
  if (!allVals.length) return '<p class="loading">No data</p>';
  const yMax = Math.max(...allVals) * 1.15 || 1;
  const yScale = (v) => padT + innerH - (v / yMax) * innerH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;

  const yDecimals = opts.decimals || 0;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax * i) / ticks;
    const y = yScale(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${COLOR_BORDER}" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">${v.toFixed(yDecimals)}</text>`;
  }

  const xLabelFn = opts.xLabelFn || ((x) => (x / 1000).toFixed(0) + "k");
  const labelStep = Math.max(1, Math.ceil(xValues.length / 8));
  xValues.forEach((x, i) => {
    if (i % labelStep === 0 || i === xValues.length - 1) {
      svg += `<text x="${xScale(x)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${xLabelFn(x)}</text>`;
    }
  });

  if (opts.atmX != null && opts.atmX >= xMin && opts.atmX <= xMax) {
    const ax = xScale(opts.atmX);
    svg += `<line x1="${ax}" y1="${padT}" x2="${ax}" y2="${H - padB}" stroke="${COLOR_ACCENT}" stroke-width="1" stroke-dasharray="3,3"/>`;
  }

  for (const s of series) {
    let d = "";
    let open = false;
    xValues.forEach((x, i) => {
      const v = s.data[i];
      if (v == null) {
        open = false;
        return;
      }
      const px = xScale(x).toFixed(1);
      const py = yScale(v).toFixed(1);
      d += (open ? "L" : "M") + px + "," + py + " ";
      open = true;
    });
    if (d) {
      const dash = s.dashed ? ' stroke-dasharray="4,3"' : "";
      svg += `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2"${dash}/>`;
    }
  }

  svg += "</svg>";
  return svg;
}

function buildOiChartSvg(xValues, callData, putData) {
  const W = 600, H = 200, padL = 42, padR = 12, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxVal = Math.max(1, ...callData, ...putData);
  const zeroY = padT + innerH / 2;
  const scale = innerH / 2 / maxVal;
  const n = xValues.length;
  const bandW = innerW / n;
  const barW = Math.max(1, bandW * 0.6);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="${COLOR_BORDER}" stroke-width="1"/>`;
  svg += `<text x="${padL - 6}" y="${padT + 8}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">${fmtNum(maxVal, 0)}</text>`;
  svg += `<text x="${padL - 6}" y="${zeroY + 3}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">0</text>`;
  svg += `<text x="${padL - 6}" y="${H - padB}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">${fmtNum(maxVal, 0)}</text>`;

  const labelStep = Math.max(1, Math.ceil(n / 8));
  xValues.forEach((x, i) => {
    const cx = padL + bandW * i + bandW / 2;
    const callH = (callData[i] || 0) * scale;
    const putH = (putData[i] || 0) * scale;
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(zeroY - callH).toFixed(1)}" width="${barW.toFixed(1)}" height="${callH.toFixed(1)}" fill="${COLOR_CALL}" opacity="0.85"/>`;
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${zeroY.toFixed(1)}" width="${barW.toFixed(1)}" height="${putH.toFixed(1)}" fill="${COLOR_PUT}" opacity="0.85"/>`;
    if (i % labelStep === 0 || i === n - 1) {
      svg += `<text x="${cx.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${(x / 1000).toFixed(0)}k</text>`;
    }
  });

  svg += "</svg>";
  return svg;
}

function renderPriceByStrikeChart(strikes, bucket, atm) {
  const el = $("priceByStrikeChart");
  $("priceByStrikeExpiry").textContent = state.selectedExpiry ? expiryLabel(state.selectedExpiry) : "—";
  if (!strikes.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const callMark = strikes.map((s) => {
    const sum = state.summaries.get(bucket.calls.get(s));
    return sum && sum.mark_price != null ? sum.mark_price : null;
  });
  const putMark = strikes.map((s) => {
    const sum = state.summaries.get(bucket.puts.get(s));
    return sum && sum.mark_price != null ? sum.mark_price : null;
  });
  el.innerHTML = buildLineChartSvg(
    strikes,
    [
      { data: callMark, color: COLOR_CALL },
      { data: putMark, color: COLOR_PUT },
    ],
    { atmX: atm, decimals: 4 }
  );
}

// Least-squares fit of y = a*x^2 + b*x + c via the normal equations (Cramer's rule).
function solve3x3(A, B) {
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return null;
  const replaceCol = (m, col, vec) => m.map((row, i) => row.map((v, j) => (j === col ? vec[i] : v)));
  return [det(replaceCol(A, 0, B)) / D, det(replaceCol(A, 1, B)) / D, det(replaceCol(A, 2, B)) / D];
}

function quadraticFit(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    sx += x; sx2 += x * x; sx3 += x * x * x; sx4 += x * x * x * x;
    sy += y; sxy += x * y; sx2y += x * x * y;
  }
  const sol = solve3x3(
    [
      [sx4, sx3, sx2],
      [sx3, sx2, sx],
      [sx2, sx, n],
    ],
    [sx2y, sxy, sy]
  );
  if (!sol) return null;
  const [a, b, c] = sol;
  return (x) => a * x * x + b * x + c;
}

function renderIvSkewChart(strikes, bucket, atm) {
  const el = $("ivSkewChart");
  $("ivSkewExpiry").textContent = state.selectedExpiry ? expiryLabel(state.selectedExpiry) : "—";
  if (!strikes.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const callIv = strikes.map((s) => {
    const sum = state.summaries.get(bucket.calls.get(s));
    return sum && sum.mark_iv != null ? sum.mark_iv : null;
  });
  const putIv = strikes.map((s) => {
    const sum = state.summaries.get(bucket.puts.get(s));
    return sum && sum.mark_iv != null ? sum.mark_iv : null;
  });

  const series = [
    { data: callIv, color: COLOR_CALL },
    { data: putIv, color: COLOR_PUT },
  ];

  // Smile fit uses OTM points only (OTM calls above ATM, OTM puts below), the
  // conventional way to assemble one smile curve from a call+put chain.
  if (atm != null) {
    const smilePoints = [];
    strikes.forEach((s, i) => {
      if (s >= atm && callIv[i] != null) smilePoints.push([s, callIv[i]]);
      else if (s < atm && putIv[i] != null) smilePoints.push([s, putIv[i]]);
    });
    const fit = quadraticFit(smilePoints.map((p) => p[0]), smilePoints.map((p) => p[1]));
    if (fit) series.push({ data: strikes.map((s) => fit(s)), color: COLOR_ACCENT, dashed: true });
  }

  el.innerHTML = buildLineChartSvg(strikes, series, { atmX: atm });
}

function renderOiChart(strikes, bucket) {
  const el = $("oiChart");
  if (!strikes.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const callOi = strikes.map((s) => {
    const sum = state.summaries.get(bucket.calls.get(s));
    return sum ? sum.open_interest || 0 : 0;
  });
  const putOi = strikes.map((s) => {
    const sum = state.summaries.get(bucket.puts.get(s));
    return sum ? sum.open_interest || 0 : 0;
  });
  el.innerHTML = buildOiChartSvg(strikes, callOi, putOi);
}

function renderGexChart(strikes, bucket) {
  const el = $("gexChart");
  if (!strikes.length || state.indexPrice == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const spot = state.indexPrice;
  const gexFor = (nameOf) =>
    strikes.map((s) => {
      const name = nameOf(s);
      const sum = name ? state.summaries.get(name) : null;
      const g = name ? state.greeks.get(name) : null;
      if (!sum || !g || g.gamma == null) return 0;
      // Notional gamma exposure per 1% spot move (USD), a common simplified GEX convention.
      return (sum.open_interest || 0) * g.gamma * spot * spot * 0.01;
    });
  el.innerHTML = buildOiChartSvg(strikes, gexFor((s) => bucket.calls.get(s)), gexFor((s) => bucket.puts.get(s)));
}

// ---------- Derived market stats: Max Pain, Put/Call ratio, IV term structure ----------

function computeMaxPain(strikes, bucket) {
  if (!strikes.length) return null;
  const oiAt = (nameOf) => strikes.map((s) => (state.summaries.get(nameOf(s)) || {}).open_interest || 0);
  const callOi = oiAt((s) => bucket.calls.get(s));
  const putOi = oiAt((s) => bucket.puts.get(s));

  let bestStrike = null, bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    strikes.forEach((k, i) => {
      if (settle > k) pain += (settle - k) * callOi[i];
      if (settle < k) pain += (k - settle) * putOi[i];
    });
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  return bestStrike;
}

function computePcr(strikes, bucket) {
  let callVol = 0, putVol = 0, callOi = 0, putOi = 0;
  for (const s of strikes) {
    const c = state.summaries.get(bucket.calls.get(s));
    const p = state.summaries.get(bucket.puts.get(s));
    if (c) {
      callVol += c.volume || 0;
      callOi += c.open_interest || 0;
    }
    if (p) {
      putVol += p.volume || 0;
      putOi += p.open_interest || 0;
    }
  }
  return {
    volume: callVol > 0 ? putVol / callVol : null,
    oi: callOi > 0 ? putOi / callOi : null,
  };
}

function computeIvTermStructure() {
  return state.expiries.map((ts) => {
    const bucket = state.instrumentsByExpiry.get(ts);
    const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])];
    const atm = closestStrike(strikes);
    if (atm == null) return { expiry: ts, atmIv: null };
    const c = state.summaries.get(bucket.calls.get(atm));
    const p = state.summaries.get(bucket.puts.get(atm));
    const ivs = [c && c.mark_iv, p && p.mark_iv].filter((v) => v != null);
    return { expiry: ts, atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null };
  });
}

function renderIvTermChart() {
  const el = $("ivTermChart");
  const term = computeIvTermStructure().filter((t) => t.atmIv != null);
  if (!term.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  el.innerHTML = buildLineChartSvg(
    term.map((t) => t.expiry),
    [{ data: term.map((t) => t.atmIv), color: COLOR_ACCENT }],
    { xLabelFn: (x) => new Date(x).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) }
  );
}

function updateVolStat() {
  const term = state.expiries.length ? computeIvTermStructure() : [];
  const front = term.find((t) => t.atmIv != null);
  const parts = [
    state.realizedVol != null ? `RVol ${fmtNum(state.realizedVol, 1)}%` : "RVol —",
    front ? `ATM IV ${fmtNum(front.atmIv, 1)}%` : "ATM IV —",
  ];
  $("volStat").textContent = parts.join(" / ");
}

function renderMarketStats(strikes, bucket) {
  const maxPain = computeMaxPain(strikes, bucket);
  $("maxPainStat").textContent = maxPain != null ? fmtStrike(maxPain) : "—";

  const pcr = computePcr(strikes, bucket);
  $("pcrStat").textContent =
    (pcr.volume != null ? fmtNum(pcr.volume, 2) : "—") + " vol · " + (pcr.oi != null ? fmtNum(pcr.oi, 2) : "—") + " oi";

  updateVolStat();
}

function updatePerpStats() {
  const parts = [];
  if (state.perp.fundingRate != null) parts.push(`Funding ${(state.perp.fundingRate * 100).toFixed(4)}%`);
  if (state.perp.markPrice != null && state.indexPrice != null) {
    const basis = state.perp.markPrice - state.indexPrice;
    parts.push(`Basis ${basis >= 0 ? "+" : ""}${fmtNum(basis, 2)}`);
  }
  $("fundingBasisStat").textContent = parts.length ? parts.join(" · ") : "—";
}

function highlightAtmOnly() {
  // Re-render is cheap enough at this table size; keeps ATM marker in sync with live index price.
  renderLadder();
}

// ---------- Index price feed + chart (WebSocket) ----------

function setPill(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = "pill " + cls;
}

function initChart() {
  if (typeof LightweightCharts === "undefined") {
    $("priceChart").innerHTML =
      '<p class="loading">Chart library failed to load — the rest of the ladder still works.</p>';
    return;
  }
  const container = $("priceChart");
  chart = LightweightCharts.createChart(container, {
    layout: { background: { color: "transparent" }, textColor: "#8892a6" },
    grid: { vertLines: { color: "#1c2331" }, horzLines: { color: "#1c2331" } },
    rightPriceScale: { borderColor: "#232a3a" },
    timeScale: { borderColor: "#232a3a", timeVisible: true, secondsVisible: true },
    autoSize: true,
  });
  chartSeries = chart.addAreaSeries({
    lineColor: "#f7931a",
    topColor: "rgba(247,147,26,0.35)",
    bottomColor: "rgba(247,147,26,0.02)",
    lineWidth: 2,
  });
}

let lastChartTime = 0;
function pushChartPoint(timestampMs, price) {
  if (!chartSeries) return;
  let t = Math.floor(timestampMs / 1000);
  if (t <= lastChartTime) t = lastChartTime + 1; // lightweight-charts requires strictly increasing time
  lastChartTime = t;
  chartSeries.update({ time: t, value: price });
}

function subscribeGreeksForExpiry(expiryTs) {
  if (!mainWs || mainWs.readyState !== WebSocket.OPEN) return;
  if (state.greeksChannels.length) {
    rpcSend(mainWs, "public/unsubscribe", { channels: state.greeksChannels });
  }
  const bucket = state.instrumentsByExpiry.get(expiryTs);
  const names = bucket ? [...bucket.calls.values(), ...bucket.puts.values()] : [];
  state.greeksChannels = names.map((n) => `ticker.${n}.100ms`);
  if (state.greeksChannels.length) rpcSend(mainWs, "public/subscribe", { channels: state.greeksChannels });
}

function scheduleGreeksRender() {
  if (greeksRenderPending) return;
  greeksRenderPending = true;
  setTimeout(() => {
    greeksRenderPending = false;
    renderLadder();
  }, 300);
}

function addTrade(t) {
  state.recentTrades.unshift(t);
  if (state.recentTrades.length > 100) state.recentTrades.length = 100;
  scheduleTradesRender();
}

function scheduleTradesRender() {
  if (tradesRenderPending) return;
  tradesRenderPending = true;
  setTimeout(() => {
    tradesRenderPending = false;
    renderTradesFeed();
  }, 500);
}

function renderTradesFeed() {
  const el = $("tradesFeed");
  if (!state.recentTrades.length) {
    el.innerHTML = '<p class="loading">Waiting for trades…</p>';
    return;
  }
  el.innerHTML = state.recentTrades
    .slice(0, 30)
    .map((t) => {
      const big = (t.amount || 0) >= LARGE_TRADE_THRESHOLD;
      const sideClass = t.direction === "buy" ? "call-cell" : "put-cell";
      return `<div class="trade-row${big ? " trade-large" : ""}">
        <span class="trade-time">${new Date(t.timestamp).toLocaleTimeString()}</span>
        <span class="trade-instrument">${t.instrument_name}</span>
        <span class="${sideClass}">${(t.direction || "").toUpperCase()}</span>
        <span>${fmtNum(t.amount, 1)}</span>
        <span>${fmtNum(t.price, 4)}</span>
        <span class="dim">iv ${t.iv != null ? fmtNum(t.iv, 1) : "—"}</span>
      </div>`;
    })
    .join("");
}

function connectMainWs() {
  mainWs = new WebSocket(WS_URL);

  mainWs.onopen = () => {
    mainWsRetryDelay = 1000;
    setPill("wsStatus", "live", "pill-live");
    rpcSend(mainWs, "public/subscribe", {
      channels: [
        `deribit_price_index.${CURRENCY.toLowerCase()}_usd`,
        "ticker.BTC-PERPETUAL.100ms",
        `trades.option.${CURRENCY}.100ms`,
      ],
    });
    if (state.selectedExpiry) subscribeGreeksForExpiry(state.selectedExpiry);
  };

  mainWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method !== "subscription") return;
    const { channel, data } = msg.params;
    if (channel.startsWith("deribit_price_index")) {
      state.indexPrice = data.price;
      $("indexPrice").textContent = "$" + fmtNum(data.price, 2);
      pushChartPoint(data.timestamp, data.price);
      updatePerpStats();
      highlightAtmOnly();
    } else if (channel === "ticker.BTC-PERPETUAL.100ms") {
      state.perp.markPrice = data.mark_price;
      state.perp.fundingRate = data.current_funding != null ? data.current_funding : state.perp.fundingRate;
      updatePerpStats();
    } else if (channel.startsWith("trades.option.")) {
      (data || []).forEach(addTrade);
    } else if (channel.startsWith("ticker.") && data.greeks) {
      state.greeks.set(data.instrument_name, data.greeks);
      scheduleGreeksRender();
    }
  };

  mainWs.onclose = () => {
    setPill("wsStatus", "reconnecting…", "pill-down");
    setTimeout(connectMainWs, mainWsRetryDelay);
    mainWsRetryDelay = Math.min(mainWsRetryDelay * 2, 15000);
  };

  mainWs.onerror = () => mainWs.close();
}

// ---------- Order book panel (WebSocket, per selected instrument) ----------

function closeOrderBook() {
  if (obWs) {
    obWs.onclose = null;
    obWs.close();
    obWs = null;
  }
  state.obInstrument = null;
  $("orderBookPanel").classList.add("hidden");
}

function openOrderBook(instrumentName) {
  closeOrderBook();
  state.obInstrument = instrumentName;
  $("orderBookPanel").classList.remove("hidden");
  $("obInstrument").textContent = instrumentName;
  $("obChartLink").href = "chart.html?instrument=" + encodeURIComponent(instrumentName);
  setPill("obStatus", "connecting…", "pill-connecting");
  $("obAsks").innerHTML = "";
  $("obBids").innerHTML = "";

  obWs = new WebSocket(WS_URL);
  obWs.onopen = () => {
    setPill("obStatus", "live", "pill-live");
    rpcSend(obWs, "public/subscribe", { channels: [`book.${instrumentName}.none.10.100ms`] });
  };
  obWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "subscription" && msg.params.channel.startsWith("book.")) {
      renderOrderBook(msg.params.data);
    }
  };
  obWs.onclose = () => {
    if (state.obInstrument === instrumentName) setPill("obStatus", "disconnected", "pill-down");
  };
}

function renderOrderBook(data) {
  const maxAmount = Math.max(
    1,
    ...data.bids.map((b) => b[1]),
    ...data.asks.map((a) => a[1])
  );

  const rowsHtml = (levels, side) =>
    levels
      .map(([price, amount]) => {
        const pct = Math.min(100, (amount / maxAmount) * 100);
        return `<div class="ob-row ob-${side}">
          <div class="depth-bar" style="width:${pct}%"></div>
          <span>${fmtNum(price, 4)}</span><span>${fmtNum(amount, 3)}</span>
        </div>`;
      })
      .join("");

  // Asks shown low-to-high near the spread (top of ask list = best ask nearest the top of the panel's bottom half).
  $("obAsks").innerHTML = rowsHtml([...data.asks].reverse(), "ask");
  $("obBids").innerHTML = rowsHtml(data.bids, "bid");
}

// ---------- Strategy builder: hypothetical multi-leg payoff diagram ----------
// Simplified illustration only: premiums are converted BTC-mark-price -> USD at
// the index price when the leg was added, and payoff is computed as a plain
// vanilla USD option payoff. This ignores Deribit's actual inverse/BTC-settled
// contract mechanics, so treat it as directional intuition, not a P&L quote.

function addStrategyLeg(instrumentName) {
  const sum = state.summaries.get(instrumentName);
  const parts = instrumentName.split("-");
  const strike = Number(parts[2]);
  const type = parts[3] === "C" ? "call" : "put";
  const premiumBtc = sum ? sum.mark_price || 0 : 0;
  state.strategyLegs.push({
    instrument: instrumentName,
    strike,
    type,
    side: "long",
    qty: 1,
    premiumUsd: premiumBtc * (state.indexPrice || 0),
  });
  renderStrategyPanel();
}

function computePayoff(legs, priceRange) {
  return priceRange.map((S) => {
    let total = 0;
    for (const leg of legs) {
      const intrinsic = leg.type === "call" ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
      const sign = leg.side === "long" ? 1 : -1;
      total += sign * leg.qty * (intrinsic - leg.premiumUsd);
    }
    return total;
  });
}

function buildPayoffChartSvg(xValues, yValues, currentPrice) {
  const W = 600, H = 220, padL = 54, padR = 12, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xMin = Math.min(...xValues), xMax = Math.max(...xValues);
  const yMin = Math.min(0, ...yValues), yMax = Math.max(0, ...yValues);
  const yRange = yMax - yMin || 1;
  const xScale = (x) => padL + ((x - xMin) / (xMax - xMin)) * innerW;
  const yScale = (y) => padT + innerH - ((y - yMin) / yRange) * innerH;
  const zeroY = yScale(0);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="${COLOR_BORDER}" stroke-width="1"/>`;
  svg += `<text x="${padL - 6}" y="${zeroY + 3}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">0</text>`;
  svg += `<text x="${padL - 6}" y="${padT + 8}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">${fmtNum(yMax, 0)}</text>`;
  svg += `<text x="${padL - 6}" y="${H - padB}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">${fmtNum(yMin, 0)}</text>`;

  if (currentPrice >= xMin && currentPrice <= xMax) {
    const cx = xScale(currentPrice);
    svg += `<line x1="${cx}" y1="${padT}" x2="${cx}" y2="${H - padB}" stroke="${COLOR_ACCENT}" stroke-width="1" stroke-dasharray="3,3"/>`;
  }

  const labelStep = Math.max(1, Math.ceil(xValues.length / 6));
  xValues.forEach((x, i) => {
    if (i % labelStep === 0 || i === xValues.length - 1) {
      svg += `<text x="${xScale(x)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${fmtNum(x, 0)}</text>`;
    }
  });

  let d = "";
  xValues.forEach((x, i) => {
    const px = xScale(x).toFixed(1), py = yScale(yValues[i]).toFixed(1);
    d += (i === 0 ? "M" : "L") + px + "," + py + " ";
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="${COLOR_ACCENT}" stroke-width="2"/>`;
  svg += "</svg>";
  return svg;
}

function renderStrategyPanel() {
  const legsEl = $("strategyLegs");
  const chartEl = $("strategyChart");
  const summaryEl = $("strategySummary");

  if (!state.strategyLegs.length) {
    legsEl.innerHTML = '<p class="loading">Click +C / +P next to a strike in the ladder to add a leg.</p>';
    chartEl.innerHTML = "";
    summaryEl.textContent = "";
    return;
  }

  legsEl.innerHTML = state.strategyLegs
    .map(
      (leg, i) => `
    <div class="leg-row">
      <span class="${leg.type === "call" ? "call-cell" : "put-cell"}">${leg.instrument}</span>
      <select data-idx="${i}" class="leg-side">
        <option value="long" ${leg.side === "long" ? "selected" : ""}>Long</option>
        <option value="short" ${leg.side === "short" ? "selected" : ""}>Short</option>
      </select>
      <input type="number" min="1" step="1" value="${leg.qty}" data-idx="${i}" class="leg-qty" />
      <button type="button" data-idx="${i}" class="leg-remove" aria-label="Remove leg">×</button>
    </div>`
    )
    .join("");

  legsEl.querySelectorAll(".leg-side").forEach((sel) =>
    sel.addEventListener("change", (e) => {
      state.strategyLegs[+e.target.dataset.idx].side = e.target.value;
      renderStrategyPanel();
    })
  );
  legsEl.querySelectorAll(".leg-qty").forEach((inp) =>
    inp.addEventListener("change", (e) => {
      state.strategyLegs[+e.target.dataset.idx].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
      renderStrategyPanel();
    })
  );
  legsEl.querySelectorAll(".leg-remove").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      state.strategyLegs.splice(+e.target.dataset.idx, 1);
      renderStrategyPanel();
    })
  );

  const center = state.indexPrice || state.strategyLegs[0].strike;
  const steps = 60;
  const lo = center * 0.6, hi = center * 1.4;
  const priceRange = Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps);
  const payoff = computePayoff(state.strategyLegs, priceRange);

  chartEl.innerHTML = buildPayoffChartSvg(priceRange, payoff, center);
  summaryEl.textContent = `Max profit (in range): $${fmtNum(Math.max(...payoff), 0)} · Max loss (in range): $${fmtNum(Math.min(...payoff), 0)}`;
}

// ---------- CSV export ----------

function exportChainCsv() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return;
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const rows = [
    [
      "strike",
      "call_instrument", "call_oi", "call_volume", "call_iv", "call_bid", "call_mark", "call_ask", "call_delta",
      "put_instrument", "put_oi", "put_volume", "put_iv", "put_bid", "put_mark", "put_ask", "put_delta",
    ],
  ];
  for (const s of strikes) {
    const cn = bucket.calls.get(s), pn = bucket.puts.get(s);
    const c = cn ? state.summaries.get(cn) : null;
    const p = pn ? state.summaries.get(pn) : null;
    const cg = cn ? state.greeks.get(cn) : null;
    const pg = pn ? state.greeks.get(pn) : null;
    rows.push([
      s,
      cn || "", c?.open_interest ?? "", c?.volume ?? "", c?.mark_iv ?? "", c?.bid_price ?? "", c?.mark_price ?? "", c?.ask_price ?? "", cg?.delta ?? "",
      pn || "", p?.open_interest ?? "", p?.volume ?? "", p?.mark_iv ?? "", p?.bid_price ?? "", p?.mark_price ?? "", p?.ask_price ?? "", pg?.delta ?? "",
    ]);
  }
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `btc-options-${state.selectedExpiry}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Wire up ----------

$("obClose").addEventListener("click", closeOrderBook);
$("strategyClear").addEventListener("click", () => {
  state.strategyLegs = [];
  renderStrategyPanel();
});
$("exportCsv").addEventListener("click", exportChainCsv);

async function init() {
  initChart();
  connectMainWs();
  await refreshInstruments();
  await refreshChain();
  refreshRealizedVol();
  renderStrategyPanel();
  setInterval(refreshChain, CHAIN_POLL_MS);
  setInterval(refreshInstruments, INSTRUMENTS_REFRESH_MS);
  setInterval(refreshRealizedVol, REALIZED_VOL_REFRESH_MS);
}

init();
