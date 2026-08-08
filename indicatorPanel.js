// Indicators UI: catalog dialog + floating legend + settings popover, built on the
// library's public addEMA/addRSI/... + handle surface (remove/getOptions/updateOptions).
// Ported from charting-library's own standalone example — the library itself knows
// nothing about dialogs or legends, so this app-level wiring is what plugs it in.
// Indicators attach to the `chart` instance itself, so they survive symbol switches
// (setData/clear recompute them against whatever data is loaded at the time).
const INDICATOR_CATALOG = [
  {
    kind: "EMA",
    displayName: "EMA",
    name: "EMA — Exponential Moving Average",
    description: "Weighted moving average that reacts faster to recent price changes.",
    defaultOptions: { period: 20, color: "#f0b90b" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 500, step: 1 },
      { key: "color", label: "Color", type: "color" },
    ],
    buildLabel: (options) => `EMA ${options.period}`,
    swatchColor: (options) => options.color,
  },
  {
    kind: "RSI",
    displayName: "RSI",
    name: "RSI — Relative Strength Index",
    description: "Momentum oscillator (0-100) measuring the speed of price changes.",
    defaultOptions: { period: 14, color: "#7e57c2" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 2, max: 200, step: 1 },
      { key: "color", label: "Color", type: "color" },
    ],
    buildLabel: (options) => `RSI ${options.period}`,
    swatchColor: (options) => options.color,
  },
  {
    kind: "UT_BOT",
    displayName: "UT Bot",
    name: "UT Bot Alerts",
    description: "ATR trailing stop that flips color and marks a buy/sell triangle when price crosses it.",
    defaultOptions: { keyValue: 1, atrPeriod: 10, upColor: "#26a69a", downColor: "#ef5350" },
    fields: [
      { key: "keyValue", label: "Key Value", type: "number", min: 0.1, max: 10, step: 0.1 },
      { key: "atrPeriod", label: "ATR Period", type: "number", min: 1, max: 200, step: 1 },
      { key: "upColor", label: "Up Color", type: "color" },
      { key: "downColor", label: "Down Color", type: "color" },
    ],
    buildLabel: (options) => `UT Bot ${options.keyValue}/${options.atrPeriod}`,
    swatchColor: (options) => options.upColor,
  },
  {
    kind: "MODIFIED_RSI",
    displayName: "Modified RSI",
    name: "Modified RSI",
    description: "Same RSI, recolored per zone: red above the high point, green below the low point.",
    defaultOptions: { period: 14, highPoint: 70, lowPoint: 30, normalColor: "#7e57c2", highColor: "#ef5350", lowColor: "#26a69a" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 2, max: 200, step: 1 },
      { key: "highPoint", label: "High point", type: "number", min: 1, max: 99, step: 1 },
      { key: "lowPoint", label: "Low point", type: "number", min: 1, max: 99, step: 1 },
      { key: "normalColor", label: "Normal color", type: "color" },
      { key: "highColor", label: "High color", type: "color" },
      { key: "lowColor", label: "Low color", type: "color" },
    ],
    buildLabel: (options) => `Modified RSI ${options.period}`,
    swatchColor: (options) => options.normalColor,
  },
  {
    kind: "Z_SCORE",
    displayName: "Z-Score",
    name: "Z-Score Probability",
    description: "How many standard deviations price sits from its rolling mean, with shaded probability zones.",
    defaultOptions: { length: 75, smaLength: 75, positiveColor: "#26a69a", negativeColor: "#ef5350", smaColor: "#e0e0e0" },
    fields: [
      { key: "length", label: "Length", type: "number", min: 2, max: 500, step: 1 },
      { key: "smaLength", label: "Z-SMA length", type: "number", min: 2, max: 500, step: 1 },
      { key: "positiveColor", label: "Positive color", type: "color" },
      { key: "negativeColor", label: "Negative color", type: "color" },
      { key: "smaColor", label: "Z-SMA color", type: "color" },
    ],
    buildLabel: (options) => `Z-Score ${options.length}`,
    swatchColor: (options) => options.positiveColor,
  },
  {
    kind: "STC",
    displayName: "STC",
    name: "Schaff Trend Cycle",
    description: '"Double stochastic of MACD" — tends to turn earlier than MACD or RSI. Colored by direction, not zone.',
    defaultOptions: { length: 12, fastLength: 26, slowLength: 50, risingColor: "#26a69a", fallingColor: "#ef5350", upperLevel: 75, lowerLevel: 25 },
    fields: [
      { key: "length", label: "Length", type: "number", min: 2, max: 100, step: 1 },
      { key: "fastLength", label: "Fast length", type: "number", min: 2, max: 200, step: 1 },
      { key: "slowLength", label: "Slow length", type: "number", min: 2, max: 300, step: 1 },
      { key: "upperLevel", label: "Upper level", type: "number", min: 1, max: 99, step: 1 },
      { key: "lowerLevel", label: "Lower level", type: "number", min: 1, max: 99, step: 1 },
      { key: "risingColor", label: "Rising color", type: "color" },
      { key: "fallingColor", label: "Falling color", type: "color" },
    ],
    buildLabel: (options) => `STC ${options.length}`,
    swatchColor: (options) => options.risingColor,
  },
  {
    kind: "DONCHIAN",
    displayName: "Donchian",
    name: "Donchian Channels",
    description: "Highest high / lowest low over N bars, plus their midline, with a shaded fill between the bands.",
    // fillColor is left at its rgba() default — the settings popover's color
    // inputs are plain <input type=color>, which only accepts 6-digit hex.
    defaultOptions: { length: 20, offset: 0, basisColor: "#ff6d00", bandColor: "#2962ff" },
    fields: [
      { key: "length", label: "Length", type: "number", min: 1, max: 500, step: 1 },
      { key: "offset", label: "Offset", type: "number", min: -100, max: 100, step: 1 },
      { key: "basisColor", label: "Basis color", type: "color" },
      { key: "bandColor", label: "Band color", type: "color" },
    ],
    buildLabel: (options) => `Donchian ${options.length}`,
    swatchColor: (options) => options.bandColor,
  },
  {
    kind: "BOLLINGER_BANDS",
    displayName: "Bollinger Bands",
    name: "Bollinger Bands",
    description: "A moving-average basis line with upper/lower bands N standard deviations away, shaded between.",
    // fillColor is left at its rgba() default — the settings popover's color
    // inputs are plain <input type=color>, which only accepts 6-digit hex.
    defaultOptions: { length: 20, maType: "SMA", source: "close", mult: 2, offset: 0, basisColor: "#2962ff", upperColor: "#f23645", lowerColor: "#089981" },
    fields: [
      { key: "length", label: "Length", type: "number", min: 1, max: 500, step: 1 },
      { key: "maType", label: "Basis MA Type", type: "select", options: ["SMA", "EMA", "SMMA (RMA)", "WMA"] },
      { key: "source", label: "Source", type: "select", options: ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"] },
      { key: "mult", label: "StdDev", type: "number", min: 0.001, max: 50, step: 0.1 },
      { key: "offset", label: "Offset", type: "number", min: -500, max: 500, step: 1 },
      { key: "basisColor", label: "Basis color", type: "color" },
      { key: "upperColor", label: "Upper color", type: "color" },
      { key: "lowerColor", label: "Lower color", type: "color" },
    ],
    buildLabel: (options) => `BB ${options.length} ${options.mult}`,
    swatchColor: (options) => options.basisColor,
  },
];

