// BTC Options Chain — Delta Exchange (india.delta.exchange), a genuinely separate venue
// and order book from Deribit, which every other page on this site reads. Options here
// are USD-denominated (unlike Deribit's coin-denominated bid/ask elsewhere on this site),
// and Delta's own strikes/expiries don't necessarily match Deribit's.
//
// FIELD-MAPPING CAVEAT: this session's sandbox could not reach any Delta Exchange domain
// (api.india.delta.exchange, cdn.india.deltaex.org, etc. all blocked by the sandbox's own
// egress policy — the chart.html page already deployed on this site DOES successfully
// reach Delta's chart CDN from a real browser, confirming the venue itself is reachable
// and CORS-enabled; only this development sandbox specifically cannot verify it directly).
// So the exact field names read below (contract_type, strike_price, settlement_time,
// quotes.best_bid/best_ask, mark_vol, greeks.delta, oi) are this session's best-documented
// understanding of Delta's public v2 REST API, not confirmed against live traffic. Every
// value is read defensively (multiple plausible field paths tried per value), and if a
// whole category of fields comes back empty across every row, the diagnostics panel below
// the table dumps one raw ticker's actual keys so a field-name mismatch can be fixed in one
// round rather than guessed at blind.

const DELTA_API_BASE = "https://api.india.delta.exchange/v2";
const UNDERLYING = "BTC";

const $ = (id) => document.getElementById(id);

const state = {
  products: [], // raw product objects for live BTC call/put options
  expiries: [], // sorted [expiryMs]
  selectedExpiry: null,
  tickersBySymbol: new Map(),
  lastRawTickerSample: null, // one raw ticker object, kept for the diagnostics panel
};

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

// ---------- Defensive field accessors (see file-top caveat) ----------

function productStrike(p) {
  const v = p.strike_price ?? p.strike ?? null;
  return v != null ? Number(v) : null;
}
function productType(p) {
  const ct = p.contract_type || p.contractType || "";
  if (ct.includes("call")) return "call";
  if (ct.includes("put")) return "put";
  return null;
}
function productUnderlying(p) {
  return p.underlying_asset?.symbol || p.underlying_asset_symbol || p.underlying_symbol || null;
}
function productExpiryMs(p) {
  const raw = p.settlement_time || p.expiry_time || p.expiration_time || null;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
function productSymbol(p) {
  return p.symbol || p.contract_symbol || null;
}

function tickerBid(t) {
  const v = t.quotes?.best_bid ?? t.best_bid ?? t.bid_price ?? null;
  return v != null ? Number(v) : null;
}
function tickerAsk(t) {
  const v = t.quotes?.best_ask ?? t.best_ask ?? t.ask_price ?? null;
  return v != null ? Number(v) : null;
}
function tickerMark(t) {
  const v = t.mark_price ?? t.markPrice ?? null;
  return v != null ? Number(v) : null;
}
function tickerIv(t) {
  const raw = t.mark_vol ?? t.iv ?? t.implied_volatility ?? t.greeks?.iv ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n < 5 ? n * 100 : n; // heuristic: BTC IV is never realistically <5 as a % figure
}
function tickerDelta(t) {
  const v = t.greeks?.delta ?? t.delta ?? null;
  return v != null ? Number(v) : null;
}
function tickerOi(t) {
  const v = t.oi ?? t.open_interest ?? null;
  return v != null ? Number(v) : null;
}
function tickerVolume(t) {
  const v = t.volume ?? t.turnover ?? null;
  return v != null ? Number(v) : null;
}
function tickerSpot(t) {
  const v = t.spot_price ?? t.underlying_price ?? t.index_price ?? null;
  return v != null ? Number(v) : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json && json.success === false) throw new Error(json.error?.message || "Delta API returned success:false");
  return json;
}

