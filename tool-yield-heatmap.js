// Income Yield Heatmap — standalone, REST-only.
// The Income Scanner page ranks every strike/expiry into one flat list sorted by yield,
// mixing tenors and deltas together. This reuses the identical scan logic but organizes
// the results into a delta-band x expiry grid instead, so a term-structure-of-yield
// pattern (e.g. "the 30-45 day tenor is rich across every delta band right now") is
// visible at a glance in a way a flat ranked list can't show.

const CURRENCY = "BTC";
const DELTA_BANDS = [
  [0.05, 0.15],
  [0.15, 0.25],
  [0.25, 0.35],
  [0.35, 0.45],
];

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function scanBestYields(instrumentsByExpiry, summaries) {
  const now = Date.now();
  const expiries = [...instrumentsByExpiry.keys()].sort((a, b) => a - b);
  const callGrid = new Map(); // "expiry|bandIdx" -> best yield
  const putGrid = new Map();

  for (const expiry of expiries) {
    const bucket = instrumentsByExpiry.get(expiry);
    const dte = (expiry - now) / (24 * 60 * 60 * 1000);
    if (dte <= 0) continue;
    const T = dte / 365.25;
    const spot = qImpliedSpot(bucket, summaries);
    if (spot == null) continue;

    for (const [strike, name] of bucket.calls) {
      const sum = summaries.get(name);
      if (!sum || sum.mark_price == null || sum.mark_iv == null || strike <= spot) continue;
      const delta = qBsDelta("call", spot, strike, T, sum.mark_iv / 100);
      const bandIdx = DELTA_BANDS.findIndex(([lo, hi]) => delta >= lo && delta < hi);
      if (bandIdx === -1) continue;
      const yieldPct = ((sum.mark_price * spot) / spot / T) * 100;
      const key = `${expiry}|${bandIdx}`;
      if (!callGrid.has(key) || callGrid.get(key) < yieldPct) callGrid.set(key, yieldPct);
    }
    for (const [strike, name] of bucket.puts) {
      const sum = summaries.get(name);
      if (!sum || sum.mark_price == null || sum.mark_iv == null || strike >= spot) continue;
      const delta = Math.abs(qBsDelta("put", spot, strike, T, sum.mark_iv / 100));
      const bandIdx = DELTA_BANDS.findIndex(([lo, hi]) => delta >= lo && delta < hi);
      if (bandIdx === -1) continue;
      const yieldPct = ((sum.mark_price * spot) / strike / T) * 100;
      const key = `${expiry}|${bandIdx}`;
      if (!putGrid.has(key) || putGrid.get(key) < yieldPct) putGrid.set(key, yieldPct);
    }
  }
  return { expiries, callGrid, putGrid };
}

function renderHeatmap(elId, expiries, grid) {
  const el = $(elId);
  const allVals = [...grid.values()];
  const maxVal = Math.max(...allVals, 1);

  let html = '<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Δ band</th>';
  for (const ts of expiries) html += `<th>${qExpiryLabel(ts)}</th>`;
  html += "</tr></thead><tbody>";
  DELTA_BANDS.forEach(([lo, hi], bandIdx) => {
    html += `<tr><td>${qFmt(lo * 100, 0)}-${qFmt(hi * 100, 0)}Δ</td>`;
    for (const ts of expiries) {
      const v = grid.get(`${ts}|${bandIdx}`);
      if (v == null) {
        html += `<td style="opacity:0.35">—</td>`;
      } else {
        const intensity = Math.min(1, v / maxVal);
        const bg = `rgba(53, 211, 153, ${(0.15 + intensity * 0.65).toFixed(2)})`;
        html += `<td style="background:${bg}">${qFmt(v, 1)}%</td>`;
      }
    }
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  el.innerHTML = html;
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

    const { expiries, callGrid, putGrid } = scanBestYields(instrumentsByExpiry, summaryMap);
    const liveExpiries = expiries.filter((ts) => ts > Date.now());
    renderHeatmap("callHeatmap", liveExpiries, callGrid);
    renderHeatmap("putHeatmap", liveExpiries, putGrid);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
