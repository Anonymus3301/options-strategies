// Scenario Analysis (Subjective Probabilities) — standalone, REST-only.
// Every POP/VaR/CVaR stat on this site uses the risk-neutral lognormal distribution
// implied by quoted IV — a pricing convention, not a claim about anyone's actual view.
// This tool inverts that: for the same up-to-4-leg combination as the Strategy Builder,
// the user supplies their OWN probabilities for 5 fixed price-move scenarios, and the
// tool computes the expected P&L under that explicitly subjective view instead.

const CURRENCY = "BTC";
const MAX_LEGS = 4;
const SCENARIOS = [-0.20, -0.10, 0, 0.10, 0.20];

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
    if (!sum || sum.mark_price == null) continue;
    legs.push({ type, side, strike, premiumUsd: sum.mark_price * spot, qty });
  }
  return { spot, legs };
}

function renderScenarioRows() {
  const tbody = document.querySelector("#scenarioTable tbody");
  tbody.innerHTML = SCENARIOS.map(
    (m, i) => `
    <tr>
      <td>${qFmtSigned(m * 100, 0)}%</td>
      <td id="priceCell${i}">—</td>
      <td id="pnlCell${i}">—</td>
      <td><input id="probInput${i}" type="number" min="0" max="100" step="any" value="${i === 2 ? 40 : i === 1 || i === 3 ? 22 : 8}" style="width: 64px; font: inherit; background: var(--panel-alt); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px;" /></td>
    </tr>`
  ).join("");
  for (let i = 0; i < SCENARIOS.length; i++) {
    $(`probInput${i}`).addEventListener("input", render);
  }
}

function render() {
  const { spot, legs } = collectLegs();
  if (!legs.length || spot == null) {
    $("probSumStat").textContent = "—";
    $("expectedPnlStat").textContent = "—";
    $("bestCaseStat").textContent = "—";
    $("worstCaseStat").textContent = "—";
    return;
  }

  let probSum = 0;
  const rows = SCENARIOS.map((m, i) => {
    const S = spot * (1 + m);
    const pnl = qLegsPnlAt(legs, S);
    const prob = Math.max(0, Number($(`probInput${i}`).value) || 0);
    probSum += prob;
    $(`priceCell${i}`).textContent = qFmt(S, 0);
    $(`pnlCell${i}`).textContent = qFmtSigned(pnl, 0);
    return { prob, pnl };
  });

  $("probSumStat").textContent = `${qFmt(probSum, 0)}%` + (Math.abs(probSum - 100) > 0.5 ? " (should sum to 100%)" : "");

  if (probSum > 0) {
    const expectedPnl = rows.reduce((sum, r) => sum + (r.prob / probSum) * r.pnl, 0);
    $("expectedPnlStat").textContent = qFmtSigned(expectedPnl, 0);
  } else {
    $("expectedPnlStat").textContent = "—";
  }
  const pnls = rows.map((r) => r.pnl);
  $("bestCaseStat").textContent = qFmtSigned(Math.max(...pnls), 0);
  $("worstCaseStat").textContent = qFmtSigned(Math.min(...pnls), 0);
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
    render();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

renderScenarioRows();

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderLegStrikeOptions();
  render();
});

for (let i = 1; i <= MAX_LEGS; i++) {
  for (const id of [`leg${i}Enable`, `leg${i}Type`, `leg${i}Side`, `leg${i}Strike`, `leg${i}Qty`]) {
    $(id).addEventListener("change", render);
  }
}

refresh();
setInterval(refresh, 30000);
