// src/CandleSeriesData.ts
import { lowerBound } from "@charting-library/utils";
var CandleSeriesData = class {
  constructor() {
    this.candles = [];
    this.timesCache = [];
  }
  setData(candles) {
    this.candles = candles.slice().sort((a, b) => a.time - b.time);
    this.rebuildTimesCache();
  }
  update(candle) {
    const n = this.candles.length;
    if (n === 0 || candle.time > this.candles[n - 1].time) {
      this.candles.push(candle);
      this.timesCache.push(candle.time);
      return;
    }
    if (candle.time === this.candles[n - 1].time) {
      this.candles[n - 1] = candle;
      return;
    }
    const idx = lowerBound(this.timesCache, candle.time);
    if (idx >= 0 && this.timesCache[idx] === candle.time) {
      this.candles[idx] = candle;
    } else {
      this.candles.splice(idx + 1, 0, candle);
      this.rebuildTimesCache();
    }
  }
  clear() {
    this.candles = [];
    this.timesCache = [];
  }
  size() {
    return this.candles.length;
  }
  isEmpty() {
    return this.candles.length === 0;
  }
  at(index) {
    return this.candles[index];
  }
  last() {
    return this.candles[this.candles.length - 1];
  }
  /** Read-only view of all bar times, ascending. Shared reference — do not mutate. */
  times() {
    return this.timesCache;
  }
  all() {
    return this.candles;
  }
  /** Bars within `range` (inclusive), clamped to valid indices. Empty if out of bounds. */
  slice(range) {
    if (this.candles.length === 0) return [];
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(this.candles.length - 1, Math.ceil(range.to));
    if (from > to) return [];
    return this.candles.slice(from, to + 1);
  }
  /** Min/max of high/low across `range`. Null if the range yields no bars. */
  priceExtent(range) {
    const bars = this.slice(range);
    if (bars.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const bar of bars) {
      if (bar.low < min) min = bar.low;
      if (bar.high > max) max = bar.high;
    }
    return { min, max };
  }
  rebuildTimesCache() {
    this.timesCache = this.candles.map((c) => c.time);
  }
};
export {
  CandleSeriesData
};
//# sourceMappingURL=index.js.map