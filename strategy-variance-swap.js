// Variance Swap / Model-Free Implied Volatility strategy page — standalone, REST-only.
// Computes the "fair" variance-swap strike from the whole option chain via the same
// log-contract replication behind the CBOE VIX and Deribit's own DVOL: a static portfolio
// of OTM options weighted 1/K^2, summed across every listed strike. With r=0 (this app's
// convention throughout) the forward equals the implied spot, dropping the usual
// discounting term.

const CURRENCY = "BTC";
const MIN_STRIKES = 6;

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

function computeFairVol() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const curve = qBuildOtmPriceCurve(bucket, state.summaries, spot);
  if (curve.strikes.length < MIN_STRIKES) return { spot, insufficient: true, strikeCount: curve.strikes.length };
  const variance = qModelFreeVariance(curve.strikes, curve.prices, spot, T);
  const fairVol = variance != null ? Math.sqrt(variance) * 100 : null;

  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  const atmCall = atm != null ? state.summaries.get(bucket.calls.get(atm)) : null;
  const atmPut = atm != null ? state.summaries.get(bucket.puts.get(atm)) : null;
  const ivs = [atmCall && atmCall.mark_iv, atmPut && atmPut.mark_iv].filter((v) => v != null);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return { spot, fairVol, atmIv, strikeCount: curve.strikes.length };
}

async function refreshRealizedVol() {
  const ohlc = await qFetchDailyCloses("BTC-PERPETUAL", 31);
  const closes = ohlc && ohlc.close ? ohlc.close : [];
  const windows = [7, 14, 30];
  const out = {};
  for (const w of windows) out[w] = closes.length >= w + 1 ? qAnnualizedVol(closes.slice(-(w + 1))) : null;
  return out;
}

function renderBarChart(fairVol, atmIv, rvol30) {
  const el = $("barChart");
  const categories = ["Fair Vol", "ATM IV", "30D RVol"];
  const values = [fairVol, atmIv, rvol30];
  if (values.every((v) => v == null)) {
    el.innerHTML = '<p class="loading">No data</p>';
    return;
  }
  el.innerHTML = qBuildBarChart(categories, values.map((v) => v ?? 0), { posColor: "#f7931a" });
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();

    const result = computeFairVol();
    $("spotStat").textContent = result && result.spot != null ? "$" + qFmt(result.spot, 0) : "—";

    if (!result || result.insufficient || result.fairVol == null) {
      $("fairVolStat").textContent = result && result.insufficient ? `Insufficient data (${result.strikeCount} strikes)` : "—";
      $("atmIvStat").textContent = result && result.atmIv != null ? qFmt(result.atmIv, 1) + "%" : "—";
      $("rvolStat").textContent = "—";
      $("premiumStat").textContent = "—";
      $("skewContribStat").textContent = "—";
      renderBarChart(null, result ? result.atmIv : null, null);
    } else {
      $("fairVolStat").textContent = qFmt(result.fairVol, 1) + "%";
      $("atmIvStat").textContent = result.atmIv != null ? qFmt(result.atmIv, 1) + "%" : "—";
      $("skewContribStat").textContent = result.atmIv != null ? `${qFmtSigned(result.fairVol - result.atmIv, 1)}pp` : "—";

      const rvol = await refreshRealizedVol();
      $("rvolStat").textContent = [7, 14, 30].map((w) => `${w}D ${rvol[w] != null ? qFmt(rvol[w], 1) : "—"}`).join(" · ");
      $("premiumStat").textContent = rvol[30] != null ? `${qFmtSigned(result.fairVol - rvol[30], 1)}pp` : "—";
      renderBarChart(result.fairVol, result.atmIv, rvol[30]);
    }

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
