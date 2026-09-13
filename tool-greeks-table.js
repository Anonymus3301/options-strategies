// Option Chain Greeks Explorer — standalone, REST-only.
// A raw reference table, not a strategy: every listed strike's Black-Scholes greeks for a
// selected expiry, computed from each strike's own quoted mark IV (no live greeks feed
// needed), the same convention every other page here already uses.

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

function greeksFor(type, spot, strike, T, ivPct) {
  if (ivPct == null) return null;
  const sigma = ivPct / 100;
  return {
    iv: ivPct,
    delta: qBsDelta(type, spot, strike, T, sigma),
    gamma: qBsGamma(spot, strike, T, sigma),
    vega: qBsVega(spot, strike, T, sigma) / 100,
    theta: qBsThetaPerDay(spot, strike, T, sigma),
  };
}

function renderTable() {
  const bucket = state.instrumentsByExpiry.get(state.selectedExpiry);
  const tbody = document.querySelector("#greeksTable tbody");
  if (!bucket) {
    tbody.innerHTML = '<tr><td colspan="11" class="loading">No data</td></tr>';
    $("spotStat").textContent = "—";
    return;
  }
  const spot = qImpliedSpot(bucket, state.summaries);
  $("spotStat").textContent = spot != null ? "$" + qFmt(spot, 0) : "—";
  if (spot == null) {
    tbody.innerHTML = '<tr><td colspan="11" class="loading">No data</td></tr>';
    return;
  }
  const T = Math.max((state.selectedExpiry - Date.now()) / QUANT_YEAR_MS, 1 / 365 / 24);
  const strikes = [...new Set([...bucket.calls.keys(), ...bucket.puts.keys()])].sort((a, b) => a - b);
  const atm = qClosestStrike(strikes, spot);

  if (!strikes.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="loading">No data</td></tr>';
    return;
  }

  tbody.innerHTML = strikes
    .map((K) => {
      const call = state.summaries.get(bucket.calls.get(K));
      const put = state.summaries.get(bucket.puts.get(K));
      const cg = greeksFor("call", spot, K, T, call ? call.mark_iv : null);
      const pg = greeksFor("put", spot, K, T, put ? put.mark_iv : null);
      const rowCls = K === atm ? "best" : "";
      return `
      <tr class="${rowCls}">
        <td>${cg ? qFmt(cg.iv, 1) + "%" : "—"}</td>
        <td>${cg ? qFmt(cg.delta, 2) : "—"}</td>
        <td>${cg ? qFmt(cg.gamma, 6) : "—"}</td>
        <td>${cg ? qFmt(cg.vega, 1) : "—"}</td>
        <td>${cg ? qFmtSigned(cg.theta, 1) : "—"}</td>
        <td class="best">${qFmt(K, 0)}</td>
        <td>${pg ? qFmt(pg.delta, 2) : "—"}</td>
        <td>${pg ? qFmt(pg.gamma, 6) : "—"}</td>
        <td>${pg ? qFmt(pg.vega, 1) : "—"}</td>
        <td>${pg ? qFmtSigned(pg.theta, 1) : "—"}</td>
        <td>${pg ? qFmt(pg.iv, 1) + "%" : "—"}</td>
      </tr>`;
    })
    .join("");
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
