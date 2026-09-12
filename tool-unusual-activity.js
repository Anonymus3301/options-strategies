// Unusual Options Activity Scanner — standalone, REST-only.
// Deribit's free API has no historical-OI/volume endpoint, so "unusual" is tracked
// entirely client-side: a baseline snapshot (reset on page load or on demand) and the
// immediately-prior poll's snapshot, both kept in localStorage, are diffed against the
// current chain to surface the biggest movers.

const CURRENCY = "BTC";
const BASELINE_KEY = "btc-options-activity-baseline-v1";
const LAST_POLL_KEY = "btc-options-activity-lastpoll-v1";
const TOP_N = 20;

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("feedStatus");
  el.textContent = text;
  el.className = "pill " + cls;
}

function loadSnapshot(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveSnapshot(key, snapshot) {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch (err) {
    // Private browsing / quota exceeded — comparisons just won't persist across reloads.
  }
}

function buildSnapshot(instruments, summaries) {
  const summaryMap = new Map(summaries.map((s) => [s.instrument_name, s]));
  const rows = {};
  for (const inst of instruments) {
    const sum = summaryMap.get(inst.instrument_name);
    if (!sum) continue;
    rows[inst.instrument_name] = {
      strike: inst.strike,
      type: inst.option_type,
      expiry: inst.expiration_timestamp,
      oi: sum.open_interest || 0,
      vol: sum.volume || 0,
    };
  }
  return { ts: Date.now(), rows };
}

function renderOiTable(current, baseline, lastPoll) {
  const tbody = document.querySelector("#oiTable tbody");
  const names = Object.keys(current.rows);
  const diffs = names.map((name) => {
    const cur = current.rows[name];
    const base = baseline && baseline.rows[name];
    const last = lastPoll && lastPoll.rows[name];
    return {
      name,
      ...cur,
      deltaBaseline: base ? cur.oi - base.oi : null,
      deltaLastPoll: last ? cur.oi - last.oi : null,
    };
  });
  diffs.sort((a, b) => Math.abs(b.deltaBaseline || 0) - Math.abs(a.deltaBaseline || 0));
  const top = diffs.filter((d) => d.deltaBaseline != null && d.deltaBaseline !== 0).slice(0, TOP_N);

  if (!baseline) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Baseline just set — reload or wait for the next poll to see changes</td></tr>';
    return;
  }
  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No OI changes vs. baseline yet</td></tr>';
    return;
  }
  tbody.innerHTML = top
    .map(
      (d) => `
    <tr>
      <td>${d.name}</td>
      <td>${qExpiryLabel(d.expiry)}</td>
      <td>${qFmt(d.strike, 0)}</td>
      <td>${d.type}</td>
      <td>${qFmt(d.oi, 0)}</td>
      <td class="${d.deltaBaseline >= 0 ? "call-cell" : "put-cell"}">${qFmtSigned(d.deltaBaseline, 0)}</td>
      <td>${d.deltaLastPoll != null ? qFmtSigned(d.deltaLastPoll, 0) : "—"}</td>
    </tr>`
    )
    .join("");
}

function renderVolTable(current, lastPoll) {
  const tbody = document.querySelector("#volTable tbody");
  const names = Object.keys(current.rows);
  const rows = names
    .map((name) => {
      const cur = current.rows[name];
      const last = lastPoll && lastPoll.rows[name];
      return { name, ...cur, deltaLastPoll: last ? cur.vol - last.vol : null };
    })
    .filter((r) => r.vol > 0)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, TOP_N);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No volume yet</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.name}</td>
      <td>${qExpiryLabel(r.expiry)}</td>
      <td>${qFmt(r.strike, 0)}</td>
      <td>${r.type}</td>
      <td>${qFmt(r.vol, 0)}</td>
      <td>${r.deltaLastPoll != null ? qFmtSigned(r.deltaLastPoll, 0) : "—"}</td>
    </tr>`
    )
    .join("");
}

async function refresh() {
  try {
    setStatus("loading…", "pill-connecting");
    const [instruments, summaries] = await Promise.all([
      qFetchInstruments(CURRENCY, "option", false),
      qFetchBookSummary(CURRENCY, "option"),
    ]);
    const current = buildSnapshot(instruments, summaries);

    let baseline = loadSnapshot(BASELINE_KEY);
    if (!baseline) {
      saveSnapshot(BASELINE_KEY, current);
      baseline = current;
      $("baselineStat").textContent = "just now";
    } else {
      const ageMin = Math.round((Date.now() - baseline.ts) / 60000);
      $("baselineStat").textContent = ageMin < 1 ? "just now" : `${ageMin}m ago`;
    }

    const lastPoll = loadSnapshot(LAST_POLL_KEY);
    renderOiTable(current, baseline === current ? null : baseline, lastPoll);
    renderVolTable(current, lastPoll);
    saveSnapshot(LAST_POLL_KEY, current);

    setStatus("live", "pill-live");
  } catch (err) {
    console.error("refresh failed", err);
    setStatus("error", "pill-down");
  }
}

$("resetBaseline").addEventListener("click", () => {
  localStorage.removeItem(BASELINE_KEY);
  refresh();
});

refresh();
setInterval(refresh, 30000);
