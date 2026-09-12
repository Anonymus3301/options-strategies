// Jelly Roll strategy page — standalone, REST-only.
// Sell the front-month synthetic forward (short call + long put, strike K), buy the
// back-month one (long call + short put, same K). By put-call parity each synthetic's
// cost reflects that expiry's own implied forward, so the combined entry cash flow
// reduces to (front implied forward) - (back implied forward) — a pricing-consistency
// signal, not a riskless terminal payoff (the two legs settle on different dates).

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
  if (!state.backExpiry || !state.instrumentsByExpiry.has(state.backExpiry) || state.backExpiry <= state.frontExpiry) {
    state.backExpiry = state.expiries.find((ts) => ts > state.frontExpiry) ?? null;
  }
}

function renderSelects() {
  const frontSel = $("frontSelect"), backSel = $("backSelect");
  frontSel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.frontExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  backSel.innerHTML = state.expiries
    .filter((ts) => ts > state.frontExpiry)
    .map((ts) => `<option value="${ts}" ${ts === state.backExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  frontSel.disabled = false;
  backSel.disabled = false;
}

function computeJellyRoll() {
  const frontBucket = state.instrumentsByExpiry.get(state.frontExpiry);
  const backBucket = state.instrumentsByExpiry.get(state.backExpiry);
  if (!frontBucket || !backBucket) return null;
  const spot = qImpliedSpot(frontBucket, state.summaries);
  if (spot == null) return { spot };

  const strikes = [...new Set([...frontBucket.calls.keys(), ...frontBucket.puts.keys()])];
  const strike = qClosestStrike(strikes, spot);
  if (strike == null) return { spot };
  if (!backBucket.calls.has(strike) || !backBucket.puts.has(strike)) return { spot, strike, noBackMatch: true };

  const frontCall = state.summaries.get(frontBucket.calls.get(strike));
  const frontPut = state.summaries.get(frontBucket.puts.get(strike));
  const backCall = state.summaries.get(backBucket.calls.get(strike));
  const backPut = state.summaries.get(backBucket.puts.get(strike));
  if (
    !frontCall || !frontPut || !backCall || !backPut ||
    frontCall.mark_price == null || frontPut.mark_price == null || backCall.mark_price == null || backPut.mark_price == null
  ) {
    return { spot, strike };
  }

  const frontCallUsd = frontCall.mark_price * spot;
  const frontPutUsd = frontPut.mark_price * spot;
  const backCallUsd = backCall.mark_price * spot;
  const backPutUsd = backPut.mark_price * spot;

  const frontForward = strike + (frontCallUsd - frontPutUsd);
  const backForward = strike + (backCallUsd - backPutUsd);
  const cashFlow = frontForward - backForward;

  return { spot, strike, frontCallUsd, frontPutUsd, backCallUsd, backPutUsd, frontForward, backForward, cashFlow };
}

function render(jr) {
  $("spotStat").textContent = jr && jr.spot != null ? "$" + qFmt(jr.spot, 0) : "—";
  const el = $("legsInfo");

  if (!jr || jr.cashFlow == null) {
    $("strikeStat").textContent = "—";
    $("frontFwdStat").textContent = "—";
    $("backFwdStat").textContent = "—";
    $("cashFlowStat").textContent = "—";
    el.innerHTML = jr && jr.noBackMatch
      ? '<p class="loading">Back expiry doesn\'t list this strike</p>'
      : '<p class="loading">No data</p>';
    return;
  }

  $("strikeStat").textContent = qFmt(jr.strike, 0);
  $("frontFwdStat").textContent = "$" + qFmt(jr.frontForward, 0);
  $("backFwdStat").textContent = "$" + qFmt(jr.backForward, 0);
  $("cashFlowStat").textContent = jr.cashFlow >= 0 ? `+$${qFmt(jr.cashFlow, 0)} (receive)` : `-$${qFmt(-jr.cashFlow, 0)} (pay)`;

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Sell front call</span><span class="scanner-value">$${qFmt(jr.frontCallUsd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Buy front put</span><span class="scanner-value">$${qFmt(jr.frontPutUsd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Buy back call</span><span class="scanner-value">$${qFmt(jr.backCallUsd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Sell back put</span><span class="scanner-value">$${qFmt(jr.backPutUsd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Interpretation</span><span class="scanner-value">${Math.abs(jr.cashFlow) < 25 ? "Two expiries' implied forwards agree closely" : "A meaningful gap between the two expiries' implied forwards — could be real forward-curve information or just noisy quotes"}</span></div>
    </div>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderSelects();
    const jr = computeJellyRoll();
    render(jr);
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("frontSelect").addEventListener("change", (e) => {
  state.frontExpiry = Number(e.target.value);
  if (state.backExpiry <= state.frontExpiry) state.backExpiry = null;
  refresh();
});
$("backSelect").addEventListener("change", (e) => {
  state.backExpiry = Number(e.target.value);
  refresh();
});

refresh();
setInterval(refresh, 30000);
