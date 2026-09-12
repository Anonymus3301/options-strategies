// Max Pain / Pin Risk strategy page — standalone, REST-only.
// Max pain and OI come straight from get_book_summary_by_currency (open_interest per
// instrument); spot is the same put-call-parity implied spot used across these pages.

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

function computeMaxPain(strikes, bucket) {
  if (!strikes.length) return null;
  const oiAt = (nameOf) => strikes.map((s) => (state.summaries.get(nameOf(s)) || {}).open_interest || 0);
  const callOi = oiAt((s) => bucket.calls.get(s));
  const putOi = oiAt((s) => bucket.puts.get(s));
  let bestStrike = null, bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    strikes.forEach((k, i) => {
      if (settle > k) pain += (settle - k) * callOi[i];
      if (settle < k) pain += (k - settle) * putOi[i];
    });
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  const totalCallOi = callOi.reduce((a, b) => a + b, 0);
  const totalPutOi = putOi.reduce((a, b) => a + b, 0);
  return { strike: bestStrike, totalCallOi, totalPutOi, callOi, putOi };
}

function analyzeExpiry(ts) {
  const bucket = state.instrumentsByExpiry.get(ts);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const mp = computeMaxPain(strikes, bucket);
  if (!mp) return { expiry: ts, spot, strikes, bucket };
  return { expiry: ts, spot, strikes, bucket, ...mp };
}

function renderOiChart(analysis) {
  $("oiExpiry").textContent = state.selectedExpiry ? qExpiryLabel(state.selectedExpiry) : "—";
  const el = $("oiChart");
  if (!analysis || !analysis.strikes.length) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const labels = analysis.strikes.map((s) => (s / 1000).toFixed(0) + "k");
  // Reuse qBuildBarChart twice-ish isn't ideal for grouped bars; build a small bespoke
  // mirrored bar chart here (calls up, puts down) matching the main dashboard's style.
  const W = 640, H = 220, padL = 46, padR = 12, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxVal = Math.max(1, ...analysis.callOi, ...analysis.putOi);
  const zeroY = padT + innerH / 2;
  const scale = innerH / 2 / maxVal;
  const n = analysis.strikes.length;
  const bandW = innerW / n;
  const barW = Math.max(1, bandW * 0.6);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const mpIdx = analysis.strikes.indexOf(analysis.strike);
  if (mpIdx >= 0) {
    const x = padL + bandW * mpIdx + bandW / 2;
    svg += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}" stroke="#f7931a" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }
  const labelStep = Math.max(1, Math.ceil(n / 8));
  analysis.strikes.forEach((s, i) => {
    const cx = padL + bandW * i + bandW / 2;
    const callH = (analysis.callOi[i] || 0) * scale;
    const putH = (analysis.putOi[i] || 0) * scale;
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(zeroY - callH).toFixed(1)}" width="${barW.toFixed(1)}" height="${callH.toFixed(1)}" fill="#35d399" opacity="0.85"/>`;
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${zeroY.toFixed(1)}" width="${barW.toFixed(1)}" height="${putH.toFixed(1)}" fill="#ff5c7c" opacity="0.85"/>`;
    if (i % labelStep === 0 || i === n - 1) {
      svg += `<text x="${cx.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#8892a6">${labels[i]}</text>`;
    }
  });
  svg += "</svg>";
  el.innerHTML = svg;
}

function renderAllExpiriesTable(allAnalyses, spot) {
  const tbody = document.querySelector("#maxPainTable tbody");
  const rows = allAnalyses.filter((a) => a && a.strike != null);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">No data</td></tr>';
    return;
  }
  const now = Date.now();
  tbody.innerHTML = rows
    .map((a) => {
      const dte = (a.expiry - now) / (24 * 60 * 60 * 1000);
      const dist = spot != null ? ((a.strike - spot) / spot) * 100 : null;
      return `
      <tr>
        <td>${qExpiryLabel(a.expiry)}</td>
        <td>${qFmt(dte, 0)}d</td>
        <td>${qFmt(a.strike, 0)}</td>
        <td>${dist != null ? qFmtSigned(dist, 1) + "%" : "—"}</td>
        <td>${qFmt(a.totalCallOi, 0)} / ${qFmt(a.totalPutOi, 0)}</td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();

    const allAnalyses = state.expiries.map((ts) => analyzeExpiry(ts));
    const selected = allAnalyses.find((a) => a && a.expiry === state.selectedExpiry);

    $("spotStat").textContent = selected && selected.spot != null ? "$" + qFmt(selected.spot, 0) : "—";
    $("maxPainStat").textContent = selected && selected.strike != null ? qFmt(selected.strike, 0) : "—";

    if (selected && selected.strike != null && selected.spot != null) {
      const dist = selected.strike - selected.spot;
      $("distanceStat").textContent = `${qFmtSigned(dist, 0)} (${qFmtSigned((dist / selected.spot) * 100, 1)}%)`;
    } else {
      $("distanceStat").textContent = "—";
    }
    $("oiTotalStat").textContent =
      selected && selected.totalCallOi != null ? `${qFmt(selected.totalCallOi, 0)} / ${qFmt(selected.totalPutOi, 0)}` : "—";

    renderOiChart(selected);
    renderAllExpiriesTable(allAnalyses, selected ? selected.spot : null);

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
