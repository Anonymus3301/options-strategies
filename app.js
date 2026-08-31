// BTC Options Ladder — live data from Deribit's free public API.
// REST is used to build/refresh the full chain (one call fetches every strike),
// WebSocket is used for the live index price feed and the per-instrument order book.

const CURRENCY = "BTC";
const REST_BASE = "https://www.deribit.com/api/v2/public";
const WS_URL = "wss://www.deribit.com/ws/api/v2";
const CHAIN_POLL_MS = 5000;
const INSTRUMENTS_REFRESH_MS = 5 * 60 * 1000;
const REALIZED_VOL_REFRESH_MS = 5 * 60 * 1000;
const FUTURES_REFRESH_MS = 30 * 1000;
const LARGE_TRADE_THRESHOLD = 5; // contracts
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const COLOR_CALL = "#35d399";
const COLOR_PUT = "#ff5c7c";
const COLOR_ACCENT = "#f7931a";
const COLOR_BORDER = "#232a3a";
const COLOR_DIM = "#8892a6";
const COLOR_PANEL_ALT = "#161c29";

const state = {
  instrumentsByExpiry: new Map(), // expiryTs -> { calls: Map(strike->name), puts: Map(strike->name) }
  expiries: [], // sorted [expiryTs]
  selectedExpiry: null,
  summaries: new Map(), // instrument_name -> summary object
  prevSummaries: new Map(), // previous poll's summaries, for OI/volume delta
  greeks: new Map(), // instrument_name -> { delta, gamma, theta, vega, rho }
  greeksChannels: [], // currently-subscribed ticker.* channels, so we can unsubscribe on expiry switch
  indexPrice: null,
  obInstrument: null,
  perp: { markPrice: null, fundingRate: null },
  realizedVol: null,
  recentTrades: [],
  strategyLegs: [], // { instrument, strike, type, side, qty, premiumUsd, ivPct, expiry }
  futures: [], // [{ name, expiry, markPrice }]
  alerts: [], // { id, metric, condition, value, fired, label }
  watchlist: new Set(), // instrument names, pinned across expiries
};

let mainWs = null;
let obWs = null;
let mainWsRetryDelay = 1000;
let rpcId = 1;
let chart, chartSeries;
let greeksRenderPending = false;
let tradesRenderPending = false;
let chainPollTimer = null;

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

