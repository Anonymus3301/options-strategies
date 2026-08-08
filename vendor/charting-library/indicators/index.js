// src/ema.ts
function computeEMA(candles, period) {
  const n = candles.length;
  const result = new Array(n).fill(null);
  if (period <= 0 || n < period) return result;
  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let ema = sum / period;
  result[period - 1] = ema;
  for (let i = period; i < n; i++) {
    ema = candles[i].close * multiplier + ema * (1 - multiplier);
    result[i] = ema;
  }
  return result;
}

// src/rsi.ts
function computeRSI(candles, period) {
  const n = candles.length;
  const result = new Array(n).fill(null);
  if (period <= 0 || n < period + 1) return result;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = rsiFromAverages(avgGain, avgLoss);
  for (let i = period + 1; i < n; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    const gain = delta >= 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return result;
}
function rsiFromAverages(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// src/atr.ts
function computeATR(candles, period) {
  const n = candles.length;
  const result = new Array(n).fill(null);
  if (period <= 0 || n === 0) return result;
  const trueRanges = new Array(n);
  for (let i = 0; i < n; i++) {
    const candle = candles[i];
    if (i === 0) {
      trueRanges[i] = candle.high - candle.low;
    } else {
      const prevClose = candles[i - 1].close;
      trueRanges[i] = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prevClose),
        Math.abs(candle.low - prevClose)
      );
    }
  }
  if (n < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trueRanges[i];
  let atr = sum / period;
  result[period - 1] = atr;
  for (let i = period; i < n; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = atr;
  }
  return result;
}

// src/utBot.ts
var EMPTY_POINT = { stop: null, aboveStop: false, buySignal: false, sellSignal: false };
function computeUtBot(candles, keyValue, atrPeriod) {
  const n = candles.length;
  const result = new Array(n).fill(EMPTY_POINT);
  const atr = computeATR(candles, atrPeriod);
  let prevStop = null;
  let prevSrc = 0;
  for (let i = 0; i < n; i++) {
    const currentAtr = atr[i];
    const src = candles[i].close;
    if (currentAtr === null || currentAtr === void 0) {
      prevSrc = src;
      continue;
    }
    const nLoss = keyValue * currentAtr;
    let stop;
    if (prevStop === null) {
      stop = src - nLoss;
    } else if (src > prevStop && prevSrc > prevStop) {
      stop = Math.max(prevStop, src - nLoss);
    } else if (src < prevStop && prevSrc < prevStop) {
      stop = Math.min(prevStop, src + nLoss);
    } else if (src > prevStop) {
      stop = src - nLoss;
    } else {
      stop = src + nLoss;
    }
    const aboveStop = src > stop;
    const crossedUp = prevStop !== null && prevSrc <= prevStop && src > stop;
    const crossedDown = prevStop !== null && prevSrc >= prevStop && src < stop;
    result[i] = {
      stop,
      aboveStop,
      buySignal: aboveStop && crossedUp,
      sellSignal: !aboveStop && crossedDown
    };
    prevStop = stop;
    prevSrc = src;
  }
  return result;
}

// src/sma.ts
function computeSmaOfSeries(values, length) {
  const n = values.length;
  const result = new Array(n).fill(null);
  if (length <= 0) return result;
  const window = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const value = values[i];
    if (value === null || value === void 0) {
      window.length = 0;
      sum = 0;
      continue;
    }
    window.push(value);
    sum += value;
    if (window.length > length) {
      sum -= window.shift();
    }
    if (window.length === length) {
      result[i] = sum / length;
    }
  }
  return result;
}

// src/zscore.ts
function computeZScore(candles, length, smaLength) {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const sma = computeSmaOfSeries(closes, length);
  const z = new Array(n).fill(null);
  for (let i = length - 1; i < n; i++) {
    const mean = sma[i];
    if (mean === null || mean === void 0) continue;
    let sumSquaredDiff = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      sumSquaredDiff += diff * diff;
    }
    const stdev = Math.sqrt(sumSquaredDiff / length);
    z[i] = stdev === 0 ? null : (closes[i] - mean) / stdev;
  }
  const zSma = computeSmaOfSeries(z, smaLength);
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = { z: z[i] ?? null, zSma: zSma[i] ?? null };
  }
  return result;
}

