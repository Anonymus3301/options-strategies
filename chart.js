// Standalone option chart, opened from the ladder's order book panel via
// chart.html?instrument=<deribit-instrument-name>.
//
// Data source: Delta Exchange's public TradingView-compatible chart API
// (https://cdn.india.deltaex.org/v2/chart/{symbols,history}), NOT Deribit.
// Delta Exchange is a different options venue from the one the rest of this
// dashboard reads (Deribit) — its strikes/expiries don't necessarily match.
// The Deribit instrument name is converted into Delta's "MARK:{C|P}-{ASSET}-
// {STRIKE}-{DDMMYY}" symbol convention; if Delta doesn't list that exact
// contract, this page says so rather than guessing or showing stale data.
//
// Confirmed against real /history traffic: unlike the bare {s,t,o,h,l,c,v}
// TradingView UDF convention, Delta wraps the OHLC payload in the same
// {success, result: {...}} envelope as /symbols.

const DELTA_CHART_BASE = "https://cdn.india.deltaex.org/v2/chart";
const REFRESH_MS = 15000;

const COLOR_CALL = "#35d399";
const COLOR_PUT = "#ff5c7c";
const COLOR_BORDER = "#232a3a";
const COLOR_DIM = "#8892a6";

const $ = (id) => document.getElementById(id);

function setPill(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = "pill " + cls;
}

// Deribit's instrument-name date is DMMMYY, and the day is NOT always
// zero-padded (e.g. "7AUG26" as well as "29AUG25") — the day is 1-2 digits,
// so it can't be sliced at a fixed offset the way the month/year can.
function parseDeribitDate(rawDate) {
  const m = /^(\d{1,2})([A-Za-z]{3})(\d{2})$/.exec(rawDate);
  if (!m) return null;
  const months = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const mon = months[m[2].toUpperCase()];
  if (!mon) return null;
  return { day: m[1].padStart(2, "0"), mon, yr: m[3] };
}

// "BTC-29AUG25-60000-C" -> "MARK:C-BTC-60000-290825"; "BTC-7AUG26-63500-C" -> "MARK:C-BTC-63500-070826"
function deribitToDeltaSymbol(instrumentName) {
  const parts = instrumentName.split("-");
  if (parts.length < 4) return null;
  const [asset, rawDate, strike, typeLetter] = parts;
  const date = parseDeribitDate(rawDate);
  if (!date) return null;
  const side = typeLetter === "C" ? "C" : "P";
  return `MARK:${side}-${asset}-${strike}-${date.day}${date.mon}${date.yr}`;
}

