// BTC/ETH Correlation Cone strategy page — standalone, REST-only.
// The BTC/ETH Vol Pair page shows today's 30D correlation as one point estimate; this is
// the same idea as the Realized Volatility Cone applied to cross-asset correlation instead
// of single-asset vol: computes the full historical distribution of rolling correlation
// for several window lengths from real daily closes, and shows where today's reading
// falls inside it.

const HISTORY_DAYS = 400;
const WINDOWS = [14, 30, 60, 90];
const MIN_SAMPLES = 30;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function rollingCorrSeries(retA, retB, window) {
  const n = Math.min(retA.length, retB.length);
  const out = [];
  for (let end = window; end <= n; end++) {
    const c = qPearsonCorrelation(retA.slice(end - window, end), retB.slice(end - window, end));
    if (c != null) out.push(c);
  }
  return out;
}

function buildConeChart(cones) {
  const W = 640, H = 240, padL = 50, padR = 16, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = cones.length;
  const bandW = innerW / n;
  const allVals = cones.flatMap((c) => [c.min, c.max, c.current]).filter((v) => v != null);
  const loY = Math.min(...allVals, 0) - 0.05, hiY = Math.max(...allVals, 0) + 0.05;
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
    const [btcOhlc, ethOhlc] = await Promise.all([
      qFetchDailyCloses("BTC-PERPETUAL", HISTORY_DAYS),
      qFetchDailyCloses("ETH-PERPETUAL", HISTORY_DAYS),
    ]);
    const btcCloses = btcOhlc && btcOhlc.close ? btcOhlc.close : [];
    const ethCloses = ethOhlc && ethOhlc.close ? ethOhlc.close : [];
    const retA = qLogReturns(btcCloses);
    const retB = qLogReturns(ethCloses);

    const cones = WINDOWS.map((window) => {
      const series = rollingCorrSeries(retA, retB, window);
      const current = series.length ? series[series.length - 1] : null;
      if (!series.length) return { window, current: null, min: null, max: null, median: null, p25: null, p75: null, pct: null };
      const sorted = [...series].sort((a, b) => a - b);
      const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
      const pct = current != null && series.length >= MIN_SAMPLES ? qComputeRankPercentile(current, series, MIN_SAMPLES) : null;
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

    const front = cones.find((c) => c.current != null);
    $("corrStat").textContent = front ? qFmt(front.current * 100, 0) + "%" : "—";

    const tbody = document.querySelector("#coneTable tbody");
    tbody.innerHTML = cones
      .map(
        (c) => `
      <tr>
        <td>${c.window}D</td>
        <td>${c.current != null ? qFmt(c.current * 100, 0) + "%" : "—"}</td>
        <td>${c.min != null ? qFmt(c.min * 100, 0) + "%" : "—"}</td>
        <td>${c.median != null ? qFmt(c.median * 100, 0) + "%" : "—"}</td>
        <td>${c.max != null ? qFmt(c.max * 100, 0) + "%" : "—"}</td>
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
