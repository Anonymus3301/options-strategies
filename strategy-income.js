// Covered Call / Cash-Secured Put income scanner — standalone, REST-only.
// Scans every live expiry's chain for OTM strikes whose Black-Scholes delta (computed
// from each strike's own quoted mark IV, no live greeks needed) falls in the selected
// band, ranks by annualized premium yield, and shows the top opportunities per side.

const CURRENCY = "BTC";
const TOP_N = 15;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function scanChain(instrumentsByExpiry, summaries, deltaMin, deltaMax) {
  const calls = [], puts = [];
  const now = Date.now();
  for (const [expiry, bucket] of instrumentsByExpiry) {
    const dte = (expiry - now) / (24 * 60 * 60 * 1000);
    if (dte <= 0) continue;
    const T = dte / 365.25;
    const spot = qImpliedSpot(bucket, summaries);
    if (spot == null) continue;

    for (const [strike, name] of bucket.calls) {
      const sum = summaries.get(name);
      if (!sum || sum.mark_price == null || sum.mark_iv == null || strike <= spot) continue;
      const sigma = sum.mark_iv / 100;
      const delta = qBsDelta("call", spot, strike, T, sigma);
      if (delta < deltaMin || delta > deltaMax) continue;
      const premiumUsd = sum.mark_price * spot;
      const annualizedYield = (premiumUsd / spot / T) * 100;
      calls.push({ expiry, dte, strike, iv: sum.mark_iv, delta, premiumUsd, annualizedYield });
    }
    for (const [strike, name] of bucket.puts) {
      const sum = summaries.get(name);
      if (!sum || sum.mark_price == null || sum.mark_iv == null || strike >= spot) continue;
      const sigma = sum.mark_iv / 100;
      const delta = qBsDelta("put", spot, strike, T, sigma);
      if (Math.abs(delta) < deltaMin || Math.abs(delta) > deltaMax) continue;
      const premiumUsd = sum.mark_price * spot;
      const annualizedYield = (premiumUsd / strike / T) * 100; // yield on collateral (strike), not spot
      puts.push({ expiry, dte, strike, iv: sum.mark_iv, delta, premiumUsd, annualizedYield });
    }
  }
  calls.sort((a, b) => b.annualizedYield - a.annualizedYield);
  puts.sort((a, b) => b.annualizedYield - a.annualizedYield);
  return { calls: calls.slice(0, TOP_N), puts: puts.slice(0, TOP_N) };
}

function renderTable(id, rows) {
  const tbody = document.querySelector(`#${id} tbody`);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No strikes in this delta band right now</td></tr>';
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

    const [deltaMin, deltaMax] = $("deltaBandSelect").value.split(",").map(Number);
    const { calls, puts } = scanChain(instrumentsByExpiry, summaryMap, deltaMin, deltaMax);

    let anySpot = null;
    for (const bucket of instrumentsByExpiry.values()) {
      const s = qImpliedSpot(bucket, summaryMap);
      if (s != null) {
        anySpot = s;
        break;
      }
    }
    $("spotStat").textContent = anySpot != null ? "$" + qFmt(anySpot, 0) : "—";

    renderTable("callTable", calls);
    renderTable("putTable", puts);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("deltaBandSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
