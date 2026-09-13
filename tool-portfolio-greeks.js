// Portfolio Greeks Dashboard — standalone, REST-only.
// The Greeks Table shows per-strike greeks in isolation; the Strategy Builder shows
// payoff/POP; the VaR Calculator shows tail risk; the P&L Attribution tool shows dollar
// contributions from an assumed move. None of them show the raw NET greeks themselves for
// a custom combination — this does, for the same up-to-4-leg model, plus a delta-hedge
// suggestion (how much underlying to trade to zero out net delta).

const CURRENCY = "BTC";
const MAX_LEGS = 4;

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

function renderLegStrikeOptions() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return;
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  for (let i = 1; i <= MAX_LEGS; i++) {
    const sel = $(`leg${i}Strike`);
    const prev = sel.value;
    sel.innerHTML = strikes.map((s) => `<option value="${s}">${qFmt(s, 0)}</option>`).join("");
    if (strikes.includes(Number(prev))) sel.value = prev;
  }
}

function collectLegs() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
  if (!bucket || spot == null) return { spot, legs: [] };
  const legs = [];
  for (let i = 1; i <= MAX_LEGS; i++) {
    if (!$(`leg${i}Enable`).checked) continue;
    const type = $(`leg${i}Type`).value;
    const side = $(`leg${i}Side`).value;
    const strike = Number($(`leg${i}Strike`).value);
    const qty = Math.max(1, Number($(`leg${i}Qty`).value) || 1);
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_iv == null) continue;
    legs.push({ type, side, strike, sigma: sum.mark_iv / 100, qty });
  }
  return { spot, legs };
}

function signedQty(leg) {
  return (leg.side === "long" ? 1 : -1) * leg.qty;
}

function renderResult() {
  const { spot, legs } = collectLegs();
  if (!legs.length || spot == null) {
    for (const id of ["netDeltaStat", "netGammaStat", "netVegaStat", "netThetaStat", "hedgeStat"]) {
      $(id).textContent = "—";
    }
    return;
  }
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  let netDelta = 0, netGamma = 0, netVega = 0, netThetaPerDay = 0;
  for (const leg of legs) {
    const q = signedQty(leg);
    netDelta += q * qBsDelta(leg.type, spot, leg.strike, T, leg.sigma);
    netGamma += q * qBsGamma(spot, leg.strike, T, leg.sigma);
    netVega += q * (qBsVega(spot, leg.strike, T, leg.sigma) / 100);
    netThetaPerDay += q * qBsThetaPerDay(spot, leg.strike, T, leg.sigma);
  }

  $("netDeltaStat").textContent = qFmtSigned(netDelta, 3);
  $("netGammaStat").textContent = qFmtSigned(netGamma, 6);
  $("netVegaStat").textContent = `${qFmtSigned(netVega, 1)} $/vol pt`;
  $("netThetaStat").textContent = `${qFmtSigned(netThetaPerDay, 1)} $/day`;

  if (Math.abs(netDelta) < 0.001) {
    $("hedgeStat").textContent = "Already ≈ delta-neutral (no hedge needed)";
  } else {
    const action = netDelta > 0 ? "Sell" : "Buy";
    $("hedgeStat").textContent = `${action} ${qFmt(Math.abs(netDelta), 3)} BTC (or equivalent futures) to zero net delta`;
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    renderLegStrikeOptions();
    const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
    const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    renderResult();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderLegStrikeOptions();
  renderResult();
});

for (let i = 1; i <= MAX_LEGS; i++) {
  for (const id of [`leg${i}Enable`, `leg${i}Type`, `leg${i}Side`, `leg${i}Strike`, `leg${i}Qty`]) {
    $(id).addEventListener("change", renderResult);
  }
}

refresh();
setInterval(refresh, 30000);
