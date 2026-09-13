// Term Structure Curve strategy page — standalone, REST-only.
// Plots ATM IV against days-to-expiry across every live expiry at once — the full curve,
// rather than the Forward Variance page's two-point bootstrap between exactly one front
// and one back expiry, or the Variance Swap page's single whole-chain number for one
// expiry. Reading the curve's overall slope (contango vs. backwardation) is a standard
// vol-trading heuristic distinct from either of those pages.

const CURRENCY = "BTC";

const $ = (id) => document.getElementById(id);

const state = {
  instrumentsByExpiry: new Map(),
  expiries: [],
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
}

function computeCurve() {
  const now = Date.now();
  const points = [];
  let anySpot = null;
  for (const expiry of state.expiries) {
    const bucket = state.instrumentsByExpiry.get(expiry);
    const spot = qImpliedSpot(bucket, state.summaries);
    if (spot == null) continue;
    if (anySpot == null) anySpot = spot;
    const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
    const atm = qClosestStrike(strikes, spot);
    if (atm == null) continue;
    const atmCall = state.summaries.get(bucket.calls.get(atm));
    const atmPut = state.summaries.get(bucket.puts.get(atm));
    const ivs = [atmCall && atmCall.mark_iv, atmPut && atmPut.mark_iv].filter((v) => v != null);
    if (!ivs.length) continue;
    const atmIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    const dte = (expiry - now) / (24 * 60 * 60 * 1000);
    if (dte <= 0) continue;
    points.push({ expiry, dte, atmIv });
  }
  return { spot: anySpot, points };
}

function buildCurveChart(points) {
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const dtes = points.map((p) => p.dte);
  const ivs = points.map((p) => p.atmIv);
  const loX = Math.min(...dtes), hiX = Math.max(...dtes);
  const loY = Math.min(...ivs) * 0.95, hiY = Math.max(...ivs) * 1.05;
  const xScale = (dte) => (hiX === loX ? padL + innerW / 2 : padL + ((dte - loX) / (hiX - loX)) * innerW);
  const yScale = (iv) => (hiY === loY ? padT + innerH / 2 : padT + innerH - ((iv - loY) / (hiY - loY)) * innerH);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#232a3a" stroke-width="1"/>`;
  let d = "";
  points.forEach((p, i) => {
    const x = xScale(p.dte), y = yScale(p.atmIv);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="#35d399" stroke-width="2"/>`;
  points.forEach((p) => {
    const x = xScale(p.dte), y = yScale(p.atmIv);
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#35d399"/>`;
    svg += `<text x="${x.toFixed(1)}" y="${H - padB + 13}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(p.dte, 0)}d</text>`;
    svg += `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(p.atmIv, 1)}%</text>`;
  });
  svg += "</svg>";
  return svg;
}

function renderCurve(curve) {
  const el = $("curveChart");
  const { points } = curve;
  if (!points || points.length < 2) {
    el.innerHTML = '<p class="loading">Need at least 2 live expiries with quoted ATM IV</p>';
    $("frontIvStat").textContent = "—";
    $("backIvStat").textContent = "—";
    $("spreadStat").textContent = "—";
    $("shapeStat").textContent = "—";
    return;
  }
  const front = points[0], back = points[points.length - 1];
  const spread = back.atmIv - front.atmIv;
  $("frontIvStat").textContent = `${qFmt(front.atmIv, 1)}% (${qFmt(front.dte, 0)}d)`;
  $("backIvStat").textContent = `${qFmt(back.atmIv, 1)}% (${qFmt(back.dte, 0)}d)`;
  $("spreadStat").textContent = `${qFmtSigned(spread, 1)}pp`;

  const THRESHOLD = 0.5;
  let shape;
  if (spread > THRESHOLD) shape = "Contango (upward-sloping) — the typical shape; more time priced with more uncertainty.";
  else if (spread < -THRESHOLD) shape = "Backwardation (downward-sloping) — front-dated IV trading rich, often event- or stress-driven near-term demand.";
  else shape = "Roughly flat — front and back dated IV priced similarly.";
  $("shapeStat").textContent = shape;

  el.innerHTML = buildCurveChart(points);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    const curve = computeCurve();
    $("spotStat").textContent = curve.spot != null ? "$" + qFmt(curve.spot, 0) : "—";
    renderCurve(curve);
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
