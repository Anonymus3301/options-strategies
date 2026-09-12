// Premium Selling (Vol Risk Premium) strategy page — standalone, REST-only, no WebSocket.
// Reuses quant.js for fetching/math and the same localStorage IV-history key app.js's
// main dashboard writes, so IV Rank benefits from history built up on either page.

const CURRENCY = "BTC";
const IV_HISTORY_KEY = "btc-options-iv-history-v1";
const IV_HISTORY_MAX_DAYS = 400;
const IV_HISTORY_MIN_DAYS = 5;
const RVOL_WINDOWS = [7, 14, 30];
const SCANNER_DTE_SWEET_MIN = 15;
const SCANNER_DTE_SWEET_MAX = 45;
const SCANNER_DTE_WIDE_MIN = 7;
const SCANNER_DTE_WIDE_MAX = 75;

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
  selectedExpiry: null,
  summaries: new Map(),
  rvolWindows: {},
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

function atmInfoForExpiry(ts) {
  const bucket = state.instrumentsByExpiry.get(ts);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot, strikes };
  const call = state.summaries.get(bucket.calls.get(atm));
  const put = state.summaries.get(bucket.puts.get(atm));
  const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
  return {
    spot,
    strikes,
    atmStrike: atm,
    call,
    put,
    atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null,
  };
}

function computeTermStructure() {
  return state.expiries.map((ts) => ({ expiry: ts, ...atmInfoForExpiry(ts) }));
}

function renderExpirySelect() {
  const sel = $("expirySelect");
  sel.innerHTML = state.expiries
    .map((ts) => `<option value="${ts}" ${ts === state.selectedExpiry ? "selected" : ""}>${qExpiryLabel(ts)}</option>`)
    .join("");
  sel.disabled = false;
}

async function refreshRealizedVol() {
  const ohlc = await qFetchDailyCloses("BTC-PERPETUAL", 31);
  const closes = ohlc && ohlc.close ? ohlc.close : [];
  const out = {};
  for (const w of RVOL_WINDOWS) out[w] = closes.length >= w + 1 ? qAnnualizedVol(closes.slice(-(w + 1))) : null;
  return out;
}

function computeExpectedMove(info) {
  if (!info || !info.call || !info.put || info.call.mark_price == null || info.put.mark_price == null || info.spot == null)
    return null;
  const usd = (info.call.mark_price + info.put.mark_price) * info.spot;
  return { usd, pct: (usd / info.spot) * 100 };
}

function updateIvRankStat(currentIv) {
  const history = qRecordDailyHistory(IV_HISTORY_KEY, "atmIv", currentIv, IV_HISTORY_MAX_DAYS);
  const values = history.map((h) => h.atmIv).filter((v) => v != null);
  const res = qComputeRankPercentile(currentIv, values, IV_HISTORY_MIN_DAYS);
  const el = $("ivRankStat");
  if (currentIv == null || res.days < IV_HISTORY_MIN_DAYS) {
    el.textContent = `Collecting history (${res.days}d so far, this browser — need ${IV_HISTORY_MIN_DAYS}+)`;
  } else {
    el.textContent = `Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)`;
  }
  return res;
}

function computeScanner(front, ivRank, rvolWindows) {
  const components = [];

  if (ivRank && ivRank.rank != null) {
    const score = ivRank.rank >= 60 ? 1 : ivRank.rank <= 30 ? -1 : 0;
    components.push({ label: "IV Rank", value: `${qFmt(ivRank.rank, 0)} (${ivRank.days}d history)`, score });
  } else {
    components.push({ label: "IV Rank", value: `Collecting history (${ivRank ? ivRank.days : 0}d so far)`, score: null });
  }

  const rvol30 = rvolWindows[30];
  const atmIv = front ? front.atmIv : null;
  if (atmIv != null && rvol30 != null) {
    const premium = atmIv - rvol30;
    const score = premium > 5 ? 1 : premium < -5 ? -1 : 0;
    components.push({
      label: "Vol Risk Premium",
      value: `${qFmtSigned(premium)}pp (IV ${qFmt(atmIv, 1)}% − RVol30 ${qFmt(rvol30, 1)}%)`,
      score,
    });
  } else {
    components.push({ label: "Vol Risk Premium", value: "—", score: null });
  }

  const dte = state.selectedExpiry != null ? (state.selectedExpiry - Date.now()) / (24 * 60 * 60 * 1000) : null;
  if (dte != null) {
    const score =
      dte >= SCANNER_DTE_SWEET_MIN && dte <= SCANNER_DTE_SWEET_MAX
        ? 1
        : dte < SCANNER_DTE_WIDE_MIN || dte > SCANNER_DTE_WIDE_MAX
        ? -1
        : 0;
    components.push({ label: "Days to Expiry", value: `${qFmt(dte, 0)}d`, score });
  } else {
    components.push({ label: "Days to Expiry", value: "—", score: null });
  }

  const term = computeTermStructure();
  const allIvs = term.map((t) => t.atmIv).filter((v) => v != null);
  if (atmIv != null && allIvs.length >= 2) {
    const sorted = [...allIvs].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    const richness = atmIv - median;
    const score = richness > 3 ? 1 : richness < -3 ? -1 : 0;
    components.push({ label: "Term-Structure Richness", value: `${qFmtSigned(richness)}pp vs. curve median`, score });
  } else {
    components.push({ label: "Term-Structure Richness", value: "—", score: null });
  }

  const scored = components.filter((c) => c.score != null);
  const verdictScore = scored.length ? scored.reduce((a, c) => a + c.score, 0) / scored.length : null;
  let verdict, level;
  if (verdictScore == null) {
    verdict = "Insufficient data";
    level = "na";
  } else if (verdictScore >= 0.5) {
    verdict = "Conditions favor selling premium";
    level = "favorable";
  } else if (verdictScore <= -0.5) {
    verdict = "Conditions favor buying — selling looks unfavorable";
    level = "unfavorable";
  } else {
    verdict = "Mixed / neutral signals";
    level = "neutral";
  }
  return { components, verdict, level };
}

