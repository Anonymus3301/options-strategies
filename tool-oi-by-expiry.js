// Open Interest Concentration by Expiry — standalone, REST-only.
// Max Pain and Gamma Exposure both slice open interest by STRIKE within one expiry at a
// time. Neither shows how open interest is distributed ACROSS expiries — which single
// expiry currently holds the largest share of the book's total risk, a real factor in how
// much a given expiration date can move the market. The PCR Sentiment page tracks one
// whole-chain put/call ratio over time; this instead breaks that ratio out expiry by
// expiry, for a live snapshot rather than a history.

const CURRENCY = "BTC";

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function computeByExpiry(instrumentsByExpiry, summaries) {
  const now = Date.now();
  const expiries = [...instrumentsByExpiry.keys()].filter((ts) => ts > now).sort((a, b) => a - b);
  const rows = [];
  for (const expiry of expiries) {
    const bucket = instrumentsByExpiry.get(expiry);
    const spot = qImpliedSpot(bucket, summaries);
    let callOi = 0,
      putOi = 0;
    for (const name of bucket.calls.values()) {
      const sum = summaries.get(name);
      if (sum && sum.open_interest != null) callOi += sum.open_interest;
    }
    for (const name of bucket.puts.values()) {
      const sum = summaries.get(name);
      if (sum && sum.open_interest != null) putOi += sum.open_interest;
    }
    const totalOi = callOi + putOi;
    const notionalUsd = spot != null ? totalOi * spot : null;
    rows.push({ expiry, spot, callOi, putOi, totalOi, notionalUsd, pcr: callOi > 0 ? putOi / callOi : null });
  }
  return rows;
}

function renderChart(rows) {
  const el = $("oiChart");
  const withNotional = rows.filter((r) => r.notionalUsd != null);
  if (!withNotional.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const categories = withNotional.map((r) => qExpiryLabel(r.expiry));
  const values = withNotional.map((r) => r.notionalUsd / 1e6); // $M
  el.innerHTML = qBuildBarChart(categories, values, { posColor: "#f7931a" });
}

function renderTable(rows) {
  const tbody = document.querySelector("#oiTable tbody");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No data</td></tr>';
    return;
  }
  const grandTotalOi = rows.reduce((sum, r) => sum + r.totalOi, 0);
  tbody.innerHTML = rows
    .map((r) => {
      const share = grandTotalOi > 0 ? (r.totalOi / grandTotalOi) * 100 : null;
      return `
      <tr>
        <td>${qExpiryLabel(r.expiry)}</td>
        <td>${qFmt(r.callOi, 0)}</td>
        <td>${qFmt(r.putOi, 0)}</td>
        <td>${qFmt(r.totalOi, 0)}</td>
        <td>${r.notionalUsd != null ? "$" + qFmt(r.notionalUsd / 1e6, 1) + "M" : "—"}</td>
        <td>${share != null ? qFmt(share, 1) + "%" : "—"}</td>
      </tr>`;
    })
    .join("");
}

function renderStats(rows) {
  if (!rows.length) {
    $("largestExpiryStat").textContent = "—";
    $("frontShareStat").textContent = "—";
    $("frontPcrStat").textContent = "—";
    return;
  }
  const grandTotalOi = rows.reduce((sum, r) => sum + r.totalOi, 0);
  const withNotional = rows.filter((r) => r.notionalUsd != null);
  const largest = withNotional.length
    ? withNotional.reduce((best, r) => (r.notionalUsd > best.notionalUsd ? r : best))
    : null;
  $("largestExpiryStat").textContent = largest
    ? `${qExpiryLabel(largest.expiry)} ($${qFmt(largest.notionalUsd / 1e6, 1)}M)`
    : "—";

  const front = rows[0];
  const frontShare = grandTotalOi > 0 ? (front.totalOi / grandTotalOi) * 100 : null;
  $("frontShareStat").textContent = frontShare != null ? `${qFmt(frontShare, 1)}% (${qExpiryLabel(front.expiry)})` : "—";
  $("frontPcrStat").textContent = front.pcr != null ? qFmt(front.pcr, 2) : "—";
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

    let anySpot = null;
    for (const bucket of instrumentsByExpiry.values()) {
      const s = qImpliedSpot(bucket, summaryMap);
      if (s != null) {
        anySpot = s;
        break;
      }
    }
    $("spotStat").textContent = anySpot != null ? "$" + qFmt(anySpot, 0) : "—";

    const rows = computeByExpiry(instrumentsByExpiry, summaryMap);
    renderChart(rows);
    renderTable(rows);
    renderStats(rows);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
