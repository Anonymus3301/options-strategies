// Straddle (Long/Short) strategy page — standalone, REST-only.
// The single most basic volatility structure on the options market, oddly absent from
// this site as its own page until now: buy (or sell) both the ATM call and ATM put at
// the same strike and expiry. Long Strangle already covers the cheaper OTM version and
// Guts the ITM version; the Long Volatility and Premium Selling pages both implicitly
// trade this exact structure but frame it as a timing scanner (when IV is cheap/rich),
// not as a plain payoff/breakeven reference the way every other basic structure gets one.

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

function computeStraddle(side) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot };

  const call = state.summaries.get(bucket.calls.get(atm));
  const put = state.summaries.get(bucket.puts.get(atm));
  if (!call || !put || call.mark_price == null || put.mark_price == null) return { spot, atm };

  const callUsd = call.mark_price * spot;
  const putUsd = put.mark_price * spot;
  const premium = callUsd + putUsd;
  const ivs = [call.mark_iv, put.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return {
    spot,
    atm,
    callUsd,
    putUsd,
    premium,
    side,
    breakevenLow: atm - premium,
    breakevenHigh: atm + premium,
    avgIv,
  };
}

function renderStraddle(st) {
  $("straddleExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = st && st.spot != null ? "$" + qFmt(st.spot, 0) : "—";

  if (!st || st.premium == null) {
    $("strikeStat").textContent = "—";
    $("premiumStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("maxLossStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  const isLong = st.side === "long";
  $("strikeStat").textContent = qFmt(st.atm, 0);
  $("premiumStat").textContent = `$${qFmt(st.premium, 0)}` + (isLong ? " (paid)" : " (received)");
  $("breakevenStat").textContent = `${qFmt(st.breakevenLow, 0)} — ${qFmt(st.breakevenHigh, 0)}`;
  $("maxProfitStat").textContent = isLong ? "Unlimited" : `$${qFmt(st.premium, 0)}`;
  $("maxLossStat").textContent = isLong ? `$${qFmt(st.premium, 0)}` : "Unlimited";

  const legs = [
    { type: "call", side: st.side, strike: st.atm, premiumUsd: st.callUsd },
    { type: "put", side: st.side, strike: st.atm, premiumUsd: st.putUsd },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, st.spot);

  if ($("popStat")) {
    let pop = null;
    if (st.avgIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, st.spot, st.avgIv / 100, T);
    }
    $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const side = $("sideSelect").value;
    const st = computeStraddle(side);
    renderStraddle(st);
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
$("sideSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
