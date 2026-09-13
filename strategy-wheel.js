// The Wheel Strategy page — standalone, REST-only.
// A systematic income cycle: sell a cash-secured put; if it would be assigned, you now own
// BTC at (strike − premium); sell covered calls against that position; if called away,
// start over. This page can only observe the *current* live chain, so it illustrates one
// full cycle rather than tracking a real position: Phase 1 finds the best-yield CSP right
// now (reusing the Income Scanner's exact delta-band/annualized-yield methodology so the
// two pages agree), then Phase 2 shows what a covered call sold *after* hypothetical
// assignment at that strike would look like, using the next expiry after the CSP's and
// requiring the call strike sit at or above the assumed cost basis (no built-in loss if
// called away). Everything past Phase 1 is explicitly disclosed as hypothetical.

const CURRENCY = "BTC";
const TOP_N = 10;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function scanPuts(instrumentsByExpiry, summaries, deltaMin, deltaMax) {
  const puts = [];
  const now = Date.now();
  for (const [expiry, bucket] of instrumentsByExpiry) {
    const dte = (expiry - now) / (24 * 60 * 60 * 1000);
    if (dte <= 0) continue;
    const T = dte / 365.25;
    const spot = qImpliedSpot(bucket, summaries);
    if (spot == null) continue;
    for (const [strike, name] of bucket.puts) {
      const sum = summaries.get(name);
      if (!sum || sum.mark_price == null || sum.mark_iv == null || strike >= spot) continue;
      const sigma = sum.mark_iv / 100;
      const delta = qBsDelta("put", spot, strike, T, sigma);
      if (Math.abs(delta) < deltaMin || Math.abs(delta) > deltaMax) continue;
      const premiumUsd = sum.mark_price * spot;
      const annualizedYield = (premiumUsd / strike / T) * 100;
      puts.push({ expiry, dte, strike, iv: sum.mark_iv, delta, premiumUsd, annualizedYield, spot });
    }
  }
  puts.sort((a, b) => b.annualizedYield - a.annualizedYield);
  return puts;
}

function scanCallsForCycle(bucket, summaries, expiry, costBasis, deltaMin, deltaMax) {
  const now = Date.now();
  const dte = (expiry - now) / (24 * 60 * 60 * 1000);
  if (dte <= 0) return [];
  const T = dte / 365.25;
  const spot = qImpliedSpot(bucket, summaries);
  if (spot == null) return [];
  const calls = [];
  for (const [strike, name] of bucket.calls) {
    if (strike < costBasis) continue; // avoid a built-in loss if called away
    const sum = summaries.get(name);
    if (!sum || sum.mark_price == null || sum.mark_iv == null || strike <= spot) continue;
    const sigma = sum.mark_iv / 100;
    const delta = qBsDelta("call", spot, strike, T, sigma);
    if (delta < deltaMin || delta > deltaMax) continue;
    const premiumUsd = sum.mark_price * spot;
    const annualizedYield = (premiumUsd / costBasis / T) * 100;
    calls.push({ expiry, dte, strike, iv: sum.mark_iv, delta, premiumUsd, annualizedYield, spot });
  }
  calls.sort((a, b) => b.annualizedYield - a.annualizedYield);
  return calls;
}

function renderTable(id, rows, colspan) {
  const tbody = document.querySelector(`#${id} tbody`);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading">No strikes qualify right now</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r, i) => `
    <tr>
      <td>${qExpiryLabel(r.expiry)}</td>
      <td>${qFmt(r.dte, 0)}d</td>
      <td>${qFmt(r.strike, 0)}</td>
      <td>${qFmt(r.iv, 1)}%</td>
      <td>${qFmt(Math.abs(r.delta), 2)}</td>
      <td>$${qFmt(r.premiumUsd, 0)}</td>
      <td class="${i === 0 ? "best" : ""}">${qFmt(r.annualizedYield, 1)}%</td>
    </tr>`
    )
    .join("");
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [instruments, summaries] = await Promise.all([
      qFetchInstruments(CURRENCY, "option", false),
      qFetchBookSummary(CURRENCY, "option"),
    ]);
    const instrumentsByExpiry = qGroupByExpiry(instruments);
    const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
    const expiries = [...instrumentsByExpiry.keys()].sort((a, b) => a - b);

    const [deltaMin, deltaMax] = $("deltaBandSelect").value.split(",").map(Number);
    const puts = scanPuts(instrumentsByExpiry, summaryMap, deltaMin, deltaMax);

    let anySpot = null;
    for (const bucket of instrumentsByExpiry.values()) {
      const s = qImpliedSpot(bucket, summaryMap);
      if (s != null) {
        anySpot = s;
        break;
      }
    }
    $("spotStat").textContent = anySpot != null ? "$" + qFmt(anySpot, 0) : "—";

    renderTable("cspTable", puts.slice(0, TOP_N), 7);

    const primaryPut = puts[0];
    if (!primaryPut) {
      $("cspSummaryStat").textContent = "—";
      $("costBasisStat").textContent = "—";
      $("callSummaryStat").textContent = "—";
      $("combinedYieldStat").textContent = "—";
      $("cycleNote").textContent = "No qualifying cash-secured put found in this delta band right now.";
      renderTable("callTable", [], 7);
      setStatus("live", "pill-live");
      return;
    }

    $("cspSummaryStat").textContent =
      `${qFmt(primaryPut.strike, 0)} strike, ${qExpiryLabel(primaryPut.expiry)}, ${qFmt(primaryPut.annualizedYield, 1)}% ann.`;

    const costBasis = primaryPut.strike - primaryPut.premiumUsd;
    $("costBasisStat").textContent = `$${qFmt(costBasis, 0)}`;

    const nextExpiryIdx = expiries.findIndex((e) => e === primaryPut.expiry) + 1;
    const cycleExpiry = nextExpiryIdx < expiries.length ? expiries[nextExpiryIdx] : primaryPut.expiry;
    const usedSameExpiry = cycleExpiry === primaryPut.expiry;
    const cycleBucket = instrumentsByExpiry.get(cycleExpiry);

    const calls = scanCallsForCycle(cycleBucket, summaryMap, cycleExpiry, costBasis, deltaMin, deltaMax);
    renderTable("callTable", calls.slice(0, TOP_N), 7);

    const primaryCall = calls[0];
    if (primaryCall) {
      $("callSummaryStat").textContent =
        `${qFmt(primaryCall.strike, 0)} strike, ${qExpiryLabel(primaryCall.expiry)}, ${qFmt(primaryCall.annualizedYield, 1)}% ann.`;
      const combined = (primaryPut.annualizedYield + primaryCall.annualizedYield) / 2;
      $("combinedYieldStat").textContent = `${qFmt(combined, 1)}%`;
    } else {
      $("callSummaryStat").textContent = "no qualifying strike";
      $("combinedYieldStat").textContent = "—";
    }

    $("cycleNote").textContent = usedSameExpiry
      ? "No later expiry is currently listed, so Phase 2 illustrates a covered call at the same expiry as the CSP — treat this cycle as purely conceptual."
      : "Phase 2 uses the next listed expiry after the CSP's, as if assignment happened at the CSP's expiry and the covered call were sold immediately after.";

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("deltaBandSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
