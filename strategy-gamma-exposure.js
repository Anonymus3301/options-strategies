// Gamma Exposure (GEX) by Strike strategy page — standalone, REST-only.
// A different OI-weighted positioning read from the Max Pain page's pin-risk theory:
// estimates net dealer gamma exposure per strike under the standard (unverifiable — this
// venue does not disclose counterparty identity) market heuristic that dealers are net
// long calls and net short puts against customer flow. Net GEX(K) = (call OI * call gamma
// - put OI * put gamma) * spot^2 * 0.01, the usual "$ per 1% move" scaling used for GEX.

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

function computeGex() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const rows = [];
  let totalGex = 0;
  for (const K of strikes) {
    const call = state.summaries.get(bucket.calls.get(K));
    const put = state.summaries.get(bucket.puts.get(K));
    const callOi = call && call.open_interest != null ? call.open_interest : 0;
    const putOi = put && put.open_interest != null ? put.open_interest : 0;
    const callIv = call && call.mark_iv != null ? call.mark_iv : null;
    const putIv = put && put.mark_iv != null ? put.mark_iv : null;
    if (!callOi && !putOi) continue;
    const callGamma = callIv != null ? qBsGamma(spot, K, T, callIv / 100) : 0;
    const putGamma = putIv != null ? qBsGamma(spot, K, T, putIv / 100) : 0;
    const gex = (callOi * callGamma - putOi * putGamma) * spot * spot * 0.01;
    rows.push({ K, gex });
    totalGex += gex;
  }
  if (!rows.length) return { spot, insufficient: true };
  return { spot, rows, totalGex };
}

function renderGex(g) {
  const el = $("gexChart");
  if (!g || g.spot == null || g.insufficient || !g.rows) {
    el.innerHTML = '<p class="loading">No open-interest data for this expiry</p>';
    $("totalGexStat").textContent = "—";
    $("readStat").textContent = "—";
    return;
  }
  $("totalGexStat").textContent = `${qFmtSigned(g.totalGex / 1e6, 2)}M $/1%`;
  $("readStat").textContent =
    g.totalGex >= 0
      ? "Net positive — under the standard dealer-long-gamma heuristic, hedging flows would tend to dampen moves (buy dips, sell rallies)."
      : "Net negative — under the standard dealer-long-gamma heuristic, hedging flows would tend to amplify moves (sell dips, buy rallies).";
  el.innerHTML = qBuildBarChart(
    g.rows.map((r) => qFmt(r.K, 0)),
    g.rows.map((r) => r.gex / 1e6),
    { posColor: "#35d399", negColor: "#ff5c7c" }
  );
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const g = computeGex();
    $("spotStat").textContent = g && g.spot != null ? "$" + qFmt(g.spot, 0) : "—";
    renderGex(g);
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
