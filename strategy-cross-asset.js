// BTC/ETH Vol Pair Trade strategy page — standalone, REST-only.
// A two-asset relative-value vol read: front-month ATM IV for both, their 30D realized
// correlation, and a Spread Rank (this-browser localStorage history, same idea as IV
// Rank). Deliberately not called "dispersion" — that needs an index priced against 3+
// constituents, which doesn't exist for crypto.

const SPREAD_HISTORY_KEY = "btc-eth-vol-spread-history-v1";
const SPREAD_HISTORY_MAX_DAYS = 400;
const SPREAD_HISTORY_MIN_DAYS = 5;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function fetchFrontMonthAtmIv(currency) {
  const [instruments, summaries] = await Promise.all([
    qFetchInstruments(currency, "option", false),
    qFetchBookSummary(currency, "option"),
  ]);
  const byExpiry = qGroupByExpiry(instruments);
  const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
  const expiries = [...byExpiry.keys()].sort((a, b) => a - b);
  for (const ts of expiries) {
    const bucket = byExpiry.get(ts);
    const spot = qImpliedSpot(bucket, summaryMap);
    if (spot == null) continue;
    const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])];
    const atm = qClosestStrike(strikes, spot);
    if (atm == null) continue;
    const call = summaryMap.get(bucket.calls.get(atm));
    const put = summaryMap.get(bucket.puts.get(atm));
    const ivs = [call && call.mark_iv, put && put.mark_iv].filter((v) => v != null);
    if (!ivs.length) continue;
    return { atmIv: ivs.reduce((a, b) => a + b, 0) / ivs.length, spot, expiry: ts, atmStrike: atm, call, put };
  }
  return null;
}

function updateSpreadRankStat(spread) {
  const history = qRecordDailyHistory(SPREAD_HISTORY_KEY, "spread", spread, SPREAD_HISTORY_MAX_DAYS);
  const values = history.map((h) => h.spread).filter((v) => v != null);
  const res = qComputeRankPercentile(spread, values, SPREAD_HISTORY_MIN_DAYS);
  const el = $("spreadRankStat");
  if (spread == null || res.days < SPREAD_HISTORY_MIN_DAYS) {
    el.textContent = `Collecting history (${res.days}d so far, this browser — need ${SPREAD_HISTORY_MIN_DAYS}+)`;
  } else {
    el.textContent = `Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)`;
  }
  return { res, history };
}

function renderPairTrade(btc, eth) {
  const el = $("pairInfo");
  if (!btc || !eth || btc.atmIv == null || eth.atmIv == null) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  const cheaper = btc.atmIv <= eth.atmIv ? "BTC" : "ETH";
  const richer = cheaper === "BTC" ? "ETH" : "BTC";
  const cheaperInfo = cheaper === "BTC" ? btc : eth;
  const richerInfo = cheaper === "BTC" ? eth : btc;
  el.innerHTML = `
    <div class="scanner-rows">
      <div class="scanner-row"><span class="scanner-label">Structure</span><span class="scanner-value">Buy ${cheaper} ATM straddle (IV ${qFmt(cheaperInfo.atmIv, 1)}%), sell ${richer} ATM straddle (IV ${qFmt(richerInfo.atmIv, 1)}%)</span></div>
      <div class="scanner-row"><span class="scanner-label">${cheaper} ATM strike</span><span class="scanner-value">${qFmt(cheaperInfo.atmStrike, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">${richer} ATM strike</span><span class="scanner-value">${qFmt(richerInfo.atmStrike, 0)}</span></div>
      <div class="scanner-row"><span class="scanner-label">Sizing note</span><span class="scanner-value">Match notional vega, not contract count — ETH's per-contract vega differs from BTC's</span></div>
    </div>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [btc, eth] = await Promise.all([fetchFrontMonthAtmIv("BTC"), fetchFrontMonthAtmIv("ETH")]);

    $("spotStat").textContent =
      (btc && btc.spot != null ? "$" + qFmt(btc.spot, 0) : "—") + " / " + (eth && eth.spot != null ? "$" + qFmt(eth.spot, 0) : "—");
    $("btcIvStat").textContent = btc && btc.atmIv != null ? qFmt(btc.atmIv, 1) + "%" : "—";
    $("ethIvStat").textContent = eth && eth.atmIv != null ? qFmt(eth.atmIv, 1) + "%" : "—";

    const spread = btc && eth && btc.atmIv != null && eth.atmIv != null ? btc.atmIv - eth.atmIv : null;
    $("spreadStat").textContent = spread != null ? `${qFmtSigned(spread, 1)}pp` : "—";

    const [btcCloses, ethCloses] = await Promise.all([
      qFetchDailyCloses("BTC-PERPETUAL", 31),
      qFetchDailyCloses("ETH-PERPETUAL", 31),
    ]);
    const corr =
      btcCloses && btcCloses.close && ethCloses && ethCloses.close
        ? qPearsonCorrelation(qLogReturns(btcCloses.close), qLogReturns(ethCloses.close))
        : null;
    $("corrStat").textContent = corr != null ? qFmt(corr * 100, 0) + "%" : "—";

    const { history } = updateSpreadRankStat(spread);
    $("spreadSparkline").innerHTML = qBuildSparkline(history.map((h) => h.spread), { color: "#f7931a", zeroLine: true });

    renderPairTrade(btc, eth);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 60000);
