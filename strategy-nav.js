// Shared "Strategies" nav strip, injected into #strategyNav on every strategy page.
// Kept in one file so adding a new strategy page only means editing this list once.

const STRATEGY_PAGES = [
  { href: "strategy-hub.html", label: "★ Strategy Hub" },
  { href: "strategy-premium-selling.html", label: "Premium Selling" },
  { href: "strategy-skew-arb.html", label: "Skew Arbitrage" },
  { href: "strategy-long-vol.html", label: "Long Volatility" },
  { href: "strategy-carry.html", label: "Carry & Funding" },
  { href: "strategy-income.html", label: "Covered Call / CSP Income" },
  { href: "strategy-cross-asset.html", label: "BTC/ETH Vol Pair" },
  { href: "strategy-maxpain.html", label: "Max Pain / Pin Risk" },
  { href: "strategy-calendar.html", label: "Calendar Spread" },
  { href: "strategy-protective-put.html", label: "Protective Put" },
  { href: "strategy-collar.html", label: "Collar" },
  { href: "strategy-iron-condor.html", label: "Iron Condor" },
  { href: "strategy-pcr.html", label: "PCR Sentiment" },
  { href: "strategy-butterfly.html", label: "Butterfly Spread" },
  { href: "strategy-jade-lizard.html", label: "Jade Lizard" },
  { href: "strategy-box-spread.html", label: "Box Spread" },
  { href: "strategy-synthetic.html", label: "Synthetic Forward" },
  { href: "strategy-ratio-spread.html", label: "Ratio Spread" },
  { href: "strategy-diagonal.html", label: "Diagonal Spread" },
  { href: "strategy-backspread.html", label: "Backspread" },
  { href: "strategy-strap-strip.html", label: "Strap / Strip" },
  { href: "strategy-broken-wing.html", label: "Broken Wing Butterfly" },
  { href: "strategy-iron-butterfly.html", label: "Iron Butterfly" },
  { href: "strategy-long-strangle.html", label: "Long Strangle" },
  { href: "strategy-guts.html", label: "Guts (ITM Strangle)" },
  { href: "strategy-call-ladder.html", label: "Call Ladder" },
  { href: "strategy-covered-strangle.html", label: "Covered Strangle" },
  { href: "strategy-put-ratio-spread.html", label: "Put Ratio Spread" },
  { href: "strategy-put-backspread.html", label: "Put Backspread" },
  { href: "strategy-put-ladder.html", label: "Put Ladder" },
  { href: "strategy-reverse-iron-condor.html", label: "Reverse Iron Condor" },
  { href: "strategy-covered-put.html", label: "Covered Put" },
  { href: "strategy-variance-swap.html", label: "Variance Swap" },
  { href: "strategy-gamma-scalping.html", label: "Gamma Scalping" },
  { href: "strategy-pmcc.html", label: "Poor Man's Covered Call" },
  { href: "strategy-pmcp.html", label: "Poor Man's Covered Put" },
  { href: "strategy-double-calendar.html", label: "Double Calendar" },
  { href: "strategy-forward-variance.html", label: "Forward Variance" },
  { href: "strategy-vega-neutral-calendar.html", label: "Vega-Neutral Calendar" },
  { href: "strategy-seagull.html", label: "Seagull Spread" },
  { href: "strategy-broken-wing-condor.html", label: "Broken Wing Condor" },
  { href: "strategy-hedged-risk-reversal.html", label: "Delta-Hedged Risk Reversal" },
  { href: "strategy-bull-call-spread.html", label: "Bull Call Spread" },
  { href: "strategy-bear-call-spread.html", label: "Bear Call Spread" },
  { href: "strategy-bull-put-spread.html", label: "Bull Put Spread" },
  { href: "strategy-bear-put-spread.html", label: "Bear Put Spread" },
  { href: "strategy-call-condor.html", label: "Call Condor" },
  { href: "strategy-put-condor.html", label: "Put Condor" },
  { href: "strategy-naked-call.html", label: "Naked Call" },
  { href: "strategy-naked-put.html", label: "Naked Put" },
  { href: "strategy-put-diagonal.html", label: "Put Diagonal Spread" },
  { href: "strategy-call-calendar.html", label: "Call Calendar" },
  { href: "strategy-put-calendar.html", label: "Put Calendar" },
  { href: "strategy-jelly-roll.html", label: "Jelly Roll" },
  { href: "strategy-double-diagonal.html", label: "Double Diagonal" },
  { href: "strategy-wheel.html", label: "The Wheel Strategy" },
  { href: "strategy-covered-call-ratio.html", label: "Covered Call Overwrite (2:1)" },
  { href: "strategy-covered-put-ratio.html", label: "Covered Put Overwrite (2:1)" },
  { href: "strategy-risk-reversal.html", label: "Risk Reversal (25Δ)" },
  { href: "strategy-risk-neutral-density.html", label: "Risk-Neutral Density" },
];

const TOOL_PAGES = [
  { href: "tool-risk-calculator.html", label: "🛠 Risk / Position Sizing" },
  { href: "tool-unusual-activity.html", label: "🛠 Unusual Activity" },
  { href: "tool-glossary.html", label: "🛠 Glossary" },
  { href: "tool-journal.html", label: "🛠 Trade Journal" },
];

function renderNavInto(id, pages) {
  const el = document.getElementById(id);
  if (!el) return;
  const here = location.pathname.split("/").pop();
  el.innerHTML = pages
    .map((p) => `<a href="${p.href}" class="strategy-nav-link${p.href === here ? " active" : ""}">${p.label}</a>`)
    .join("");
}

renderNavInto("strategyNav", STRATEGY_PAGES);
renderNavInto("toolsNav", TOOL_PAGES);
