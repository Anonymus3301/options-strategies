// Gamma Scalping (Delta-Hedged Straddle Backtest) strategy page — standalone, REST-only.
// Backtests a daily-rehedged long ATM straddle over a trailing window of actual historical
// BTC-PERPETUAL closes, using today's ATM IV as a constant assumed pricing/hedging vol
// throughout (no historical IV series is available from this free API). The option's own
// mark-to-market change and the cumulative hedge-trading P&L are computed from the same
// Black-Scholes model, so the decomposition is internally consistent by construction.

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

function atmInfoForExpiry(ts) {
  const bucket = state.instrumentsByExpiry.get(ts);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])];
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot };
  const call = state.summaries.get(bucket.calls.get(atm));
  const put = state.summaries.get(bucket.puts.get(atm));
  const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
  return { spot, atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null };
}

async function frontMonthAtmIv() {
  const [instruments, summaries] = await Promise.all([
    qFetchInstruments(CURRENCY, "option", false),
    qFetchBookSummary(CURRENCY, "option"),
  ]);
  state.instrumentsByExpiry = qGroupByExpiry(instruments);
  state.expiries = [...state.instrumentsByExpiry.keys()].sort((a, b) => a - b);
  state.summaries = new Map(summaries.map((s) => [s.instrument_name, s]));
  for (const ts of state.expiries) {
    const info = atmInfoForExpiry(ts);
    if (info && info.atmIv != null) return info;
  }
  return state.expiries.length ? atmInfoForExpiry(state.expiries[0]) : null;
}

function runBacktest(path, K, sigma, windowDays) {
  const optVal = [], delta = [];
  for (let i = 0; i <= windowDays; i++) {
    const Ti = Math.max((windowDays - i) / 365.25, 1 / 365 / 24);
    const S = path[i];
    optVal.push(qBsPrice("call", S, K, Ti, sigma) + qBsPrice("put", S, K, Ti, sigma));
    delta.push(qBsDelta("call", S, K, Ti, sigma) + qBsDelta("put", S, K, Ti, sigma));
  }
  let cumHedgePnl = 0;
  const running = [0]; // day 0: net P&L is 0 by definition
  for (let i = 1; i <= windowDays; i++) {
    const heldShares = -delta[i - 1];
    cumHedgePnl += heldShares * (path[i] - path[i - 1]);
    const optionPnlSoFar = optVal[i] - optVal[0];
    running.push(optionPnlSoFar + cumHedgePnl);
  }
  const optionPnl = optVal[windowDays] - optVal[0];
  return { entryCost: optVal[0], cumHedgePnl, optionPnl, netPnl: optionPnl + cumHedgePnl, running };
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const windowDays = Number($("windowSelect").value);

    const [atmInfo, ohlc] = await Promise.all([
      frontMonthAtmIv(),
      qFetchDailyCloses("BTC-PERPETUAL", windowDays + 5),
    ]);

    const spot = atmInfo ? atmInfo.spot : null;
    $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";

    const closes = ohlc && ohlc.close ? ohlc.close : [];
    const path = closes.slice(-(windowDays + 1));

    if (!atmInfo || atmInfo.atmIv == null || path.length < windowDays + 1) {
      $("setupStat").textContent = "Insufficient data";
      $("entryCostStat").textContent = "—";
      $("hedgePnlStat").textContent = "—";
      $("optionPnlStat").textContent = "—";
      $("netPnlStat").textContent = "—";
      $("volCompareStat").textContent = "—";
      $("pnlChart").innerHTML = '<p class="loading">Not enough price history or IV data for this window</p>';
      setStatus("live", "pill-live");
      return;
    }

    const sigma = atmInfo.atmIv / 100;
    const K = Math.round(path[0] / 500) * 500;
    const result = runBacktest(path, K, sigma, windowDays);
    const realizedVol = qAnnualizedVol(path);

    $("setupStat").textContent = `${qFmt(K, 0)} / $${qFmt(path[0], 0)} / ${qFmt(atmInfo.atmIv, 1)}%`;
    $("entryCostStat").textContent = `$${qFmt(result.entryCost, 0)}`;
    $("hedgePnlStat").textContent = `${result.cumHedgePnl >= 0 ? "+" : ""}$${qFmt(result.cumHedgePnl, 0)}`;
    $("optionPnlStat").textContent = `${result.optionPnl >= 0 ? "+" : ""}$${qFmt(result.optionPnl, 0)}`;
    $("netPnlStat").textContent = `${result.netPnl >= 0 ? "+" : ""}$${qFmt(result.netPnl, 0)}`;
    $("volCompareStat").textContent =
      realizedVol != null
        ? `Realized ${qFmt(realizedVol, 1)}% vs. assumed ${qFmt(atmInfo.atmIv, 1)}% (${qFmtSigned(realizedVol - atmInfo.atmIv, 1)}pp)`
        : "—";

    $("pnlChart").innerHTML = qBuildSparkline(result.running, { color: result.netPnl >= 0 ? "#35d399" : "#ff5c7c", zeroLine: true });

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("windowSelect").addEventListener("change", refresh);

refresh();
setInterval(refresh, 30000);
