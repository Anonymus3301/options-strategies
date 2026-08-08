// src/Chart.ts
import { clamp, getDevicePixelRatio as getDevicePixelRatio2 } from "@charting-library/utils";
import { TimeScale, PriceScale } from "@charting-library/scales";
import { CandleSeriesData } from "@charting-library/series";
import { PointerSource, Delegate } from "@charting-library/events";
import {
  DARK_THEME,
  drawBackground,
  drawGrid,
  drawCandlesticks,
  DEFAULT_CANDLESTICK_OPTIONS,
  drawPriceAxis,
  drawTimeAxis,
  drawCrosshair,
  drawLineSeries,
  drawReferenceLevels,
  drawOscillatorPriceAxis,
  drawUtBotStopLine,
  drawUtBotMarkers,
  drawThresholdColoredLine,
  drawDirectionColoredLine,
  drawHorizontalBands,
  drawFilledLineBand,
  drawLegend,
  drawCurrentPriceOverlay,
  drawPositionTool,
  POSITION_TOOL_DELETE_SIZE,
  POSITION_TOOL_EDGE_HIT_PX,
  PRICE_AXIS_WIDTH as PRICE_AXIS_WIDTH2
} from "@charting-library/renderer";

// src/ChartLayout.ts
import { CanvasLayer } from "@charting-library/renderer";
import { PRICE_AXIS_WIDTH, TIME_AXIS_HEIGHT } from "@charting-library/renderer";
var DEFAULT_SUB_PANE_HEIGHT = 120;
var PANE_GAP = 1;
var ChartLayout = class {
  constructor(container) {
    this.paneLayer = new CanvasLayer(0);
    this.priceAxisLayer = new CanvasLayer(0);
    this.timeAxisLayer = new CanvasLayer(0);
    /**
     * Spans the *entire* chart (every pane + both axis strips), not just the main
     * pane, because the crosshair's price/time label boxes are drawn just past a
     * pane's edge, into the axis strips — a pane-sized canvas would clip them.
     */
    this.crosshairLayer = new CanvasLayer(2);
    this.subPanes = /* @__PURE__ */ new Map();
    this.root = document.createElement("div");
    this.root.style.position = "relative";
    this.root.style.width = "100%";
    this.root.style.height = "100%";
    this.root.style.overflow = "hidden";
    this.root.style.userSelect = "none";
    this.root.style.cursor = "crosshair";
    this.paneContainer = this.makeAbsoluteContainer();
    this.paneContainer.appendChild(this.paneLayer.canvas);
    this.priceAxisContainer = this.makeAbsoluteContainer();
    this.priceAxisContainer.appendChild(this.priceAxisLayer.canvas);
    this.timeAxisContainer = this.makeAbsoluteContainer();
    this.timeAxisContainer.appendChild(this.timeAxisLayer.canvas);
    this.cornerFiller = this.makeAbsoluteContainer();
    this.root.appendChild(this.paneContainer);
    this.root.appendChild(this.priceAxisContainer);
    this.root.appendChild(this.timeAxisContainer);
    this.root.appendChild(this.cornerFiller);
    this.root.appendChild(this.crosshairLayer.canvas);
    container.appendChild(this.root);
  }
  makeAbsoluteContainer() {
    const div = document.createElement("div");
    div.style.position = "absolute";
    return div;
  }
  ensureSubPane(id) {
    const existing = this.subPanes.get(id);
    if (existing) return existing;
    const paneContainer = this.makeAbsoluteContainer();
    const paneLayer = new CanvasLayer(0);
    paneContainer.appendChild(paneLayer.canvas);
    const priceAxisContainer = this.makeAbsoluteContainer();
    const priceAxisLayer = new CanvasLayer(0);
    priceAxisContainer.appendChild(priceAxisLayer.canvas);
    this.root.insertBefore(paneContainer, this.crosshairLayer.canvas);
    this.root.insertBefore(priceAxisContainer, this.crosshairLayer.canvas);
    const dom = { paneContainer, paneLayer, priceAxisContainer, priceAxisLayer };
    this.subPanes.set(id, dom);
    return dom;
  }
  destroySubPane(id) {
    const dom = this.subPanes.get(id);
    if (!dom) return;
    dom.paneContainer.remove();
    dom.priceAxisContainer.remove();
    this.subPanes.delete(id);
  }
  /** The pane/axis canvases for one sub-pane id, or null if it isn't currently laid out. */
  getSubPaneLayers(id) {
    const dom = this.subPanes.get(id);
    return dom ? { paneLayer: dom.paneLayer, priceAxisLayer: dom.priceAxisLayer } : null;
  }
  /**
   * Recomputes every pane/axis rectangle for a given total size and resizes every
   * canvas. `subPaneIds` is the complete, ordered list of sub-panes that should
   * exist right now — panes for ids no longer present are torn down, panes for new
   * ids are created, and the survivors keep their canvas (and GPU-uploaded content)
   * across the call.
   */
  layout(totalWidth, totalHeight, pixelRatio, subPaneIds, subPaneHeight = DEFAULT_SUB_PANE_HEIGHT) {
    for (const id of Array.from(this.subPanes.keys())) {
      if (!subPaneIds.includes(id)) this.destroySubPane(id);
    }
    for (const id of subPaneIds) this.ensureSubPane(id);
    const subPaneBlockHeight = subPaneIds.length > 0 ? (subPaneHeight + PANE_GAP) * subPaneIds.length : 0;
    const paneWidth = Math.max(0, totalWidth - PRICE_AXIS_WIDTH);
    const mainPaneHeight = Math.max(0, totalHeight - TIME_AXIS_HEIGHT - subPaneBlockHeight);
    this.paneContainer.style.left = "0";
    this.paneContainer.style.top = "0";
    this.paneContainer.style.width = `${paneWidth}px`;
    this.paneContainer.style.height = `${mainPaneHeight}px`;
    this.priceAxisContainer.style.left = `${paneWidth}px`;
    this.priceAxisContainer.style.top = "0";
    this.priceAxisContainer.style.width = `${PRICE_AXIS_WIDTH}px`;
    this.priceAxisContainer.style.height = `${mainPaneHeight}px`;
    this.paneLayer.resize(paneWidth, mainPaneHeight, pixelRatio);
    this.priceAxisLayer.resize(PRICE_AXIS_WIDTH, mainPaneHeight, pixelRatio);
    const subPanes = /* @__PURE__ */ new Map();
    let cursor = mainPaneHeight + (subPaneIds.length > 0 ? PANE_GAP : 0);
    for (const id of subPaneIds) {
      const dom = this.subPanes.get(id);
      if (!dom) continue;
      dom.paneContainer.style.left = "0";
      dom.paneContainer.style.top = `${cursor}px`;
      dom.paneContainer.style.width = `${paneWidth}px`;
      dom.paneContainer.style.height = `${subPaneHeight}px`;
      dom.priceAxisContainer.style.left = `${paneWidth}px`;
      dom.priceAxisContainer.style.top = `${cursor}px`;
      dom.priceAxisContainer.style.width = `${PRICE_AXIS_WIDTH}px`;
      dom.priceAxisContainer.style.height = `${subPaneHeight}px`;
      dom.paneLayer.resize(paneWidth, subPaneHeight, pixelRatio);
      dom.priceAxisLayer.resize(PRICE_AXIS_WIDTH, subPaneHeight, pixelRatio);
      subPanes.set(id, { width: paneWidth, height: subPaneHeight, top: cursor });
      cursor += subPaneHeight + PANE_GAP;
    }
    const timeAxisTop = mainPaneHeight + subPaneBlockHeight;
    this.timeAxisContainer.style.left = "0";
    this.timeAxisContainer.style.top = `${timeAxisTop}px`;
    this.timeAxisContainer.style.width = `${paneWidth}px`;
    this.timeAxisContainer.style.height = `${TIME_AXIS_HEIGHT}px`;
    this.cornerFiller.style.left = `${paneWidth}px`;
    this.cornerFiller.style.top = `${timeAxisTop}px`;
    this.cornerFiller.style.width = `${PRICE_AXIS_WIDTH}px`;
    this.cornerFiller.style.height = `${TIME_AXIS_HEIGHT}px`;
    this.timeAxisLayer.resize(paneWidth, TIME_AXIS_HEIGHT, pixelRatio);
    this.crosshairLayer.resize(totalWidth, totalHeight, pixelRatio);
    return { mainPane: { width: paneWidth, height: mainPaneHeight }, subPanes };
  }
  destroy() {
    this.root.remove();
  }
};

// src/DprWatcher.ts
import { getDevicePixelRatio } from "@charting-library/utils";
var DprWatcher = class {
  constructor(onChange) {
    this.mediaQuery = null;
    this.handleChange = () => {
      this.mediaQuery?.removeEventListener("change", this.handleChange);
      this.arm();
      this.onChange();
    };
    this.onChange = onChange;
    this.arm();
  }
  arm() {
    const dpr = getDevicePixelRatio();
    this.mediaQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    this.mediaQuery.addEventListener("change", this.handleChange);
  }
  destroy() {
    this.mediaQuery?.removeEventListener("change", this.handleChange);
    this.mediaQuery = null;
  }
};

