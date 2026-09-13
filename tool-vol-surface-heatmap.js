// Volatility Surface Heatmap — standalone, REST-only.
// The Volatility Smile Curve page shows the full strike/delta smile for ONE expiry; the
// IV Term Structure Curve shows ONE point (ATM) across every expiry. Neither shows the
// whole surface at once. This compresses every live expiry's smile into 5 delta buckets
// (10Δ put through 10Δ call) as a single delta x expiry grid, so a pattern like "front-week
// skew is much steeper than back-month skew" is visible in one glance instead of by paging
// through expiries one at a time on the Smile Curve page.

const CURRENCY = "BTC";
const DELTA_COLS = [
  { label: "10Δ Put", type: "put", target: -0.1 },
  { label: "25Δ Put", type: "put", target: -0.25 },
  { label: "ATM", type: "atm", target: 0.5 },
  { label: "25Δ Call", type: "call", target: 0.25 },
  { label: "10Δ Call", type: "call", target: 0.1 },
];

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function findDeltaStrike(strikes, bucket, summaries, type, targetDelta, spot, T) {
  let best = null,
    bestDiff = Infinity;
  for (const strike of strikes) {
    const name = type === "call" ? bucket.calls.get(strike) : bucket.puts.get(strike);
    const sum = name ? summaries.get(name) : null;
    if (!sum || sum.mark_iv == null) continue;
    const sigma = sum.mark_iv / 100;
    const delta = qBsDelta(type, spot, strike, T, sigma);
    const diff = Math.abs(delta - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike, delta, iv: sum.mark_iv };
    }
  }
  return best;
}

function computeAtmIv(bucket, summaries, strikes, spot) {
  const atmStrike = qClosestStrike(strikes, spot);
  if (atmStrike == null) return null;
  const call = summaries.get(bucket.calls.get(atmStrike));
  const put = summaries.get(bucket.puts.get(atmStrike));
  const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

function buildSurface(instrumentsByExpiry, summaries) {
  const now = Date.now();
  const expiries = [...instrumentsByExpiry.keys()].filter((ts) => ts > now).sort((a, b) => a - b);
  const grid = new Map(); // "expiry|colIdx" -> iv

  for (const expiry of expiries) {
    const bucket = instrumentsByExpiry.get(expiry);
    const spot = qImpliedSpot(bucket, summaries);
    if (spot == null) continue;
    const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
    const T = Math.max((expiry - now) / QUANT_YEAR_MS, 1 / 365 / 24);

    DELTA_COLS.forEach((col, i) => {
      let iv = null;
      if (col.type === "atm") {
        iv = computeAtmIv(bucket, summaries, strikes, spot);
      } else {
        const found = findDeltaStrike(strikes, bucket, summaries, col.type, col.target, spot, T);
        iv = found ? found.iv : null;
      }
      if (iv != null) grid.set(`${expiry}|${i}`, iv);
    });
  }
  return { expiries, grid };
}

function renderHeatmap(expiries, grid) {
  const el = $("surfaceHeatmap");
  const allVals = [...grid.values()];
  if (!allVals.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = Math.max(maxVal - minVal, 0.01);

  let html = '<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Expiry</th>';
  for (const col of DELTA_COLS) html += `<th>${col.label}</th>`;
  html += "</tr></thead><tbody>";
  expiries.forEach((ts) => {
    html += `<tr><td>${qExpiryLabel(ts)}</td>`;
    DELTA_COLS.forEach((col, i) => {
      const v = grid.get(`${ts}|${i}`);
      if (v == null) {
        html += `<td style="opacity:0.35">—</td>`;
      } else {
        const intensity = (v - minVal) / range;
        const bg = `rgba(247, 147, 26, ${(0.12 + intensity * 0.68).toFixed(2)})`;
        html += `<td style="background:${bg}">${qFmt(v, 1)}%</td>`;
      }
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  el.innerHTML = html;
}

function renderSkewReadout(expiries, grid) {
  if (!expiries.length) {
    $("frontSkewStat").textContent = "—";
    $("backSkewStat").textContent = "—";
    return;
  }
  const front = expiries[0];
  const back = expiries[expiries.length - 1];
  const wingSkew = (ts) => {
    const p10 = grid.get(`${ts}|0`),
      c10 = grid.get(`${ts}|4`);
    return p10 != null && c10 != null ? p10 - c10 : null;
  };
  const frontSkew = wingSkew(front);
  const backSkew = wingSkew(back);
  $("frontSkewStat").textContent = frontSkew != null ? `${qFmtSigned(frontSkew, 1)}pp (${qExpiryLabel(front)})` : "—";
  $("backSkewStat").textContent =
    expiries.length > 1 && backSkew != null ? `${qFmtSigned(backSkew, 1)}pp (${qExpiryLabel(back)})` : "—";
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

    const { expiries, grid } = buildSurface(instrumentsByExpiry, summaryMap);
    renderHeatmap(expiries, grid);
    renderSkewReadout(expiries, grid);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
