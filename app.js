// BTC Options Ladder — live data from Deribit's free public API.
// REST is used to build/refresh the full chain (one call fetches every strike),
// WebSocket is used for the live index price feed and the per-instrument order book.

const CURRENCY = "BTC";
const REST_BASE = "https://www.deribit.com/api/v2/public";
const WS_URL = "wss://www.deribit.com/ws/api/v2";
const CHAIN_POLL_MS = 5000;
const INSTRUMENTS_REFRESH_MS = 5 * 60 * 1000;
const OB_CHART_REFRESH_MS = 30000;

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
  indexPrice: null,
  obInstrument: null,
};

let mainWs = null;
let obWs = null;
let mainWsRetryDelay = 1000;
let rpcId = 1;
let chart, chartSeries;
let obChart, obCandleSeries, obChartInterval;

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

async function fetchOptionOhlc(instrumentName) {
  const end = Date.now();
  const start = end - 2 * 24 * 60 * 60 * 1000; // last 2 days of 30m candles
  const url = `${REST_BASE}/get_tradingview_chart_data?instrument_name=${instrumentName}&start_timestamp=${start}&end_timestamp=${end}&resolution=30`;
  const res = await fetch(url);
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
    indexInstruments(await fetchInstruments());
    renderExpiryTabs();
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
      `<tr><td colspan="13" class="loading">Couldn't reach Deribit's REST API (${err.message}). Retrying…</td></tr>`;
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
    body.innerHTML = `<tr><td colspan="13" class="loading">Loading instruments from Deribit…</td></tr>`;
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

    const tr = document.createElement("tr");
    tr.className = "option-row" + (strike === atm ? " atm-row" : "");

    tr.innerHTML = `
      <td class="call-cell">${call ? fmtNum(call.open_interest, 0) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.volume, 0) : "—"}</td>
      <td class="call-cell">${call && call.mark_iv != null ? fmtNum(call.mark_iv, 1) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.bid_price, 4) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.mark_price, 4) : "—"}</td>
      <td class="call-cell">${call ? fmtNum(call.ask_price, 4) : "—"}</td>
      <td class="strike-cell">${fmtStrike(strike)}</td>
      <td class="put-cell">${put ? fmtNum(put.bid_price, 4) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.mark_price, 4) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.ask_price, 4) : "—"}</td>
      <td class="put-cell">${put && put.mark_iv != null ? fmtNum(put.mark_iv, 1) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.volume, 0) : "—"}</td>
      <td class="put-cell">${put ? fmtNum(put.open_interest, 0) : "—"}</td>
    `;

    tr.addEventListener("click", () => {
      // Prefer whichever side was clicked closer to; default to the call leg.
      const target = callName || putName;
      if (target) openOrderBook(target);
    });
    body.appendChild(tr);
  }

  renderPriceByStrikeChart(strikes, bucket, atm);
  renderIvSkewChart(strikes, bucket, atm);
  renderOiChart(strikes, bucket);
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

  const labelStep = Math.max(1, Math.ceil(xValues.length / 8));
  xValues.forEach((x, i) => {
    if (i % labelStep === 0 || i === xValues.length - 1) {
      svg += `<text x="${xScale(x)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="${COLOR_DIM}">${(x / 1000).toFixed(0)}k</text>`;
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
    if (d) svg += `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
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
  el.innerHTML = buildLineChartSvg(
    strikes,
    [
      { data: callIv, color: COLOR_CALL },
      { data: putIv, color: COLOR_PUT },
    ],
    { atmX: atm }
  );
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

function connectMainWs() {
  mainWs = new WebSocket(WS_URL);

  mainWs.onopen = () => {
    mainWsRetryDelay = 1000;
    setPill("wsStatus", "live", "pill-live");
    rpcSend(mainWs, "public/subscribe", { channels: [`deribit_price_index.${CURRENCY.toLowerCase()}_usd`] });
  };

  mainWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method !== "subscription") return;
    const { channel, data } = msg.params;
    if (channel.startsWith("deribit_price_index")) {
      state.indexPrice = data.price;
      $("indexPrice").textContent = "$" + fmtNum(data.price, 2);
      pushChartPoint(data.timestamp, data.price);
      highlightAtmOnly();
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

function initObChart() {
  const container = $("obPriceChart");
  container.innerHTML = "";
  if (typeof LightweightCharts === "undefined") {
    container.innerHTML = '<p class="loading">Chart library unavailable</p>';
    obChart = null;
    obCandleSeries = null;
    return;
  }
  obChart = LightweightCharts.createChart(container, {
    layout: { background: { color: "transparent" }, textColor: COLOR_DIM },
    grid: { vertLines: { color: "#1c2331" }, horzLines: { color: "#1c2331" } },
    rightPriceScale: { borderColor: COLOR_BORDER },
    timeScale: { borderColor: COLOR_BORDER, timeVisible: true },
    handleScroll: false,
    handleScale: false,
    autoSize: true,
  });
  obCandleSeries = obChart.addBarSeries({
    upColor: COLOR_CALL,
    downColor: COLOR_PUT,
    openVisible: true,
    thinBars: false,
  });
}

async function refreshObChart(instrumentName) {
  if (!obCandleSeries) return;
  try {
    const data = await fetchOptionOhlc(instrumentName);
    if (data.status !== "ok" || !data.ticks || !data.ticks.length) return;
    const candles = data.ticks.map((t, i) => ({
      time: Math.floor(t / 1000),
      open: data.open[i],
      high: data.high[i],
      low: data.low[i],
      close: data.close[i],
    }));
    obCandleSeries.setData(candles);
  } catch (err) {
    console.error("get_tradingview_chart_data failed", err);
  }
}

function closeOrderBook() {
  if (obWs) {
    obWs.onclose = null;
    obWs.close();
    obWs = null;
  }
  if (obChartInterval) {
    clearInterval(obChartInterval);
    obChartInterval = null;
  }
  obChart = null;
  obCandleSeries = null;
  state.obInstrument = null;
  $("orderBookPanel").classList.add("hidden");
}

function openOrderBook(instrumentName) {
  closeOrderBook();
  state.obInstrument = instrumentName;
  $("orderBookPanel").classList.remove("hidden");
  $("obInstrument").textContent = instrumentName;
  setPill("obStatus", "connecting…", "pill-connecting");
  $("obAsks").innerHTML = "";
  $("obBids").innerHTML = "";

  initObChart();
  refreshObChart(instrumentName);
  obChartInterval = setInterval(() => refreshObChart(instrumentName), OB_CHART_REFRESH_MS);

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

// ---------- Wire up ----------

$("obClose").addEventListener("click", closeOrderBook);

async function init() {
  initChart();
  connectMainWs();
  await refreshInstruments();
  await refreshChain();
  setInterval(refreshChain, CHAIN_POLL_MS);
  setInterval(refreshInstruments, INSTRUMENTS_REFRESH_MS);
}

init();