function addIndicatorByKind(chart, definition, options) {
  if (definition.kind === "EMA") return chart.addEMA(options);
  if (definition.kind === "RSI") return chart.addRSI(options);
  if (definition.kind === "UT_BOT") return chart.addUTBot(options);
  if (definition.kind === "MODIFIED_RSI") return chart.addModifiedRSI(options);
  if (definition.kind === "Z_SCORE") return chart.addZScore(options);
  if (definition.kind === "STC") return chart.addSTC(options);
  if (definition.kind === "DONCHIAN") return chart.addDonchian(options);
  return chart.addBollingerBands(options);
}

/**
 * `initialIndicators`: `{ kind, options }[]` to add immediately (e.g. restored from
 * a saved session) instead of starting empty.
 * `onChange`: called with the current `{ kind, options }[]` after every add, remove,
 * or settings change, so a caller can persist "what's on the chart right now".
 */
export function setupIndicatorPanel(chart, chartContainer, { initialIndicators = [], onChange } = {}) {
  let nextUid = 1;
  const active = new Map();

  function notifyChange() {
    onChange?.(
      [...active.values()].map((item) => ({
        kind: item.definition.kind,
        options: item.handle.getOptions(),
      }))
    );
  }

  const legend = document.createElement("div");
  legend.id = "indicator-legend";
  chartContainer.appendChild(legend);

  const popover = document.createElement("div");
  popover.id = "indicator-settings-popover";
  popover.style.display = "none";
  document.body.appendChild(popover);

  function closePopover() {
    popover.style.display = "none";
    popover.innerHTML = "";
  }

  document.addEventListener("mousedown", (e) => {
    if (popover.style.display === "none") return;
    if (e.target instanceof Node && !popover.contains(e.target)) closePopover();
  });

  function renderLegend() {
    legend.innerHTML = "";
    for (const item of active.values()) {
      const row = document.createElement("div");
      row.className = "legend-item";

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = item.color;
      row.appendChild(swatch);

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;
      row.appendChild(label);

      const gearBtn = document.createElement("button");
      gearBtn.textContent = "⚙";
      gearBtn.title = "Settings";
      gearBtn.addEventListener("click", (e) => openSettingsPopover(item, e.currentTarget));
      row.appendChild(gearBtn);

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove";
      removeBtn.addEventListener("click", () => {
        item.handle.remove();
        active.delete(item.uid);
        closePopover();
        renderLegend();
        notifyChange();
      });
      row.appendChild(removeBtn);

      legend.appendChild(row);
    }
  }

  function openSettingsPopover(item, anchor) {
    popover.innerHTML = "";

    const title = document.createElement("h4");
    title.textContent = `${item.definition.displayName} settings`;
    popover.appendChild(title);

    const currentOptions = item.handle.getOptions();
    const inputs = {};

    for (const field of item.definition.fields) {
      const row = document.createElement("div");
      row.className = "field";

      const label = document.createElement("label");
      label.textContent = field.label;
      row.appendChild(label);

      let input;
      if (field.type === "select") {
        input = document.createElement("select");
        for (const optionValue of field.options) {
          const opt = document.createElement("option");
          opt.value = optionValue;
          opt.textContent = optionValue;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement("input");
        input.type = field.type;
        if (field.type === "number") {
          if (field.min !== undefined) input.min = String(field.min);
          if (field.max !== undefined) input.max = String(field.max);
          input.step = String(field.step ?? 1);
        }
      }
      input.value = String(currentOptions[field.key]);
      inputs[field.key] = input;
      row.appendChild(input);

      popover.appendChild(row);
    }

    const applyPatch = () => {
      const patch = {};
      for (const field of item.definition.fields) {
        const raw = inputs[field.key]?.value ?? "";
        patch[field.key] = field.type === "number" ? Number(raw) : raw;
      }
      item.handle.updateOptions(patch);
      const updated = item.handle.getOptions();
      item.color = String(item.definition.swatchColor(updated));
      item.label = item.definition.buildLabel(updated);
      closePopover();
      renderLegend();
      notifyChange();
    };

    const actions = document.createElement("div");
    actions.className = "popover-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", closePopover);
    actions.appendChild(cancelBtn);

    const applyBtn = document.createElement("button");
    applyBtn.className = "primary";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", applyPatch);
    actions.appendChild(applyBtn);

    popover.appendChild(actions);

    popover.style.display = "block";
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${rect.left + window.scrollX}px`;
  }

  function addIndicator(definition, options = definition.defaultOptions) {
    const handle = addIndicatorByKind(chart, definition, options);

    const resolvedOptions = handle.getOptions();
    const uid = nextUid++;
    active.set(uid, {
      uid,
      definition,
      handle,
      label: definition.buildLabel(resolvedOptions),
      color: String(definition.swatchColor(resolvedOptions)),
    });
    renderLegend();
    notifyChange();
  }

  const dialog = document.getElementById("indicators-dialog");
  const catalogEl = document.getElementById("indicators-catalog");
  const openBtn = document.getElementById("btn-indicators");
  const closeBtn = document.getElementById("indicators-dialog-close");

  for (const definition of INDICATOR_CATALOG) {
    const row = document.createElement("div");
    row.className = "catalog-item";

    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = definition.name;
    const desc = document.createElement("div");
    desc.className = "description";
    desc.textContent = definition.description;
    text.appendChild(name);
    text.appendChild(desc);
    row.appendChild(text);

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => addIndicator(definition));
    row.appendChild(addBtn);

    catalogEl.appendChild(row);
  }

  openBtn.addEventListener("click", () => dialog.showModal());
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  for (const saved of initialIndicators) {
    const definition = INDICATOR_CATALOG.find((d) => d.kind === saved.kind);
    // Merge over defaultOptions rather than trusting saved.options alone, so a
    // saved indicator from an older version missing a newer field still resolves.
    if (definition) addIndicator(definition, { ...definition.defaultOptions, ...saved.options });
  }
}