async function fetchSymbolInfo(symbol) {
  const url = `${DELTA_CHART_BASE}/symbols?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchHistory(symbol, resolution, fromSec, toSec) {
  const url = `${DELTA_CHART_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${fromSec}&to=${toSec}`;
  const res = await fetch(url);
  const json = await res.json();
  // Delta wraps the OHLC payload in {success, result: {s, t, o, h, l, c, v}},
  // the same envelope as /symbols — not the bare {s, t, o, ...} UDF convention.
  return json && json.result ? json.result : json;
}

function resolutionSortKey(r) {
  if (/^\d+$/.test(r)) return parseInt(r, 10);
  if (/^\d+W$/.test(r)) return 100000 + parseInt(r, 10);
  if (r === "D") return 90000;
  if (r === "W") return 100000;
  if (r === "M") return 200000;
  return 300000;
}

function resolutionLabel(r) {
  if (r === "D") return "1D";
  if (r === "W") return "1W";
  if (r === "M") return "1M";
  if (/^\d+W$/.test(r)) return r;
  const mins = parseInt(r, 10);
  if (!Number.isFinite(mins)) return r;
  if (mins % 1440 === 0) return mins / 1440 + "D";
  if (mins % 60 === 0) return mins / 60 + "h";
  return mins + "m";
}

// Lookback window sized so each resolution shows a reasonable number of bars.
function windowSecondsFor(resolution) {
  if (resolution === "M" || /^\d+W$/.test(resolution)) return 3 * 365 * 86400;
  if (resolution === "W") return 3 * 365 * 86400;
  if (resolution === "D") return 200 * 86400;
  const mins = parseInt(resolution, 10);
  if (!Number.isFinite(mins)) return 86400;
  return Math.max(mins * 60 * 150, 3600); // ~150 bars, at least 1 hour
}

function init() {
  const instrument = new URLSearchParams(location.search).get("instrument");
  if (!instrument) {
    $("fullChart").innerHTML =
      '<p class="loading">No instrument specified. Open this page from a ladder row\'s order book panel.</p>';
    return;
  }

  document.title = `${instrument} — Option Chart`;
  $("chartTitle").textContent = instrument;
  $("chartInstrument").textContent = instrument;

  const symbol = deribitToDeltaSymbol(instrument);
  $("deltaSymbolHint").textContent = "Delta symbol: " + (symbol || "could not be constructed");
  if (!symbol) {
    setPill("chartStatus", "unavailable", "pill-down");
    $("fullChart").innerHTML = '<p class="loading">Could not derive a Delta Exchange symbol from this instrument name.</p>';
    return;
  }

  if (typeof LightweightCharts === "undefined") {
    $("fullChart").innerHTML = '<p class="loading">Chart library failed to load.</p>';
    setPill("chartStatus", "unavailable", "pill-down");
    return;
  }

  const chart = LightweightCharts.createChart($("fullChart"), {
    layout: { background: { color: "transparent" }, textColor: COLOR_DIM },
    grid: { vertLines: { color: "#1c2331" }, horzLines: { color: "#1c2331" } },
    rightPriceScale: { borderColor: COLOR_BORDER },
    timeScale: { borderColor: COLOR_BORDER, timeVisible: true, secondsVisible: true },
    autoSize: true,
  });
  const series = chart.addBarSeries({
    upColor: COLOR_CALL,
    downColor: COLOR_PUT,
    openVisible: true,
    thinBars: false,
  });

  let resolution = "1";
  let refreshTimer = null;

  async function refresh() {
    try {
      const end = Math.floor(Date.now() / 1000);
      const start = end - windowSecondsFor(resolution);
      const data = await fetchHistory(symbol, resolution, start, end);
      if (data.s !== "ok" || !data.t || !data.t.length) {
        setPill("chartStatus", data.s === "no_data" ? "no data" : "no data", "pill-down");
        $("fullChart").innerHTML = `<p class="loading">Delta Exchange has no ${resolutionLabel(resolution)} history for ${symbol}.</p>`;
        return;
      }
      setPill("chartStatus", "live", "pill-live");
      const bars = data.t.map((t, i) => ({
        time: t,
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
      }));
      series.setData(bars);
      $("chartLastUpdate").textContent = new Date().toLocaleTimeString();
    } catch (err) {
      console.error("Delta Exchange history fetch failed", err);
      setPill("chartStatus", "retrying…", "pill-down");
    }
  }

  function startPolling() {
    if (refreshTimer) clearInterval(refreshTimer);
    refresh();
    refreshTimer = setInterval(refresh, REFRESH_MS);
  }

  async function setup() {
    let info;
    try {
      info = await fetchSymbolInfo(symbol);
    } catch (err) {
      setPill("chartStatus", "unreachable", "pill-down");
      $("fullChart").innerHTML =
        `<p class="loading">Could not reach Delta Exchange's chart API (${err.message}). This may be a network/CORS restriction — check the browser console.</p>`;
      return;
    }

    if (!info.success || !info.result) {
      setPill("chartStatus", "not listed", "pill-down");
      $("fullChart").innerHTML =
        `<p class="loading">Delta Exchange doesn't list a contract matching ${symbol}. It likely doesn't offer this exact strike/expiry.</p>`;
      return;
    }

    const resolutions = (info.result.supported_resolutions || ["1"]).slice().sort(
      (a, b) => resolutionSortKey(a) - resolutionSortKey(b)
    );
    const select = $("resolutionSelect");
    select.innerHTML = resolutions.map((r) => `<option value="${r}">${resolutionLabel(r)}</option>`).join("");
    resolution = resolutions.includes("1") ? "1" : resolutions[0];
    select.value = resolution;
    select.disabled = false;
    select.addEventListener("change", (e) => {
      resolution = e.target.value;
      startPolling();
    });

    startPolling();
  }

  setup();
}

init();
