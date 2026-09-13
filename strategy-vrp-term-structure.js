// Vol Risk Premium Term Structure strategy page — standalone, REST-only.
// Combines two ideas already on this site that have never been put together: the IV Term
// Structure Curve page's per-expiry ATM IV, and the Realized Volatility Cone's real
// historical-close-based realized vol — but instead of comparing every expiry's IV to the
// SAME fixed RVol windows (as Premium Selling does), this matches each expiry's own DTE to
// its own realized-vol lookback, answering "which specific expiry currently carries the
// richest (or cheapest) vol risk premium," not just "is IV rich vs. RVol in general."

const CURRENCY = "BTC";
const HISTORY_DAYS = 400;
const VRP_RANK_HISTORY_KEY = "btc-options-vrp-rank-history-v1";
const VRP_RANK_HISTORY_MAX_DAYS = 400;
const VRP_RANK_HISTORY_MIN_DAYS = 5;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function buildChart(rows) {
  const W = 640, H = 240, padL = 50, padR = 16, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = rows.length;
  const bandW = innerW / n;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.vrp || 0)), 1) * 1.15;
  const zeroY = padT + innerH / 2;
  const scale = innerH / 2 / maxAbs;
  const barW = Math.max(1, bandW * 0.55);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const v = r.vrp || 0;
    const cx = padL + bandW * i + bandW / 2;
    const h = Math.abs(v) * scale;
    const color = v >= 0 ? "#35d399" : "#ff5c7c";
    const y = v >= 0 ? zeroY - h : zeroY;
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    svg += `<text x="${cx.toFixed(1)}" y="${H - padB + 14}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(r.dte, 0)}d</text>`;
    svg += `<text x="${cx.toFixed(1)}" y="${(v >= 0 ? y - 4 : y + h + 12).toFixed(1)}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmtSigned(v, 0)}</text>`;
  });
  svg += "</svg>";
  return svg;
}

function updateVrpRankStat(frontVrp) {
  const history = qRecordDailyHistory(VRP_RANK_HISTORY_KEY, "vrp", frontVrp, VRP_RANK_HISTORY_MAX_DAYS);
  const values = history.map((h) => h.vrp).filter((v) => v != null);
  const res = qComputeRankPercentile(frontVrp, values, VRP_RANK_HISTORY_MIN_DAYS);
  const el = $("vrpRankStat");
  if (frontVrp == null || res.days < VRP_RANK_HISTORY_MIN_DAYS) {
    el.textContent = `Collecting history (${res.days}d so far, this browser — need ${VRP_RANK_HISTORY_MIN_DAYS}+)`;
  } else {
    const extreme = res.percentile >= 80 || res.percentile <= 20;
    el.textContent =
      `VRP Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)` +
      (extreme ? " — stretched vs. its own recent range" : "");
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [instruments, summaries, ohlc] = await Promise.all([
      qFetchInstruments(CURRENCY, "option", false),
      qFetchBookSummary(CURRENCY, "option"),
      qFetchDailyCloses("BTC-PERPETUAL", HISTORY_DAYS),
    ]);
    const instrumentsByExpiry = qGroupByExpiry(instruments);
    const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
    const closes = ohlc && ohlc.close ? ohlc.close : [];
    const now = Date.now();

    let anySpot = null;
    const rows = [];
    for (const [expiry, bucket] of instrumentsByExpiry) {
      const spot = qImpliedSpot(bucket, summaryMap);
      if (spot == null) continue;
      if (anySpot == null) anySpot = spot;
      const dte = Math.round((expiry - now) / (24 * 60 * 60 * 1000));
      if (dte <= 0) continue;
      const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
      const atm = qClosestStrike(strikes, spot);
      if (atm == null) continue;
      const atmCall = summaryMap.get(bucket.calls.get(atm));
      const atmPut = summaryMap.get(bucket.puts.get(atm));
      const ivs = [atmCall && atmCall.mark_iv, atmPut && atmPut.mark_iv].filter((v) => v != null);
      if (!ivs.length) continue;
      const atmIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;

      const window = Math.min(dte, closes.length - 1);
      const rvol = window >= 3 ? qAnnualizedVol(closes.slice(-(window + 1))) : null;
      if (rvol == null) continue;
      rows.push({ expiry, dte, atmIv, rvol, vrp: atmIv - rvol });
    }
    rows.sort((a, b) => a.dte - b.dte);

    $("spotStat").textContent = anySpot != null ? "$" + qFmt(anySpot, 0) : "—";

    if (!rows.length) {
      $("richestStat").textContent = "—";
      $("cheapestStat").textContent = "—";
      $("chart").innerHTML = '<p class="loading">Not enough data (need matching IV and price history)</p>';
      updateVrpRankStat(null);
      setStatus("live", "pill-live");
      return;
    }

    updateVrpRankStat(rows[0].vrp);

    const richest = rows.reduce((best, r) => (r.vrp > best.vrp ? r : best));
    const cheapest = rows.reduce((best, r) => (r.vrp < best.vrp ? r : best));
    $("richestStat").textContent = `${richest.dte}d: IV ${qFmt(richest.atmIv, 1)}% − RVol ${qFmt(richest.rvol, 1)}% = ${qFmtSigned(richest.vrp, 1)}pp`;
    $("cheapestStat").textContent = `${cheapest.dte}d: IV ${qFmt(cheapest.atmIv, 1)}% − RVol ${qFmt(cheapest.rvol, 1)}% = ${qFmtSigned(cheapest.vrp, 1)}pp`;

    $("chart").innerHTML = buildChart(rows);

    const tbody = document.querySelector("#vrpTable tbody");
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${qExpiryLabel(r.expiry)}</td>
        <td>${r.dte}d</td>
        <td>${qFmt(r.atmIv, 1)}%</td>
        <td>${qFmt(r.rvol, 1)}%</td>
        <td class="${r === richest ? "best" : ""}">${qFmtSigned(r.vrp, 1)}pp</td>
      </tr>`
      )
      .join("");

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 60000);
