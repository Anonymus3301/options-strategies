// Standalone 1-minute OHLC chart for a single Deribit option instrument.
// Opened from the ladder's order book panel via chart.html?instrument=...

const REST_BASE = "https://www.deribit.com/api/v2/public";
const REFRESH_MS = 15000;
const WINDOW_MS = 6 * 60 * 60 * 1000; // last 6 hours of 1m candles

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

async function fetchOhlc1m(instrumentName) {
  const end = Date.now();
  const start = end - WINDOW_MS;
  const url = `${REST_BASE}/get_tradingview_chart_data?instrument_name=${instrumentName}&start_timestamp=${start}&end_timestamp=${end}&resolution=1`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
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

  async function refresh() {
    try {
      const data = await fetchOhlc1m(instrument);
      setPill("chartStatus", "live", "pill-live");
      if (data.status === "ok" && data.ticks && data.ticks.length) {
        const candles = data.ticks.map((t, i) => ({
          time: Math.floor(t / 1000),
          open: data.open[i],
          high: data.high[i],
          low: data.low[i],
          close: data.close[i],
        }));
        series.setData(candles);
      }
      $("chartLastUpdate").textContent = new Date().toLocaleTimeString();
    } catch (err) {
      console.error("get_tradingview_chart_data failed", err);
      setPill("chartStatus", "retrying…", "pill-down");
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
}

init();
