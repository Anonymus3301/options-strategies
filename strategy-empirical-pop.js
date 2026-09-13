// Empirical vs. Risk-Neutral POP Backtest — standalone, REST-only.
// Every Probability of Profit stat on this site (and this page's own risk-neutral figure)
// comes from the lognormal distribution implied by quoted IV — a forward-looking, model
// assumption. This page is the one empirical check on the whole site: for an ATM long
// straddle at the selected expiry, it walks ~400 days of REAL historical closes and asks
// how often a move at least as large as the straddle's own breakeven % has actually
// happened over a window of that same length — then compares that empirical frequency
// directly against the model's own risk-neutral POP for the identical structure.

const CURRENCY = "BTC";
const HISTORY_DAYS = 400;

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

function computeStraddle() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  if (!bucket) return null;
  const spot = qImpliedSpot(bucket, state.summaries);
  if (spot == null) return { spot };
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);
  if (atm == null) return { spot };
  const call = state.summaries.get(bucket.calls.get(atm));
  const put = state.summaries.get(bucket.puts.get(atm));
  if (!call || !put || call.mark_price == null || put.mark_price == null) return { spot, atm };
  const premiumUsd = (call.mark_price + put.mark_price) * spot;
  const breakevenPct = premiumUsd / spot;
  const ivs = [call.mark_iv, put.mark_iv].filter((v) => v != null);
  const iv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const dte = Math.max(1, Math.round((state.selectedExpiry - Date.now()) / (24 * 60 * 60 * 1000)));
  return { spot, atm, premiumUsd, breakevenPct, iv, dte };
}

function empiricalWinRate(closes, dte, breakevenPct) {
  const windows = closes.length - dte;
  if (windows < 20) return null;
  let hits = 0, total = 0;
  for (let i = 0; i < windows; i++) {
    const movePct = Math.abs(closes[i + dte] / closes[i] - 1);
    if (movePct >= breakevenPct) hits++;
    total++;
  }
  return { rate: (hits / total) * 100, total, hits };
}

function riskNeutralPop(spot, atm, premiumUsd, iv, dte) {
  if (iv == null) return null;
  const T = dte / 365.25;
  const legs = [
    { type: "call", side: "long", strike: atm, premiumUsd: premiumUsd / 2 },
    { type: "put", side: "long", strike: atm, premiumUsd: premiumUsd / 2 },
  ];
  return qComputeProbabilityOfProfit(legs, spot, iv / 100, T);
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [ohlc] = await Promise.all([qFetchDailyCloses("BTC-PERPETUAL", HISTORY_DAYS), loadChain()]);
    renderExpirySelect();
    const closes = ohlc && ohlc.close ? ohlc.close : [];

    const s = computeStraddle();
    $("spotStat").textContent = s && s.spot != null ? "$" + qFmt(s.spot, 0) : "—";

    if (!s || s.breakevenPct == null || s.iv == null) {
      $("breakevenStat").textContent = "—";
      $("empiricalStat").textContent = "—";
      $("riskNeutralStat").textContent = "—";
      $("readStat").textContent = "—";
      setStatus("live", "pill-live");
      return;
    }

    $("breakevenStat").textContent = `±${qFmt(s.breakevenPct * 100, 1)}% (${qFmt(s.dte, 0)}d)`;

    const emp = empiricalWinRate(closes, s.dte, s.breakevenPct);
    const rn = riskNeutralPop(s.spot, s.atm, s.premiumUsd, s.iv, s.dte);

    $("empiricalStat").textContent = emp != null ? `${qFmt(emp.rate, 1)}% (${emp.hits}/${emp.total} windows)` : "Not enough history for this DTE";
    $("riskNeutralStat").textContent = rn != null ? `${qFmt(rn, 1)}%` : "—";

    if (emp != null && rn != null) {
      const gap = emp.rate - rn;
      $("readStat").textContent =
        Math.abs(gap) < 3
          ? "Roughly in agreement — historical moves of this size have happened about as often as the option market's own IV implies."
          : gap > 0
          ? `Empirical rate runs ${qFmt(gap, 1)}pp HIGHER than risk-neutral — big moves of this size have historically been more common than current IV prices in (long vol favored, historically).`
          : `Empirical rate runs ${qFmt(-gap, 1)}pp LOWER than risk-neutral — big moves of this size have historically been rarer than current IV prices in (premium selling favored, historically).`;
    } else {
      $("readStat").textContent = "—";
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
setInterval(refresh, 60000);
