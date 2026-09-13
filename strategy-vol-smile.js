// Volatility Smile Curve strategy page — standalone, REST-only.
// Plots quoted IV against strike for one selected expiry — the actual smile/skew curve
// that the Skew Arbitrage (RR25) and Convexity Arb (BF25) pages each reduce to a single
// number. Uses each strike's OTM quote (put below spot, call above, matching the same
// convention as quant.js's qBuildOtmPriceCurve for the Variance Swap page) since OTM
// quotes are typically the more liquidly traded/tighter side of the chain.

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

function computeSmile() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);

  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  const points = [];
  for (const K of strikes) {
    const call = state.summaries.get(bucket.calls.get(K));
    const put = state.summaries.get(bucket.puts.get(K));
    let iv = null;
    if (K === atm) {
      const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
      iv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
    } else if (K > spot) {
      iv = call ? call.mark_iv : null;
    } else {
      iv = put ? put.mark_iv : null;
    }
    if (iv != null) points.push({ K, iv });
  }
  if (points.length < 4) return { spot, insufficient: true };

  let call25 = null, call25Diff = Infinity, put25 = null, put25Diff = Infinity;
  for (const K of strikes) {
    const call = state.summaries.get(bucket.calls.get(K));
    if (call && call.mark_iv != null && K > spot) {
      const delta = qBsDelta("call", spot, K, T, call.mark_iv / 100);
      const diff = Math.abs(delta - 0.25);
      if (diff < call25Diff) {
        call25Diff = diff;
        call25 = { K, iv: call.mark_iv };
      }
    }
    const put = state.summaries.get(bucket.puts.get(K));
    if (put && put.mark_iv != null && K < spot) {
      const delta = qBsDelta("put", spot, K, T, put.mark_iv / 100);
      const diff = Math.abs(Math.abs(delta) - 0.25);
      if (diff < put25Diff) {
        put25Diff = diff;
        put25 = { K, iv: put.mark_iv };
      }
    }
  }
  const atmIv = points.find((p) => p.K === atm)?.iv ?? null;
  const rr25 = call25 && put25 ? call25.iv - put25.iv : null;
  const bf25 = call25 && put25 && atmIv != null ? (call25.iv + put25.iv) / 2 - atmIv : null;

  return { spot, points, atm, atmIv, call25, put25, rr25, bf25 };
}

function buildSmileChart(points, spot, atm, call25, put25) {
  const W = 640, H = 240, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const strikes = points.map((p) => p.K);
  const ivs = points.map((p) => p.iv);
  const loX = Math.min(...strikes), hiX = Math.max(...strikes);
  const loY = Math.min(...ivs) * 0.95, hiY = Math.max(...ivs) * 1.05;
  const xScale = (K) => padL + ((K - loX) / (hiX - loX)) * innerW;
  const yScale = (iv) => (hiY === loY ? padT + innerH / 2 : padT + innerH - ((iv - loY) / (hiY - loY)) * innerH);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  svg += `<text x="${spotX}" y="${padT - 2}" font-size="9" fill="#f7931a" text-anchor="middle">spot</text>`;

  let d = "";
  points.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${xScale(p.K).toFixed(1)},${yScale(p.iv).toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="#35d399" stroke-width="2"/>`;

  const markPoint = (pt, label, color) => {
    if (!pt) return "";
    const x = xScale(pt.K), y = yScale(pt.iv);
    return (
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}"/>` +
      `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="9" fill="${color}" text-anchor="middle">${label}</text>`
    );
  };
  svg += markPoint(put25, "25Δ P", "#ff5c7c");
  svg += markPoint(call25, "25Δ C", "#3aa0ff");
  const atmPt = points.find((p) => p.K === atm);
  svg += markPoint(atmPt, "ATM", "#f7931a");

  strikes
    .filter((_, i) => i % Math.ceil(strikes.length / 8) === 0)
    .forEach((K) => {
      svg += `<text x="${xScale(K).toFixed(1)}" y="${H - padB + 13}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(K, 0)}</text>`;
    });
  svg += "</svg>";
  return svg;
}

function renderSmile(smile) {
  const el = $("smileChart");
  if (!smile || smile.spot == null || smile.insufficient || !smile.points) {
    el.innerHTML = '<p class="loading">Insufficient quoted strikes for this expiry</p>';
    $("atmIvStat").textContent = "—";
    $("rr25Stat").textContent = "—";
    $("bf25Stat").textContent = "—";
    return;
  }
  $("atmIvStat").textContent = smile.atmIv != null ? qFmt(smile.atmIv, 1) + "%" : "—";
  $("rr25Stat").textContent = smile.rr25 != null ? qFmtSigned(smile.rr25, 1) + "pp" : "—";
  $("bf25Stat").textContent = smile.bf25 != null ? qFmtSigned(smile.bf25, 1) + "pp" : "—";
  el.innerHTML = buildSmileChart(smile.points, smile.spot, smile.atm, smile.call25, smile.put25);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const smile = computeSmile();
    $("spotStat").textContent = smile && smile.spot != null ? "$" + qFmt(smile.spot, 0) : "—";
    renderSmile(smile);
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
