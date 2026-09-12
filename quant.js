// quant.js — shared fetch + math helpers for the standalone strategy pages.
// Each strategy page fetches its own data straight from Deribit's free public REST API
// (no WebSocket, no auth, no dependency on the main ladder page being open) and derives
// everything — including an implied spot price — from the same book-summary payload,
// using Black-Scholes at each strike's own quoted IV rather than live greeks. That keeps
// every page self-contained: open any one of them on its own and it still works.
//
// This intentionally does not share code with app.js's own copies of similar functions
// (e.g. bsPrice, computeRankPercentile) — app.js is the already-tested main dashboard,
// and duplicating a few dozen lines here is a safer tradeoff than risking a regression
// there for the sake of DRY.

const QUANT_REST_BASE = "https://www.deribit.com/api/v2/public";
const QUANT_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

async function qFetchInstruments(currency, kind, expired) {
  const url = `${QUANT_REST_BASE}/get_instruments?currency=${currency}&kind=${kind}&expired=${expired ? "true" : "false"}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function qFetchBookSummary(currency, kind) {
  const res = await fetch(`${QUANT_REST_BASE}/get_book_summary_by_currency?currency=${currency}&kind=${kind}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function qFetchDailyCloses(instrumentName, days) {
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const url = `${QUANT_REST_BASE}/get_tradingview_chart_data?instrument_name=${instrumentName}&start_timestamp=${start}&end_timestamp=${end}&resolution=1D`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// ---------- Black-Scholes (r=0, matching Deribit's own BTC/ETH options convention) ----------

function qErf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function qNormCdf(x) {
  return 0.5 * (1 + qErf(x / Math.SQRT2));
}

function qNormPdf(x) {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

function qBsPrice(type, S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return type === "call" ? S * qNormCdf(d1) - K * qNormCdf(d2) : K * qNormCdf(-d2) - S * qNormCdf(-d1);
}

function qBsDelta(type, S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return type === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return type === "call" ? qNormCdf(d1) : qNormCdf(d1) - 1;
}

function qBsGamma(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return qNormPdf(d1) / (S * sigma * Math.sqrt(T));
}

// Per-day theta (r=0, so the usual carry term vanishes for both call and put).
function qBsThetaPerDay(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return -(S * qNormPdf(d1) * sigma) / (2 * Math.sqrt(T)) / 365;
}

// ---------- Chain grouping + implied spot via put-call parity ----------

function qGroupByExpiry(instruments) {
  const map = new Map();
  for (const inst of instruments) {
    const expiry = inst.expiration_timestamp;
    if (!map.has(expiry)) map.set(expiry, { calls: new Map(), puts: new Map() });
    const bucket = map.get(expiry);
    (inst.option_type === "call" ? bucket.calls : bucket.puts).set(inst.strike, inst.instrument_name);
  }
  return map;
}

// Implied spot via put-call parity, r=0: C_usd - P_usd = S - K, and C_usd = C_coin * S,
// so S = K / (1 - (C_coin - P_coin)). Median across strikes in the bucket for robustness
// against any single noisy quote. Avoids trusting an unverified underlying_price field.
function qImpliedSpot(bucket, summaryMap) {
  const spots = [];
  const strikes = new Set([...bucket.calls.keys(), ...bucket.puts.keys()]);
  for (const strike of strikes) {
    const call = summaryMap.get(bucket.calls.get(strike));
    const put = summaryMap.get(bucket.puts.get(strike));
    if (call && put && call.mark_price != null && put.mark_price != null) {
      const denom = 1 - (call.mark_price - put.mark_price);
      if (denom > 0.2 && denom < 5) spots.push(strike / denom);
    }
  }
  if (!spots.length) return null;
  spots.sort((a, b) => a - b);
  return spots[Math.floor(spots.length / 2)];
}

function qClosestStrike(strikes, target) {
  if (!strikes.length || target == null) return null;
  return strikes.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best));
}

// ---------- Generic rank/percentile + localStorage daily history ----------
// Shares localStorage KEYS with app.js's own IV/Skew Rank features (same key names), so
// a strategy page opened in the same browser sees the same accumulated history the main
// ladder page has been building, and vice versa.

function qComputeRankPercentile(currentVal, values, minDays) {
  if (currentVal == null || values.length < minDays) return { days: values.length };
  const min = Math.min(...values), max = Math.max(...values);
  const rank = max === min ? 50 : ((currentVal - min) / (max - min)) * 100;
  const percentile = (values.filter((v) => v <= currentVal).length / values.length) * 100;
  return { rank, percentile, days: values.length };
}

function qLoadDailyHistory(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function qRecordDailyHistory(key, field, value, maxDays) {
  if (value == null) return qLoadDailyHistory(key);
  const today = new Date().toISOString().slice(0, 10);
  const history = qLoadDailyHistory(key);
  const last = history[history.length - 1];
  if (last && last.date === today) last[field] = value;
  else history.push({ date: today, [field]: value });
  if (history.length > maxDays) history.splice(0, history.length - maxDays);
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch (err) {
    // Private browsing / quota exceeded — history just won't persist across reloads.
  }
  return history;
}

// ---------- Realized vol / correlation ----------

function qLogReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

function qAnnualizedVol(closes) {
  if (!closes || closes.length < 3) return null;
  const returns = qLogReturns(closes);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

function qPearsonCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const xs = a.slice(-n), ys = b.slice(-n);
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

// ---------- Formatting ----------

function qFmt(n, digits = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function qFmtSigned(n, digits = 1) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${qFmt(n, digits)}`;
}

function qExpiryLabel(ts) {
  const d = new Date(ts);
  const days = Math.round((ts - Date.now()) / (24 * 60 * 60 * 1000));
  const dateStr = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
  return days >= 0 ? `${dateStr} (${days}d)` : `${dateStr} (${Math.abs(days)}d ago)`;
}

// ---------- Generic multi-leg payoff-at-expiry SVG ----------
// legs: [{ type: "call"|"put", side: "long"|"short", strike, premiumUsd, qty }]

function qBuildPayoffSvg(legs, spot, opts = {}) {
  const W = opts.width || 640, H = opts.height || 220, padL = 50, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const strikes = legs.map((l) => l.strike);
  const lo = Math.min(spot, ...strikes) * 0.7;
  const hi = Math.max(spot, ...strikes) * 1.3;
  const steps = 100;
  const pnlAt = (S) =>
    legs.reduce((sum, leg) => {
      const intrinsic = leg.type === "call" ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
      const legPnl = leg.side === "long" ? intrinsic - leg.premiumUsd : leg.premiumUsd - intrinsic;
      return sum + legPnl * (leg.qty || 1);
    }, 0);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    pts.push({ S, pnl: pnlAt(S) });
  }
  const xScale = (S) => padL + ((S - lo) / (hi - lo)) * innerW;
  const maxAbs = Math.max(...pts.map((p) => Math.abs(p.pnl)), 1) * 1.15;
  const yScale = (pnl) => padT + innerH / 2 - (pnl / maxAbs) * (innerH / 2);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const zeroY = yScale(0);
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  const spotX = xScale(spot);
  svg += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${H - padB}" stroke="#f7931a" stroke-width="1" stroke-dasharray="3,3"/>`;
  svg += `<text x="${spotX}" y="${padT - 2}" font-size="9" fill="#f7931a" text-anchor="middle">spot</text>`;
  const seenX = new Set();
  strikes.forEach((K) => {
    const x = xScale(K).toFixed(1);
    if (seenX.has(x)) return;
    seenX.add(x);
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#8892a6" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<text x="${x}" y="${H - padB + 12}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(K, 0)}</text>`;
  });
  let d = "";
  pts.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${xScale(p.S).toFixed(1)},${yScale(p.pnl).toFixed(1)} `;
  });
  svg += `<path d="${d.trim()}" fill="none" stroke="${opts.color || "#35d399"}" stroke-width="2"/>`;
  svg += "</svg>";
  return svg;
}

// ---------- Simple signed bar chart (category labels, not numeric x-axis) ----------

function qBuildBarChart(categories, values, opts = {}) {
  const W = opts.width || 640, H = opts.height || 200, padL = 46, padR = 12, padT = 14, padB = 34;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxAbs = Math.max(...values.map((v) => Math.abs(v || 0)), 1) * 1.15;
  const zeroY = padT + innerH / 2;
  const scale = innerH / 2 / maxAbs;
  const n = categories.length;
  const bandW = innerW / n;
  const barW = Math.max(1, bandW * 0.55);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="#232a3a" stroke-width="1"/>`;
  categories.forEach((label, i) => {
    const v = values[i] || 0;
    const cx = padL + bandW * i + bandW / 2;
    const h = Math.abs(v) * scale;
    const color = v >= 0 ? opts.posColor || "#35d399" : opts.negColor || "#ff5c7c";
    const y = v >= 0 ? zeroY - h : zeroY;
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    svg += `<text x="${cx.toFixed(1)}" y="${H - padB + 14}" font-size="9" fill="#8892a6" text-anchor="middle">${label}</text>`;
    svg += `<text x="${cx.toFixed(1)}" y="${(v >= 0 ? y - 4 : y + h + 12).toFixed(1)}" font-size="9" fill="#8892a6" text-anchor="middle">${qFmt(v, 1)}</text>`;
  });
  svg += "</svg>";
  return svg;
}

// ---------- Minimal shared line-chart SVG (sparkline / history charts) ----------

function qBuildSparkline(values, opts = {}) {
  const W = opts.width || 600, H = opts.height || 120, pad = 14;
  const clean = values.filter((v) => v != null);
  if (clean.length < 2) return '<p class="loading">Not enough history yet</p>';
  const min = Math.min(...clean), max = Math.max(...clean);
  const range = max - min || 1;
  const stepX = (W - pad * 2) / (values.length - 1);
  const yFor = (v) => H - pad - ((v - min) / range) * (H - pad * 2);
  let d = "";
  values.forEach((v, i) => {
    if (v == null) return;
    const x = pad + i * stepX;
    d += `${d ? "L" : "M"}${x.toFixed(1)},${yFor(v).toFixed(1)} `;
  });
  const color = opts.color || "#f7931a";
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"/>`;
  if (opts.zeroLine && min < 0 && max > 0) {
    const zy = yFor(0);
    svg += `<line x1="${pad}" y1="${zy}" x2="${W - pad}" y2="${zy}" stroke="#8892a6" stroke-width="1" stroke-dasharray="3,3"/>`;
  }
  svg += `<text x="${pad}" y="12" font-size="10" fill="#8892a6">${qFmt(max, 1)}</text>`;
  svg += `<text x="${pad}" y="${H - 4}" font-size="10" fill="#8892a6">${qFmt(min, 1)}</text>`;
  svg += "</svg>";
  return svg;
}
