// Put Ladder (Christmas Tree) strategy page — standalone, REST-only.
// Buy 1 near-ATM put (K1), sell 1 further-OTM put (K2), sell 1 even further-OTM put (K3).
// The bearish mirror of the Call Ladder page: a cheaper bear put spread that loses its
// floor below K3, down toward BTC's price floor at zero.

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

function computeLadder(innerPct, outerPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...bucket.puts.keys()].sort((a, b) => a - b);

  const k1 = qClosestStrike(strikes, spot);
  if (k1 == null) return { spot };
  const innerWidth = spot * (innerPct / 100);
  const outerWidth = spot * (outerPct / 100);
  const k2Candidates = strikes.filter((s) => s < k1);
  const k2 = k2Candidates.length ? qClosestStrike(k2Candidates, k1 - innerWidth) : null;
  if (k2 == null) return { spot, k1 };
  const k3Candidates = strikes.filter((s) => s < k2);
  const k3 = k3Candidates.length ? qClosestStrike(k3Candidates, k2 - outerWidth) : null;
  if (k3 == null) return { spot, k1, k2 };

  const put1 = state.summaries.get(bucket.puts.get(k1));
  const put2 = state.summaries.get(bucket.puts.get(k2));
  const put3 = state.summaries.get(bucket.puts.get(k3));
  if (!put1 || !put2 || !put3 || put1.mark_price == null || put2.mark_price == null || put3.mark_price == null) {
    return { spot, k1, k2, k3 };
  }

  const usd1 = put1.mark_price * spot;
  const usd2 = put2.mark_price * spot;
  const usd3 = put3.mark_price * spot;
  const netCost = usd1 - usd2 - usd3; // positive = net debit, negative = net credit
  const maxProfit = (k1 - k2) - netCost;
  const upperBreakeven = netCost > 0 ? k1 - netCost : null;
  const lowerBreakeven = k2 + k3 - k1 + netCost;
  const ivs = [put1.mark_iv, put2.mark_iv, put3.mark_iv].filter((v) => v != null);
  const avgIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, k1, k2, k3, usd1, usd2, usd3, netCost, maxProfit, upperBreakeven, lowerBreakeven, avgIv };
}

function renderLadder(l) {
  $("ladderExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const chartEl = $("payoffChart");
  $("spotStat").textContent = l && l.spot != null ? "$" + qFmt(l.spot, 0) : "—";

  if (!l || l.netCost == null) {
    $("strikesStat").textContent = "—";
    $("costStat").textContent = "—";
    $("maxProfitStat").textContent = "—";
    $("breakevenStat").textContent = "—";
    chartEl.innerHTML = '<p class="loading">No data (chain may be too thin for these widths)</p>';
    if ($("popStat")) $("popStat").textContent = "—";
    return;
  }

  $("strikesStat").textContent = `${qFmt(l.k1, 0)} / ${qFmt(l.k2, 0)} / ${qFmt(l.k3, 0)}`;
  $("costStat").textContent = l.netCost >= 0 ? `debit $${qFmt(l.netCost, 0)}` : `credit $${qFmt(-l.netCost, 0)}`;
  $("maxProfitStat").textContent = `+$${qFmt(l.maxProfit, 0)}`;
  $("breakevenStat").textContent =
    l.upperBreakeven != null
      ? `${qFmt(l.upperBreakeven, 0)} / ${qFmt(l.lowerBreakeven, 0)} (severe loss below)`
      : `None above K2 (net credit) / ${qFmt(l.lowerBreakeven, 0)} (severe loss below)`;

  const legs = [
    { type: "put", side: "long", strike: l.k1, premiumUsd: l.usd1 },
    { type: "put", side: "short", strike: l.k2, premiumUsd: l.usd2 },
    { type: "put", side: "short", strike: l.k3, premiumUsd: l.usd3 },
  ];
  chartEl.innerHTML = qBuildPayoffSvg(legs, l.spot, { width: 700 });

  if ($("popStat")) {
    let pop = null;
    if (l.avgIv != null && state.selectedExpiry) {
      const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
      pop = qComputeProbabilityOfProfit(legs, l.spot, l.avgIv / 100, T);
    }
    $("popStat").textContent = pop != null ? qFmt(pop, 0) + "%" : "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const innerPct = Number($("innerSelect").value);
    const outerPct = Number($("outerSelect").value);
    const l = computeLadder(innerPct, outerPct);
    renderLadder(l);
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
$("innerSelect").addEventListener("change", refresh);
$("outerSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