// src/PositionTools.ts
function serializeShapes(shapes) {
  return shapes.map((s) => ({ kind: s.kind, options: s.options }));
}

// src/Indicators.ts
import {
  computeEMA,
  computeRSI,
  computeUtBot,
  computeZScore,
  computeSTC,
  computeDonchian,
  computeBollingerBands
} from "@charting-library/indicators";
var DEFAULT_EMA_COLOR = "#f0b90b";
var DEFAULT_RSI_COLOR = "#7e57c2";
var DEFAULT_UT_BOT_UP_COLOR = "#26a69a";
var DEFAULT_UT_BOT_DOWN_COLOR = "#ef5350";
var DEFAULT_MODIFIED_RSI_NORMAL_COLOR = "#7e57c2";
var DEFAULT_MODIFIED_RSI_HIGH_COLOR = "#ef5350";
var DEFAULT_MODIFIED_RSI_LOW_COLOR = "#26a69a";
var DEFAULT_ZSCORE_POSITIVE_COLOR = "#26a69a";
var DEFAULT_ZSCORE_NEGATIVE_COLOR = "#ef5350";
var DEFAULT_ZSCORE_SMA_COLOR = "#e0e0e0";
var DEFAULT_STC_RISING_COLOR = "#26a69a";
var DEFAULT_STC_FALLING_COLOR = "#ef5350";
var DEFAULT_DONCHIAN_BASIS_COLOR = "#ff6d00";
var DEFAULT_DONCHIAN_BAND_COLOR = "#2962ff";
var DEFAULT_DONCHIAN_FILL_COLOR = "rgba(33, 150, 243, 0.05)";
var DEFAULT_BOLLINGER_BASIS_COLOR = "#2962ff";
var DEFAULT_BOLLINGER_UPPER_COLOR = "#f23645";
var DEFAULT_BOLLINGER_LOWER_COLOR = "#089981";
var DEFAULT_BOLLINGER_FILL_COLOR = "rgba(33, 150, 243, 0.1)";
var DEFAULT_LINE_WIDTH = 1.5;
function resolveEmaOptions(options) {
  return {
    period: options.period,
    color: options.color ?? DEFAULT_EMA_COLOR,
    lineWidth: options.lineWidth ?? DEFAULT_LINE_WIDTH
  };
}
function resolveRsiOptions(options) {
  return {
    period: options.period,
    color: options.color ?? DEFAULT_RSI_COLOR,
    lineWidth: options.lineWidth ?? DEFAULT_LINE_WIDTH,
    overboughtLevel: options.overboughtLevel ?? 70,
    oversoldLevel: options.oversoldLevel ?? 30
  };
}
function resolveUtBotOptions(options) {
  return {
    keyValue: options.keyValue ?? 1,
    atrPeriod: options.atrPeriod ?? 10,
    upColor: options.upColor ?? DEFAULT_UT_BOT_UP_COLOR,
    downColor: options.downColor ?? DEFAULT_UT_BOT_DOWN_COLOR,
    lineWidth: options.lineWidth ?? DEFAULT_LINE_WIDTH
  };
}
function resolveModifiedRsiOptions(options) {
  return {
    period: options.period ?? 14,
    highPoint: options.highPoint ?? 70,
    lowPoint: options.lowPoint ?? 30,
    normalColor: options.normalColor ?? DEFAULT_MODIFIED_RSI_NORMAL_COLOR,
    highColor: options.highColor ?? DEFAULT_MODIFIED_RSI_HIGH_COLOR,
    lowColor: options.lowColor ?? DEFAULT_MODIFIED_RSI_LOW_COLOR,
    lineWidth: options.lineWidth ?? DEFAULT_LINE_WIDTH
  };
}
function resolveZScoreOptions(options) {
  return {
    length: options.length ?? 75,
    smaLength: options.smaLength ?? 75,
    showZSma: options.showZSma ?? true,
    showBands: options.showBands ?? true,
    positiveColor: options.positiveColor ?? DEFAULT_ZSCORE_POSITIVE_COLOR,
    negativeColor: options.negativeColor ?? DEFAULT_ZSCORE_NEGATIVE_COLOR,
    smaColor: options.smaColor ?? DEFAULT_ZSCORE_SMA_COLOR,
    lineWidth: options.lineWidth ?? DEFAULT_LINE_WIDTH
  };
}
function resolveStcOptions(options) {
  return {
    length: options.length ?? 12,
    fastLength: options.fastLength ?? 26,
    slowLength: options.slowLength ?? 50,
    risingColor: options.risingColor ?? DEFAULT_STC_RISING_COLOR,
    fallingColor: options.fallingColor ?? DEFAULT_STC_FALLING_COLOR,
    upperLevel: options.upperLevel ?? 75,
    lowerLevel: options.lowerLevel ?? 25,
    lineWidth: options.lineWidth ?? 2
  };
}
function resolveDonchianOptions(options) {
  return {
    length: options.length ?? 20,
    offset: options.offset ?? 0,
    basisColor: options.basisColor ?? DEFAULT_DONCHIAN_BASIS_COLOR,
    bandColor: options.bandColor ?? DEFAULT_DONCHIAN_BAND_COLOR,
    fillColor: options.fillColor ?? DEFAULT_DONCHIAN_FILL_COLOR,
    lineWidth: options.lineWidth ?? DEFAULT_LINE_WIDTH
  };
}
function recomputeOverlay(indicator, candles) {
  return { ...indicator, values: computeEMA(candles, indicator.options.period) };
}
function recomputeOscillator(indicator, candles) {
  return { ...indicator, values: computeRSI(candles, indicator.options.period) };
}
function recomputeUtBot(indicator, candles) {
  return { ...indicator, points: computeUtBot(candles, indicator.options.keyValue, indicator.options.atrPeriod) };
}
function recomputeModifiedRsi(indicator, candles) {
  return { ...indicator, values: computeRSI(candles, indicator.options.period) };
}
function recomputeZScore(indicator, candles) {
  return { ...indicator, points: computeZScore(candles, indicator.options.length, indicator.options.smaLength) };
}
function recomputeStc(indicator, candles) {
  return {
    ...indicator,
    values: computeSTC(candles, indicator.options.length, indicator.options.fastLength, indicator.options.slowLength)
  };
}
function recomputeDonchian(indicator, candles) {
  return { ...indicator, points: computeDonchian(candles, indicator.options.length) };
}
function resolveBollingerBandsOptions(options) {
  return {
    length: options.length ?? 20,
    maType: options.maType ?? "SMA",
    source: options.source ?? "close",
    mult: options.mult ?? 2,
    offset: options.offset ?? 0,
    basisColor: options.basisColor ?? DEFAULT_BOLLINGER_BASIS_COLOR,
    upperColor: options.upperColor ?? DEFAULT_BOLLINGER_UPPER_COLOR,
    lowerColor: options.lowerColor ?? DEFAULT_BOLLINGER_LOWER_COLOR,
    fillColor: options.fillColor ?? DEFAULT_BOLLINGER_FILL_COLOR,
    lineWidth: options.lineWidth ?? DEFAULT_LINE_WIDTH
  };
}
function recomputeBollingerBands(indicator, candles) {
  return {
    ...indicator,
    points: computeBollingerBands(
      candles,
      indicator.options.length,
      indicator.options.maType,
      indicator.options.source,
      indicator.options.mult
    )
  };
}