async function loadChain() {
  const [productsJson, tickersJson] = await Promise.all([
    fetchJson(`${DELTA_API_BASE}/products?contract_types=call_options,put_options`),
    fetchJson(`${DELTA_API_BASE}/tickers?contract_types=call_options,put_options`),
  ]);

  const allProducts = productsJson.result || productsJson.products || [];
  state.products = allProducts.filter((p) => productUnderlying(p) === UNDERLYING && productType(p) && productStrike(p) != null && productExpiryMs(p) != null);

  const allTickers = tickersJson.result || tickersJson.tickers || [];
  state.tickersBySymbol = new Map(allTickers.map((t) => [t.symbol || t.contract_symbol, t]));
  if (allTickers.length) state.lastRawTickerSample = allTickers[0];

  const expirySet = new Set(state.products.map((p) => productExpiryMs(p)));
  state.expiries = [...expirySet].sort((a, b) => a - b);
  if (!state.selectedExpiry || !state.expiries.includes(state.selectedExpiry)) {
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

function bucketForSelectedExpiry() {
  const calls = new Map(); // strike -> product
  const puts = new Map();
  for (const p of state.products) {
    if (productExpiryMs(p) !== state.selectedExpiry) continue;
    const strike = productStrike(p);
    (productType(p) === "call" ? calls : puts).set(strike, p);
  }
  return { calls, puts };
}

function cell(ticker, accessor, digits, prefix) {
  if (!ticker) return "—";
  const v = accessor(ticker);
  if (v == null || !Number.isFinite(v)) return "—";
  return (prefix || "") + qFmt(v, digits);
}

function renderLadder() {
  const body = $("ladderBody");
  if (!state.selectedExpiry) {
    body.innerHTML = `<tr><td colspan="15" class="loading">Loading Delta Exchange's BTC options chain…</td></tr>`;
    return;
  }
  const { calls, puts } = bucketForSelectedExpiry();
  const strikes = [...new Set([...calls.keys(), ...puts.keys()])].sort((a, b) => a - b);

  if (!strikes.length) {
    body.innerHTML = `<tr><td colspan="15" class="loading">Delta Exchange lists no live BTC options for this expiry.</td></tr>`;
    return;
  }

  let anyBidAskFound = false;

  body.innerHTML = strikes
    .map((strike) => {
      const callProduct = calls.get(strike);
      const putProduct = puts.get(strike);
      const callTicker = callProduct ? state.tickersBySymbol.get(productSymbol(callProduct)) : null;
      const putTicker = putProduct ? state.tickersBySymbol.get(productSymbol(putProduct)) : null;
      if ((callTicker && tickerBid(callTicker) != null) || (putTicker && tickerBid(putTicker) != null)) anyBidAskFound = true;

      return `
      <tr class="option-row">
        <td class="call-cell">${cell(callTicker, tickerOi, 0)}</td>
        <td class="call-cell">${cell(callTicker, tickerVolume, 0)}</td>
        <td class="call-cell">${cell(callTicker, tickerIv, 1)}</td>
        <td class="call-cell">${cell(callTicker, tickerDelta, 3)}</td>
        <td class="call-cell">${cell(callTicker, tickerBid, 2, "$")}</td>
        <td class="call-cell">${cell(callTicker, tickerMark, 2, "$")}</td>
        <td class="call-cell">${cell(callTicker, tickerAsk, 2, "$")}</td>
        <td class="strike-cell"><div class="strike-value">${qFmt(strike, 0)}</div></td>
        <td class="put-cell">${cell(putTicker, tickerBid, 2, "$")}</td>
        <td class="put-cell">${cell(putTicker, tickerMark, 2, "$")}</td>
        <td class="put-cell">${cell(putTicker, tickerAsk, 2, "$")}</td>
        <td class="put-cell">${cell(putTicker, tickerDelta, 3)}</td>
        <td class="put-cell">${cell(putTicker, tickerIv, 1)}</td>
        <td class="put-cell">${cell(putTicker, tickerVolume, 0)}</td>
        <td class="put-cell">${cell(putTicker, tickerOi, 0)}</td>
      </tr>`;
    })
    .join("");

  renderDiagnostics(anyBidAskFound);
}

function renderDiagnostics(anyBidAskFound) {
  const el = $("diagnostics");
  if (anyBidAskFound || !state.lastRawTickerSample) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <p><strong>No bid/ask parsed from any row.</strong> Delta's ticker response almost
    certainly uses different field names than this page assumed. Here are the actual keys
    on one raw ticker object it received, to fix the field mapping in one round instead of
    guessing again:</p>
    <pre>${JSON.stringify(state.lastRawTickerSample, null, 2).slice(0, 2000)}</pre>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();

    let anySpot = null;
    for (const t of state.tickersBySymbol.values()) {
      const s = tickerSpot(t);
      if (s != null) {
        anySpot = s;
        break;
      }
    }
    $("spotStat").textContent = anySpot != null ? "$" + qFmt(anySpot, 0) : "—";

    renderLadder();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("Delta Exchange chain fetch failed", err);
    setStatus("error", "pill-down");
    $("ladderBody").innerHTML = `<tr><td colspan="15" class="loading">Could not reach Delta Exchange's API (${err.message}). This may be a network/CORS restriction — check the browser console.</td></tr>`;
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderLadder();
});

refresh();
setInterval(refresh, 15000);
