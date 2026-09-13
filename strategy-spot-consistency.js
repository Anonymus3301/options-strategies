// Cross-Market Spot Consistency Check — standalone, REST-only.
// The Conversion/Reversal Scanner page explicitly disclosed a limitation: it only checks
// parity consistency WITHIN the options chain, against that chain's own aggregated median
// spot — never against an independent price. This page closes that gap directly: compares
// the options-implied spot (put-call parity, front expiry) against the perpetual's own
// mark price (an independent, non-options-derived number) and the nearest dated future's
// mark (shown for context with its own expected carry/basis, not flagged as a dislocation
// the way a big options-vs-perp gap would be, since a future's price legitimately differs
// from spot by its cost of carry while options-implied spot has no such structural reason
// to differ from the perpetual at all).

const CURRENCY = "BTC";
const DIVERGENCE_THRESHOLD_PCT = 0.5;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [optionInstruments, optionSummaries, futureInstruments, futureSummaries] = await Promise.all([
      qFetchInstruments(CURRENCY, "option", false),
      qFetchBookSummary(CURRENCY, "option"),
      qFetchInstruments(CURRENCY, "future", false),
      qFetchBookSummary(CURRENCY, "future"),
    ]);

    const instrumentsByExpiry = qGroupByExpiry(optionInstruments);
    const optionSummaryMap = new Map(optionSummaries.map((s) => [s.instrument_name, s]));
    const expiries = [...instrumentsByExpiry.keys()].sort((a, b) => a - b);
    const now = Date.now();

    let frontExpiry = null, optionsSpot = null;
    for (const expiry of expiries) {
      if (expiry <= now) continue;
      const bucket = instrumentsByExpiry.get(expiry);
      const s = qImpliedSpot(bucket, optionSummaryMap);
      if (s != null) {
        frontExpiry = expiry;
        optionsSpot = s;
        break;
      }
    }

    const futureSummaryMap = new Map(futureSummaries.map((s) => [s.instrument_name, s]));
    const perpSummary = futureSummaryMap.get(`${CURRENCY}-PERPETUAL`);
    const perpMark = perpSummary ? perpSummary.mark_price : null;

    const datedFutures = futureInstruments
      .filter((i) => i.settlement_period !== "perpetual")
      .map((i) => ({ name: i.instrument_name, expiry: i.expiration_timestamp, mark: (futureSummaryMap.get(i.instrument_name) || {}).mark_price }))
      .filter((f) => f.mark != null && f.expiry > now)
      .sort((a, b) => a.expiry - b.expiry);
    const nearestFuture = datedFutures[0] || null;

    $("perpStat").textContent = perpMark != null ? "$" + qFmt(perpMark, 0) : "—";
    $("optionsSpotStat").textContent = optionsSpot != null ? "$" + qFmt(optionsSpot, 0) + (frontExpiry ? ` (${qExpiryLabel(frontExpiry)})` : "") : "—";

    if (optionsSpot != null && perpMark != null) {
      const devPct = ((optionsSpot - perpMark) / perpMark) * 100;
      $("devStat").textContent = `${qFmtSigned(devPct, 2)}%`;
      const flagged = Math.abs(devPct) >= DIVERGENCE_THRESHOLD_PCT;
      $("readStat").textContent = flagged
        ? `Notably diverging (|${qFmt(Math.abs(devPct), 2)}%| ≥ ${DIVERGENCE_THRESHOLD_PCT}%) — options-implied spot has no structural reason to differ from the perpetual; worth a closer look at chain liquidity.`
        : "Consistent — options-implied spot tracks the perpetual closely, as expected.";
    } else {
      $("devStat").textContent = "—";
      $("readStat").textContent = "—";
    }

    if (nearestFuture && perpMark != null) {
      const dte = (nearestFuture.expiry - now) / (24 * 60 * 60 * 1000);
      const basis = (nearestFuture.mark - perpMark) / perpMark;
      const annualized = dte > 0 ? (basis / dte) * 365 * 100 : null;
      $("futureStat").textContent = `${nearestFuture.name}: $${qFmt(nearestFuture.mark, 0)} (${qExpiryLabel(nearestFuture.expiry)})`;
      $("futureBasisStat").textContent = annualized != null ? `${qFmtSigned(annualized, 1)}% annualized — expected carry, not a dislocation` : "—";
    } else {
      $("futureStat").textContent = "—";
      $("futureBasisStat").textContent = "—";
    }

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