async function fetchFuturesInstruments() {
  const res = await fetch(`${REST_BASE}/get_instruments?currency=${CURRENCY}&kind=future&expired=false`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function fetchFuturesSummary() {
  const res = await fetch(`${REST_BASE}/get_book_summary_by_currency?currency=${CURRENCY}&kind=future`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function refreshFutures() {
  try {
    const [instruments, summaries] = await Promise.all([fetchFuturesInstruments(), fetchFuturesSummary()]);
    const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
    state.futures = instruments
      .filter((i) => i.settlement_period !== "perpetual")
      .map((i) => ({
        name: i.instrument_name,
        expiry: i.expiration_timestamp,
        markPrice: (summaryMap.get(i.instrument_name) || {}).mark_price,
      }))
      .filter((f) => f.markPrice != null)
      .sort((a, b) => a.expiry - b.expiry);
    renderFuturesCurve();
  } catch (err) {
    console.error("futures fetch failed", err);
  }
}

// ---------- Black-Scholes pricer (r=0, matching Deribit's own BTC/ETH options convention) ----------

function erf(x) {
  // Abramowitz & Stegun 7.1.26 approximation.
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function bsPrice(type, S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) {
    return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const d1 = (Math.log(S / K) + (sigma * sigma * 0.5) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return type === "call" ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
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
  const map = new Map();
  for (const s of list) map.set(s.instrument_name, s);
  return map;
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
    const fresh = indexSummaries(await fetchBookSummary());
    state.prevSummaries = state.summaries;
    state.summaries = fresh;
    $("lastUpdate").textContent = new Date().toLocaleTimeString();
    renderLadder();
  } catch (err) {
    console.error("get_book_summary_by_currency failed", err);
    $("ladderBody").innerHTML =
      `<tr><td colspan="17" class="loading">Couldn't reach Deribit's REST API (${err.message}). Retrying…</td></tr>`;
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

function oiVolDelta(name) {
  if (!name) return null;
  const cur = state.summaries.get(name);
  const prev = state.prevSummaries.get(name);
  if (!cur || !prev) return null;
  return { oiDelta: (cur.open_interest || 0) - (prev.open_interest || 0) };
}

function fmtWithOiDelta(value, delta) {
  const base = fmtNum(value, 0);
  if (!delta || !delta.oiDelta) return base;
  const cls = delta.oiDelta > 0 ? "delta-up" : "delta-down";
  const sign = delta.oiDelta > 0 ? "+" : "";
  return `${base} <span class="${cls}">${sign}${fmtNum(delta.oiDelta, 0)}</span>`;
}

function edgeCell(pct) {
  if (pct == null || !Number.isFinite(pct)) return `<td class="dim">—</td>`;
  const cls = pct >= 0 ? "put-cell" : "call-cell"; // rich (mark>theo) = warning red; cheap = green
  return `<td class="${cls}">${pct >= 0 ? "+" : ""}${fmtNum(pct, 1)}%</td>`;
}

function renderLadder() {
  const body = $("ladderBody");
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  $("expiryLabel").textContent = state.selectedExpiry ? expiryLabel(state.selectedExpiry) : "—";

  if (!bucket) {
    body.innerHTML = `<tr><td colspan="17" class="loading">Loading instruments from Deribit…</td></tr>`;
    return;
  }

  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = closestStrike(strikes);
  const edges = computeEdges(strikes, bucket, atm, state.indexPrice);

  body.innerHTML = "";
  for (const strike of strikes) {
    const callName = bucket.calls.get(strike);
    const putName = bucket.puts.get(strike);
    const call = callName ? state.summaries.get(callName) : null;
    const put = putName ? state.summaries.get(putName) : null;
    const callGreeks = callName ? state.greeks.get(callName) : null;
    const putGreeks = putName ? state.greeks.get(putName) : null;
    const watched = (callName && state.watchlist.has(callName)) || (putName && state.watchlist.has(putName));

    const tr = document.createElement("tr");
    tr.className = "option-row" + (strike === atm ? " atm-row" : "");

    tr.innerHTML = `
      <td class="call-cell">${call ? fmtWithOiDelta(call.open_interest, oiVolDelta(callName)) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.volume, 0) : "—"}</td>
      <td class="call-cell">${call && call.mark_iv != null ? fmtNum(call.mark_iv, 1) : "—"}</td>
      <td class="call-cell">${callGreeks && callGreeks.delta != null ? fmtNum(callGreeks.delta, 3) : "—"}</td>
      ${edgeCell(edges.call.get(strike))}
      <td class="call-cell">${call ? fmtNum(call.bid_price, 4) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.mark_price, 4) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.ask_price, 4) : "—"}</td>
      <td class="strike-cell">
        <div class="strike-value">${fmtStrike(strike)}</div>
        <div class="strike-actions">
          ${callName ? `<button type="button" class="leg-btn leg-btn-call" data-instrument="${callName}" title="Add ${callName} (long) to strategy">+C</button>` : ""}
          ${putName ? `<button type="button" class="leg-btn leg-btn-put" data-instrument="${putName}" title="Add ${putName} (long) to strategy">+P</button>` : ""}
          <button type="button" class="leg-btn watch-btn" data-call="${callName || ""}" data-put="${putName || ""}" title="Toggle watchlist">${watched ? "★" : "☆"}</button>
        </div>
      </td>
      <td class="put-cell">${put ? fmtNum(put.bid_price, 4) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.mark_price, 4) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.ask_price, 4) : "—"}</td>
      ${edgeCell(edges.put.get(strike))}
      <td class="put-cell">${putGreeks && putGreeks.delta != null ? fmtNum(putGreeks.delta, 3) : "—"}</td>
      <td class="put-cell">${put && put.mark_iv != null ? fmtNum(put.mark_iv, 1) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.volume, 0) : "—"}</td>
      <td class="put-cell">${put ? fmtWithOiDelta(put.open_interest, oiVolDelta(putName)) : "—"}</td>
    `;

    tr.addEventListener("click", () => {
      // Prefer whichever side was clicked closer to; default to the call leg.
      const target = callName || putName;
      if (target) openOrderBook(target);
    });
    tr.querySelectorAll(".leg-btn-call, .leg-btn-put").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        addStrategyLeg(btn.dataset.instrument);
      });
    });
    const watchBtn = tr.querySelector(".watch-btn");
    if (watchBtn) {
      watchBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleWatchlistPair(watchBtn.dataset.call || null, watchBtn.dataset.put || null);
      });
    }
    body.appendChild(tr);
  }

  renderPriceByStrikeChart(strikes, bucket, atm);
  renderIvSkewChart(strikes, bucket, atm);
  renderOiChart(strikes, bucket);
  renderGexChart(strikes, bucket);
  renderIvTermChart();
  renderIvSurface();
  renderMarketStats(strikes, bucket);
  renderWatchlist();
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

function ivArraysForExpiry(strikes, bucket) {
  const callIv = strikes.map((s) => {
    const sum = state.summaries.get(bucket.calls.get(s));
    return sum && sum.mark_iv != null ? sum.mark_iv : null;
  });
  const putIv = strikes.map((s) => {
    const sum = state.summaries.get(bucket.puts.get(s));
    return sum && sum.mark_iv != null ? sum.mark_iv : null;
  });
  return { callIv, putIv };
}

// Smile fit uses OTM points only (OTM calls above ATM, OTM puts below), the
// conventional way to assemble one smile curve from a call+put chain.
function computeSmileFit(strikes, callIv, putIv, atm) {
  if (atm == null) return null;
  const points = [];
  strikes.forEach((s, i) => {
    if (s >= atm && callIv[i] != null) points.push([s, callIv[i]]);
    else if (s < atm && putIv[i] != null) points.push([s, putIv[i]]);
  });
  return quadraticFit(points.map((p) => p[0]), points.map((p) => p[1]));
}

function renderIvSkewChart(strikes, bucket, atm) {
  const el = $("ivSkewChart");
  $("ivSkewExpiry").textContent = state.selectedExpiry ? expiryLabel(state.selectedExpiry) : "—";
  if (!strikes.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const { callIv, putIv } = ivArraysForExpiry(strikes, bucket);
  const series = [
    { data: callIv, color: COLOR_CALL },
    { data: putIv, color: COLOR_PUT },
  ];

  const fit = computeSmileFit(strikes, callIv, putIv, atm);
  if (fit) series.push({ data: strikes.map((s) => fit(s)), color: COLOR_ACCENT, dashed: true });

  el.innerHTML = buildLineChartSvg(strikes, series, { atmX: atm });
}

// ---------- Theoretical price / edge finder ----------
// Compares each contract's mark price to a Black-Scholes price built from the
// *fitted* smile IV at its strike (not its own mark IV, which would trivially
// match by construction). A contract trading away from the smooth smile curve
// shows up as "rich" (mark > theoretical) or "cheap" (mark < theoretical).

function computeEdges(strikes, bucket, atm, spot) {
  const empty = { call: new Map(), put: new Map() };
  if (spot == null || !state.selectedExpiry || !strikes.length) return empty;
  const { callIv, putIv } = ivArraysForExpiry(strikes, bucket);
  const fit = computeSmileFit(strikes, callIv, putIv, atm);
  if (!fit) return empty;

  const T = Math.max((state.selectedExpiry - Date.now()) / YEAR_MS, 1 / 365 / 24);
  const call = new Map(), put = new Map();
  for (const s of strikes) {
    const fittedIv = fit(s);
    if (fittedIv == null || fittedIv <= 0) continue;
    const sigma = fittedIv / 100;

    const cSum = state.summaries.get(bucket.calls.get(s));
    if (cSum && cSum.mark_price != null) {
      const theo = bsPrice("call", spot, s, T, sigma);
      if (theo > 0) call.set(s, ((cSum.mark_price * spot - theo) / theo) * 100);
    }
    const pSum = state.summaries.get(bucket.puts.get(s));
    if (pSum && pSum.mark_price != null) {
      const theo = bsPrice("put", spot, s, T, sigma);
      if (theo > 0) put.set(s, ((pSum.mark_price * spot - theo) / theo) * 100);
    }
  }
  return { call, put };
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

// ---------- Expected move, risk reversal / butterfly, probability cone ----------

function computeExpectedMove(bucket, atm, spot) {
  if (atm == null || spot == null) return null;
  const call = state.summaries.get(bucket.calls.get(atm));
  const put = state.summaries.get(bucket.puts.get(atm));
  if (!call || !put || call.mark_price == null || put.mark_price == null) return null;
  const usd = (call.mark_price + put.mark_price) * spot;
  return { usd, pct: (usd / spot) * 100 };
}

// 25-delta risk reversal (call IV minus put IV at the strikes nearest 25Δ) and
// butterfly (avg of those two IVs minus ATM IV) — standard skew-quantification
// metrics. Needs live Greeks, so only works for the currently selected expiry
// (the only one we subscribe ticker.* for).
function computeRiskReversalButterfly(strikes, bucket, atm) {
  if (atm == null) return null;
  let bestCall = null, bestCallDiff = Infinity;
  let bestPut = null, bestPutDiff = Infinity;
  for (const s of strikes) {
    const cName = bucket.calls.get(s);
    const cGreeks = cName ? state.greeks.get(cName) : null;
    if (cGreeks && cGreeks.delta != null) {
      const diff = Math.abs(cGreeks.delta - 0.25);
      if (diff < bestCallDiff) {
        bestCallDiff = diff;
        bestCall = cName;
      }
    }
    const pName = bucket.puts.get(s);
    const pGreeks = pName ? state.greeks.get(pName) : null;
    if (pGreeks && pGreeks.delta != null) {
      const diff = Math.abs(pGreeks.delta + 0.25);
      if (diff < bestPutDiff) {
        bestPutDiff = diff;
        bestPut = pName;
      }
    }
  }
  if (!bestCall || !bestPut) return null;
  const callSum = state.summaries.get(bestCall);
  const putSum = state.summaries.get(bestPut);
  if (!callSum || !putSum || callSum.mark_iv == null || putSum.mark_iv == null) return null;

  const atmCall = state.summaries.get(bucket.calls.get(atm));
  const atmPut = state.summaries.get(bucket.puts.get(atm));
  const atmIvs = [atmCall && atmCall.mark_iv, atmPut && atmPut.mark_iv].filter((v) => v != null);
  const atmIv = atmIvs.length ? atmIvs.reduce((a, b) => a + b, 0) / atmIvs.length : null;

  return {
    rr: callSum.mark_iv - putSum.mark_iv,
    bf: atmIv != null ? (callSum.mark_iv + putSum.mark_iv) / 2 - atmIv : null,
  };
}

function buildConeChartSvg(times, upper, lower, spot) {
  const W = 600, H = 200, padL = 50, padR = 12, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xMin = times[0], xMax = times[times.length - 1];
  const yMin = Math.min(...lower, spot), yMax = Math.max(...upper, spot);
  const yRange = yMax - yMin || 1;
  const xScale = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const yScale = (y) => padT + innerH - ((y - yMin) / yRange) * innerH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;

  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + (yRange * i) / ticks;
    const y = yScale(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${COLOR_BORDER}" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">${fmtNum(v, 0)}</text>`;
  }

  const labelStep = Math.max(1, Math.ceil(times.length / 6));
  times.forEach((t, i) => {
    if (i % labelStep === 0 || i === times.length - 1) {
      svg += `<text x="${xScale(t).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${new Date(t).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</text>`;
    }
  });

  let band = "";
  times.forEach((t, i) => (band += `${i === 0 ? "M" : "L"}${xScale(t).toFixed(1)},${yScale(upper[i]).toFixed(1)} `));
  for (let i = times.length - 1; i >= 0; i--) band += `L${xScale(times[i]).toFixed(1)},${yScale(lower[i]).toFixed(1)} `;
  svg += `<path d="${band.trim()}Z" fill="${COLOR_ACCENT}" opacity="0.12" stroke="none"/>`;

  const lineFor = (vals) => times.map((t, i) => `${i === 0 ? "M" : "L"}${xScale(t).toFixed(1)},${yScale(vals[i]).toFixed(1)}`).join(" ");
  svg += `<path d="${lineFor(upper)}" fill="none" stroke="${COLOR_ACCENT}" stroke-width="1.5"/>`;
  svg += `<path d="${lineFor(lower)}" fill="none" stroke="${COLOR_ACCENT}" stroke-width="1.5"/>`;

  const spotY = yScale(spot);
  svg += `<line x1="${padL}" y1="${spotY}" x2="${W - padR}" y2="${spotY}" stroke="${COLOR_DIM}" stroke-width="1" stroke-dasharray="3,3"/>`;

  svg += "</svg>";
  return svg;
}

function renderProbabilityCone() {
  const el = $("probConeChart");
  if (!el) return;
  $("probConeExpiry").textContent = state.selectedExpiry ? expiryLabel(state.selectedExpiry) : "—";
  const spot = state.indexPrice;
  if (spot == null || !state.selectedExpiry || state.selectedExpiry <= Date.now()) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const entry = computeIvTermStructure().find((t) => t.expiry === state.selectedExpiry);
  if (!entry || entry.atmIv == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const sigma = entry.atmIv / 100;
  const now = Date.now();
  const steps = 24;
  const times = [], upper = [], lower = [];
  for (let i = 0; i <= steps; i++) {
    const t = now + ((state.selectedExpiry - now) * i) / steps;
    const T = Math.max((t - now) / YEAR_MS, 0);
    const band = sigma * Math.sqrt(T);
    times.push(t);
    upper.push(spot * Math.exp(band));
    lower.push(spot * Math.exp(-band));
  }
  el.innerHTML = buildConeChartSvg(times, upper, lower, spot);
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

  const atm = closestStrike(strikes);
  const move = computeExpectedMove(bucket, atm, state.indexPrice);
  $("expectedMoveStat").textContent = move != null ? `$${fmtNum(move.usd, 0)} (±${fmtNum(move.pct, 1)}%)` : "—";

  const rrbf = computeRiskReversalButterfly(strikes, bucket, atm);
  $("skewStat").textContent =
    rrbf != null
      ? `RR ${rrbf.rr >= 0 ? "+" : ""}${fmtNum(rrbf.rr, 1)}pp · BF ${rrbf.bf != null ? (rrbf.bf >= 0 ? "+" : "") + fmtNum(rrbf.bf, 1) + "pp" : "—"}`
      : "—";

  updateVolStat();
  renderProbabilityCone();
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

// ---------- Color helpers for heatmaps ----------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blendRgb(base, target, t) {
  return base.map((b, i) => Math.round(b + (target[i] - b) * t));
}

// ---------- IV surface: moneyness x expiry heatmap ----------

const MONEYNESS_BINS = [-30, -22.5, -15, -7.5, 0, 7.5, 15, 22.5, 30]; // % relative to spot

function computeIvSurface() {
  const spot = state.indexPrice;
  if (spot == null || !state.expiries.length) return null;
  const matrix = state.expiries.map((ts) => {
    const bucket = state.instrumentsByExpiry.get(ts);
    const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])];
    if (!strikes.length) return MONEYNESS_BINS.map(() => null);
    return MONEYNESS_BINS.map((pct) => {
      const target = spot * (1 + pct / 100);
      const nearest = strikes.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best));
      const useCall = nearest >= spot;
      const name = useCall ? bucket.calls.get(nearest) : bucket.puts.get(nearest);
      const sum = name ? state.summaries.get(name) : null;
      return sum && sum.mark_iv != null ? sum.mark_iv : null;
    });
  });
  return { cols: state.expiries, rows: MONEYNESS_BINS, matrix };
}

