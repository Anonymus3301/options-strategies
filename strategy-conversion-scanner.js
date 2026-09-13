// Conversion/Reversal Arbitrage Scanner — standalone, REST-only.
// The Box Spread page checks put-call parity at one selected pair of strikes; this page
// scans every strike across every live expiry at once. qImpliedSpot already aggregates
// all strikes into one robust median "fair" spot for the rest of this app — this page
// exposes what that aggregation normally hides: how far each INDIVIDUAL strike's own
// parity-implied spot sits from that chain-wide median, ranked by size. A strike whose
// call is priced rich relative to its put (vs. the chain's own consensus) points to a
// Conversion (long spot + short call + long put); the reverse points to a Reversal (short
// spot + long call + short put). Verified numerically (scratchpad): artificially bumping
// one call's price 15% above fair pushes exactly that strike's implied spot above the
// median and produces the expected positive edge under the Conversion label.

const CURRENCY = "BTC";
const TOP_N = 15;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function scanExpiry(expiry, bucket, summaryMap, now) {
  const spot = qImpliedSpot(bucket, summaryMap);
  if (spot == null) return [];
  const dte = (expiry - now) / (24 * 60 * 60 * 1000);
  if (dte <= 0) return [];
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const rows = [];
  for (const strike of strikes) {
    const call = summaryMap.get(bucket.calls.get(strike));
    const put = summaryMap.get(bucket.puts.get(strike));
    if (!call || !put || call.mark_price == null || put.mark_price == null) continue;
    const denom = 1 - (call.mark_price - put.mark_price);
    if (!(denom > 0.2 && denom < 5)) continue;
    const impliedSpotHere = strike / denom;
    const edgeUsd = call.mark_price * spot - put.mark_price * spot - (spot - strike);
    const devPct = ((impliedSpotHere - spot) / spot) * 100;
    rows.push({
      expiry,
      dte,
      strike,
      callIv: call.mark_iv,
      putIv: put.mark_iv,
      impliedSpotHere,
      devPct,
      edgeUsd,
      structure: edgeUsd >= 0 ? "Conversion" : "Reversal",
    });
  }
  return rows;
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
    const now = Date.now();

    let allRows = [];
    let anySpot = null;
    for (const [expiry, bucket] of instrumentsByExpiry) {
      const rows = scanExpiry(expiry, bucket, summaryMap, now);
      allRows = allRows.concat(rows);
      if (anySpot == null && rows.length) {
        const s = qImpliedSpot(bucket, summaryMap);
        if (s != null) anySpot = s;
      }
    }
    if (anySpot == null) {
      for (const bucket of instrumentsByExpiry.values()) {
        const s = qImpliedSpot(bucket, summaryMap);
        if (s != null) {
          anySpot = s;
          break;
        }
      }
    }
    $("spotStat").textContent = anySpot != null ? "$" + qFmt(anySpot, 0) : "—";

    allRows.sort((a, b) => Math.abs(b.edgeUsd) - Math.abs(a.edgeUsd));
    const top = allRows.slice(0, TOP_N);

    const tbody = document.querySelector("#scanTable tbody");
    if (!top.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading">No usable strikes right now</td></tr>';
    } else {
      tbody.innerHTML = top
        .map(
          (r, i) => `
        <tr>
          <td>${qExpiryLabel(r.expiry)}</td>
          <td>${qFmt(r.dte, 0)}d</td>
          <td>${qFmt(r.strike, 0)}</td>
          <td>${qFmt(r.callIv, 1)}%</td>
          <td>${qFmt(r.putIv, 1)}%</td>
          <td>${qFmtSigned(r.devPct, 2)}%</td>
          <td>${r.structure}</td>
          <td class="${i === 0 ? "best" : ""}">$${qFmt(Math.abs(r.edgeUsd), 0)}</td>
        </tr>`
        )
        .join("");
    }

    $("maxEdgeStat").textContent = top.length ? `$${qFmt(Math.abs(top[0].edgeUsd), 0)} (${top[0].structure})` : "—";
    $("scannedStat").textContent = `${allRows.length} strikes across ${instrumentsByExpiry.size} expiries`;

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
