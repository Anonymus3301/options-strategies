// Execution Slippage Calculator — standalone, REST-only.
// The Liquidity Explorer shows bid-ask spread % per strike in isolation. Every multi-leg
// tool here (Strategy Builder, Scenario Analysis, VaR Calculator, Portfolio Greeks) prices
// legs off the theoretical mark, which is exactly what a real order can never guarantee —
// buying crosses the ask, selling crosses the bid. This computes the same up-to-4-leg
// combination's net cost twice: once at mark (the theoretical price every other tool
// uses) and once at the realistic bid/ask a market order would actually cross, then
// reports the gap in dollars and as a % of the mark-priced cost.

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
    if (!sum || sum.mark_price == null) continue;
    const hasQuotes = sum.bid_price != null && sum.ask_price != null && sum.bid_price > 0 && sum.ask_price > 0;
    legs.push({
      type,
      side,
      strike,
      qty,
      markUsd: sum.mark_price * spot,
      bidUsd: hasQuotes ? sum.bid_price * spot : null,
      askUsd: hasQuotes ? sum.ask_price * spot : null,
    });
  }
  return { spot, legs };
}

function render() {
  const { legs } = collectLegs();
  const tbody = document.querySelector("#legsDetailTable tbody");

  if (!legs.length) {
    $("markCostStat").textContent = "—";
    $("realCostStat").textContent = "—";
    $("slippageStat").textContent = "—";
    $("slippagePctStat").textContent = "—";
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Enable at least one leg</td></tr>';
    return;
  }

  let markCost = 0;
  let realCost = 0;
  let anyMissingQuotes = false;
  const rows = legs.map((leg) => {
    const sign = leg.side === "long" ? 1 : -1;
    markCost += sign * leg.qty * leg.markUsd;
    let realUsd = leg.markUsd;
    if (leg.bidUsd != null && leg.askUsd != null) {
      // Buying crosses the ask; selling crosses the bid -- the worse side either way.
      realUsd = leg.side === "long" ? leg.askUsd : leg.bidUsd;
    } else {
      anyMissingQuotes = true;
    }
    realCost += sign * leg.qty * realUsd;
    const spreadPct = leg.bidUsd != null && leg.askUsd != null ? ((leg.askUsd - leg.bidUsd) / leg.markUsd) * 100 : null;
    return { leg, realUsd, spreadPct };
  });

  tbody.innerHTML = rows
    .map(
      ({ leg, realUsd, spreadPct }) => `
    <tr>
      <td>${leg.side} ${qFmt(leg.strike, 0)} ${leg.type}</td>
      <td>$${qFmt(leg.markUsd, 0)}</td>
      <td>$${qFmt(realUsd, 0)}</td>
      <td>${spreadPct != null ? qFmt(spreadPct, 1) + "%" : "no quotes"}</td>
      <td>${leg.qty}</td>
    </tr>`
    )
    .join("");

  $("markCostStat").textContent = markCost >= 0 ? `debit $${qFmt(markCost, 0)}` : `credit $${qFmt(-markCost, 0)}`;
  $("realCostStat").textContent = realCost >= 0 ? `debit $${qFmt(realCost, 0)}` : `credit $${qFmt(-realCost, 0)}`;

  const slippage = realCost - markCost; // extra debit (or lost credit) from crossing the spread
  $("slippageStat").textContent = qFmtSigned(slippage, 0) + (anyMissingQuotes ? " (some legs had no bid/ask)" : "");
  const denom = Math.abs(markCost);
  $("slippagePctStat").textContent = denom > 0.01 ? qFmtSigned((slippage / denom) * 100, 1) + "%" : "—";
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
