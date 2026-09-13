// Vanna & Charm (Second-Order Greeks) — standalone, REST-only.
// The Portfolio Greeks Dashboard shows net delta/gamma/vega/theta; the P&L Attribution
// tool Taylor-expands delta+gamma+theta against an assumed move. Neither shows how the
// position's OWN delta-hedge ratio drifts for reasons other than price moving: Vanna
// (how much delta changes per unit of IV change) and Charm (how much delta decays from
// time alone, price and IV both held fixed) are exactly that, and nothing else on this
// site computes either one. Formulas use this site's r=0, q=0 Black-Scholes convention
// (matching every other Greek already in quant.js) and were verified against a finite-
// difference numerical derivative of quant.js's own qBsDelta before shipping.

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

// Vanna = d(Delta)/d(sigma) = d(Vega)/d(S); Charm = d(Delta)/d(calendar time), i.e. how
// delta decays as T shrinks with price/IV held fixed. Both use r=0, q=0 (this site's
// standing convention) and are identical for a call and put at the same strike/expiry --
// a direct consequence of put-call parity under r=0, verified numerically before shipping.
function bsVanna(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return (-qNormPdf(d1) * d2) / sigma;
}

function bsCharmPerDay(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const perYear = (qNormPdf(d1) * d2) / (2 * T);
  return perYear / 365.25;
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
    legs.push({ type, side, strike, qty, iv: sum.mark_iv });
  }
  return { spot, legs };
}

function render() {
  const { spot, legs } = collectLegs();
  if (!legs.length || spot == null || !state.selectedExpiry) {
    $("netVannaStat").textContent = "—";
    $("netCharmStat").textContent = "—";
    $("deltaPerVolStat").textContent = "—";
    $("deltaPerDayStat").textContent = "—";
    return;
  }

  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  let netVanna = 0,
    netCharmPerDay = 0;
  for (const leg of legs) {
    const sign = leg.side === "long" ? 1 : -1;
    const sigma = leg.iv / 100;
    netVanna += sign * leg.qty * bsVanna(spot, leg.strike, T, sigma);
    netCharmPerDay += sign * leg.qty * bsCharmPerDay(spot, leg.strike, T, sigma);
  }

  $("netVannaStat").textContent = qFmtSigned(netVanna, 3);
  $("netCharmStat").textContent = qFmtSigned(netCharmPerDay, 4);
  $("deltaPerVolStat").textContent = qFmtSigned(netVanna * 0.01, 4);
  $("deltaPerDayStat").textContent = qFmtSigned(netCharmPerDay, 4);
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
