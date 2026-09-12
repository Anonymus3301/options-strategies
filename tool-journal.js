// Trade Journal — pure client-side, localStorage only, no network calls. Logs
// real/paper positions and tracks them to close with a realized P&L.

const JOURNAL_KEY = "btc-options-journal-v1";

const $ = (id) => document.getElementById(id);

function loadEntries() {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveEntries(entries) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch (err) {
    // Private browsing / quota exceeded — entries just won't persist across reloads.
  }
}

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "$" : "-$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function populateStrategySelect() {
  const sel = $("strategySelect");
  const names = typeof STRATEGY_PAGES !== "undefined" ? STRATEGY_PAGES.map((p) => p.label).filter((l) => !l.startsWith("★")) : [];
  sel.innerHTML = ['<option value="Custom">Custom / other</option>', ...names.map((n) => `<option value="${n}">${n}</option>`)].join("");
}

function renderStats(entries) {
  const open = entries.filter((e) => e.status === "open");
  const closed = entries.filter((e) => e.status === "closed");
  $("openCountStat").textContent = String(open.length);
  $("closedCountStat").textContent = String(closed.length);

  const realized = closed.reduce((sum, e) => sum + (e.realizedPnl || 0), 0);
  $("realizedPnlStat").textContent = closed.length ? fmtUsd(realized) : "—";

  const wins = closed.filter((e) => (e.realizedPnl || 0) > 0).length;
  $("winRateStat").textContent = closed.length ? `${Math.round((wins / closed.length) * 100)}% (${wins}/${closed.length})` : "—";
}

function renderTable(entries) {
  const tbody = document.querySelector("#journalTable tbody");
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No entries yet</td></tr>';
    return;
  }
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = sorted
    .map((e) => {
      const maxPL = `${e.maxProfit != null ? fmtUsd(e.maxProfit) : "—"} / ${e.maxLoss != null ? fmtUsd(-Math.abs(e.maxLoss)) : "—"}`;
      const statusText =
        e.status === "closed"
          ? `Closed ${e.exitDate || ""} (${fmtUsd(e.realizedPnl)})`
          : "Open";
      return `
      <tr>
        <td>${e.date}</td>
        <td>${e.strategy}</td>
        <td>${e.notes || "—"}</td>
        <td>${e.entrySpot != null ? "$" + Number(e.entrySpot).toLocaleString() : "—"}</td>
        <td>${e.netCost != null ? fmtUsd(e.netCost) : "—"}</td>
        <td>${maxPL}</td>
        <td>${statusText}</td>
        <td>${e.status === "open" ? `<button type="button" class="leg-remove close-entry-btn" data-id="${e.id}" title="Close position">✓</button>` : `<button type="button" class="leg-remove delete-entry-btn" data-id="${e.id}" title="Delete entry">×</button>`}</td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".close-entry-btn").forEach((btn) => {
    btn.addEventListener("click", () => closeEntry(btn.dataset.id));
  });
  tbody.querySelectorAll(".delete-entry-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteEntry(btn.dataset.id));
  });
}

function refresh() {
  const entries = loadEntries();
  renderStats(entries);
  renderTable(entries);
}

function addEntry() {
  const strategy = $("strategySelect").value;
  const entrySpot = parseFloat($("entrySpot").value);
  const netCost = parseFloat($("netCost").value);
  const maxProfit = parseFloat($("maxProfit").value);
  const maxLoss = parseFloat($("maxLoss").value);
  const notes = $("notes").value.trim();

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString().slice(0, 10),
    strategy,
    notes,
    entrySpot: Number.isFinite(entrySpot) ? entrySpot : null,
    netCost: Number.isFinite(netCost) ? netCost : null,
    maxProfit: Number.isFinite(maxProfit) ? maxProfit : null,
    maxLoss: Number.isFinite(maxLoss) ? maxLoss : null,
    status: "open",
  };

  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  $("entrySpot").value = "";
  $("netCost").value = "";
  $("maxProfit").value = "";
  $("maxLoss").value = "";
  $("notes").value = "";
  refresh();
}

function closeEntry(id) {
  const input = window.prompt("Realized P&L for this trade (USD, negative for a loss):");
  if (input === null) return;
  const pnl = parseFloat(input);
  if (!Number.isFinite(pnl)) {
    window.alert("Enter a number.");
    return;
  }
  const entries = loadEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.status = "closed";
  entry.exitDate = new Date().toISOString().slice(0, 10);
  entry.realizedPnl = pnl;
  saveEntries(entries);
  refresh();
}

function deleteEntry(id) {
  if (!window.confirm("Delete this journal entry permanently?")) return;
  const entries = loadEntries().filter((e) => e.id !== id);
  saveEntries(entries);
  refresh();
}

function exportCsv() {
  const entries = loadEntries();
  const rows = [
    ["date", "strategy", "notes", "entry_spot", "net_cost", "max_profit", "max_loss", "status", "exit_date", "realized_pnl"],
    ...entries.map((e) => [
      e.date, e.strategy, e.notes || "", e.entrySpot ?? "", e.netCost ?? "", e.maxProfit ?? "", e.maxLoss ?? "",
      e.status, e.exitDate || "", e.realizedPnl ?? "",
    ]),
  ];
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "btc-options-journal.csv";
  a.click();
  URL.revokeObjectURL(url);
}

populateStrategySelect();
$("addEntry").addEventListener("click", addEntry);
$("exportCsv").addEventListener("click", exportCsv);
refresh();