function buildIvHeatmapSvg(cols, rows, matrix) {
  const cellW = 66, cellH = 20, padL = 44, padT = 8, padR = 8, padB = 24;
  const W = padL + cellW * cols.length + padR;
  const H = padT + cellH * rows.length + padB;
  const vals = matrix.flat().filter((v) => v != null);
  if (!vals.length) return '<p class="loading">No data</p>';
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const stops = [hexToRgb(COLOR_CALL), hexToRgb(COLOR_ACCENT), hexToRgb(COLOR_PUT)];
  const colorFor = (v) => {
    if (v == null) return COLOR_PANEL_ALT;
    const t = vMax === vMin ? 0.5 : (v - vMin) / (vMax - vMin);
    const seg = t < 0.5 ? 0 : 1;
    const localT = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const [r, g, b] = blendRgb(stops[seg], stops[seg + 1], localT);
    return `rgb(${r},${g},${b})`;
  };

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  rows.forEach((r, ri) => {
    const y = padT + ri * cellH;
    svg += `<text x="${padL - 6}" y="${y + cellH / 2 + 3}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">${r > 0 ? "+" : ""}${r}%</text>`;
    cols.forEach((c, ci) => {
      const x = padL + ci * cellW;
      const v = matrix[ci][ri];
      svg += `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" fill="${colorFor(v)}"/>`;
      if (v != null) svg += `<text x="${x + cellW / 2 - 1}" y="${y + cellH / 2 + 3}" text-anchor="middle" font-size="8" fill="#0b0e14">${v.toFixed(0)}</text>`;
    });
  });
  cols.forEach((c, ci) => {
    const x = padL + ci * cellW + cellW / 2 - 1;
    svg += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${new Date(c).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</text>`;
  });
  svg += "</svg>";
  return svg;
}

function renderIvSurface() {
  const el = $("ivSurfaceChart");
  const surface = computeIvSurface();
  el.innerHTML = surface ? buildIvHeatmapSvg(surface.cols, surface.rows, surface.matrix) : '<p class="loading">No data</p>';
}

// ---------- Futures term structure / basis curve ----------

function renderFuturesCurve() {
  const el = $("futuresCurveChart");
  if (state.indexPrice == null || !state.futures.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const spot = state.indexPrice;
  const xValues = state.futures.map((f) => f.expiry);
  const basis = state.futures.map((f) => ((f.markPrice - spot) / spot) * 100);
  el.innerHTML = buildLineChartSvg(xValues, [{ data: basis, color: COLOR_ACCENT }], {
    xLabelFn: (x) => new Date(x).toLocaleDateString(undefined, { day: "2-digit", month: "short" }),
    decimals: 2,
  });
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

// ---------- Watchlist: pin instruments across expiries ----------

function toggleWatchlistPair(callName, putName) {
  const anyWatched = (callName && state.watchlist.has(callName)) || (putName && state.watchlist.has(putName));
  if (anyWatched) {
    if (callName) state.watchlist.delete(callName);
    if (putName) state.watchlist.delete(putName);
  } else {
    if (callName) state.watchlist.add(callName);
    if (putName) state.watchlist.add(putName);
  }
  renderLadder();
}

function renderWatchlist() {
  const el = $("watchlistPanel");
  if (!state.watchlist.size) {
    el.innerHTML = '<p class="loading">Click ☆ next to a strike to pin it here.</p>';
    return;
  }
  el.innerHTML = [...state.watchlist]
    .map((name) => {
      const sum = state.summaries.get(name);
      const isCall = name.endsWith("-C");
      return `<div class="watch-row">
        <span class="${isCall ? "call-cell" : "put-cell"}">${name}</span>
        <span>${sum ? fmtNum(sum.bid_price, 4) : "—"}</span>
        <span>${sum ? fmtNum(sum.mark_price, 4) : "—"}</span>
        <span>${sum ? fmtNum(sum.ask_price, 4) : "—"}</span>
        <span>${sum && sum.mark_iv != null ? fmtNum(sum.mark_iv, 1) + "%" : "—"}</span>
        <button type="button" data-name="${name}" class="leg-remove" aria-label="Remove from watchlist">×</button>
      </div>`;
    })
    .join("");
  el.querySelectorAll(".leg-remove").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      state.watchlist.delete(e.currentTarget.dataset.name);
      renderWatchlist();
      renderLadder();
    })
  );
}

// ---------- In-page threshold alerts (price / ATM IV / chain OI) ----------
// Client-side only: fires a Notification (with permission) + a short beep.
// Only works while this tab stays open — there is no server to push from.

function chainOiTotal() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])];
  let total = 0;
  for (const s of strikes) {
    const c = state.summaries.get(bucket.calls.get(s));
    const p = state.summaries.get(bucket.puts.get(s));
    total += (c ? c.open_interest || 0 : 0) + (p ? p.open_interest || 0 : 0);
  }
  return total;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  } catch (err) {
    // Audio not available in this browser/context; skip silently.
  }
}

function fireAlert(alert, current) {
  const msg = `${alert.label} ${alert.condition} ${fmtNum(alert.value, 2)} — now ${fmtNum(current, 2)}`;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("BTC Options Dashboard alert", { body: msg });
  }
  beep();
}

function checkAlerts() {
  if (!state.alerts.length) return;
  let changed = false;
  for (const alert of state.alerts) {
    if (alert.fired) continue;
    let current = null;
    if (alert.metric === "price") current = state.indexPrice;
    else if (alert.metric === "iv") {
      const front = computeIvTermStructure().find((t) => t.atmIv != null);
      current = front ? front.atmIv : null;
    } else if (alert.metric === "oi") current = chainOiTotal();
    if (current == null) continue;
    const hit = alert.condition === "above" ? current >= alert.value : current <= alert.value;
    if (hit) {
      alert.fired = true;
      changed = true;
      fireAlert(alert, current);
    }
  }
  if (changed) renderAlertsList();
}

function addAlert(metric, condition, value) {
  const labels = { price: "BTC Index", iv: "ATM IV", oi: "Chain OI (selected expiry)" };
  state.alerts.push({ id: Date.now() + Math.random(), metric, condition, value, fired: false, label: labels[metric] });
  renderAlertsList();
}

function renderAlertsList() {
  const el = $("alertsList");
  if (!state.alerts.length) {
    el.innerHTML = '<p class="loading">No alerts set.</p>';
    return;
  }
  el.innerHTML = state.alerts
    .map(
      (a, i) => `
    <div class="alert-row${a.fired ? " alert-fired" : ""}">
      <span>${a.label} ${a.condition} ${fmtNum(a.value, 2)}</span>
      <span class="dim">${a.fired ? "fired" : "armed"}</span>
      <button type="button" data-idx="${i}" class="leg-remove" aria-label="Remove alert">×</button>
    </div>`
    )
    .join("");
  el.querySelectorAll(".leg-remove").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      state.alerts.splice(+e.currentTarget.dataset.idx, 1);
      renderAlertsList();
    })
  );
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
      renderFuturesCurve();
      checkAlerts();
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
    ivPct: sum ? sum.mark_iv || null : null,
    expiry: state.selectedExpiry,
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

function findBreakevens(priceRange, payoff) {
  const breakevens = [];
  for (let i = 1; i < payoff.length; i++) {
    const a = payoff[i - 1], b = payoff[i];
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) {
      const t = a === b ? 0 : -a / (b - a);
      breakevens.push(priceRange[i - 1] + t * (priceRange[i] - priceRange[i - 1]));
    }
  }
  return breakevens;
}

function computeNetGreeks(legs) {
  const totals = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  let missing = false;
  for (const leg of legs) {
    const g = state.greeks.get(leg.instrument);
    if (!g) {
      missing = true;
      continue;
    }
    const sign = leg.side === "long" ? 1 : -1;
    totals.delta += sign * leg.qty * (g.delta || 0);
    totals.gamma += sign * leg.qty * (g.gamma || 0);
    totals.theta += sign * leg.qty * (g.theta || 0);
    totals.vega += sign * leg.qty * (g.vega || 0);
  }
  return { totals, missing };
}

function computeScenarioGrid(legs) {
  const spot = state.indexPrice;
  if (!legs.length || spot == null) return null;
  const prices = Array.from({ length: 7 }, (_, i) => spot * 0.7 + spot * 0.6 * (i / 6));
  const maxDays = Math.max(1, ...legs.map((l) => (l.expiry - Date.now()) / 86400000));
  const dayOffsets = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxDays);
  const grid = dayOffsets.map((daysFromNow) => {
    const atMs = Date.now() + daysFromNow * 86400000;
    return prices.map((S) => {
      let total = 0;
      for (const leg of legs) {
        const T = Math.max((leg.expiry - atMs) / YEAR_MS, 0);
        const sigma = (leg.ivPct || 0) / 100;
        const value =
          T > 0 && sigma > 0
            ? bsPrice(leg.type, S, leg.strike, T, sigma)
            : leg.type === "call"
              ? Math.max(S - leg.strike, 0)
              : Math.max(leg.strike - S, 0);
        const sign = leg.side === "long" ? 1 : -1;
        total += sign * leg.qty * (value - leg.premiumUsd);
      }
      return total;
    });
  });
  return { prices, dayOffsets, grid };
}

function buildPnlHeatmapSvg(prices, dayOffsets, grid) {
  const cellW = 76, cellH = 26, padL = 62, padT = 8, padR = 8, padB = 22;
  const cols = dayOffsets.length, rows = prices.length;
  const W = padL + cellW * cols + padR;
  const H = padT + cellH * rows + padB;
  const allVals = grid.flat();
  const maxAbs = Math.max(1, ...allVals.map(Math.abs));
  const base = hexToRgb(COLOR_PANEL_ALT);
  const cellColor = (v) => {
    const t = Math.min(1, Math.abs(v) / maxAbs) * 0.85;
    const [r, g, b] = blendRgb(base, hexToRgb(v >= 0 ? COLOR_CALL : COLOR_PUT), t);
    return `rgb(${r},${g},${b})`;
  };

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  for (let ri = 0; ri < rows; ri++) {
    const y = padT + ri * cellH;
    svg += `<text x="${padL - 6}" y="${y + cellH / 2 + 3}" text-anchor="end" font-size="9" fill="${COLOR_DIM}">$${fmtNum(prices[rows - 1 - ri], 0)}</text>`;
    for (let ci = 0; ci < cols; ci++) {
      const v = grid[ci][rows - 1 - ri];
      const x = padL + ci * cellW;
      svg += `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" fill="${cellColor(v)}"/>`;
      svg += `<text x="${x + cellW / 2 - 1}" y="${y + cellH / 2 + 3}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${v >= 0 ? "+" : ""}${fmtNum(v, 0)}</text>`;
    }
  }
  dayOffsets.forEach((d, ci) => {
    const x = padL + ci * cellW + cellW / 2 - 1;
    svg += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${d === 0 ? "Now" : "+" + d.toFixed(1) + "d"}</text>`;
  });
  svg += "</svg>";
  return svg;
}

function buildPayoffChartSvg(xValues, yValues, currentPrice, breakevens = []) {
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

  for (const be of breakevens) {
    if (be < xMin || be > xMax) continue;
    const bx = xScale(be);
    svg += `<line x1="${bx}" y1="${padT}" x2="${bx}" y2="${H - padB}" stroke="#5b9dd9" stroke-width="1" stroke-dasharray="2,2"/>`;
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
  const greeksEl = $("strategyGreeks");
  const scenarioEl = $("scenarioChart");

  if (!state.strategyLegs.length) {
    legsEl.innerHTML = '<p class="loading">Click +C / +P next to a strike in the ladder to add a leg.</p>';
    chartEl.innerHTML = "";
    summaryEl.textContent = "";
    greeksEl.textContent = "";
    scenarioEl.innerHTML = "";
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
  const breakevens = findBreakevens(priceRange, payoff);

  chartEl.innerHTML = buildPayoffChartSvg(priceRange, payoff, center, breakevens);
  const beText = breakevens.length ? ` · Breakeven: ${breakevens.map((b) => "$" + fmtNum(b, 0)).join(", ")}` : "";
  summaryEl.textContent = `Max profit (in range): $${fmtNum(Math.max(...payoff), 0)} · Max loss (in range): $${fmtNum(Math.min(...payoff), 0)}${beText}`;

  const { totals, missing } = computeNetGreeks(state.strategyLegs);
  greeksEl.textContent =
    `Net Greeks — Δ ${fmtNum(totals.delta, 3)} · Γ ${fmtNum(totals.gamma, 5)} · Θ ${fmtNum(totals.theta, 2)} · V ${fmtNum(totals.vega, 2)}` +
    (missing ? " (some legs still loading Greeks)" : "");

  const scenario = computeScenarioGrid(state.strategyLegs);
  scenarioEl.innerHTML = scenario
    ? buildPnlHeatmapSvg(scenario.prices, scenario.dayOffsets, scenario.grid)
    : '<p class="loading">Waiting for index price…</p>';
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

function setChainPollInterval(ms) {
  if (chainPollTimer) clearInterval(chainPollTimer);
  chainPollTimer = setInterval(refreshChain, ms);
}

$("obClose").addEventListener("click", closeOrderBook);
$("strategyClear").addEventListener("click", () => {
  state.strategyLegs = [];
  renderStrategyPanel();
});
$("exportCsv").addEventListener("click", exportChainCsv);
$("pollRateSelect").addEventListener("change", (e) => setChainPollInterval(parseInt(e.target.value, 10)));
$("enableNotifications").addEventListener("click", () => {
  if (typeof Notification !== "undefined") Notification.requestPermission();
});
$("alertAdd").addEventListener("click", () => {
  const value = parseFloat($("alertValue").value);
  if (!Number.isFinite(value)) return;
  addAlert($("alertMetric").value, $("alertCondition").value, value);
  $("alertValue").value = "";
});

async function init() {
  initChart();
  connectMainWs();
  await refreshInstruments();
  await refreshChain();
  refreshRealizedVol();
  refreshFutures();
  renderStrategyPanel();
  renderAlertsList();
  setChainPollInterval(CHAIN_POLL_MS);
  setInterval(refreshInstruments, INSTRUMENTS_REFRESH_MS);
  setInterval(refreshRealizedVol, REALIZED_VOL_REFRESH_MS);
  setInterval(refreshFutures, FUTURES_REFRESH_MS);
}

init();
