// Naked Put Writing strategy page — standalone, REST-only.
// Sell 1 OTM put on margin rather than fully cash-secured. Same payoff shape as the
// Income Scanner's CSP side, but framed around the capital-efficiency/margin-risk tradeoff
// instead of the fully-collateralized case.

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

function computeNakedPut(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const width = spot * (widthPct / 100);
  const candidates = [...bucket.puts.keys()].filter((s) => s < spot);
  const strike = candidates.length ? qClosestStrike(candidates, spot - width) : null;
  if (strike == null) return { spot };

  const put = state.summaries.get(bucket.puts.get(strike));
  if (!put || put.mark_price == null) return { spot, strike };

  const premiumUsd = put.mark_price * spot;
  const breakeven = strike - premiumUsd;

  return { spot, strike, premiumUsd, breakeven, iv: put.mark_iv };
}

function render(np) {
  $("putExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = np && np.spot != null ? "$" + qFmt(np.spot, 0) : "—";

  if (!np || np.premiumUsd == null) {
    $("strikeStat").textContent = "—";
    $("premiumStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    return;
  }

  $("strikeStat").textContent = qFmt(np.strike, 0);
  $("premiumStat").textContent = `$${qFmt(np.premiumUsd, 0)}`;
  $("breakevenStat").textContent = qFmt(np.breakeven, 0);

  const legs = [{ type: "put", side: "short", strike: np.strike, premiumUsd: np.premiumUsd }];
  chartEl.innerHTML = qBuildPayoffSvg(legs, np.spot);

  let pop = null;
  if (np.iv != null && state.selectedExpiry) {
    const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
    pop = qComputeProbabilityOfProfit(legs, np.spot, np.iv / 100, T);
  }
  $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const np = computeNakedPut(widthPct);
    render(np);
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
$("widthSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
