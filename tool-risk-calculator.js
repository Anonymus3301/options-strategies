// Risk & Position Sizing Calculator — pure client-side arithmetic, no network calls.
// Takes a max-loss-per-contract figure from any strategy page and computes how many
// contracts fit a stated risk budget, plus an optional Kelly-fraction sanity check.

const $ = (id) => document.getElementById(id);

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function recompute() {
  const accountSize = parseFloat($("accountSize").value);
  const riskPct = parseFloat($("riskPct").value);
  const maxLoss = parseFloat($("maxLossPerContract").value);
  const margin = parseFloat($("marginPerContract").value);

  const riskBudget = Number.isFinite(accountSize) && Number.isFinite(riskPct) ? accountSize * (riskPct / 100) : null;
  $("riskBudgetStat").textContent = riskBudget != null ? fmtUsd(riskBudget) : "—";

  const byLoss = riskBudget != null && Number.isFinite(maxLoss) && maxLoss > 0 ? Math.floor(riskBudget / maxLoss) : null;
  $("contractsByLossStat").textContent = byLoss != null ? String(byLoss) : "—";

  const byMargin =
    Number.isFinite(accountSize) && Number.isFinite(margin) && margin > 0 ? Math.floor(accountSize / margin) : null;
  $("contractsByMarginStat").textContent = byMargin != null ? String(byMargin) : "—";

  let suggested = null;
  if (byLoss != null && byMargin != null) suggested = Math.min(byLoss, byMargin);
  else if (byLoss != null) suggested = byLoss;
  else if (byMargin != null) suggested = byMargin;

  if (suggested == null) {
    $("suggestedSizeStat").textContent = "—";
  } else {
    const binding = byLoss != null && byMargin != null ? (byLoss <= byMargin ? "max loss" : "margin/capital") : byLoss != null ? "max loss" : "margin/capital";
    $("suggestedSizeStat").textContent = `${suggested} contract${suggested === 1 ? "" : "s"} (binding: ${binding})`;
  }

  const winProb = parseFloat($("winProb").value) / 100;
  const winAmount = parseFloat($("winAmount").value);
  const lossAmount = parseFloat($("lossAmount").value);
  const kellyEl = $("kellyOutput");
  if (Number.isFinite(winProb) && Number.isFinite(winAmount) && Number.isFinite(lossAmount) && winAmount > 0 && lossAmount > 0) {
    const b = winAmount / lossAmount; // payoff ratio
    const p = winProb, q = 1 - winProb;
    const kelly = (b * p - q) / b;
    const kellyPct = kelly * 100;
    const halfKellyPct = kellyPct / 2;
    const quarterKellyPct = kellyPct / 4;
    kellyEl.innerHTML = `
      <div class="scanner-rows">
        <div class="scanner-row"><span class="scanner-label">Payoff ratio (win/loss)</span><span class="scanner-value">${b.toFixed(2)}</span></div>
        <div class="scanner-row"><span class="scanner-label">Full Kelly</span><span class="scanner-value">${kellyPct.toFixed(1)}% of account${kellyPct < 0 ? " (negative — this trade has negative expectancy at your inputs)" : ""}</span></div>
        <div class="scanner-row"><span class="scanner-label">Half Kelly (common practice)</span><span class="scanner-value">${halfKellyPct.toFixed(1)}% of account</span></div>
        <div class="scanner-row"><span class="scanner-label">Quarter Kelly (conservative)</span><span class="scanner-value">${quarterKellyPct.toFixed(1)}% of account</span></div>
      </div>`;
  } else {
    kellyEl.innerHTML = '<p class="loading">Fill in win probability, win amount, and loss amount to see a Kelly estimate.</p>';
  }
}

["accountSize", "riskPct", "maxLossPerContract", "marginPerContract", "winProb", "winAmount", "lossAmount"].forEach((id) => {
  $(id).addEventListener("input", recompute);
});

recompute();
