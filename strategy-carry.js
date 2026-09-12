// Carry & Funding (cash-and-carry basis trade) strategy page — standalone, REST-only.
// Uses only futures/perpetual data (get_instruments + get_book_summary_by_currency with
// kind=future, which on Deribit covers dated futures AND the perpetual in one call) — no
// options chain needed. The perpetual's own mark price stands in for "spot" since it
// isn't independently fetched here; Deribit keeps it tightly pinned via funding.
//
// Funding rate fields (current_funding / funding_8h) come straight from Deribit's book
// summary response; if a future release of this app finds those fields missing or
// renamed, the funding tile below falls back to "—" rather than asserting a value.

const CURRENCY = "BTC";
const FUNDING_HISTORY_KEY = "btc-options-funding-history-v1";
const FUNDING_HISTORY_MAX_POINTS = 200;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function recordFundingHistory(rate) {
  if (rate == null) return;
  try {
    const raw = localStorage.getItem(FUNDING_HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    history.push(rate);
    if (history.length > FUNDING_HISTORY_MAX_POINTS) history.splice(0, history.length - FUNDING_HISTORY_MAX_POINTS);
    localStorage.setItem(FUNDING_HISTORY_KEY, JSON.stringify(history));
    return history;
  } catch (err) {
    return null;
  }
}

function loadFundingHistory() {
  try {
    const raw = localStorage.getItem(FUNDING_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function renderFuturesTable(perpMark, futures) {
  const tbody = document.querySelector("#futuresTable tbody");
  if (!futures.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No dated futures found</td></tr>';
    return;
  }
  const now = Date.now();
  let bestIdx = -1, bestAbs = -1;
  const rows = futures.map((f, i) => {
    const dte = (f.expiry - now) / (24 * 60 * 60 * 1000);
    const basis = perpMark != null && f.mark != null ? (f.mark - perpMark) / perpMark : null;
    const annualized = basis != null && dte > 0 ? (basis / dte) * 365 * 100 : null;
    if (annualized != null && Math.abs(annualized) > bestAbs) {
      bestAbs = Math.abs(annualized);
      bestIdx = i;
    }
    return { name: f.name, expiry: f.expiry, dte, mark: f.mark, basis, annualized };
  });
  tbody.innerHTML = rows
    .map(
      (r, i) => `
    <tr>
      <td>${r.name}</td>
      <td>${qExpiryLabel(r.expiry)}</td>
      <td>${qFmt(r.dte, 0)}d</td>
      <td>${qFmt(r.mark, 2)}</td>
      <td>${r.basis != null ? qFmtSigned(r.basis * 100, 2) + "%" : "—"}</td>
      <td class="${i === bestIdx ? "best" : ""}">${r.annualized != null ? qFmtSigned(r.annualized, 1) + "%" : "—"}</td>
    </tr>`
    )
    .join("");
  return { rows, bestIdx };
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [instruments, summaries] = await Promise.all([
      qFetchInstruments(CURRENCY, "future", false),
      qFetchBookSummary(CURRENCY, "future"),
    ]);
    const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
    const perpSummary = summaryMap.get(`${CURRENCY}-PERPETUAL`);
    const perpMark = perpSummary ? perpSummary.mark_price : null;

    $("spotStat").textContent = perpMark != null ? "$" + qFmt(perpMark, 0) : "—";

    const currentFunding = perpSummary ? perpSummary.current_funding : undefined;
    const funding8h = perpSummary ? perpSummary.funding_8h : undefined;
    if (funding8h != null) {
      const annualized = funding8h * 3 * 365 * 100; // 3 fundings/day * 365
      $("fundingStat").textContent = `${qFmtSigned(funding8h * 100, 4)}% / 8h · ${qFmtSigned(annualized, 1)}% annualized`;
      const history = recordFundingHistory(funding8h * 100);
      $("fundingSparkline").innerHTML = qBuildSparkline((history || loadFundingHistory()), { color: "#f7931a", zeroLine: true });
    } else {
      $("fundingStat").textContent = currentFunding != null ? `${qFmtSigned(currentFunding * 100, 4)}% (instantaneous)` : "—";
      $("fundingSparkline").innerHTML = '<p class="loading">Funding rate field not present in this response</p>';
    }

    const futures = instruments
      .filter((i) => i.settlement_period !== "perpetual")
      .map((i) => ({
        name: i.instrument_name,
        expiry: i.expiration_timestamp,
        mark: (summaryMap.get(i.instrument_name) || {}).mark_price,
      }))
      .filter((f) => f.mark != null)
      .sort((a, b) => a.expiry - b.expiry);

    const table = renderFuturesTable(perpMark, futures);
    if (table && table.bestIdx >= 0) {
      const best = table.rows[table.bestIdx];
      $("bestBasisStat").textContent = `${best.name}: ${qFmtSigned(best.annualized, 1)}%`;
      const positiveCount = table.rows.filter((r) => r.annualized != null && r.annualized > 0).length;
      $("curveStateStat").textContent =
        positiveCount === table.rows.length ? "Full contango" : positiveCount === 0 ? "Full backwardation" : "Mixed";
      $("basisChart").innerHTML = qBuildBarChart(
        table.rows.map((r) => r.name.replace(`${CURRENCY}-`, "")),
        table.rows.map((r) => r.annualized || 0)
      );
    } else {
      $("bestBasisStat").textContent = "—";
      $("curveStateStat").textContent = "—";
      $("basisChart").innerHTML = '<p class="loading">No data</p>';
    }

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

refresh();
setInterval(refresh, 30000);
