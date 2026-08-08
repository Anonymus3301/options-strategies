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
//
// The expiry dropdown is populated from Deribit's own instrument list (the
// same source the ladder uses) — Delta has no "list expiries" endpoint we
// know of, so Deribit is the authoritative source for which expiries exist
// for this strike/type; Delta is only ever used for the actual OHLC bars,
// per contract, once one is selected.
//
// Rendering: our own charting library (vendor/charting-library/, built from
// the sibling deltaExahangeChart project's chart pages) rather than
// lightweight-charts — this is what gives this page the same indicators
// panel + drawing toolbar every deltaExchange chart page has, since
// lightweight-charts has no equivalent public API for either.
import { createChart } from "@charting-library/core";
import { setupIndicatorPanel } from "./indicatorPanel.js";
import { setupDrawingToolPanel } from "./drawingToolPanel.js";
import { createSessionStore } from "./sessionStore.js";

const DELTA_CHART_BASE = "https://cdn.india.deltaex.org/v2/chart";
const DERIBIT_REST_BASE = "https://www.deribit.com/api/v2/public";
const REFRESH_MS = 15000;

const $ = (id) => document.getElementById(id);

function setPill(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = "pill " + cls;
}

function setMessage(text) {
  const el = $("chartMessage");
  if (el) el.textContent = text || "";
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

function parseInstrumentParts(instrumentName) {
  const parts = instrumentName.split("-");
  if (parts.length < 4) return null;
  const [asset, rawDate, strike, typeLetter] = parts;
  if (!parseDeribitDate(rawDate) || !Number.isFinite(Number(strike))) return null;
  return { asset, rawDate, strike: Number(strike), type: typeLetter === "C" ? "C" : "P" };
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

function expiryLabel(ts) {
  const d = new Date(ts);
  const days = Math.round((ts - Date.now()) / 86400000);
  const dayLabel = days >= 0 ? `${days}d` : `${Math.abs(days)}d ago`;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" })} (${dayLabel})`;
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

// Every option on Deribit with this strike/type, any expiry (past and
// future) — the "same strike, different date" list for the expiry dropdown.
// Deribit only lets you filter by expired true/false in one call, not both,
// so this fetches each and merges them.
async function fetchExpiriesForContract(asset, strike, type) {
  const wantType = type === "C" ? "call" : "put";
  const urls = [
    `${DERIBIT_REST_BASE}/get_instruments?currency=${asset}&kind=option&expired=false`,
    `${DERIBIT_REST_BASE}/get_instruments?currency=${asset}&kind=option&expired=true`,
  ];
  const responses = await Promise.all(urls.map((u) => fetch(u).then((r) => r.json())));
  const all = [];
  for (const json of responses) {
    if (json.error) throw new Error(json.error.message);
    all.push(...json.result);
  }
  const matched = all
    .filter((i) => i.strike === strike && i.option_type === wantType)
    .map((i) => ({ name: i.instrument_name, expiry: i.expiration_timestamp }))
    .sort((a, b) => a.expiry - b.expiry);
  console.info(
    `[expiries] ${asset} strike=${strike} type=${wantType}: ` +
      `${responses[0]?.result?.length ?? 0} active + ${responses[1]?.result?.length ?? 0} expired instruments fetched, ` +
      `${matched.length} matched this exact strike`
  );
  return matched;
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

// Ask for a generously wide window and let Delta's API trim it to whatever
// data it actually has, rather than us guessing a bar count and potentially
// cutting off history the exchange would otherwise return.
function windowSecondsFor(resolution) {
  if (resolution === "M") return 6 * 365 * 86400;
  if (resolution === "W" || /^\d+W$/.test(resolution)) return 4 * 365 * 86400;
  if (resolution === "D") return 3 * 365 * 86400;
  return 2 * 365 * 86400; // any intraday minute resolution
}

function init() {
  const instrument = new URLSearchParams(location.search).get("instrument");
  if (!instrument) {
    $("fullChart").innerHTML =
      '<p class="loading">No instrument specified. Open this page from a ladder row\'s order book panel.</p>';
    return;
  }

  const chart = createChart($("fullChart"));

  // Same cookie-backed session pattern as every other deltaExchange chart
  // page: indicators AND manual drawings both persist across reloads. Unlike
  // tradeReview.html's backtest-drill-down page, nothing here auto-plots
  // trades that would conflict with saved drawings, so there's no reason to
  // withhold persistence from shapes the way that page deliberately does.
  const { load: loadChartSession, save: saveChartSession } = createSessionStore("optionsChartSession");
  let chartSession = loadChartSession() ?? {};
  function persistChartSession(partial) {
    chartSession = { ...chartSession, ...partial };
    saveChartSession(chartSession);
  }
  setupIndicatorPanel(chart, $("fullChart"), {
    initialIndicators: chartSession.indicators ?? [],
    onChange: (indicators) => persistChartSession({ indicators }),
  });
  setupDrawingToolPanel(chart, $("fullChart"), {
    initialShapes: chartSession.shapes ?? [],
    onChange: (shapes) => persistChartSession({ shapes }),
  });

  let resolution = "1";
  let refreshTimer = null;
  let allBars = []; // accumulated, deduped by time, sorted ascending
  let currentSymbol = null;
  let currentInstrument = null;
  let allExpiries = []; // every { name, expiry } at this strike/type, from Deribit
  let expiryScope = "upcoming"; // "upcoming" | "expired" — which tab is active

  function toBars(data) {
    return data.t.map((t, i) => ({ time: t, open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i] }));
  }

  function mergeBars(existing, incoming) {
    const map = new Map(existing.map((b) => [b.time, b]));
    for (const b of incoming) map.set(b.time, b);
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  // Keeps paging further back, one window at a time, until Delta returns
  // nothing more — "take whatever data we can get till we get nothing from
  // the API" rather than guessing a single window size up front.
  async function backfill() {
    const step = windowSecondsFor(resolution);
    let to = Math.floor(Date.now() / 1000);
    const MAX_PAGES = 50;
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = to - step;
      let data;
      try {
        data = await fetchHistory(currentSymbol, resolution, from, to);
      } catch (err) {
        console.error("Delta Exchange history fetch failed", err);
        break;
      }
      if (!data || data.s !== "ok" || !data.t || !data.t.length) break;
      const pageBars = toBars(data);
      allBars = mergeBars(allBars, pageBars);
      const earliest = pageBars[0].time;
      if (earliest >= to || pageBars.length < 2) break; // no further progress possible
      to = earliest - 1;
    }
  }

  async function refresh() {
    try {
      const hadData = allBars.length > 0;
      const previousLastTime = hadData ? allBars[allBars.length - 1].time : -Infinity;

      if (!hadData) {
        await backfill();
      } else {
        // Deep history is already in; each tick only needs the recent window.
        const end = Math.floor(Date.now() / 1000);
        const start = end - windowSecondsFor(resolution);
        const data = await fetchHistory(currentSymbol, resolution, start, end);
        if (data && data.s === "ok" && data.t && data.t.length) {
          allBars = mergeBars(allBars, toBars(data));
        }
      }

      if (!allBars.length) {
        setPill("chartStatus", "no data", "pill-down");
        setMessage(`Delta Exchange has no ${resolutionLabel(resolution)} history for ${currentSymbol}.`);
        chart.clear();
        return;
      }
      setPill("chartStatus", "live", "pill-live");
      setMessage("");

      if (!hadData) {
        // First load for this contract/resolution: replace everything and fit
        // the view to it.
        chart.setData(allBars);
        chart.fitContent();
      } else {
        // Later polls: push only the tail that could actually be new or
        // changed (already-closed historical bars never retroactively
        // change) via update(), which appends-or-replaces-the-last-bar and
        // preserves the current zoom/pan — setData() always re-fits the
        // view, which would yank the user's zoom back out on every 15s poll.
        for (const bar of allBars) {
          if (bar.time >= previousLastTime) chart.update(bar);
        }
      }
      $("chartLastUpdate").textContent = new Date().toLocaleTimeString();
    } catch (err) {
      console.error("Delta Exchange history fetch failed", err);
      setPill("chartStatus", "retrying…", "pill-down");
    }
  }

  function startPolling() {
    if (refreshTimer) clearInterval(refreshTimer);
    allBars = []; // reset so a resolution/contract switch re-runs the full backfill
    refresh();
    refreshTimer = setInterval(refresh, REFRESH_MS);
  }

  async function setupSymbol() {
    let info;
    try {
      info = await fetchSymbolInfo(currentSymbol);
    } catch (err) {
      setPill("chartStatus", "unreachable", "pill-down");
      setMessage(`Could not reach Delta Exchange's chart API (${err.message}). This may be a network/CORS restriction — check the browser console.`);
      return;
    }

    if (!info.success || !info.result) {
      setPill("chartStatus", "not listed", "pill-down");
      setMessage(`Delta Exchange doesn't have a symbol matching ${currentSymbol}.`);
      chart.clear();
      return;
    }

    const resolutions = (info.result.supported_resolutions || ["1"]).slice().sort(
      (a, b) => resolutionSortKey(a) - resolutionSortKey(b)
    );
    const select = $("resolutionSelect");
    select.innerHTML = resolutions.map((r) => `<option value="${r}">${resolutionLabel(r)}</option>`).join("");
    if (!resolutions.includes(resolution)) resolution = resolutions.includes("1") ? "1" : resolutions[0];
    select.value = resolution;
    select.disabled = false;

    startPolling();
  }

  // Renders the expiry <select> from whichever scope tab (upcoming/expired)
  // is currently active, filtering the already-fetched allExpiries client-side
  // — no refetch needed just to switch tabs.
  function renderExpirySelect() {
    const select = $("expirySelect");
    const now = Date.now();
    const list =
      expiryScope === "upcoming"
        ? allExpiries.filter((e) => e.expiry >= now).sort((a, b) => a.expiry - b.expiry)
        : allExpiries.filter((e) => e.expiry < now).sort((a, b) => b.expiry - a.expiry);

    if (!list.length) {
      select.innerHTML = `<option disabled selected>No ${expiryScope} expiries at this exact strike</option>`;
      select.disabled = true;
      return;
    }
    select.innerHTML = list.map((e) => `<option value="${e.name}">${expiryLabel(e.expiry)}</option>`).join("");
    select.disabled = false;
    if (list.some((e) => e.name === currentInstrument)) select.value = currentInstrument;
  }

  function setExpiryScope(scope) {
    expiryScope = scope;
    document.querySelectorAll(".expiry-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.scope === scope);
    });
    renderExpirySelect();
  }

  // Switches the chart to a different contract (e.g. a different expiry at
  // the same strike/type) without recreating the chart itself.
  async function loadContract(instrumentName) {
    currentInstrument = instrumentName;
    document.title = `${instrumentName} — Option Chart`;
    $("chartTitle").textContent = instrumentName;
    $("chartInstrument").textContent = instrumentName;
    history.replaceState(null, "", `?instrument=${encodeURIComponent(instrumentName)}`);
    if ($("expirySelect").querySelector(`option[value="${CSS.escape(instrumentName)}"]`)) {
      $("expirySelect").value = instrumentName;
    }

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    allBars = [];
    chart.clear();
    setMessage("");

    currentSymbol = deribitToDeltaSymbol(instrumentName);
    $("deltaSymbolHint").textContent = "Delta symbol: " + (currentSymbol || "could not be constructed");
    if (!currentSymbol) {
      setPill("chartStatus", "unavailable", "pill-down");
      setMessage("Could not derive a Delta Exchange symbol from this instrument name.");
      return;
    }

    setPill("chartStatus", "connecting…", "pill-connecting");
    await setupSymbol();
  }

  async function loadExpiryOptions(instrumentName) {
    const parts = parseInstrumentParts(instrumentName);
    const select = $("expirySelect");
    if (!parts) {
      select.innerHTML = "<option>—</option>";
      return;
    }
    try {
      allExpiries = await fetchExpiriesForContract(parts.asset, parts.strike, parts.type);
      if (!allExpiries.length) {
        select.innerHTML = "<option>No expiries found</option>";
        select.disabled = true;
        return;
      }
      // Default to whichever tab actually contains the contract we're viewing.
      const viewingUpcoming = allExpiries.some((e) => e.name === instrumentName && e.expiry >= Date.now());
      setExpiryScope(viewingUpcoming ? "upcoming" : "expired");
    } catch (err) {
      console.error("get_instruments failed", err);
      select.innerHTML = "<option>Couldn’t load expiries</option>";
    }
  }

  $("resolutionSelect").addEventListener("change", (e) => {
    resolution = e.target.value;
    startPolling();
  });
  $("expirySelect").addEventListener("change", (e) => {
    loadContract(e.target.value);
  });
  document.querySelectorAll(".expiry-tab").forEach((btn) => {
    btn.addEventListener("click", () => setExpiryScope(btn.dataset.scope));
  });

  loadContract(instrument);
  loadExpiryOptions(instrument);
}

init();
