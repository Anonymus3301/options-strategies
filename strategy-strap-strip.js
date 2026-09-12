// Strap / Strip (weighted ATM straddle) strategy page — standalone, REST-only.
// Strap: 2 long calls + 1 long put at the ATM strike (bullish-leaning long vol).
// Strip: 1 long call + 2 long puts (bearish-leaning long vol).

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

function computeStrapStrip(mode) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const strike = qClosestStrike(strikes, spot);
  if (strike == null) return { spot };

  const call = state.summaries.get(bucket.calls.get(strike));
  const put = state.summaries.get(bucket.puts.get(strike));
  if (!call || !put || call.mark_price == null || put.mark_price == null) return { spot, strike };

  const callUsd = call.mark_price * spot;
  const putUsd = put.mark_price * spot;
  const callQty = mode === "strap" ? 2 : 1;
  const putQty = mode === "strap" ? 1 : 2;
  const cost = callQty * callUsd + putQty * putUsd;
  const breakevenUp = strike + cost / callQty;
  const breakevenDown = strike - cost / putQty;
  const ivs = [call.mark_iv, put.mark_iv].filter((v) => v != null);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, strike, callUsd, putUsd, callQty, putQty, cost, breakevenUp, breakevenDown, atmIv };
}

function renderStrapStrip(ss) {
  $("strapExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = ss && ss.spot != null ? "$" + qFmt(ss.spot, 0) : "—";

  if (!ss || ss.cost == null) {
    $("strikeStat").textContent = "—";
    $("costStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikeStat").textContent = qFmt(ss.strike, 0);
  $("costStat").textContent = `$${qFmt(ss.cost, 0)} (${ss.callQty}× call + ${ss.putQty}× put)`;
  $("breakevenStat").textContent = `${qFmt(ss.breakevenDown, 0)} / ${qFmt(ss.breakevenUp, 0)}`;

  const legs = [
    { type: "call", side: "long", strike: ss.strike, premiumUsd: ss.callUsd, qty: ss.callQty },
    { type: "put", side: "long", strike: ss.strike, premiumUsd: ss.putUsd, qty: ss.putQty },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, ss.spot);

  if ($("popStat")) {
    let pop = null;
    if (ss.atmIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, ss.spot, ss.atmIv / 100, T);
    }
    $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const mode = $("modeSelect").value;
    const ss = computeStrapStrip(mode);
    renderStrapStrip(ss);
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
$("modeSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
