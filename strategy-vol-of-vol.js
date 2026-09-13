// Vol-of-Vol (IV Volatility) strategy page — standalone, REST-only.
// Every vol page on this site (IV Rank, IV Term Structure, VRP Term Structure, the
// Volatility Cone) measures the LEVEL of implied or realized vol, or how that level ranks
// against its own recent range. None of them measure how much IV itself moves day to day
// — a genuinely different quantity ("vol of vol"), relevant to how much a long-vega
// calendar or vega-neutral position's own hedge ratio should be expected to drift over
// time. Writes to and reads from the exact same this-browser daily ATM-IV history the IV
// Rank feature already maintains (same localStorage key), then treats that accumulated IV
// series the same way qAnnualizedVol treats a price-close series.

const CURRENCY = "BTC";
const IV_HISTORY_KEY = "btc-options-iv-history-v1"; // same key app.js's IV Rank writes
const IV_HISTORY_MAX_DAYS = 400;
const MIN_DAYS = 10;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function frontMonthAtmIv() {
  const [instruments, summaries] = await Promise.all([
    qFetchInstruments(CURRENCY, "option", false),
    qFetchBookSummary(CURRENCY, "option"),
  ]);
  const instrumentsByExpiry = qGroupByExpiry(instruments);
  const expiries = [...instrumentsByExpiry.keys()].sort((a, b) => a - b);
  const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
  const front = expiries[0];
  if (front == null) return { spot: null, atmIv: null };
  const bucket = instrumentsByExpiry.get(front);
  const spot = qImpliedSpot(bucket, summaryMap);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot, atmIv: null };
  const call = summaryMap.get(bucket.calls.get(atm));
  const put = summaryMap.get(bucket.puts.get(atm));
  const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  return { spot, atmIv };
}

function dailyIvChangesPp(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] - series[i - 1]);
  return out;
}

function render(series) {
  const days = series.length;
  $("historyDaysStat").textContent = `${days}d (this browser)`;

  if (days < MIN_DAYS) {
    $("volOfVolStat").textContent = `Collecting history (${days}d so far, need ${MIN_DAYS}+)`;
    $("avgDailyMoveStat").textContent = "—";
    $("sparkline").innerHTML = '<p class="loading">Not enough history yet</p>';
    return;
  }

  const volOfVol = qAnnualizedVol(series);
  const changes = dailyIvChangesPp(series);
  const meanAbsChange = changes.reduce((sum, c) => sum + Math.abs(c), 0) / changes.length;

  $("volOfVolStat").textContent = volOfVol != null ? `${qFmt(volOfVol, 1)}%` : "—";
  $("avgDailyMoveStat").textContent = `±${qFmt(meanAbsChange, 2)}pp/day`;
  $("sparkline").innerHTML = qBuildSparkline(series, { color: "#f7931a" });
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const { spot, atmIv } = await frontMonthAtmIv();
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
    $("currentIvStat").textContent = atmIv != null ? `${qFmt(atmIv, 1)}%` : "—";

    const history = qRecordDailyHistory(IV_HISTORY_KEY, "atmIv", atmIv, IV_HISTORY_MAX_DAYS);
    const series = history.map((h) => h.atmIv).filter((v) => v != null);
    render(series);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
