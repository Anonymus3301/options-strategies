// Theta Decay Curve — standalone, REST-only.
// Every page on this site that shows theta (the Greeks Table, every individual strategy
// page) shows it as a single snapshot number for today. None show the well-known fact
// that theta decay is not linear — it accelerates as expiry approaches. This holds spot
// and IV fixed at today's live values and walks time-to-expiry down from the option's
// full remaining life to just before zero, recomputing both per-day theta and remaining
// time value at each step via the same qBsThetaPerDay/qBsPrice this app already uses.

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

function buildCurveChart(points, key, color) {
  const W = 640, H = 220, padL = 55, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const dtes = points.map((p) => p.dte);
  const vals = points.map((p) => p[key]);
  const loX = Math.min(...dtes), hiX = Math.max(...dtes);
  const loY = Math.min(...vals, 0), hiY = Math.max(...vals) * 1.1;
  // Full remaining life (largest DTE) on the left, counting down toward expiry (DTE=0)
  // on the right — inverted vs. a plain numeric axis since DTE itself decreases left-to-right.
  const xScale = (dte) => padL + (1 - (dte - loX) / (hiX - loX || 1)) * innerW;
  const yScale = (v) => padT + innerH - ((v - loY) / (hiY - loY || 1)) * innerH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#232a3a" stroke-width="1"/>`;
  let d = "";
  points.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${xScale(p.dte).toFixed(1)},${yScale(p[key]).toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"/>`;
  [0.75, 0.5, 0.25, 0].forEach((frac) => {
    const dte = loX + (hiX - loX) * frac;
    svg += `<text x="${xScale(dte).toFixed(1)}" y="${H - padB + 13}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(dte, 0)}d</text>`;
  });
  svg += "</svg>";
  return svg;
}

function computeCurve() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot };
  const call = state.summaries.get(bucket.calls.get(atm));
  if (!call || call.mark_iv == null) return { spot, atm };
  const sigma = call.mark_iv / 100;
  const T0 = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const totalDays = T0 * 365.25;

  const points = [];
  const steps = 120;
  for (let i = steps; i >= 1; i--) {
    const dte = (totalDays * i) / steps;
    const T = dte / 365.25;
    points.push({
      dte,
      theta: qBsThetaPerDay(spot, atm, T, sigma),
      value: qBsPrice("call", spot, atm, T, sigma),
    });
  }
  return { spot, atm, iv: call.mark_iv, totalDays, points };
}

function render(c) {
  const thetaEl = $("thetaChart");
  const valueEl = $("valueChart");
  if (!c || c.spot == null || !c.points) {
    thetaEl.innerHTML = '<p class="loading">No data</p>';
    valueEl.innerHTML = "";
    $("atmStat").textContent = "—";
    $("todayThetaStat").textContent = "—";
    $("thetaAt10pctStat").textContent = "—";
    return;
  }
  $("atmStat").textContent = `${qFmt(c.atm, 0)} strike, ${qFmt(c.iv, 1)}% IV`;
  const todayTheta = c.points[0].theta; // points[0] = largest DTE (today, full remaining life)
  $("todayThetaStat").textContent = `${qFmtSigned(todayTheta, 1)} $/day`;
  const near = c.points.reduce((best, p) => (Math.abs(p.dte - c.totalDays * 0.1) < Math.abs(best.dte - c.totalDays * 0.1) ? p : best));
  $("thetaAt10pctStat").textContent = `${qFmtSigned(near.theta, 1)} $/day (at ${qFmt(near.dte, 1)}d left)`;

  thetaEl.innerHTML = buildCurveChart(c.points, "theta", "#ff5c7c");
  valueEl.innerHTML = buildCurveChart(c.points, "value", "#35d399");
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    const c = computeCurve();
    $("spotStat").textContent = c && c.spot != null ? "$" + qFmt(c.spot, 0) : "—";
    render(c);
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
