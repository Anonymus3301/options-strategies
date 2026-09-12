// Shared "Strategies" nav strip, injected into #strategyNav on every strategy page.
// Kept in one file so adding a new strategy page only means editing this list once.

const STRATEGY_PAGES = [
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
];

(function renderStrategyNav() {
  const el = document.getElementById("strategyNav");
  if (!el) return;
  const here = location.pathname.split("/").pop();
  el.innerHTML = STRATEGY_PAGES.map(
    (p) => `<a href="${p.href}" class="strategy-nav-link${p.href === here ? " active" : ""}">${p.label}</a>`
  ).join("");
})();