// src/stc.ts
var SMOOTHING_FACTOR = 0.5;
function stochasticSmooth(source, length, smoothingFactor) {
  const n = source.length;
  const smoothed = new Array(n).fill(null);
  if (length <= 0) return smoothed;
  let prevK = null;
  let prevSmoothed = null;
  for (let i = length - 1; i < n; i++) {
    const current = source[i];
    if (current === null || current === void 0) continue;
    let low = Infinity;
    let high = -Infinity;
    let windowValid = true;
    for (let j = i - length + 1; j <= i; j++) {
      const v = source[j];
      if (v === null || v === void 0) {
        windowValid = false;
        break;
      }
      if (v < low) low = v;
      if (v > high) high = v;
    }
    if (!windowValid) continue;
    const range = high - low;
    const k = range > 0 ? (current - low) / range * 100 : prevK ?? 0;
    prevK = k;
    const value = prevSmoothed === null ? k : prevSmoothed + smoothingFactor * (k - prevSmoothed);
    prevSmoothed = value;
    smoothed[i] = value;
  }
  return smoothed;
}
function computeSTC(candles, length, fastLength, slowLength) {
  const n = candles.length;
  const fastEma = computeEMA(candles, fastLength);
  const slowEma = computeEMA(candles, slowLength);
  const macd = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const fast = fastEma[i];
    const slow = slowEma[i];
    macd[i] = fast === null || fast === void 0 || slow === null || slow === void 0 ? null : fast - slow;
  }
  const firstPass = stochasticSmooth(macd, length, SMOOTHING_FACTOR);
  return stochasticSmooth(firstPass, length, SMOOTHING_FACTOR);
}

// src/donchian.ts
function computeDonchian(candles, length) {
  const n = candles.length;
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    if (length <= 0 || i < length - 1) {
      result[i] = { upper: null, lower: null, basis: null };
      continue;
    }
    let upper = -Infinity;
    let lower = Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      const candle = candles[j];
      if (candle.high > upper) upper = candle.high;
      if (candle.low < lower) lower = candle.low;
    }
    result[i] = { upper, lower, basis: (upper + lower) / 2 };
  }
  return result;
}

// src/bollinger.ts
function resolveSource(candles, source) {
  switch (source) {
    case "open":
      return candles.map((c) => c.open);
    case "high":
      return candles.map((c) => c.high);
    case "low":
      return candles.map((c) => c.low);
    case "hl2":
      return candles.map((c) => (c.high + c.low) / 2);
    case "hlc3":
      return candles.map((c) => (c.high + c.low + c.close) / 3);
    case "ohlc4":
      return candles.map((c) => (c.open + c.high + c.low + c.close) / 4);
    default:
      return candles.map((c) => c.close);
  }
}
function computeEmaOfSeries(values, length) {
  const n = values.length;
  const result = new Array(n).fill(null);
  if (length <= 0 || n < length) return result;
  const multiplier = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += values[i];
  let ema = sum / length;
  result[length - 1] = ema;
  for (let i = length; i < n; i++) {
    ema = values[i] * multiplier + ema * (1 - multiplier);
    result[i] = ema;
  }
  return result;
}
function computeRmaOfSeries(values, length) {
  const n = values.length;
  const result = new Array(n).fill(null);
  if (length <= 0 || n < length) return result;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += values[i];
  let rma = sum / length;
  result[length - 1] = rma;
  for (let i = length; i < n; i++) {
    rma = (rma * (length - 1) + values[i]) / length;
    result[i] = rma;
  }
  return result;
}
function computeWmaOfSeries(values, length) {
  const n = values.length;
  const result = new Array(n).fill(null);
  if (length <= 0 || n < length) return result;
  const denom = length * (length + 1) / 2;
  for (let i = length - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) {
      sum += values[i - length + 1 + j] * (j + 1);
    }
    result[i] = sum / denom;
  }
  return result;
}
function computeMa(values, length, maType) {
  switch (maType) {
    case "EMA":
      return computeEmaOfSeries(values, length);
    case "SMMA (RMA)":
      return computeRmaOfSeries(values, length);
    case "WMA":
      return computeWmaOfSeries(values, length);
    default:
      return computeSmaOfSeries(values, length);
  }
}
function computeStdevOfSeries(values, length) {
  const n = values.length;
  const sma = computeSmaOfSeries(values, length);
  const result = new Array(n).fill(null);
  for (let i = length - 1; i < n; i++) {
    const mean = sma[i];
    if (mean === null || mean === void 0) continue;
    let sumSquaredDiff = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const diff = values[j] - mean;
      sumSquaredDiff += diff * diff;
    }
    result[i] = Math.sqrt(sumSquaredDiff / length);
  }
  return result;
}
function computeBollingerBands(candles, length, maType, source, mult) {
  const n = candles.length;
  const src = resolveSource(candles, source);
  const basis = computeMa(src, length, maType);
  const dev = computeStdevOfSeries(src, length);
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = basis[i];
    const d = dev[i];
    if (b === null || b === void 0 || d === null || d === void 0) {
      result[i] = { basis: null, upper: null, lower: null };
    } else {
      const width = mult * d;
      result[i] = { basis: b, upper: b + width, lower: b - width };
    }
  }
  return result;
}
export {
  computeATR,
  computeBollingerBands,
  computeDonchian,
  computeEMA,
  computeRSI,
  computeSTC,
  computeSmaOfSeries,
  computeUtBot,
  computeZScore
};
//# sourceMappingURL=index.js.map