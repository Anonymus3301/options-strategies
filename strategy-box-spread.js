// Box Spread (implied interest rate) strategy page — standalone, REST-only.
// A long call spread + long put spread at the same two strikes (K1 < K2) pays exactly
// K2-K1 at expiry no matter where spot lands. Comparing that guaranteed payout to what
// the chain's current mark prices say the structure costs today implies an annualized
// financing rate.

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

function computeBox(widthPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);

  const k1 = qClosestStrike(strikes.filter((s) => s <= spot), spot) ?? qClosestStrike(strikes, spot);
  if (k1 == null) return { spot };
  const width = spot * (widthPct / 100);
  const upperCandidates = strikes.filter((s) => s > k1);
  const k2 = upperCandidates.length ? qClosestStrike(upperCandidates, k1 + width) : null;
  if (k2 == null) return { spot, k1 };

  const callK1 = state.summaries.get(bucket.calls.get(k1));
  const callK2 = state.summaries.get(bucket.calls.get(k2));
  const putK1 = state.summaries.get(bucket.puts.get(k1));
  const putK2 = state.summaries.get(bucket.puts.get(k2));
  if (
    !callK1 || !callK2 || !putK1 || !putK2 ||
    callK1.mark_price == null || callK2.mark_price == null || putK1.mark_price == null || putK2.mark_price == null
  ) {
    return { spot, k1, k2 };
  }

  const callSpreadCost = (callK1.mark_price - callK2.mark_price) * spot; // buy K1 call, sell K2 call
  const putSpreadCost = (putK2.mark_price - putK1.mark_price) * spot; // buy K2 put, sell K1 put
  const boxCost = callSpreadCost + putSpreadCost;
  const payout = k2 - k1;
  const dte = (state.selectedExpiry - Date.now()) / (24 * 60 * 60 * 1000);
  const T = dte / 365.25;
  const impliedRate = boxCost > 0 && T > 0 ? ((payout - boxCost) / boxCost / T) * 100 : null;

  return { spot, k1, k2, callSpreadCost, putSpreadCost, boxCost, payout, impliedRate };
}

function renderBox(box) {
  $("spotStat").textContent = box && box.spot != null ? "$" + qFmt(box.spot, 0) : "—";
  const el = $("boxInfo");

  if (!box || box.boxCost == null) {
    $("strikesStat").textContent = "—";
    $("costStat").textContent = "—";
    $("rateStat").textContent = "—";
    el.innerHTML = '<p class="loading">No data (chain may be too thin for this width)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(box.k1, 0)} / ${qFmt(box.k2, 0)}`;
  $("costStat").textContent = `$${qFmt(box.boxCost, 0)} → pays $${qFmt(box.payout, 0)}`;
  $("rateStat").textContent = box.impliedRate != null ? `${qFmtSigned(box.impliedRate, 2)}%` : "—";

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Call spread cost (buy K1, sell K2)</span><span class="scanner-value">$${qFmt(box.callSpreadCost, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Put spread cost (buy K2, sell K1)</span><span class="scanner-value">$${qFmt(box.putSpreadCost, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Total box cost</span><span class="scanner-value">$${qFmt(box.boxCost, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Guaranteed payout at expiry</span><span class="scanner-value">$${qFmt(box.payout, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Interpretation</span><span class="scanner-value">${box.impliedRate != null && box.impliedRate >= 0 ? "Paying less than the guaranteed payout — like lending at " + qFmt(box.impliedRate, 2) + "% annualized" : "Paying more than the guaranteed payout — an unusual/negative-rate reading"}</span></div>
    </div>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const widthPct = Number($("widthSelect").value);
    const box = computeBox(widthPct);
    renderBox(box);
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
