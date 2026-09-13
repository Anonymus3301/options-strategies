// Synthetic Equivalents Explorer — standalone, REST-only.
// Put-call parity (C - P = S - K at r=0) means every one of the 6 basic positions (long/
// short stock, long/short call, long/short put) has an exact synthetic equivalent built
// from the other two. The Box Spread and Synthetic Forward pages already use this
// identity to hunt for arbitrage; this tool reframes the same math pedagogically —
// "what combination replicates X" — with a live parity check proving the two sides price
// consistently on the current chain.

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

function renderStrikeSelect() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return;
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const sel = $("strikeSelect");
  const prev = sel.value;
  sel.innerHTML = strikes.map((s) => `<option value="${s}">${qFmt(s, 0)}</option>`).join("");
  if (strikes.includes(Number(prev))) sel.value = prev;
}

// Each entry: the direct position's own price (using stock=spot convention already used
// elsewhere on this site for Protective Put/Collar/Covered Put), and its synthetic build.
const RECIPES = {
  long_call: {
    label: "Long Call",
    directPrice: (spot, K, C, P) => C,
    synthesis: (spot, K, C, P) => ({ text: "Long Stock + Long Put", price: spot - K + P }),
  },
  short_call: {
    label: "Short Call",
    directPrice: (spot, K, C, P) => -C,
    synthesis: (spot, K, C, P) => ({ text: "Short Stock + Short Put", price: -(spot - K) - P }),
  },
  long_put: {
    label: "Long Put",
    directPrice: (spot, K, C, P) => P,
    synthesis: (spot, K, C, P) => ({ text: "Short Stock + Long Call", price: -(spot - K) + C }),
  },
  short_put: {
    label: "Short Put",
    directPrice: (spot, K, C, P) => -P,
    synthesis: (spot, K, C, P) => ({ text: "Long Stock + Short Call", price: (spot - K) - C }),
  },
  long_stock: {
    label: "Long Stock (synthetic forward)",
    directPrice: (spot, K, C, P) => spot - K,
    synthesis: (spot, K, C, P) => ({ text: "Long Call + Short Put", price: C - P }),
  },
  short_stock: {
    label: "Short Stock (synthetic forward)",
    directPrice: (spot, K, C, P) => -(spot - K),
    synthesis: (spot, K, C, P) => ({ text: "Short Call + Long Put", price: -C + P }),
  },
};

function render() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  const el = $("resultBody");
  if (!bucket) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const spot = qImpliedSpot(bucket, state.summaries);
  const K = Number($("strikeSelect").value);
  const call = state.summaries.get(bucket.calls.get(K));
  const put = state.summaries.get(bucket.puts.get(K));
  if (spot == null || !call || !put || call.mark_price == null || put.mark_price == null) {
    el.innerHTML = '<p class="loading">No data for this strike</p>';
    return;
  }
  const C = call.mark_price * spot;
  const P = put.mark_price * spot;
  const recipe = RECIPES[$("baseSelect").value];
  const direct = recipe.directPrice(spot, K, C, P);
  const synth = recipe.synthesis(spot, K, C, P);
  const gap = direct - synth.price;

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Direct position</span><span class="scanner-value">${recipe.label} at strike ${qFmt(K, 0)} — value ${qFmtSigned(direct, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Synthetic equivalent</span><span class="scanner-value">${synth.text} — value ${qFmtSigned(synth.price, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Parity check (should be ≈ 0)</span><span class="scanner-value">${qFmtSigned(gap, 2)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Call / Put used</span><span class="scanner-value">$${qFmt(C, 0)} / $${qFmt(P, 0)} (mark)</span></div>
    </div>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    renderStrikeSelect();
    const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
    const spot = bucket ? qImpliedSpot(bucket, state.summaries) : null;
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderStrikeSelect();
  render();
});
$("strikeSelect").addEventListener("change", render);
$("baseSelect").addEventListener("change", render);

refresh();
setInterval(refresh, 30000);
