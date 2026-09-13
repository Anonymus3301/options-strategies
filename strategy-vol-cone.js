// Volatility Cone strategy page — standalone, REST-only.
// Every other page here that shows realized vol (Premium Selling, Long Volatility, the
// Strategy Hub snapshot) shows a single point estimate per window (e.g. "30D RVol: 55%").
// This page instead computes the FULL historical distribution of realized vol for each
// window length from real daily closes (Deribit's own get_tradingview_chart_data, not a
// simulation), and shows where today's reading falls inside that distribution — the
// classic "volatility cone" (Burghardt-style) read.

const HISTORY_DAYS = 400;
const WINDOWS = [7, 14, 30, 60, 90];
const MIN_SAMPLES = 30;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

// Rolling realized vol series for one window length across the whole close history.
function rollingVolSeries(closes, window) {
  const out = [];
  for (let end = window; end < closes.length; end++) {
    const v = qAnnualizedVol(closes.slice(end - window, end + 1));
    if (v != null) out.push(v);
  }
  return out;
}

function percentileOf(current, series) {
  if (current == null || series.length < MIN_SAMPLES) return null;
  return qComputeRankPercentile(current, series, MIN_SAMPLES);
}

function buildConeChart(cones) {
  const W = 640, H = 260, padL = 50, padR = 16, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = cones.length;
  const bandW = innerW / n;
  const allVals = cones.flatMap((c) => [c.min, c.max, c.current]).filter((v) => v != null);
  const loY = Math.min(...allVals) * 0.9, hiY = Math.max(...allVals) * 1.1;
  const yScale = (v) => padT + innerH - ((v - loY) / (hiY - loY)) * innerH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#232a3a" stroke-width="1"/>`;
  cones.forEach((c, i) => {
    const cx = padL + bandW * i + bandW / 2;
    if (c.min != null && c.max != null) {
      svg += `<line x1="${cx.toFixed(1)}" y1="${yScale(c.min).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yScale(c.max).toFixed(1)}" stroke="#3a4258" stroke-width="6" stroke-linecap="round"/>`;
    }
    if (c.p25 != null && c.p75 != null) {
      svg += `<line x1="${cx.toFixed(1)}" y1="${yScale(c.p25).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yScale(c.p75).toFixed(1)}" stroke="#8892a6" stroke-width="9" stroke-linecap="round"/>`;
    }
    if (c.median != null) {
      const my = yScale(c.median);
      svg += `<line x1="${(cx - bandW * 0.28).toFixed(1)}" y1="${my.toFixed(1)}" x2="${(cx + bandW * 0.28).toFixed(1)}" y2="${my.toFixed(1)}" stroke="#8892a6" stroke-width="2"/>`;
    }
    if (c.current != null) {
      svg += `<circle cx="${cx.toFixed(1)}" cy="${yScale(c.current).toFixed(1)}" r="5" fill="#f7931a"/>`;
    }
    svg += `<text x="${cx.toFixed(1)}" y="${H - padB + 14}" font-size="10" fill="#8892a6" text-anchor="middle">${c.window}D</text>`;
  });
  svg += "</svg>";
  return svg;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const ohlc = await qFetchDailyCloses("BTC-PERPETUAL", HISTORY_DAYS);
    const closes = ohlc && ohlc.close ? ohlc.close : [];
    $("spotStat").textContent = closes.length ? "$" + qFmt(closes[closes.length - 1], 0) : "—";

    const cones = WINDOWS.map((window) => {
      const series = rollingVolSeries(closes, window);
      const current = series.length ? series[series.length - 1] : null;
      if (!series.length) return { window, current: null, min: null, max: null, median: null, p25: null, p75: null, pct: null };
      const sorted = [...series].sort((a, b) => a - b);
      const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
      const pct = percentileOf(current, series);
      return {
        window,
        current,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p25: q(0.25),
        p75: q(0.75),
        median: q(0.5),
        pct,
      };
    });

    const tbody = document.querySelector("#coneTable tbody");
    tbody.innerHTML = cones
      .map(
        (c) => `
      <tr>
        <td>${c.window}D</td>
        <td>${c.current != null ? qFmt(c.current, 1) + "%" : "—"}</td>
        <td>${c.min != null ? qFmt(c.min, 1) + "%" : "—"}</td>
        <td>${c.median != null ? qFmt(c.median, 1) + "%" : "—"}</td>
        <td>${c.max != null ? qFmt(c.max, 1) + "%" : "—"}</td>
        <td>${c.pct != null ? qFmt(c.pct.percentile, 0) + "%ile (" + c.pct.days + "d)" : "collecting"}</td>
      </tr>`
      )
      .join("");

    $("coneChart").innerHTML = buildConeChart(cones);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 60000);