// src/Chart.ts
var ZOOM_STEP = 1.1;
var LEGEND_MARGIN = 8;
var CLICK_MOVE_TOLERANCE_PX = 4;
var PRICE_AXIS_DRAG_SENSITIVITY = 4e-3;
var RSI_MIDLINE = 50;
var Z_SCORE_SCALE_MIN = -4;
var Z_SCORE_SCALE_MAX = 4;
var Z_SCORE_BANDS = [
  { from: -1, to: 1, color: "rgba(38, 166, 154, 0.15)" },
  // within 1 SD — "calm"
  { from: 1, to: 2, color: "rgba(255, 193, 7, 0.12)" },
  // 1-2 SD — "moderate"
  { from: -2, to: -1, color: "rgba(255, 193, 7, 0.12)" },
  { from: 2, to: 3, color: "rgba(239, 83, 80, 0.15)" },
  // 2-3 SD — "extreme"
  { from: -3, to: -2, color: "rgba(239, 83, 80, 0.15)" }
];
var STC_NEUTRAL_BAND_COLOR = "rgba(120, 120, 120, 0.06)";
var Chart = class {
  constructor(container, options = {}) {
    this.seriesData = new CandleSeriesData();
    this.resizeObserver = null;
    this.countdownTimerId = null;
    this.overlayIndicators = [];
    this.utBotIndicators = [];
    this.donchianIndicators = [];
    this.bollingerBandsIndicators = [];
    /**
     * Indicators that live in their own stacked pane below the main price pane (RSI,
     * Modified RSI, ...). Kept as one array (not split per kind) so add-order — not
     * kind — decides stacking order, and so a future 3rd sub-pane indicator only
     * needs to join this union, not thread a whole new parallel array through sizing/
     * crosshair/render.
     */
    this.subPaneIndicators = [];
    /** Absolute (crosshair-canvas-space) top y of each sub-pane indicator's own pane. */
    this.subPaneTops = /* @__PURE__ */ new Map();
    /** Long/Short Position drawings on the main pane. See PositionTools.ts. */
    this.positionTools = [];
    /** Set by setDrawingTool(); the next click on the pane places a shape of this kind
     *  and reverts to null (one-shot placement, like most TradingView drawing tools). */
    this.pendingDrawingTool = null;
    this.draggingShape = null;
    /** The shape a click last selected (distinct from draggingShape, which only lives
     *  for the duration of an actual drag) — drives onSelectedShapeChange, e.g. for a
     *  floating "remove this drawing" button. */
    this.selectedShapeId = null;
    /** Where the current press started, and which shape's interior (if any) it started
     *  inside of — used on release to tell a click (select that shape, or deselect if
     *  it started on empty pane) apart from a pan that happened to start over a shape. */
    this.pointerDownPos = null;
    this.pressedShapeForSelect = null;
    this.shapesChanged = new Delegate();
    this.drawingToolChanged = new Delegate();
    this.selectedShapeChanged = new Delegate();
    /** Set while dragging the price axis itself (not the pane) to rescale it — a
     *  distinct gesture from panning/zooming the main pane. */
    this.priceAxisDragStartY = null;
    this.priceAxisDragStartRange = null;
    this.pixelRatio = getDevicePixelRatio2();
    this.crosshair = null;
    /** Bar index under the cursor, for live indicator legend values; null when not hovering. */
    this.hoveredIndex = null;
    this.dragging = false;
    this.lastPointerX = 0;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.paneDirty = true;
    this.crosshairOnlyDirty = false;
    this.frameScheduled = false;
    this.destroyed = false;
    this.renderFrame = () => {
      this.frameScheduled = false;
      if (this.destroyed) return;
      if (this.paneDirty) {
        this.drawMainPane();
        this.drawSubPanes();
        this.drawCrosshairLayer();
        this.paneDirty = false;
        this.crosshairOnlyDirty = false;
      } else if (this.crosshairOnlyDirty) {
        this.drawCrosshairLayer();
        this.crosshairOnlyDirty = false;
      }
    };
    this.theme = { ...DARK_THEME, ...options.theme };
    this.candlestickOptions = { ...DEFAULT_CANDLESTICK_OPTIONS, ...options.candlestick };
    this.priceLineEnabled = options.priceLine ?? true;
    this.now = options.now ?? (() => Date.now() / 1e3);
    this.timeScale = new TimeScale(options.timeScale);
    this.priceScale = new PriceScale(options.priceScale);
    this.layout = new ChartLayout(container);
    this.pointerSource = new PointerSource(this.layout.crosshairLayer.canvas);
    this.wireInteractions();
    const initialWidth = options.width ?? container.clientWidth;
    const initialHeight = options.height ?? container.clientHeight;
    this.applySize(initialWidth, initialHeight);
    if (options.autoResize !== false) {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        this.applySize(width, height);
      });
      this.resizeObserver.observe(container);
    }
    this.dprWatcher = new DprWatcher(() => {
      this.pixelRatio = getDevicePixelRatio2();
      this.applySize(this.lastWidth, this.lastHeight);
    });
    if (this.priceLineEnabled) {
      this.countdownTimerId = setInterval(() => {
        if (!this.seriesData.isEmpty()) this.invalidateCrosshairOnly();
      }, 1e3);
    }
    this.invalidatePane();
  }
  // ---- Public data API -----------------------------------------------------
  setData(candles) {
    this.seriesData.setData(candles);
    this.timeScale.setTimes(this.seriesData.times());
    this.recomputeIndicators();
    this.invalidatePane();
  }
  update(candle) {
    this.seriesData.update(candle);
    this.timeScale.setTimes(this.seriesData.times(), { preserveViewport: true });
    this.recomputeIndicators();
    this.invalidatePane();
  }
  clear() {
    this.seriesData.clear();
    this.timeScale.setTimes([]);
    this.recomputeIndicators();
    this.crosshair = null;
    this.invalidatePane();
  }
  fitContent() {
    this.timeScale.fitContent();
    this.invalidatePane();
  }
  setVisibleBarCount(count) {
    this.timeScale.showLastBars(count);
    this.invalidatePane();
  }
  resize(width, height) {
    this.applySize(width, height);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.countdownTimerId !== null) clearInterval(this.countdownTimerId);
    this.resizeObserver?.disconnect();
    this.dprWatcher.destroy();
    this.pointerSource.destroy();
    this.shapesChanged.destroy();
    this.drawingToolChanged.destroy();
    this.selectedShapeChanged.destroy();
    this.layout.destroy();
  }
  // ---- Indicators -----------------------------------------------------
  addEMA(options) {
    const id = /* @__PURE__ */ Symbol("ema");
    const indicator = recomputeOverlay(
      { id, kind: "EMA", options: resolveEmaOptions(options), values: [] },
      this.seriesData.all()
    );
    this.overlayIndicators = [...this.overlayIndicators, indicator];
    this.invalidatePane();
    return {
      kind: "EMA",
      remove: () => this.removeOverlay(id),
      getOptions: () => this.findOverlay(id).options,
      updateOptions: (patch) => this.updateOverlayOptions(id, patch)
    };
  }
  addRSI(options) {
    const priceScale = new PriceScale();
    priceScale.setRange({ minPrice: 0, maxPrice: 100 });
    const id = /* @__PURE__ */ Symbol("rsi");
    const indicator = recomputeOscillator(
      { id, kind: "RSI", options: resolveRsiOptions(options), values: [], priceScale },
      this.seriesData.all()
    );
    this.addSubPaneIndicator(indicator);
    return {
      kind: "RSI",
      remove: () => this.removeSubPaneIndicator(id),
      getOptions: () => this.findSubPaneIndicator(id, "RSI").options,
      updateOptions: (patch) => this.updateOscillatorOptions(id, patch)
    };
  }
  addModifiedRSI(options = {}) {
    const priceScale = new PriceScale();
    priceScale.setRange({ minPrice: 0, maxPrice: 100 });
    const id = /* @__PURE__ */ Symbol("modified-rsi");
    const indicator = recomputeModifiedRsi(
      { id, kind: "MODIFIED_RSI", options: resolveModifiedRsiOptions(options), values: [], priceScale },
      this.seriesData.all()
    );
    this.addSubPaneIndicator(indicator);
    return {
      kind: "MODIFIED_RSI",
      remove: () => this.removeSubPaneIndicator(id),
      getOptions: () => this.findSubPaneIndicator(id, "MODIFIED_RSI").options,
      updateOptions: (patch) => this.updateModifiedRsiOptions(id, patch)
    };
  }
  addZScore(options = {}) {
    const priceScale = new PriceScale();
    priceScale.setRange({ minPrice: Z_SCORE_SCALE_MIN, maxPrice: Z_SCORE_SCALE_MAX });
    const id = /* @__PURE__ */ Symbol("z-score");
    const indicator = recomputeZScore(
      { id, kind: "Z_SCORE", options: resolveZScoreOptions(options), points: [], priceScale },
      this.seriesData.all()
    );
    this.addSubPaneIndicator(indicator);
    return {
      kind: "Z_SCORE",
      remove: () => this.removeSubPaneIndicator(id),
      getOptions: () => this.findSubPaneIndicator(id, "Z_SCORE").options,
      updateOptions: (patch) => this.updateZScoreOptions(id, patch)
    };
  }
  addSTC(options = {}) {
    const priceScale = new PriceScale();
    priceScale.setRange({ minPrice: 0, maxPrice: 100 });
    const id = /* @__PURE__ */ Symbol("stc");
    const indicator = recomputeStc(
      { id, kind: "STC", options: resolveStcOptions(options), values: [], priceScale },
      this.seriesData.all()
    );
    this.addSubPaneIndicator(indicator);
    return {
      kind: "STC",
      remove: () => this.removeSubPaneIndicator(id),
      getOptions: () => this.findSubPaneIndicator(id, "STC").options,
      updateOptions: (patch) => this.updateStcOptions(id, patch)
    };
  }
  addUTBot(options = {}) {
    const id = /* @__PURE__ */ Symbol("ut-bot");
    const indicator = recomputeUtBot(
      { id, kind: "UT_BOT", options: resolveUtBotOptions(options), points: [] },
      this.seriesData.all()
    );
    this.utBotIndicators = [...this.utBotIndicators, indicator];
    this.invalidatePane();
    return {
      kind: "UT_BOT",
      remove: () => this.removeUtBot(id),
      getOptions: () => this.findUtBot(id).options,
      updateOptions: (patch) => this.updateUtBotOptions(id, patch)
    };
  }
  addDonchian(options = {}) {
    const id = /* @__PURE__ */ Symbol("donchian");
    const indicator = recomputeDonchian(
      { id, kind: "DONCHIAN", options: resolveDonchianOptions(options), points: [] },
      this.seriesData.all()
    );
    this.donchianIndicators = [...this.donchianIndicators, indicator];
    this.invalidatePane();
    return {
      kind: "DONCHIAN",
      remove: () => this.removeDonchian(id),
      getOptions: () => this.findDonchian(id).options,
      updateOptions: (patch) => this.updateDonchianOptions(id, patch)
    };
  }
  addBollingerBands(options = {}) {
    const id = /* @__PURE__ */ Symbol("bollinger-bands");
    const indicator = recomputeBollingerBands(
      { id, kind: "BOLLINGER_BANDS", options: resolveBollingerBandsOptions(options), points: [] },
      this.seriesData.all()
    );
    this.bollingerBandsIndicators = [...this.bollingerBandsIndicators, indicator];
    this.invalidatePane();
    return {
      kind: "BOLLINGER_BANDS",
      remove: () => this.removeBollingerBands(id),
      getOptions: () => this.findBollingerBands(id).options,
      updateOptions: (patch) => this.updateBollingerBandsOptions(id, patch)
    };
  }
  // ---- Drawing tools (Long/Short Position) ---------------------------------
  addLongPosition(options) {
    return this.addPositionTool("LONG_POSITION", options);
  }
  addShortPosition(options) {
    return this.addPositionTool("SHORT_POSITION", options);
  }
  /** Arms `kind`: the next click on the pane places a shape there (with a default
   *  2:1 reward:risk box) and this reverts to null on its own. Pass null to cancel
   *  an armed tool without placing anything. */
  setDrawingTool(kind) {
    if (this.pendingDrawingTool === kind) return;
    this.pendingDrawingTool = kind;
    this.drawingToolChanged.fire(kind);
  }
  getDrawingTool() {
    return this.pendingDrawingTool;
  }
  clearPositionTools() {
    if (this.positionTools.length === 0) return;
    this.positionTools = [];
    this.setSelectedShape(null);
    this.invalidatePane();
    this.notifyShapesChange();
  }
  /** Fires after every add/remove/drag-release — not on every mousemove while
   *  dragging — with the full current shape list, ready to persist. */
  onShapesChange(callback) {
    return this.shapesChanged.subscribe(callback);
  }
  onDrawingToolChange(callback) {
    return this.drawingToolChanged.subscribe(callback);
  }
  /**
   * Fires whenever the "selected" drawing changes — clicking a shape selects it
   * (fires `{ id, kind, remove }`), clicking empty pane or removing the shape
   * deselects (fires null). Meant for an app-level "remove this drawing" affordance
   * (e.g. a floating button) that shouldn't require precisely hitting the small
   * in-canvas delete glyph.
   */
  onSelectedShapeChange(callback) {
    return this.selectedShapeChanged.subscribe(callback);
  }
  addPositionTool(kind, options) {
    const id = Symbol(kind);
    this.positionTools = [...this.positionTools, { id, kind, options }];
    this.invalidatePane();
    this.notifyShapesChange();
    return {
      kind,
      remove: () => this.removePositionTool(id),
      getOptions: () => this.findPositionTool(id).options,
      updateOptions: (patch) => this.updatePositionToolOptions(id, patch)
    };
  }
  findPositionTool(id) {
    const found = this.positionTools.find((s) => s.id === id);
    if (!found) throw new Error("This drawing has already been removed from the chart.");
    return found;
  }
  removePositionTool(id) {
    this.positionTools = this.positionTools.filter((s) => s.id !== id);
    if (this.selectedShapeId === id) this.setSelectedShape(null);
    this.invalidatePane();
    this.notifyShapesChange();
  }
  /** Changes which shape (if any) is "selected" and notifies onSelectedShapeChange
   *  listeners. A no-op if `id` is already the current selection. */
  setSelectedShape(id) {
    if (this.selectedShapeId === id) return;
    this.selectedShapeId = id;
    this.invalidatePane();
    const shape = id === null ? void 0 : this.positionTools.find((s) => s.id === id);
    this.selectedShapeChanged.fire(shape ? { id: shape.id, kind: shape.kind, remove: () => this.removePositionTool(shape.id) } : null);
  }
  updatePositionToolOptions(id, patch) {
    this.positionTools = this.positionTools.map((s) => s.id === id ? { ...s, options: { ...s.options, ...patch } } : s);
    this.invalidatePane();
    this.notifyShapesChange();
  }
  notifyShapesChange() {
    this.shapesChanged.fire(serializeShapes(this.positionTools));
  }
  /**
   * Default 2:1 reward:risk box, used when a shape is placed by clicking rather than
   * via addLongPosition/addShortPosition with explicit options. Both dimensions are
   * sized relative to the *currently visible* viewport (roughly an eighth of it)
   * rather than fixed amounts — width used to be a flat 20 bars, and target/stop a
   * flat 2%/1% of price, both of which read as tiny when zoomed way out but could
   * exceed the entire visible frame when zoomed in far (on price, time, or both),
   * which is what "still making big drawings" meant here even after the width-only
   * fix. Width is also hard-capped at the visible range's right edge, so the box can
   * never extend past what's currently on screen even for an entry click near it.
   */
  defaultPositionOptions(kind, entryTime, entryPrice) {
    const interval = this.inferBarIntervalSeconds() ?? 60;
    const visible = this.timeScale.getVisibleLogicalRange();
    const visibleBars = Math.max(1, visible.to - visible.from);
    const times = this.seriesData.times();
    const entryIndex = times.length > 0 ? (entryTime - times[0]) / interval : visible.from;
    const desiredWidthBars = clamp(visibleBars * 0.125, 3, 500);
    const widthBars = Math.max(1, Math.min(desiredWidthBars, visible.to - entryIndex));
    const endTime = entryTime + interval * widthBars;
    const priceRange = this.priceScale.getRange();
    const visiblePriceSpan = priceRange.maxPrice - priceRange.minPrice || entryPrice * 0.01;
    const targetOffset = visiblePriceSpan * 0.125;
    const stopOffset = targetOffset / 2;
    const sign = kind === "LONG_POSITION" ? 1 : -1;
    return {
      entryTime,
      entryPrice,
      targetPrice: entryPrice + sign * targetOffset,
      stopPrice: entryPrice - sign * stopOffset,
      endTime
    };
  }
  findOverlay(id) {
    const found = this.overlayIndicators.find((ind) => ind.id === id);
    if (!found) throw new Error("This indicator has already been removed from the chart.");
    return found;
  }
  findUtBot(id) {
    const found = this.utBotIndicators.find((ind) => ind.id === id);
    if (!found) throw new Error("This indicator has already been removed from the chart.");
    return found;
  }
  findDonchian(id) {
    const found = this.donchianIndicators.find((ind) => ind.id === id);
    if (!found) throw new Error("This indicator has already been removed from the chart.");
    return found;
  }
  findBollingerBands(id) {
    const found = this.bollingerBandsIndicators.find((ind) => ind.id === id);
    if (!found) throw new Error("This indicator has already been removed from the chart.");
    return found;
  }
  findSubPaneIndicator(id, kind) {
    const found = this.subPaneIndicators.find((ind) => ind.id === id);
    if (!found || found.kind !== kind) throw new Error("This indicator has already been removed from the chart.");
    return found;
  }
  addSubPaneIndicator(indicator) {
    this.subPaneIndicators = [...this.subPaneIndicators, indicator];
    this.applySize(this.lastWidth, this.lastHeight);
  }
  removeSubPaneIndicator(id) {
    this.subPaneIndicators = this.subPaneIndicators.filter((ind) => ind.id !== id);
    this.applySize(this.lastWidth, this.lastHeight);
  }
  removeOverlay(id) {
    this.overlayIndicators = this.overlayIndicators.filter((ind) => ind.id !== id);
    this.invalidatePane();
  }
  removeUtBot(id) {
    this.utBotIndicators = this.utBotIndicators.filter((ind) => ind.id !== id);
    this.invalidatePane();
  }
  removeDonchian(id) {
    this.donchianIndicators = this.donchianIndicators.filter((ind) => ind.id !== id);
    this.invalidatePane();
  }
  removeBollingerBands(id) {
    this.bollingerBandsIndicators = this.bollingerBandsIndicators.filter((ind) => ind.id !== id);
    this.invalidatePane();
  }
  updateOverlayOptions(id, patch) {
    const candles = this.seriesData.all();
    this.overlayIndicators = this.overlayIndicators.map((ind) => {
      if (ind.id !== id) return ind;
      const options = resolveEmaOptions({ ...ind.options, ...patch });
      return recomputeOverlay({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  updateOscillatorOptions(id, patch) {
    const candles = this.seriesData.all();
    this.subPaneIndicators = this.subPaneIndicators.map((ind) => {
      if (ind.id !== id || ind.kind !== "RSI") return ind;
      const options = resolveRsiOptions({ ...ind.options, ...patch });
      return recomputeOscillator({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  updateModifiedRsiOptions(id, patch) {
    const candles = this.seriesData.all();
    this.subPaneIndicators = this.subPaneIndicators.map((ind) => {
      if (ind.id !== id || ind.kind !== "MODIFIED_RSI") return ind;
      const options = resolveModifiedRsiOptions({ ...ind.options, ...patch });
      return recomputeModifiedRsi({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  updateZScoreOptions(id, patch) {
    const candles = this.seriesData.all();
    this.subPaneIndicators = this.subPaneIndicators.map((ind) => {
      if (ind.id !== id || ind.kind !== "Z_SCORE") return ind;
      const options = resolveZScoreOptions({ ...ind.options, ...patch });
      return recomputeZScore({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  updateStcOptions(id, patch) {
    const candles = this.seriesData.all();
    this.subPaneIndicators = this.subPaneIndicators.map((ind) => {
      if (ind.id !== id || ind.kind !== "STC") return ind;
      const options = resolveStcOptions({ ...ind.options, ...patch });
      return recomputeStc({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  updateUtBotOptions(id, patch) {
    const candles = this.seriesData.all();
    this.utBotIndicators = this.utBotIndicators.map((ind) => {
      if (ind.id !== id) return ind;
      const options = resolveUtBotOptions({ ...ind.options, ...patch });
      return recomputeUtBot({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  updateDonchianOptions(id, patch) {
    const candles = this.seriesData.all();
    this.donchianIndicators = this.donchianIndicators.map((ind) => {
      if (ind.id !== id) return ind;
      const options = resolveDonchianOptions({ ...ind.options, ...patch });
      return recomputeDonchian({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  updateBollingerBandsOptions(id, patch) {
    const candles = this.seriesData.all();
    this.bollingerBandsIndicators = this.bollingerBandsIndicators.map((ind) => {
      if (ind.id !== id) return ind;
      const options = resolveBollingerBandsOptions({ ...ind.options, ...patch });
      return recomputeBollingerBands({ ...ind, options }, candles);
    });
    this.invalidatePane();
  }
  recomputeIndicators() {
    const candles = this.seriesData.all();
    this.overlayIndicators = this.overlayIndicators.map((ind) => recomputeOverlay(ind, candles));
    this.utBotIndicators = this.utBotIndicators.map((ind) => recomputeUtBot(ind, candles));
    this.donchianIndicators = this.donchianIndicators.map((ind) => recomputeDonchian(ind, candles));
    this.bollingerBandsIndicators = this.bollingerBandsIndicators.map((ind) => recomputeBollingerBands(ind, candles));
    this.subPaneIndicators = this.subPaneIndicators.map((ind) => {
      if (ind.kind === "RSI") return recomputeOscillator(ind, candles);
      if (ind.kind === "MODIFIED_RSI") return recomputeModifiedRsi(ind, candles);
      if (ind.kind === "Z_SCORE") return recomputeZScore(ind, candles);
      return recomputeStc(ind, candles);
    });
  }
  // ---- Sizing ----------------------------------------------------------
  applySize(cssWidth, cssHeight) {
    const width = Math.max(0, Math.floor(cssWidth));
    const height = Math.max(0, Math.floor(cssHeight));
    this.lastWidth = width;
    this.lastHeight = height;
    const subPaneIds = this.subPaneIndicators.map((ind) => ind.id);
    const result = this.layout.layout(width, height, this.pixelRatio, subPaneIds);
    this.timeScale.setWidth(result.mainPane.width);
    this.priceScale.setHeight(result.mainPane.height);
    this.subPaneTops = /* @__PURE__ */ new Map();
    for (const indicator of this.subPaneIndicators) {
      const rect = result.subPanes.get(indicator.id);
      indicator.priceScale.setHeight(rect ? rect.height : 0);
      if (rect) this.subPaneTops.set(indicator.id, rect.top);
    }
    this.invalidatePane();
  }
  // ---- Interaction wiring -------------------------------------------------
  wireInteractions() {
    this.pointerSource.pressed.subscribe((pos) => this.onPointerPressed(pos));
    this.pointerSource.moved.subscribe((pos) => this.onPointerMoved(pos));
    this.pointerSource.released.subscribe((pos) => this.onPointerReleased(pos));
    this.pointerSource.left.subscribe(() => this.onPointerLeft());
    this.pointerSource.wheel.subscribe((payload) => this.onWheel(payload));
    this.pointerSource.doubleClicked.subscribe((pos) => this.onDoubleClick(pos));
  }
  /** Bottom edge (crosshair-canvas-space) of the lowest pane — main, or the last sub-pane if any. */
  paneAreaBottom() {
    if (this.subPaneIndicators.length === 0) return this.priceScale.getHeight();
    const last = this.subPaneIndicators[this.subPaneIndicators.length - 1];
    const top = this.subPaneTops.get(last.id) ?? 0;
    return top + last.priceScale.getHeight();
  }
  /** The crosshair canvas spans the whole chart (panes + axes); this tells them apart. */
  isWithinPane(pos) {
    return pos.x >= 0 && pos.x <= this.timeScale.getWidth() && pos.y >= 0 && pos.y <= this.paneAreaBottom();
  }
  /** Which pane (and that pane's own price scale + top offset) a canvas-space y coordinate falls in, if any. */
  resolvePaneAt(y) {
    if (y >= 0 && y <= this.priceScale.getHeight()) {
      return { priceScale: this.priceScale, localY: y, top: 0 };
    }
    for (const indicator of this.subPaneIndicators) {
      const top = this.subPaneTops.get(indicator.id);
      if (top === void 0) continue;
      const height = indicator.priceScale.getHeight();
      if (y >= top && y <= top + height) {
        return { priceScale: indicator.priceScale, localY: y - top, top };
      }
    }
    return null;
  }
  onPointerPressed(pos) {
    if (this.isOverPriceAxis(pos)) {
      this.priceAxisDragStartY = pos.y;
      this.priceAxisDragStartRange = this.priceScale.getRange();
      this.layout.crosshairLayer.canvas.style.cursor = "ns-resize";
      return;
    }
    if (!this.isWithinPane(pos)) return;
    if (this.pendingDrawingTool) {
      const time = this.coordinateToApproxTime(pos.x);
      if (time !== null) {
        const price = this.priceScale.coordinateToPrice(pos.y);
        this.addPositionTool(this.pendingDrawingTool, this.defaultPositionOptions(this.pendingDrawingTool, time, price));
      }
      this.setDrawingTool(null);
      return;
    }
    const hit = this.hitTestPositionTools(pos);
    if (hit) {
      if (hit.handle === "delete") {
        this.removePositionTool(hit.id);
        return;
      }
      this.setSelectedShape(hit.id);
      this.draggingShape = { id: hit.id, handle: hit.handle, lastX: pos.x, lastY: pos.y };
      return;
    }
    this.pointerDownPos = { x: pos.x, y: pos.y };
    this.pressedShapeForSelect = this.shapeContaining(pos)?.id ?? null;
    this.dragging = true;
    this.lastPointerX = pos.x;
    this.layout.crosshairLayer.canvas.style.cursor = "grabbing";
    this.crosshair = null;
    this.invalidateCrosshairOnly();
  }
  onPointerMoved(pos) {
    if (this.priceAxisDragStartY !== null) {
      this.updatePriceAxisDrag(pos);
      return;
    }
    if (this.draggingShape) {
      this.updateDraggedShape(pos);
      return;
    }
    if (this.dragging) {
      const dx = pos.x - this.lastPointerX;
      this.lastPointerX = pos.x;
      if (dx !== 0) {
        this.timeScale.scrollByPixels(dx);
        this.invalidatePane();
      }
      return;
    }
    if (this.isOverPriceAxis(pos)) {
      this.layout.crosshairLayer.canvas.style.cursor = "ns-resize";
      if (this.crosshair) {
        this.crosshair = null;
        this.hoveredIndex = null;
        this.invalidateCrosshairOnly();
      }
      return;
    }
    if (!this.isWithinPane(pos)) {
      if (this.crosshair) {
        this.crosshair = null;
        this.hoveredIndex = null;
        this.invalidateCrosshairOnly();
      }
      return;
    }
    if (!this.pendingDrawingTool) {
      const hit = this.hitTestPositionTools(pos);
      this.layout.crosshairLayer.canvas.style.cursor = cursorForHandle(hit?.handle);
    }
    this.updateCrosshair(pos);
  }
  onPointerReleased(pos) {
    if (this.priceAxisDragStartY !== null) {
      this.priceAxisDragStartY = null;
      this.priceAxisDragStartRange = null;
      this.layout.crosshairLayer.canvas.style.cursor = "crosshair";
      return;
    }
    if (this.draggingShape) {
      this.draggingShape = null;
      this.notifyShapesChange();
      return;
    }
    if (this.dragging) {
      this.dragging = false;
      this.layout.crosshairLayer.canvas.style.cursor = "crosshair";
      if (this.pointerDownPos) {
        const dx = pos.x - this.pointerDownPos.x;
        const dy = pos.y - this.pointerDownPos.y;
        if (Math.hypot(dx, dy) <= CLICK_MOVE_TOLERANCE_PX) this.setSelectedShape(this.pressedShapeForSelect);
      }
      this.pointerDownPos = null;
      this.pressedShapeForSelect = null;
    }
  }
  onPointerLeft() {
    this.dragging = false;
    this.pointerDownPos = null;
    this.pressedShapeForSelect = null;
    if (this.priceAxisDragStartY !== null) {
      this.priceAxisDragStartY = null;
      this.priceAxisDragStartRange = null;
    }
    if (this.draggingShape) {
      this.draggingShape = null;
      this.notifyShapesChange();
    }
    this.crosshair = null;
    this.hoveredIndex = null;
    this.invalidateCrosshairOnly();
  }
  /** Drag-to-rescale the price axis: dragging it stretches/compresses the visible
   *  price range around its current midpoint and switches to manual scaling (auto
   *  mode would otherwise recompute and override it on the very next frame). Reset
   *  via double-click on the axis (see onDoubleClick) or the chart's own auto-scale
   *  double-click. */
  updatePriceAxisDrag(pos) {
    const startY = this.priceAxisDragStartY;
    const startRange = this.priceAxisDragStartRange;
    if (startY === null || !startRange) return;
    const dy = pos.y - startY;
    const factor = Math.exp(-dy * PRICE_AXIS_DRAG_SENSITIVITY);
    const mid = (startRange.minPrice + startRange.maxPrice) / 2;
    const halfSpan = (startRange.maxPrice - startRange.minPrice) / 2 * factor;
    this.priceScale.setRange({ minPrice: mid - halfSpan, maxPrice: mid + halfSpan });
    this.invalidatePane();
  }
  onWheel(payload) {
    if (!this.isWithinPane(payload)) return;
    const isHorizontalIntent = payload.shiftKey || Math.abs(payload.deltaX) > Math.abs(payload.deltaY);
    if (isHorizontalIntent) {
      const dx = payload.shiftKey ? payload.deltaY : payload.deltaX;
      this.timeScale.scrollByPixels(-dx);
    } else {
      const factor = payload.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      this.timeScale.zoom(payload.x, factor);
    }
    this.updateCrosshair(payload);
    this.invalidatePane();
  }
  onDoubleClick(pos) {
    if (this.isOverPriceAxis(pos)) {
      this.priceScale.setAutoScale(true);
      this.invalidatePane();
      return;
    }
    this.timeScale.fitContent();
    this.priceScale.setAutoScale(true);
    this.invalidatePane();
  }
  updateCrosshair(pos) {
    if (this.seriesData.isEmpty()) {
      this.crosshair = null;
      this.hoveredIndex = null;
      this.invalidateCrosshairOnly();
      return;
    }
    const pane = this.resolvePaneAt(pos.y);
    if (!pane) {
      this.crosshair = null;
      this.hoveredIndex = null;
      this.invalidateCrosshairOnly();
      return;
    }
    const nearestIndex = clamp(this.timeScale.coordinateToNearestIndex(pos.x), 0, this.seriesData.size() - 1);
    const candle = this.seriesData.at(nearestIndex);
    if (!candle) {
      this.crosshair = null;
      this.hoveredIndex = null;
      this.invalidateCrosshairOnly();
      return;
    }
    this.hoveredIndex = nearestIndex;
    const centerX = this.timeScale.indexToCoordinate(nearestIndex) + this.timeScale.barSpacing() / 2;
    const clampedLocalY = clamp(pane.localY, 0, pane.priceScale.getHeight());
    const price = pane.priceScale.coordinateToPrice(clampedLocalY);
    this.crosshair = {
      x: centerX,
      y: clampedLocalY + pane.top,
      price,
      priceLabel: pane.priceScale.formatPrice(price),
      timeLabel: formatCrosshairTime(candle.time)
    };
    this.invalidateCrosshairOnly();
  }
  // ---- Dirty render loop ----------------------------------------------
  invalidatePane() {
    this.paneDirty = true;
    this.scheduleFrame();
  }
  invalidateCrosshairOnly() {
    this.crosshairOnlyDirty = true;
    this.scheduleFrame();
  }
  scheduleFrame() {
    if (this.frameScheduled || this.destroyed) return;
    this.frameScheduled = true;
    requestAnimationFrame(this.renderFrame);
  }
  drawMainPane() {
    const { paneLayer, priceAxisLayer, timeAxisLayer } = this.layout;
    const { width, height } = paneLayer.getSize();
    const ctx = paneLayer.getContext();
    drawBackground(ctx, width, height, this.theme);
    const visibleRange = this.timeScale.getVisibleDataRange();
    if (visibleRange) {
      const extent = this.seriesData.priceExtent(visibleRange);
      if (extent) {
        let min = extent.min;
        let max = extent.max;
        for (const indicator of this.donchianIndicators) {
          const slice = indicator.points.slice(visibleRange.from, visibleRange.to + 1);
          for (const point of slice) {
            if (point.upper !== null && point.upper > max) max = point.upper;
            if (point.lower !== null && point.lower < min) min = point.lower;
          }
        }
        for (const indicator of this.bollingerBandsIndicators) {
          const slice = indicator.points.slice(visibleRange.from, visibleRange.to + 1);
          for (const point of slice) {
            if (point.upper !== null && point.upper > max) max = point.upper;
            if (point.lower !== null && point.lower < min) min = point.lower;
          }
        }
        const times = this.seriesData.times();
        const visibleTimeMin = times[visibleRange.from];
        const visibleTimeMax = times[visibleRange.to];
        if (visibleTimeMin !== void 0 && visibleTimeMax !== void 0) {
          for (const shape of this.positionTools) {
            const { entryTime, endTime, entryPrice, targetPrice, stopPrice } = shape.options;
            if (entryTime > visibleTimeMax || endTime < visibleTimeMin) continue;
            if (entryPrice > max) max = entryPrice;
            if (entryPrice < min) min = entryPrice;
            if (targetPrice > max) max = targetPrice;
            if (targetPrice < min) min = targetPrice;
            if (stopPrice > max) max = stopPrice;
            if (stopPrice < min) min = stopPrice;
          }
        }
        this.priceScale.applyAutoScale(min, max);
      }
    }
    drawGrid(ctx, width, height, this.timeScale, this.priceScale, this.theme, this.pixelRatio);
    if (visibleRange) {
      const candles = this.seriesData.slice(visibleRange);
      for (const indicator of this.donchianIndicators) {
        const slice = indicator.points.slice(visibleRange.from, visibleRange.to + 1);
        const upper = slice.map((p) => p.upper);
        const lower = slice.map((p) => p.lower);
        const basis = slice.map((p) => p.basis);
        const { offset } = indicator.options;
        drawFilledLineBand(ctx, upper, lower, visibleRange.from, this.timeScale, this.priceScale, indicator.options.fillColor, offset);
        drawLineSeries(ctx, upper, visibleRange.from, this.timeScale, this.priceScale, { color: indicator.options.bandColor, lineWidth: indicator.options.lineWidth }, offset);
        drawLineSeries(ctx, lower, visibleRange.from, this.timeScale, this.priceScale, { color: indicator.options.bandColor, lineWidth: indicator.options.lineWidth }, offset);
        drawLineSeries(ctx, basis, visibleRange.from, this.timeScale, this.priceScale, { color: indicator.options.basisColor, lineWidth: indicator.options.lineWidth }, offset);
      }
      for (const indicator of this.bollingerBandsIndicators) {
        const slice = indicator.points.slice(visibleRange.from, visibleRange.to + 1);
        const upper = slice.map((p) => p.upper);
        const lower = slice.map((p) => p.lower);
        const basis = slice.map((p) => p.basis);
        const { offset } = indicator.options;
        drawFilledLineBand(ctx, upper, lower, visibleRange.from, this.timeScale, this.priceScale, indicator.options.fillColor, offset);
        drawLineSeries(ctx, upper, visibleRange.from, this.timeScale, this.priceScale, { color: indicator.options.upperColor, lineWidth: indicator.options.lineWidth }, offset);
        drawLineSeries(ctx, lower, visibleRange.from, this.timeScale, this.priceScale, { color: indicator.options.lowerColor, lineWidth: indicator.options.lineWidth }, offset);
        drawLineSeries(ctx, basis, visibleRange.from, this.timeScale, this.priceScale, { color: indicator.options.basisColor, lineWidth: indicator.options.lineWidth }, offset);
      }
      drawCandlesticks(
        ctx,
        candles,
        visibleRange.from,
        this.timeScale,
        this.priceScale,
        this.theme,
        this.pixelRatio,
        this.candlestickOptions
      );
      for (const indicator of this.overlayIndicators) {
        const slice = indicator.values.slice(visibleRange.from, visibleRange.to + 1);
        drawLineSeries(ctx, slice, visibleRange.from, this.timeScale, this.priceScale, {
          color: indicator.options.color,
          lineWidth: indicator.options.lineWidth
        });
      }
      for (const indicator of this.utBotIndicators) {
        const slice = indicator.points.slice(visibleRange.from, visibleRange.to + 1);
        drawUtBotStopLine(ctx, slice, visibleRange.from, this.timeScale, this.priceScale, indicator.options);
        drawUtBotMarkers(ctx, slice, candles, visibleRange.from, this.timeScale, this.priceScale, indicator.options);
      }
      for (const shape of this.positionTools) {
        this.drawPositionToolShape(ctx, shape);
      }
    }
    const priceAxisCtx = priceAxisLayer.getContext();
    const priceAxisSize = priceAxisLayer.getSize();
    drawPriceAxis(priceAxisCtx, priceAxisSize.width, priceAxisSize.height, this.priceScale, this.theme);
    const timeAxisCtx = timeAxisLayer.getContext();
    const timeAxisSize = timeAxisLayer.getSize();
    drawTimeAxis(timeAxisCtx, timeAxisSize.width, timeAxisSize.height, this.timeScale, this.theme);
  }
  drawSubPanes() {
    const visibleRange = this.timeScale.getVisibleDataRange();
    for (const indicator of this.subPaneIndicators) {
      const layers = this.layout.getSubPaneLayers(indicator.id);
      if (!layers) continue;
      const { paneLayer, priceAxisLayer } = layers;
      const { width, height } = paneLayer.getSize();
      const ctx = paneLayer.getContext();
      drawBackground(ctx, width, height, this.theme);
      if (indicator.kind === "Z_SCORE" && indicator.options.showBands) {
        drawHorizontalBands(ctx, width, Z_SCORE_BANDS, indicator.priceScale);
      }
      if (indicator.kind === "STC") {
        const band = {
          from: indicator.options.lowerLevel,
          to: indicator.options.upperLevel,
          color: STC_NEUTRAL_BAND_COLOR
        };
        drawHorizontalBands(ctx, width, [band], indicator.priceScale);
      }
      drawGrid(ctx, width, height, this.timeScale, indicator.priceScale, this.theme, this.pixelRatio);
      const levels = subPaneReferenceLevels(indicator);
      drawReferenceLevels(ctx, width, levels, indicator.priceScale, this.theme, this.pixelRatio);
      if (visibleRange) {
        if (indicator.kind === "RSI") {
          const slice = indicator.values.slice(visibleRange.from, visibleRange.to + 1);
          drawLineSeries(ctx, slice, visibleRange.from, this.timeScale, indicator.priceScale, {
            color: indicator.options.color,
            lineWidth: indicator.options.lineWidth
          });
        } else if (indicator.kind === "MODIFIED_RSI") {
          const slice = indicator.values.slice(visibleRange.from, visibleRange.to + 1);
          drawThresholdColoredLine(ctx, slice, visibleRange.from, this.timeScale, indicator.priceScale, {
            normalColor: indicator.options.normalColor,
            highColor: indicator.options.highColor,
            lowColor: indicator.options.lowColor,
            highThreshold: indicator.options.highPoint,
            lowThreshold: indicator.options.lowPoint,
            lineWidth: indicator.options.lineWidth
          });
        } else if (indicator.kind === "Z_SCORE") {
          const pointsSlice = indicator.points.slice(visibleRange.from, visibleRange.to + 1);
          const zSlice = pointsSlice.map((p) => p.z);
          drawThresholdColoredLine(ctx, zSlice, visibleRange.from, this.timeScale, indicator.priceScale, {
            normalColor: indicator.options.negativeColor,
            highColor: indicator.options.positiveColor,
            lowColor: indicator.options.negativeColor,
            highThreshold: 0,
            lowThreshold: 0,
            lineWidth: indicator.options.lineWidth
          });
          if (indicator.options.showZSma) {
            const zSmaSlice = pointsSlice.map((p) => p.zSma);
            drawLineSeries(ctx, zSmaSlice, visibleRange.from, this.timeScale, indicator.priceScale, {
              color: indicator.options.smaColor,
              lineWidth: indicator.options.lineWidth
            });
          }
        } else {
          const slice = indicator.values.slice(visibleRange.from, visibleRange.to + 1);
          drawDirectionColoredLine(ctx, slice, visibleRange.from, this.timeScale, indicator.priceScale, {
            risingColor: indicator.options.risingColor,
            fallingColor: indicator.options.fallingColor,
            lineWidth: indicator.options.lineWidth
          });
        }
      }
      const axisCtx = priceAxisLayer.getContext();
      const axisSize = priceAxisLayer.getSize();
      drawOscillatorPriceAxis(axisCtx, axisSize.width, axisSize.height, indicator.priceScale, levels, this.theme);
    }
  }
  drawCrosshairLayer() {
    const { crosshairLayer } = this.layout;
    crosshairLayer.clear();
    const ctx = crosshairLayer.getContext();
    this.drawSubPaneLegends(ctx);
    if (this.priceLineEnabled) this.drawCurrentPrice(ctx);
    if (!this.crosshair) return;
    drawCrosshair(ctx, this.timeScale.getWidth(), this.paneAreaBottom(), this.crosshair, this.theme, this.pixelRatio);
  }
  /** Last-close line/badge on the price axis, with a next-bar countdown stacked
   *  above the price once at least two bars let us infer the bar interval. */
  drawCurrentPrice(ctx) {
    const last = this.seriesData.last();
    if (!last) return;
    const paneWidth = this.timeScale.getWidth();
    const paneHeight = this.priceScale.getHeight();
    const y = this.priceScale.priceToCoordinate(last.close);
    const priceLabel = this.priceScale.formatPrice(last.close);
    const all = this.seriesData.all();
    const prevClose = all.length > 1 ? all[all.length - 2].close : null;
    const color = prevClose === null || last.close >= prevClose ? this.theme.upColor : this.theme.downColor;
    const interval = this.inferBarIntervalSeconds();
    const countdownLabel = interval === null ? null : formatCountdown(last.time + interval - this.now());
    drawCurrentPriceOverlay(ctx, paneWidth, paneHeight, y, priceLabel, countdownLabel, color, this.pixelRatio);
  }
  /** Bar spacing inferred from the last two bars' timestamps; null until there are
   *  at least two (there's no explicit "resolution" concept in this library). */
  inferBarIntervalSeconds() {
    const times = this.seriesData.times();
    const n = times.length;
    if (n < 2) return null;
    const interval = times[n - 1] - times[n - 2];
    return interval > 0 ? interval : null;
  }
  /**
   * Absolute unix-second time -> pane x-coordinate, extrapolating past either end of
   * the loaded data using the *local* bar spacing at that end — e.g. so a drawing can
   * be placed or dragged into the empty margin ahead of the last bar, same as
   * TradingView. Deliberately bypasses TimeScale's own timeToCoordinate for that
   * extrapolation case: that goes through timeToIndex (a floor search), which clamps
   * a time past the last bar to the last bar's own coordinate instead of
   * extrapolating — wrong for this use.
   *
   * For a time within the loaded range, this resolves the exact bar (or interpolates
   * between the two bars bracketing it) using the real gap *at that specific point*,
   * not a single dataset-wide interval inferred from just the last two bars. That
   * distinction matters for any series with gaps — e.g. this project's options
   * candles, built only from bars where a trade actually happened, so consecutive
   * bars are not reliably a fixed number of seconds apart throughout. An earlier
   * version of this used one global interval end to end; for a trade's entryTime/
   * exitTime (always an exact bar time from the same series), any local gap
   * elsewhere being a different size from that one global guess put the shape at
   * the wrong x-coordinate outright — often far enough off to draw completely
   * outside the visible pane, silently.
   */
  timeToApproxCoordinate(time) {
    const times = this.seriesData.times();
    const n = times.length;
    if (n === 0) return null;
    if (n === 1) return time === times[0] ? this.timeScale.indexToCoordinate(0) : null;
    const first = times[0];
    const last = times[n - 1];
    const fallbackInterval = this.inferBarIntervalSeconds() ?? 60;
    if (time <= first) {
      const interval = times[1] - first || fallbackInterval;
      const index = interval === 0 ? 0 : (time - first) / interval;
      return this.timeScale.indexToCoordinate(index);
    }
    if (time >= last) {
      const interval = last - times[n - 2] || fallbackInterval;
      const index = interval === 0 ? n - 1 : n - 1 + (time - last) / interval;
      return this.timeScale.indexToCoordinate(index);
    }
    const idx = this.timeScale.timeToIndex(time);
    if (idx < 0 || times[idx] === time) {
      return this.timeScale.indexToCoordinate(Math.max(0, idx));
    }
    const gap = times[idx + 1] - times[idx];
    const frac = gap > 0 ? (time - times[idx]) / gap : 0;
    return this.timeScale.indexToCoordinate(idx + frac);
  }
  /** The inverse of {@link timeToApproxCoordinate} — pane x-coordinate -> absolute
   *  unix-second time, as a continuous (non-integer-snapped) value. */
  coordinateToApproxTime(x) {
    const times = this.seriesData.times();
    if (times.length === 0) return null;
    if (times.length === 1) return times[0];
    const interval = this.inferBarIntervalSeconds();
    if (interval === null) return null;
    const index = this.timeScale.coordinateToIndex(x);
    return times[0] + index * interval;
  }
  /**
   * Hit-tests pointer-down against every position-tool shape's handles (checked
   * topmost/most-recently-added first): the delete glyph, the right edge (width),
   * the target/stop edges, or the dashed entry line (move). Null if none hit.
   *
   * Deliberately narrow: "move" only fires within a thin band around the entry line,
   * not anywhere inside the box. Earlier this treated the whole interior as "move",
   * which meant a shape spanning most of the visible pane swallowed every drag
   * attempt there — the chart could no longer be panned from inside it. Interior
   * clicks now fall through to normal pan/select handling instead.
   */
  hitTestPositionTools(pos) {
    for (let i = this.positionTools.length - 1; i >= 0; i--) {
      const shape = this.positionTools[i];
      const { options } = shape;
      const x1 = this.timeToApproxCoordinate(options.entryTime);
      const x2 = this.timeToApproxCoordinate(options.endTime);
      if (x1 === null || x2 === null) continue;
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      if (pos.x < left - POSITION_TOOL_EDGE_HIT_PX || pos.x > right + POSITION_TOOL_EDGE_HIT_PX) continue;
      const yTarget = this.priceScale.priceToCoordinate(options.targetPrice);
      const yStop = this.priceScale.priceToCoordinate(options.stopPrice);
      const yEntry = this.priceScale.priceToCoordinate(options.entryPrice);
      const top = Math.min(yTarget, yStop);
      const bottom = Math.max(yTarget, yStop);
      if (pos.y < top - POSITION_TOOL_EDGE_HIT_PX || pos.y > bottom + POSITION_TOOL_EDGE_HIT_PX) continue;
      if (pos.x >= right - POSITION_TOOL_DELETE_SIZE && pos.x <= right + 2 && pos.y >= top - 2 && pos.y <= top + POSITION_TOOL_DELETE_SIZE) {
        return { id: shape.id, handle: "delete" };
      }
      if (pos.x >= right - POSITION_TOOL_EDGE_HIT_PX) return { id: shape.id, handle: "width" };
      if (Math.abs(pos.y - yTarget) <= POSITION_TOOL_EDGE_HIT_PX) return { id: shape.id, handle: "target" };
      if (Math.abs(pos.y - yStop) <= POSITION_TOOL_EDGE_HIT_PX) return { id: shape.id, handle: "stop" };
      if (Math.abs(pos.y - yEntry) <= POSITION_TOOL_EDGE_HIT_PX) return { id: shape.id, handle: "move" };
      continue;
    }
    return null;
  }
  /** Broader than {@link hitTestPositionTools}: true if `pos` is anywhere inside a
   *  shape's bounding box (not just on a handle) — used to select a shape on a plain
   *  click without also making the whole interior draggable. */
  shapeContaining(pos) {
    for (let i = this.positionTools.length - 1; i >= 0; i--) {
      const shape = this.positionTools[i];
      const { options } = shape;
      const x1 = this.timeToApproxCoordinate(options.entryTime);
      const x2 = this.timeToApproxCoordinate(options.endTime);
      if (x1 === null || x2 === null) continue;
      if (pos.x < Math.min(x1, x2) || pos.x > Math.max(x1, x2)) continue;
      const yTarget = this.priceScale.priceToCoordinate(options.targetPrice);
      const yStop = this.priceScale.priceToCoordinate(options.stopPrice);
      if (pos.y < Math.min(yTarget, yStop) || pos.y > Math.max(yTarget, yStop)) continue;
      return shape;
    }
    return null;
  }
  /** True if `pos` is over the main pane's own price axis gutter (not a sub-pane's). */
  isOverPriceAxis(pos) {
    const left = this.timeScale.getWidth();
    return pos.x >= left && pos.x <= left + PRICE_AXIS_WIDTH2 && pos.y >= 0 && pos.y <= this.priceScale.getHeight();
  }
  updateDraggedShape(pos) {
    const drag = this.draggingShape;
    if (!drag) return;
    this.positionTools = this.positionTools.map((shape) => {
      if (shape.id !== drag.id) return shape;
      return { ...shape, options: this.computeDraggedOptions(shape.options, drag, pos) };
    });
    drag.lastX = pos.x;
    drag.lastY = pos.y;
    this.invalidatePane();
  }
  computeDraggedOptions(options, drag, pos) {
    if (drag.handle === "target") return { ...options, targetPrice: this.priceScale.coordinateToPrice(pos.y) };
    if (drag.handle === "stop") return { ...options, stopPrice: this.priceScale.coordinateToPrice(pos.y) };
    if (drag.handle === "width") {
      const time = this.coordinateToApproxTime(pos.x);
      return time === null ? options : { ...options, endTime: time };
    }
    const oldTime = this.coordinateToApproxTime(drag.lastX);
    const newTime = this.coordinateToApproxTime(pos.x);
    const timeDelta = oldTime !== null && newTime !== null ? newTime - oldTime : 0;
    const priceDelta = this.priceScale.coordinateToPrice(pos.y) - this.priceScale.coordinateToPrice(drag.lastY);
    return {
      entryTime: options.entryTime + timeDelta,
      endTime: options.endTime + timeDelta,
      entryPrice: options.entryPrice + priceDelta,
      targetPrice: options.targetPrice + priceDelta,
      stopPrice: options.stopPrice + priceDelta
    };
  }
  drawPositionToolShape(ctx, shape) {
    const { options } = shape;
    const x1 = this.timeToApproxCoordinate(options.entryTime);
    const x2 = this.timeToApproxCoordinate(options.endTime);
    if (x1 === null || x2 === null) return;
    const yEntry = this.priceScale.priceToCoordinate(options.entryPrice);
    const yTarget = this.priceScale.priceToCoordinate(options.targetPrice);
    const yStop = this.priceScale.priceToCoordinate(options.stopPrice);
    const risk = Math.abs(options.entryPrice - options.stopPrice);
    const reward = Math.abs(options.targetPrice - options.entryPrice);
    const ratioLabel = `R:R ${risk > 0 ? (reward / risk).toFixed(2) : "\u2014"}`;
    drawPositionTool(
      ctx,
      {
        x1,
        x2,
        yEntry,
        yTarget,
        yStop,
        entryLabel: `Entry ${this.priceScale.formatPrice(options.entryPrice)}`,
        targetLabel: `Target ${this.priceScale.formatPrice(options.targetPrice)}`,
        stopLabel: `Stop ${this.priceScale.formatPrice(options.stopPrice)}`,
        ratioLabel,
        isSelected: shape.id === this.selectedShapeId
      },
      this.theme,
      this.priceScale.getHeight()
    );
  }
  drawSubPaneLegends(ctx) {
    const size = this.seriesData.size();
    if (size === 0) return;
    const idx = this.hoveredIndex !== null && this.hoveredIndex < size ? this.hoveredIndex : size - 1;
    for (const indicator of this.subPaneIndicators) {
      const top = this.subPaneTops.get(indicator.id);
      if (top === void 0) continue;
      drawLegend(ctx, LEGEND_MARGIN, top + LEGEND_MARGIN, [subPaneLegendEntry(indicator, idx)], this.theme);
    }
  }
};
function subPaneReferenceLevels(indicator) {
  if (indicator.kind === "RSI") return [indicator.options.oversoldLevel, RSI_MIDLINE, indicator.options.overboughtLevel];
  if (indicator.kind === "MODIFIED_RSI") return [indicator.options.lowPoint, RSI_MIDLINE, indicator.options.highPoint];
  if (indicator.kind === "Z_SCORE") return [-3, -2, -1, 0, 1, 2, 3];
  return [indicator.options.lowerLevel, indicator.options.upperLevel];
}
function subPaneLegendEntry(indicator, idx) {
  if (indicator.kind === "RSI") {
    const value2 = indicator.values[idx] ?? null;
    return { label: `RSI ${indicator.options.period}`, valueText: formatLegendValue(value2), color: indicator.options.color };
  }
  if (indicator.kind === "MODIFIED_RSI") {
    const value2 = indicator.values[idx] ?? null;
    return {
      label: `Modified RSI ${indicator.options.period}`,
      valueText: formatLegendValue(value2),
      color: legendColorForValue(value2, indicator.options)
    };
  }
  if (indicator.kind === "Z_SCORE") {
    const point = indicator.points[idx];
    const value2 = point ? point.z : null;
    const color2 = value2 === null ? indicator.options.smaColor : value2 > 0 ? indicator.options.positiveColor : indicator.options.negativeColor;
    return { label: `Z-Score ${indicator.options.length}`, valueText: formatLegendValue(value2), color: color2 };
  }
  const value = indicator.values[idx] ?? null;
  const prevValue = idx > 0 ? indicator.values[idx - 1] ?? null : null;
  const color = value === null || prevValue === null ? indicator.options.risingColor : value > prevValue ? indicator.options.risingColor : indicator.options.fallingColor;
  return { label: `STC ${indicator.options.length}`, valueText: formatLegendValue(value), color };
}
function legendColorForValue(value, options) {
  if (value === null) return options.normalColor;
  if (value > options.highPoint) return options.highColor;
  if (value < options.lowPoint) return options.lowColor;
  return options.normalColor;
}
function formatLegendValue(value) {
  return value === null ? "\u2014" : value.toFixed(2);
}
function formatCountdown(secondsRemaining) {
  const total = Math.max(0, Math.round(secondsRemaining));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor(total % 3600 / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
function cursorForHandle(handle) {
  if (handle === "delete") return "pointer";
  if (handle === "move") return "move";
  if (handle === "target" || handle === "stop") return "ns-resize";
  if (handle === "width") return "ew-resize";
  return "crosshair";
}
function formatCrosshairTime(unixSeconds) {
  const date = new Date(unixSeconds * 1e3);
  const datePart = date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  if (hh !== 0 || mm !== 0) {
    return `${datePart} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return datePart;
}

// src/api.ts
function createChart(container, options = {}) {
  return new Chart(container, options);
}
export {
  createChart
};
//# sourceMappingURL=index.js.map