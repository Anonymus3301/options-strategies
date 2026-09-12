// Put/Call Ratio contrarian sentiment strategy page — standalone, REST-only.
// Combines every live expiry's OI/volume into one whole-chain PCR, tracked over time in
// this browser's localStorage the same way IV Rank is, and read as a (weak) contrarian
// signal when it sits at an extreme vs. its own recent range.

const CURRENCY = "BTC";
const PCR_HISTORY_KEY = "btc-options-pcr-history-v1";
const PCR_HISTORY_MAX_DAYS = 400;
const PCR_HISTORY_MIN_DAYS = 5;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function updatePcrRankStat(pcrOi) {
  const history = qRecordDailyHistory(PCR_HISTORY_KEY, "pcr", pcrOi, PCR_HISTORY_MAX_DAYS);
  const values = history.map((h) => h.pcr).filter((v) => v != null);
  const res = qComputeRankPercentile(pcrOi, values, PCR_HISTORY_MIN_DAYS);
  const el = $("pcrRankStat");
  if (pcrOi == null || res.days < PCR_HISTORY_MIN_DAYS) {
    el.textContent = `Collecting history (${res.days}d so far, this browser — need ${PCR_HISTORY_MIN_DAYS}+)`;
  } else {
    el.textContent = `Rank ${qFmt(res.rank, 0)} · Pctl ${qFmt(res.percentile, 0)} (${res.days}d, this browser)`;
  }
  return { res, history };
}

function renderSignal(res) {
  const el = $("signalBody");
  if (res.days < PCR_HISTORY_MIN_DAYS) {
    el.innerHTML = `<p class="loading">Collecting history (${res.days}d so far, need ${PCR_HISTORY_MIN_DAYS}+)</p>`;
    return;
  }
  let verdict, level;
  if (res.percentile >= 80) {
    verdict = "Elevated put positioning vs. its own recent range — historically a contrarian-bullish extreme";
    level = "favorable";
  } else if (res.percentile <= 20) {
    verdict = "Elevated call positioning vs. its own recent range — historically a contrarian-bearish extreme";
    level = "unfavorable";
  } else {
    verdict = "PCR sits within its normal recent range — no extreme reading";
    level = "neutral";
  }
  el.innerHTML = `<div class="scanner-verdict scanner-${level}">${verdict}</div>`;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [instruments, summaries] = await Promise.all([
      qFetchInstruments(CURRENCY, "option", false),
      qFetchBookSummary(CURRENCY, "option"),
    ]);
    const instrumentsByExpiry = qGroupByExpiry(instruments);
    const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));

    let anySpot = null;
    let callVol = 0, putVol = 0, callOi = 0, putOi = 0;
    for (const bucket of instrumentsByExpiry.values()) {
      if (anySpot == null) anySpot = qImpliedSpot(bucket, summaryMap);
      for (const name of bucket.calls.values()) {
        const s = summaryMap.get(name);
        if (s) {
          callVol += s.volume || 0;
          callOi += s.open_interest || 0;
        }
      }
      for (const name of bucket.puts.values()) {
        const s = summaryMap.get(name);
        if (s) {
          putVol += s.volume || 0;
          putOi += s.open_interest || 0;
        }
      }
    }

    $("spotStat").textContent = anySpot != null ? "$" + qFmt(anySpot, 0) : "—";

    const pcrOi = callOi > 0 ? putOi / callOi : null;
    const pcrVol = callVol > 0 ? putVol / callVol : null;
    $("pcrOiStat").textContent = pcrOi != null ? qFmt(pcrOi, 2) : "—";
    $("pcrVolStat").textContent = pcrVol != null ? qFmt(pcrVol, 2) : "—";

    const { res, history } = updatePcrRankStat(pcrOi);
    renderSignal(res);
    $("pcrSparkline").innerHTML = qBuildSparkline(history.map((h) => h.pcr), { color: "#f7931a" });

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
