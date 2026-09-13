// Liquidity / Bid-Ask Spread Explorer — standalone, REST-only.
// A raw reference table, not a strategy: bid/ask spread (as % of mid) per strike for one
// expiry, using the bid_price/ask_price fields already present in Deribit's book summary
// (the same fields app.js's own option chain and watchlist already read). None of the
// other 66 strategy pages focus on execution quality — they all price off mark, which
// hides how wide or thin a given strike actually is to trade.

const CURRENCY = "BTC";

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

function spreadFor(sum) {
  if (!sum || sum.bid_price == null || sum.ask_price == null || sum.bid_price <= 0 || sum.ask_price <= 0) return null;
  const mid = (sum.bid_price + sum.ask_price) / 2;
  if (mid <= 0) return null;
  return { bid: sum.bid_price, ask: sum.ask_price, mid, spreadPct: ((sum.ask_price - sum.bid_price) / mid) * 100 };
}

function renderTable() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  const tbody = document.querySelector("#spreadTable tbody");
  if (!bucket) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No data</td></tr>';
    $("spotStat").textContent = "—";
    $("medianSpreadStat").textContent = "—";
    return;
  }
  const spot = qImpliedSpot(bucket, state.summaries);
  $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = spot != null ? qClosestStrike(strikes, spot) : null;

  if (!strikes.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No data</td></tr>';
    $("medianSpreadStat").textContent = "—";
    return;
  }

  const allSpreadPcts = [];
  const rows = strikes.map((K) => {
    const call = state.summaries.get(bucket.calls.get(K));
    const put = state.summaries.get(bucket.puts.get(K));
    const cs = spreadFor(call);
    const ps = spreadFor(put);
    if (cs) allSpreadPcts.push(cs.spreadPct);
    if (ps) allSpreadPcts.push(ps.spreadPct);
    return { K, cs, ps };
  });

  tbody.innerHTML = rows
    .map(
      ({ K, cs, ps }) => `
    <tr class="${K === atm ? "best" : ""}">
      <td>${cs ? qFmt(cs.bid, 4) : "—"}</td>
      <td>${cs ? qFmt(cs.ask, 4) : "—"}</td>
      <td>${cs ? qFmt(cs.spreadPct, 1) + "%" : "no quote"}</td>
      <td class="best">${qFmt(K, 0)}</td>
      <td>${ps ? qFmt(ps.spreadPct, 1) + "%" : "no quote"}</td>
      <td>${ps ? qFmt(ps.bid, 4) : "—"}</td>
      <td>${ps ? qFmt(ps.ask, 4) : "—"}</td>
    </tr>`
    )
    .join("");

  if (allSpreadPcts.length) {
    const sorted = [...allSpreadPcts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    $("medianSpreadStat").textContent = `${qFmt(median, 1)}% (${allSpreadPcts.length} quoted sides)`;
  } else {
    $("medianSpreadStat").textContent = "—";
  }
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    await loadChain();
    renderExpirySelect();
    renderTable();
    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("expirySelect").addEventListener("change", (e) => {
  state.selectedExpiry = Number(e.target.value);
  renderTable();
});

refresh();
setInterval(refresh, 30000);
