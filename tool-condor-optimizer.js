// Defined-Risk Structure Optimizer (Iron Condor) — standalone, REST-only.
// The existing Iron Condor page commits to one short-strike delta (20Δ) and shows that
// single structure. This tool scans a whole range of short-strike deltas at a selectable
// wing width and ranks every candidate by net credit, max loss, reward:risk, and live
// POP side by side — letting a visitor see the actual tradeoff curve (tighter deltas =
// more credit but lower POP; wider deltas = less credit but higher POP) instead of
// evaluating one fixed choice at a time.

const CURRENCY = "BTC";
const DELTA_TARGETS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];

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

function findDeltaStrike(strikes, bucket, type, targetDelta, spot, T) {
  let best = null, bestDiff = Infinity;
  for (const strike of strikes) {
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? state.summaries.get(name) : null;
    if (!sum || sum.mark_iv == null) continue;
    const delta = qBsDelta(type, spot, strike, T, sum.mark_iv / 100);
    const diff = Math.abs(Math.abs(delta) - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike, delta, iv: sum.mark_iv, mark: sum.mark_price };
    }
  }
  return best;
}

function computeCandidates(wingPct) {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return { spot: null, rows: [] };
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot, rows: [] };
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const wingWidth = spot * (wingPct / 100);

  const rows = [];
  for (const targetDelta of DELTA_TARGETS) {
    const shortCall = findDeltaStrike(strikes.filter((s) => s > spot), bucket, "call", targetDelta, spot, T);
    const shortPut = findDeltaStrike(strikes.filter((s) => s < spot), bucket, "put", targetDelta, spot, T);
    if (!shortCall || !shortPut) continue;
    const longCallStrike = qClosestStrike(strikes, shortCall.strike + wingWidth);
    const longPutStrike = qClosestStrike(strikes, shortPut.strike - wingWidth);
    const longCall = state.summaries.get(bucket.calls.get(longCallStrike));
    const longPut = state.summaries.get(bucket.puts.get(longPutStrike));
    if (!longCall || !longPut || longCall.mark_price == null || longPut.mark_price == null) continue;

    const legs = [
      { type: "call", side: "short", strike: shortCall.strike, premiumUsd: shortCall.mark * spot },
      { type: "call", side: "long", strike: longCallStrike, premiumUsd: longCall.mark_price * spot },
      { type: "put", side: "short", strike: shortPut.strike, premiumUsd: shortPut.mark * spot },
      { type: "put", side: "long", strike: longPutStrike, premiumUsd: longPut.mark_price * spot },
    ];
    const netCredit = legs.reduce((sum, l) => sum + (l.side === "short" ? l.premiumUsd : -l.premiumUsd), 0);
    // Max loss is the WORSE of the two sides' caps, not the narrower wing — a snapped-strike
    // asymmetric condor's true worst case is set by whichever wing is wider, since that side
    // needs a bigger move to cap out but caps at a bigger loss once it does. Verified
    // numerically: Math.min here would understate the real max loss on an asymmetric condor.
    const callWingWidth = longCallStrike - shortCall.strike;
    const putWingWidth = shortPut.strike - longPutStrike;
    const maxLoss = Math.max(callWingWidth, putWingWidth) - netCredit;
    const avgIv = (shortCall.iv + shortPut.iv + longCall.mark_iv + longPut.mark_iv) / 4;
    const pop = qComputeProbabilityOfProfit(legs, spot, avgIv / 100, T);

    rows.push({
      targetDelta,
      shortCallStrike: shortCall.strike,
      shortPutStrike: shortPut.strike,
      longCallStrike,
      longPutStrike,
      netCredit,
      maxLoss,
      rewardRisk: maxLoss > 0 ? netCredit / maxLoss : null,
      pop,
    });
  }
  return { spot, rows };
}

function renderTable(rows) {
  const tbody = document.querySelector("#optTable tbody");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No candidates found for this expiry/width</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${qFmt(r.targetDelta * 100, 0)}Δ</td>
      <td>${qFmt(r.shortPutStrike, 0)} / ${qFmt(r.shortCallStrike, 0)}</td>
      <td>${qFmt(r.longPutStrike, 0)} / ${qFmt(r.longCallStrike, 0)}</td>
      <td>$${qFmt(r.netCredit, 0)}</td>
      <td>$${qFmt(r.maxLoss, 0)}</td>
      <td>${r.rewardRisk != null ? qFmt(r.rewardRisk, 2) : "—"}</td>
      <td>${r.pop != null ? qFmt(r.pop, 0) + "%" : "—"}</td>
    </tr>`
    )
    .join("");
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const wingPct = Number($("wingSelect").value);
    const { spot, rows } = computeCandidates(wingPct);
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    renderTable(rows);
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
$("wingSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
