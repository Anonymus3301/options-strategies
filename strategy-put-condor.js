// Put Condor Spread strategy page — standalone, REST-only.
// Buy 1 put at K1, sell 1 put at K2, sell 1 put at K3, buy 1 put at K4 — the same four
// strikes as the Call Condor page, verified numerically to produce an identical payoff.

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

function computeCondor(bodyPct, wingPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...bucket.puts.keys()].sort((a, b) => a - b);

  const bodyHalf = spot * (bodyPct / 100);
  const wing = spot * (wingPct / 100);
  const k2Target = spot - bodyHalf, k3Target = spot + bodyHalf;
  const k2Candidates = strikes.filter((s) => s < spot);
  const k3Candidates = strikes.filter((s) => s > spot);
  const k2 = k2Candidates.length ? qClosestStrike(k2Candidates, k2Target) : null;
  const k3 = k3Candidates.length ? qClosestStrike(k3Candidates, k3Target) : null;
  if (k2 == null || k3 == null) return { spot };

  const k1Candidates = strikes.filter((s) => s < k2);
  const k4Candidates = strikes.filter((s) => s > k3);
  const k1 = k1Candidates.length ? qClosestStrike(k1Candidates, k2 - wing) : null;
  const k4 = k4Candidates.length ? qClosestStrike(k4Candidates, k3 + wing) : null;
  if (k1 == null || k4 == null) return { spot, k2, k3 };

  const put1 = state.summaries.get(bucket.puts.get(k1));
  const put2 = state.summaries.get(bucket.puts.get(k2));
  const put3 = state.summaries.get(bucket.puts.get(k3));
  const put4 = state.summaries.get(bucket.puts.get(k4));
  if (
    !put1 || !put2 || !put3 || !put4 ||
    put1.mark_price == null || put2.mark_price == null || put3.mark_price == null || put4.mark_price == null
  ) {
    return { spot, k1, k2, k3, k4 };
  }

  const usd1 = put1.mark_price * spot, usd2 = put2.mark_price * spot;
  const usd3 = put3.mark_price * spot, usd4 = put4.mark_price * spot;
  const legs = [
    { type: "put", side: "long", strike: k1, premiumUsd: usd1 },
    { type: "put", side: "short", strike: k2, premiumUsd: usd2 },
    { type: "put", side: "short", strike: k3, premiumUsd: usd3 },
    { type: "put", side: "long", strike: k4, premiumUsd: usd4 },
  ];
  const netDebit = usd1 + usd4 - usd2 - usd3;
  const maxProfit = qLegsPnlAt(legs, (k2 + k3) / 2);
  const ivs = [put2.mark_iv, put3.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return {
    spot, k1, k2, k3, k4, legs, netDebit, maxProfit, avgIv,
    breakevenLow: k1 + netDebit, breakevenHigh: k4 - netDebit,
  };
}

function render(c) {
  $("condorExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = c && c.spot != null ? "$" + qFmt(c.spot, 0) : "—";

  if (!c || c.netDebit == null) {
    $("strikesStat").textContent = "—";
    $("debitStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    $("popStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for these widths)</p>';
    return;
  }

  $("strikesStat").textContent = `${qFmt(c.k1, 0)} / ${qFmt(c.k2, 0)} / ${qFmt(c.k3, 0)} / ${qFmt(c.k4, 0)}`;
  $("debitStat").textContent = `$${qFmt(c.netDebit, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(c.maxProfit, 0)}`;
  $("breakevenStat").textContent = `${qFmt(c.breakevenLow, 0)} — ${qFmt(c.breakevenHigh, 0)}`;

  chartEl.innerHTML = qBuildPayoffSvg(c.legs, c.spot, { width: 700 });

  let pop = null;
  if (c.avgIv != null && state.selectedExpiry) {
    const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
    pop = qComputeProbabilityOfProfit(c.legs, c.spot, c.avgIv / 100, T);
  }
  $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const bodyPct = Number($("bodySelect").value);
    const wingPct = Number($("wingSelect").value);
    const c = computeCondor(bodyPct, wingPct);
    render(c);
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
$("bodySelect").addEventListener("change", refresh);
$("wingSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
