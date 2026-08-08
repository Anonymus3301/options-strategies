// src/math.ts
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function invLerp(a, b, value) {
  if (a === b) return 0;
  return (value - a) / (b - a);
}
function isBetween(value, min, max) {
  return value >= min && value <= max;
}
function alignToDevicePixel(value, devicePixelRatio) {
  return Math.round(value * devicePixelRatio) / devicePixelRatio;
}
function crispenLineCoordinate(value, devicePixelRatio) {
  const shift = 0.5 / devicePixelRatio;
  return alignToDevicePixel(value, devicePixelRatio) + shift;
}

// src/dpr.ts
function getDevicePixelRatio() {
  return typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
}
function resizeCanvasToDisplaySize(canvas, cssWidth, cssHeight, devicePixelRatio) {
  const targetWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const targetHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
  const resized = canvas.width !== targetWidth || canvas.height !== targetHeight;
  if (resized) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  return resized;
}

// src/binarySearch.ts
function lowerBound(sorted, value, less = defaultLess) {
  let lo = 0;
  let hi = sorted.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = lo + hi >>> 1;
    const midVal = sorted[mid];
    if (less(midVal, value) || equal(midVal, value, less)) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
function upperBoundInclusive(sorted, value, less = defaultLess) {
  let lo = 0;
  let hi = sorted.length - 1;
  let result = sorted.length;
  while (lo <= hi) {
    const mid = lo + hi >>> 1;
    const midVal = sorted[mid];
    if (less(value, midVal)) {
      result = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return result;
}
function defaultLess(a, b) {
  return a < b;
}
function equal(a, b, less) {
  return !less(a, b) && !less(b, a);
}

// src/niceNumbers.ts
function niceNum(value, round) {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}
function computeNiceScale(dataMin, dataMax, targetTickCount) {
  if (dataMin === dataMax) {
    const pad = dataMin === 0 ? 1 : Math.abs(dataMin) * 0.01;
    dataMin -= pad;
    dataMax += pad;
  }
  const range = niceNum(dataMax - dataMin, false);
  const step = niceNum(range / Math.max(1, targetTickCount - 1), true);
  const min = Math.floor(dataMin / step) * step;
  const max = Math.ceil(dataMax / step) * step;
  const ticks = [];
  const count = Math.round((max - min) / step);
  for (let i = 0; i <= count; i++) {
    ticks.push(min + i * step);
  }
  return { min, max, step, ticks };
}
function decimalPrecisionForStep(step) {
  if (step <= 0 || !isFinite(step)) return 2;
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  return Math.min(precision, 8);
}
export {
  alignToDevicePixel,
  clamp,
  computeNiceScale,
  crispenLineCoordinate,
  decimalPrecisionForStep,
  getDevicePixelRatio,
  invLerp,
  isBetween,
  lerp,
  lowerBound,
  resizeCanvasToDisplaySize,
  upperBoundInclusive
};
//# sourceMappingURL=index.js.map