function renderScanner(scanner) {
  const dotClass = (s) => (s == null ? "scanner-dot-na" : s > 0 ? "scanner-dot-green" : s < 0 ? "scanner-dot-red" : "scanner-dot-yellow");
  $("scannerBody").innerHTML = `
    <div class="scanner-verdict scanner-${scanner.level}">${scanner.verdict}</div>
    <div class="scanner-rows">
      ${scanner.components
        .map(
          (c) => `<div class="scanner-row"><span class="scanner-dot ${dotClass(c.score)}"></span><span class="scanner-label">${c.label}</span><span class="scanner-value">${c.value}</span></div>`
        )
        .join("")}
    </div>`;
}

// ---------- Suggested strangle + payoff diagram ----------

function buildStranglePayoffSvg(callStrike, putStrike, premiumUsd, spot) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = Math.min(putStrike, spot) * 0.7;
  const hi = Math.max(callStrike, spot) * 1.3;
  const steps = 80;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    const callLoss = Math.max(S - callStrike, 0);
    const putLoss = Math.max(putStrike - S, 0);
    pts.push({ S, pnl: premiumUsd - callLoss - putLoss });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.abs(p.pnl)), premiumUsd) * 1.15 || 1;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  svg += `<text x="${spotX}" y="${padT - 2}" font-size="9" fill="#f7931a" text-anchor="middle">spot</text>`;
  [putStrike, callStrike].forEach((K, i) => {
    const x = xScale(K);
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<text x="${x}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(K, 0)}</text>`;
  });
  let d = "";
  pts.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p.pnl).toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="#35d399" stroke-width="2"/>`;
  svg += "</svg>";
  return svg;
}

function renderStrangle(front) {
  $("strangleExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const move = computeExpectedMove(front);
  const el = $("strangleInfo");
  const chartEl = $("payoffChart");
  if (!front || !front.spot || !move || !front.strikes || !front.strikes.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    chartEl.innerHTML = "";
    return;
  }
  const callTarget = front.spot + move.usd;
  const putTarget = front.spot - move.usd;
  const callStrike = qClosestStrike(front.strikes, callTarget);
  const putStrike = qClosestStrike(front.strikes, putTarget);
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  const callSum = state.summaries.get(bucket.calls.get(callStrike));
  const putSum = state.summaries.get(bucket.puts.get(putStrike));
  const callPremiumUsd = callSum && callSum.mark_price != null ? callSum.mark_price * front.spot : null;
  const putPremiumUsd = putSum && putSum.mark_price != null ? putSum.mark_price * front.spot : null;
  const totalPremium = callPremiumUsd != null && putPremiumUsd != null ? callPremiumUsd + putPremiumUsd : null;

  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Sell call strike</span><span class="scanner-value">${qFmt(callStrike, 0)} (premium ≈ $${qFmt(callPremiumUsd, 0)})</span></div>
      <div class="scanner-row"><span class="scanner-label">Sell put strike</span><span class="scanner-value">${qFmt(putStrike, 0)} (premium ≈ $${qFmt(putPremiumUsd, 0)})</span></div>
      <div class="scanner-row"><span class="scanner-label">Total premium collected</span><span class="scanner-value">${totalPremium != null ? "$" + qFmt(totalPremium, 0) : "—"}</span></div>
      <div class="scanner-row"><span class="scanner-label">Breakevens</span><span class="scanner-value">${totalPremium != null ? qFmt(putStrike - totalPremium, 0) + " — " + qFmt(callStrike + totalPremium, 0) : "—"}</span></div>
    </div>`;
  chartEl.innerHTML = totalPremium != null ? buildStranglePayoffSvg(callStrike, putStrike, totalPremium, front.spot) : "";
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const term = computeTermStructure();
    const front = term.find((t) => t.expiry === state.selectedExpiry);
    const frontMonth = term.find((t) => t.atmIv != null);

    $("spotStat").textContent = front && front.spot != null ? "$" + qFmt(front.spot, 0) : "—";
    $("atmIvStat").textContent = front && front.atmIv != null ? qFmt(front.atmIv, 1) + "%" : "—";

    state.rvolWindows = await refreshRealizedVol();
    $("rvolStat").textContent = RVOL_WINDOWS.map((w) => `${w}D ${state.rvolWindows[w] != null ? qFmt(state.rvolWindows[w], 1) : "—"}`).join(" · ");

    const rvol30 = state.rvolWindows[30];
    const atmIv = frontMonth ? frontMonth.atmIv : null;
    $("premiumStat").textContent = atmIv != null && rvol30 != null ? `${qFmtSigned(atmIv - rvol30)}pp` : "—";

    const ivRank = updateIvRankStat(atmIv);

    const move = computeExpectedMove(front);
    $("expectedMoveStat").textContent = move != null ? `$${qFmt(move.usd, 0)} (±${qFmt(move.pct, 1)}%)` : "—";

    const scanner = computeScanner(frontMonth, ivRank, state.rvolWindows);
    renderScanner(scanner);
    renderStrangle(front);

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

refresh();
setInterval(refresh, 30000);
