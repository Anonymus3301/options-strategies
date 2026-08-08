// src/TimeScale.ts
import { clamp, lowerBound } from "@charting-library/utils";
var DEFAULT_TIME_SCALE_OPTIONS = {
  barSpacing: 8,
  minBarSpacing: 0.5,
  maxBarSpacing: 100,
  rightBarMargin: 5
};
var TimeScale = class {
  constructor(options = {}) {
    this.width = 0;
    this.rightIndex = 0;
    /** Ascending-sorted unix-second timestamps, one per bar. Owned by the series layer. */
    this.times = [];
    this.options = { ...DEFAULT_TIME_SCALE_OPTIONS, ...options };
  }
  setWidth(width) {
    this.width = Math.max(0, width);
  }
  getWidth() {
    return this.width;
  }
  /** Called by the series/data layer whenever the backing time array changes. */
  setTimes(times, opts = {}) {
    const hadData = this.times.length > 0;
    this.times = times;
    if (!opts.preserveViewport || !hadData) {
      this.fitContent();
    }
  }
  barSpacing() {
    return this.options.barSpacing;
  }
  barCount() {
    return this.times.length;
  }
  setBarSpacing(spacing) {
    this.options.barSpacing = clamp(spacing, this.options.minBarSpacing, this.options.maxBarSpacing);
  }
  /** Logical index (float) -> pixel x coordinate (CSS px), can be outside [0, width]. */
  indexToCoordinate(index) {
    return this.width - (this.rightIndex - index) * this.options.barSpacing;
  }
  /** Pixel x coordinate -> logical index (float, unclamped). */
  coordinateToIndex(x) {
    return this.rightIndex - (this.width - x) / this.options.barSpacing;
  }
  /** Nearest integer bar index to a pixel x coordinate. Not clamped to data bounds. */
  coordinateToNearestIndex(x) {
    return Math.round(this.coordinateToIndex(x));
  }
  /** Resolves a bar's unix-second time from its logical index, if in range. */
  indexToTime(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.times.length) return null;
    return this.times[index] ?? null;
  }
  /** Finds the logical index of the bar at or immediately before `time`. */
  timeToIndex(time) {
    return lowerBound(this.times, time);
  }
  timeToCoordinate(time) {
    const idx = this.timeToIndex(time);
    if (idx === -1) return null;
    return this.indexToCoordinate(idx);
  }
  coordinateToTime(x) {
    return this.indexToTime(Math.round(this.coordinateToIndex(x)));
  }
  /** The (unclamped) logical range of bars currently spanning the viewport. */
  getVisibleLogicalRange() {
    return {
      from: this.coordinateToIndex(0),
      to: this.coordinateToIndex(this.width)
    };
  }
  /** Same as {@link getVisibleLogicalRange} but clamped + rounded to valid data indices. */
  getVisibleDataRange() {
    if (this.times.length === 0) return null;
    const raw = this.getVisibleLogicalRange();
    const from = clamp(Math.floor(raw.from), 0, this.times.length - 1);
    const to = clamp(Math.ceil(raw.to), 0, this.times.length - 1);
    if (from > to) return null;
    return { from, to };
  }
  /** Pans the viewport by a pixel delta (positive = drag right = reveal earlier bars).
   *  Clamped so panning can't run away into empty space past either end of the data
   *  (see {@link clampRightIndex}). */
  scrollByPixels(dx) {
    if (this.options.barSpacing === 0) return;
    this.rightIndex = this.clampRightIndex(this.rightIndex - dx / this.options.barSpacing);
  }
  /**
   * Zooms so that `barSpacing` changes by `factor`, while keeping the bar under
   * `anchorX` (a pixel x coordinate) visually stationary. Clamped the same way
   * {@link scrollByPixels} is.
   */
  zoom(anchorX, factor) {
    const anchorIndex = this.coordinateToIndex(anchorX);
    const prevSpacing = this.options.barSpacing;
    this.setBarSpacing(prevSpacing * factor);
    const newSpacing = this.options.barSpacing;
    if (newSpacing === prevSpacing) return;
    this.rightIndex = this.clampRightIndex(anchorIndex + (this.width - anchorX) / newSpacing);
  }
  /**
   * Bounds `rightIndex` so at least one real bar always stays on screen — without
   * this, scrollByPixels/zoom let the viewport run arbitrarily far into empty space
   * in either direction, with no data ever visible again short of manually scrolling
   * all the way back. Skipped when there's no data to bound against.
   *
   * The visible window is `[rightIndex - barsInView, rightIndex]`. Forward, it's
   * capped once the window's *left* edge passes `rightBarMargin` bars beyond the
   * last bar (so scrolling stops once only that much trailing empty space, plus the
   * last bar, would be added — same margin fitContent/showLastBars already leave).
   * Backward is the mirror image: capped once the window's *left* edge would go more
   * than `rightBarMargin` bars before bar 0. (An earlier version of this bounded
   * `rightIndex >= 0` directly instead — i.e. bar 0 pinned at the pane's *right*
   * edge — which is the wrong end entirely: at that position bar 0 is a hair from
   * being clipped off, not "comfortably in view", so the fix looked like scrolling
   * still ran into an empty pane.) Both margins are capped to leave at least one
   * real bar in view even when zoomed in far enough that fewer bars than the margin
   * fit on screen at all.
   */
  clampRightIndex(index) {
    if (this.times.length === 0) return index;
    const barsInView = this.options.barSpacing > 0 ? this.width / this.options.barSpacing : 0;
    const margin = Math.min(this.options.rightBarMargin, Math.max(0, barsInView - 1));
    const minIndex = barsInView - margin;
    const maxIndex = this.times.length - 1 + margin;
    return clamp(index, Math.min(minIndex, maxIndex), Math.max(minIndex, maxIndex));
  }
  /** Fits all data into the viewport with a small trailing margin, resetting zoom. */
  fitContent() {
    this.showLastBars(this.times.length);
  }
  /**
   * Like {@link fitContent}, but fits a fixed-size trailing window instead of every
   * bar — e.g. a chart backed by a large history fetch can still open on a readable
   * recent slice instead of the whole (possibly very dense) range. Earlier bars are
   * still reachable by scrolling/zooming out. `count` is clamped to at least 1.
   */
  showLastBars(count) {
    if (this.times.length === 0 || this.width === 0) {
      this.rightIndex = this.times.length - 1 + this.options.rightBarMargin;
      return;
    }
    const barsToShow = Math.max(1, count) + this.options.rightBarMargin;
    this.options.barSpacing = clamp(
      this.width / barsToShow,
      this.options.minBarSpacing,
      this.options.maxBarSpacing
    );
    this.rightIndex = this.times.length - 1 + this.options.rightBarMargin;
  }
  generateTicks(targetPixelSpacing = 100) {
    if (this.times.length === 0 || this.width === 0) return [];
    const spacing = this.options.barSpacing;
    const stepBars = Math.max(1, Math.round(targetPixelSpacing / spacing));
    const visible = this.getVisibleDataRange();
    if (!visible) return [];
    const ticks = [];
    const start = Math.ceil(visible.from / stepBars) * stepBars;
    for (let idx = start; idx <= visible.to; idx += stepBars) {
      const time = this.indexToTime(idx);
      if (time === null) continue;
      ticks.push({
        value: time,
        coordinate: this.indexToCoordinate(idx),
        label: formatTimeLabel(time)
      });
    }
    return ticks;
  }
};
function formatTimeLabel(unixSeconds) {
  const date = new Date(unixSeconds * 1e3);
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  if (hh !== 0 || mm !== 0) {
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${date.getUTCDate()}`;
}

// src/PriceScale.ts
import { computeNiceScale, decimalPrecisionForStep } from "@charting-library/utils";
var DEFAULT_PRICE_SCALE_OPTIONS = {
  autoScaleMargin: 0.1,
  targetTickSpacing: 60
};
var PriceScale = class {
  constructor(options = {}) {
    this.height = 0;
    this.mode = "auto";
    this.range = { minPrice: 0, maxPrice: 1 };
    this.options = { ...DEFAULT_PRICE_SCALE_OPTIONS, ...options };
  }
  setHeight(height) {
    this.height = Math.max(0, height);
  }
  getHeight() {
    return this.height;
  }
  isAutoScale() {
    return this.mode === "auto";
  }
  setAutoScale(enabled) {
    this.mode = enabled ? "auto" : "manual";
  }
  getRange() {
    return this.range;
  }
  /** Pins the visible range and switches to manual mode. */
  setRange(range) {
    this.mode = "manual";
    this.range = normalizeRange(range);
  }
  /**
   * Recomputes the visible range from the data's min/max, if in auto mode. No-op in
   * manual mode. Called once per frame with the min/max of the currently visible
   * (viewport-culled) series data.
   */
  applyAutoScale(dataMin, dataMax) {
    if (this.mode !== "auto") return;
    if (!isFinite(dataMin) || !isFinite(dataMax)) return;
    const span = dataMax - dataMin || Math.abs(dataMax) * 0.01 || 1;
    const margin = span * this.options.autoScaleMargin;
    this.range = normalizeRange({ minPrice: dataMin - margin, maxPrice: dataMax + margin });
  }
  priceToCoordinate(price) {
    const { minPrice, maxPrice } = this.range;
    if (maxPrice === minPrice) return this.height / 2;
    return (maxPrice - price) / (maxPrice - minPrice) * this.height;
  }
  coordinateToPrice(y) {
    const { minPrice, maxPrice } = this.range;
    return maxPrice - y / this.height * (maxPrice - minPrice);
  }
  generateTicks() {
    if (this.height === 0) return [];
    const targetCount = Math.max(2, Math.floor(this.height / this.options.targetTickSpacing));
    const nice = computeNiceScale(this.range.minPrice, this.range.maxPrice, targetCount);
    const precision = decimalPrecisionForStep(nice.step);
    return nice.ticks.filter((value) => value >= this.range.minPrice && value <= this.range.maxPrice).map((value) => ({
      value,
      coordinate: this.priceToCoordinate(value),
      label: value.toFixed(precision)
    }));
  }
  /** Formats a price using the same decimal precision as the current axis ticks. */
  formatPrice(price) {
    const targetCount = Math.max(2, Math.floor(this.height / this.options.targetTickSpacing));
    const nice = computeNiceScale(this.range.minPrice, this.range.maxPrice, targetCount);
    return price.toFixed(decimalPrecisionForStep(nice.step));
  }
};
function normalizeRange(range) {
  return range.minPrice <= range.maxPrice ? range : { minPrice: range.maxPrice, maxPrice: range.minPrice };
}
export {
  DEFAULT_PRICE_SCALE_OPTIONS,
  DEFAULT_TIME_SCALE_OPTIONS,
  PriceScale,
  TimeScale
};
//# sourceMappingURL=index.js.map