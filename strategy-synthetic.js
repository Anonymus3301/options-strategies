// Synthetic Forward (conversion/reversal) strategy page — standalone, REST-only.
// Long call + short put at the same strike replicates a long forward. Compares that
// options-implied forward (via put-call parity) against the actual dated future's mark
// price for the nearest-matching expiry — a different cross-check than the Carry &
// Funding page, which compares dated futures against the perpetual instead.

const CURRENCY = "BTC";

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  selectedExpiry: null,
  summaries: new Map(),
  futures: [],
};

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function loadData() {
  const [optInstruments, optSummaries, futInstruments, futSummaries] = await Promise.all([
    qFetchInstruments(CURRENCY, "option", false),
    qFetchBookSummary(CURRENCY, "option"),
    qFetchInstruments(CURRENCY, "future", false),
    qFetchBookSummary(CURRENCY, "future"),
  ]);
  state.instrumentsByExpiry = qGroupByExpiry(optInstruments);
  state.expiries = [...state.instrumentsByExpiry.keys()].sort((a, b) => a - b);
  state.summaries = new Map(optSummaries.map((s) => [s.instrument_name, s]));
  if (!state.selectedExpiry || !state.instrumentsByExpiry.has(state.selectedExpiry)) {
    state.selectedExpiry = state.expiries[0] ?? null;
  }
  const futSummaryMap = new Map(futSummaries.map((s) => [s.instrument_name, s]));
  state.futures = futInstruments
    .filter((i) => i.settlement_period !== "perpetual")
    .map((i) => ({
      name: i.instrument_name,
      expiry: i.expiration_timestamp,
      mark: (futSummaryMap.get(i.instrument_name) || {}).mark_price,
    }))
    .filter((f) => f.mark != null);
}

function renderExpirySelect() {
  const sel = $("expirySelect");
  sel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.selectedExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  sel.disabled = false;
}

function findMatchingFuture(expiryTs) {
  const exact = state.futures.find((f) => f.expiry === expiryTs);
  if (exact) return { future: exact, exact: true };
  if (!state.futures.length) return null;
  const nearest = state.futures.reduce((best, f) =>
    Math.abs(f.expiry - expiryTs) < Math.abs(best.expiry - expiryTs) ? f : best
  );
  return { future: nearest, exact: false };
}

function computeSynthetic() {
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
  const syntheticForward = atm + (callUsd - putUsd); // put-call parity: S = K + (C - P) at r=0

  const match = findMatchingFuture(state.selectedExpiry);
  if (!match) return { spot, atm, callUsd, putUsd, syntheticForward };

  const divergence = match.future.mark - syntheticForward;
  return { spot, atm, callUsd, putUsd, syntheticForward, match, divergence };
}

function renderSynthetic(syn) {
  $("spotStat").textContent = syn && syn.spot != null ? "$" + qFmt(syn.spot, 0) : "—";
  $("syntheticStat").textContent = syn && syn.syntheticForward != null ? "$" + qFmt(syn.syntheticForward, 0) : "—";

  const el = $("structureInfo");
  if (!syn || syn.syntheticForward == null) {
    $("actualStat").textContent = "—";
    $("divergenceStat").textContent = "—";
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }

  if (!syn.match) {
    $("actualStat").textContent = "No dated futures found";
    $("divergenceStat").textContent = "—";
    el.innerHTML = `
      <div class="scanner-rows">
        <div class="scanner-row"><span class="scanner-label">ATM strike</span><span class="scanner-value">${qFmt(syn.atm, 0)}</span></div>
        <div class="scanner-row"><span class="scanner-label">Long call / short put premium</span><span class="scanner-value">$${qFmt(syn.callUsd, 0)} / $${qFmt(syn.putUsd, 0)}</span></div>
      </div>
      <p class="loading">No dated futures available to compare against this expiry.</p>`;
    return;
  }

  const { future, exact } = syn.match;
  $("actualStat").textContent = `$${qFmt(future.mark, 0)} (${future.name}${exact ? "" : ", nearest — not exact match"})`;
  $("divergenceStat").textContent = `${qFmtSigned(syn.divergence, 0)}`;

  const structure =
    syn.divergence > 0
      ? `Future rich vs. synthetic → Conversion: sell ${future.name}, buy synthetic forward (long ${qFmt(syn.atm, 0)} call, short ${qFmt(syn.atm, 0)} put)`
      : syn.divergence < 0
      ? `Future cheap vs. synthetic → Reversal: buy ${future.name}, sell synthetic forward (short ${qFmt(syn.atm, 0)} call, long ${qFmt(syn.atm, 0)} put)`
      : "No divergence";

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">ATM strike</span><span class="scanner-value">${qFmt(syn.atm, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Long call / short put premium</span><span class="scanner-value">$${qFmt(syn.callUsd, 0)} / $${qFmt(syn.putUsd, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Matching future</span><span class="scanner-value">${future.name}${exact ? " (exact expiry match)" : " (nearest, expiries differ)"}</span></div>
      <div class="scanner-row"><span class="scanner-label">Structure</span><span class="scanner-value">${structure}</span></div>
    </div>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadData();
    renderExpirySelect();
    const syn = computeSynthetic();
    renderSynthetic(syn);
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
