// Roll Analyzer — standalone, REST-only.
// A common real action for anyone running the Income Scanner or Wheel Strategy pages:
// closing a near-dated option and opening a farther-dated one (the same strike or a new
// one) before/at expiry. Nothing else on this site prices that specific transaction — this
// computes the net cash flow of closing the front leg and opening the back leg together.

const CURRENCY = "BTC";

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  frontExpiry: null,
  backExpiry: null,
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
  if (!state.frontExpiry || !state.instrumentsByExpiry.has(state.frontExpiry)) {
    state.frontExpiry = state.expiries[0] ?? null;
  }
  const laterExpiries = state.expiries.filter((ts) => ts > state.frontExpiry);
  if (!state.backExpiry || !laterExpiries.includes(state.backExpiry)) {
    state.backExpiry = laterExpiries[0] ?? null;
  }
}

function renderExpirySelects() {
  const frontSel = $("frontExpirySelect");
  frontSel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.frontExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  frontSel.disabled = false;

  const laterExpiries = state.expiries.filter((ts) => ts > state.frontExpiry);
  const backSel = $("backExpirySelect");
  backSel.innerHTML = laterExpiries.length
    ? laterExpiries.map((ts) => `<option value="${ts}" ${ts === state.backExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`).join("")
    : '<option value="">No later expiry listed</option>';
  backSel.disabled = laterExpiries.length === 0;
}

function renderStrikeSelects() {
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  if (frontBucket) {
    const strikes = [...new Set([...frontBucket.calls.keys(), ...frontBucket.puts.keys()])].sort((a, b) => a - b);
    const sel = $("frontStrikeSelect");
    const prev = sel.value;
    sel.innerHTML = strikes.map((s) => `<option value="${s}">${qFmt(s, 0)}</option>`).join("");
    if (strikes.includes(Number(prev))) sel.value = prev;
  }
  if (backBucket) {
    const strikes = [...new Set([...backBucket.calls.keys(), ...backBucket.puts.keys()])].sort((a, b) => a - b);
    const sel = $("backStrikeSelect");
    const prev = sel.value;
    sel.innerHTML = strikes.map((s) => `<option value="${s}">${qFmt(s, 0)}</option>`).join("");
    if (strikes.includes(Number(prev))) sel.value = prev;
  }
}

function premiumFor(expiry, type, strike) {
  const bucket = state.instrumentsByExpiry.get(expiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return null;
  const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
  const sum = name ? state.summaries.get(name) : null;
  if (!sum || sum.mark_price == null) return null;
  return { premiumUsd: sum.mark_price * spot, iv: sum.mark_iv, spot };
}

function render() {
  const el = $("resultBody");
  if (!state.backExpiry) {
    el.innerHTML = '<p class="loading">No later expiry is currently listed to roll into</p>';
    return;
  }
  const type = $("typeSelect").value;
  const side = $("sideSelect").value;
  const frontStrike = Number($("frontStrikeSelect").value);
  const backStrike = Number($("backStrikeSelect").value);

  const front = premiumFor(state.frontExpiry, type, frontStrike);
  const back = premiumFor(state.backExpiry, type, backStrike);
  if (!front || !back) {
    el.innerHTML = '<p class="loading">No quote for one of these legs</p>';
    return;
  }

  // Cash flow: opening the back leg (credit if short, debit if long) plus closing the
  // front leg (debit if short — buying it back, credit if long — selling it).
  const openBackCF = side === "short" ? back.premiumUsd : -back.premiumUsd;
  const closeFrontCF = side === "short" ? -front.premiumUsd : front.premiumUsd;
  const netCF = openBackCF + closeFrontCF;

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Close front leg</span><span class="scanner-value">${side === "short" ? "Buy back" : "Sell"} ${side} ${type} ${qFmt(frontStrike, 0)} (${qExpiryLabel(state.frontExpiry)}) — $${qFmt(front.premiumUsd, 0)} (${qFmt(front.iv, 1)}% IV)</span></div>
      <div class="scanner-row"><span class="scanner-label">Open back leg</span><span class="scanner-value">${side === "short" ? "Sell" : "Buy"} ${side} ${type} ${qFmt(backStrike, 0)} (${qExpiryLabel(state.backExpiry)}) — $${qFmt(back.premiumUsd, 0)} (${qFmt(back.iv, 1)}% IV)</span></div>
      <div class="scanner-row"><span class="scanner-label">Net Roll Cash Flow</span><span class="scanner-value">${netCF >= 0 ? "credit $" + qFmt(netCF, 0) : "debit $" + qFmt(-netCF, 0)}</span></div>
    </div>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelects();
    renderStrikeSelects();
    const bucket = state.instrumentsByExpiry.get(state.frontExpiry);
    const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("frontExpirySelect").addEventListener("change", (e) => {
  state.frontExpiry = Number(e.target.value);
  const laterExpiries = state.expiries.filter((ts) => ts > state.frontExpiry);
  state.backExpiry = laterExpiries[0] ?? null;
  renderExpirySelects();
  renderStrikeSelects();
  render();
});
$("backExpirySelect").addEventListener("change", (e) => {
  state.backExpiry = e.target.value ? Number(e.target.value) : null;
  renderStrikeSelects();
  render();
});
$("frontStrikeSelect").addEventListener("change", render);
$("backStrikeSelect").addEventListener("change", render);
$("typeSelect").addEventListener("change", render);
$("sideSelect").addEventListener("change", render);

refresh();
setInterval(refresh, 30000);
