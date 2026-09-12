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
