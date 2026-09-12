// Protective Put (portfolio insurance) strategy page — standalone, REST-only.
// For each live expiry, finds the strike nearest the selected protection floor (e.g.
// spot * 0.90 for a -10% floor) and reports its cost, annualized so different tenors are
// comparable on one number.

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

function analyzeExpiry(ts, floorPct) {
  const bucket = state.instrumentsByExpiry.get(ts);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return null;
  const strikes = [...new Set(bucket.puts.keys())].sort((a, b) => a - b);
  const target = spot * (1 - floorPct / 100);
  const strike = qClosestStrike(strikes, target);
  if (strike == null) return { spot };
  const put = state.summaries.get(bucket.puts.get(strike));
  if (!put || put.mark_price == null) return { spot, strike };
  const premiumUsd = put.mark_price * spot;
  const costPct = (premiumUsd / spot) * 100;
  const dte = (ts - Date.now()) / (24 * 60 * 60 * 1000);
  const annualizedCost = dte > 0 ? (costPct / dte) * 365 : null;
  const actualFloorPct = ((spot - strike) / spot) * 100;
  return { spot, strike, dte, iv: put.mark_iv, premiumUsd, costPct, annualizedCost, actualFloorPct };
}

function renderTable(rows) {
  const tbody = document.querySelector("#putTable tbody");
  const valid = rows.filter((r) => r && r.strike != null && r.premiumUsd != null);
  if (!valid.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No data</td></tr>';
    return;
  }
  tbody.innerHTML = valid
    .map(
      (r) => `
    <tr>
      <td>${qExpiryLabel(r.expiry)}</td>
      <td>${qFmt(r.dte, 0)}d</td>
      <td>${qFmt(r.strike, 0)}</td>
      <td>${qFmtSigned(-r.actualFloorPct, 1)}%</td>
      <td>${r.iv != null ? qFmt(r.iv, 1) + "%" : "—"}</td>
      <td>$${qFmt(r.premiumUsd, 0)}</td>
      <td>${qFmt(r.costPct, 2)}%</td>
      <td>${r.annualizedCost != null ? qFmt(r.annualizedCost, 1) + "%" : "—"}</td>
    </tr>`
    )
    .join("");
}

function renderPayoff(front, floorPct) {
  $("payoffExpiry").textContent = front ? qExpiryLabel(front.expiry) : "—";
  const el = $("payoffChart");
  if (!front || front.strike == null || front.spot == null || front.premiumUsd == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const spot = front.spot, strike = front.strike, premium = front.premiumUsd;
  const W = 640, H = 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo = spot * 0.5, hi = spot * 1.3;
  const steps = 100;
  const hedgedPnl = (S) => (S - spot) + Math.max(strike - S, 0) - premium;
  const unhedgedPnl = (S) => S - spot;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, hedged: hedgedPnl(S), unhedged: unhedgedPnl(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.max(Math.abs(p.hedged), Math.abs(p.unhedged))), 1) * 1.1;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  const kx = xScale(strike);
  svg += `<line x1="${kx}" y1="${padT}" x2="${kx}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
  svg += `<text x="${kx}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(strike, 0)}</text>`;
  const lineFor = (key, color) => {
    let d = "";
    pts.forEach((p, i) => {
      d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p[key]).toFixed(1)} `;
    });
    return `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"/>`;
  };
  svg += lineFor("unhedged", "#8892a6");
  svg += lineFor("hedged", "#35d399");
  svg += "</svg>";
  el.innerHTML = svg;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    const floorPct = Number($("floorSelect").value);

    const rows = state.expiries.map((ts) => {
      const a = analyzeExpiry(ts, floorPct);
      return a ? { expiry: ts, ...a } : null;
    });
    const valid = rows.filter(Boolean);
    const front = valid.find((r) => r.strike != null && r.premiumUsd != null);

    $("spotStat").textContent = front && front.spot != null ? "$" + qFmt(front.spot, 0) : valid[0] && valid[0].spot != null ? "$" + qFmt(valid[0].spot, 0) : "—";
    renderTable(rows);
    renderPayoff(front, floorPct);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("floorSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
