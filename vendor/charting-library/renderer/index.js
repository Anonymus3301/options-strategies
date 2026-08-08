// src/Theme.ts
var DARK_THEME = {
  background: "#0f1117",
  gridLines: "#1c2028",
  text: "#8a8f99",
  upColor: "#26a69a",
  downColor: "#ef5350",
  upWickColor: "#26a69a",
  downWickColor: "#ef5350",
  crosshairLine: "#5c6270",
  crosshairLabelBackground: "#2a2e39",
  crosshairLabelText: "#d1d4dc",
  axisBorder: "#1c2028"
};

// src/CanvasLayer.ts
import { resizeCanvasToDisplaySize } from "@charting-library/utils";
var CanvasLayer = class {
  constructor(zIndex) {
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.zIndex = String(zIndex);
    const ctx = this.canvas.getContext("2d", { alpha: zIndex > 0 });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }
  resize(cssWidth, cssHeight, pixelRatio) {
    this.width = cssWidth;
    this.height = cssHeight;
    this.pixelRatio = pixelRatio;
    resizeCanvasToDisplaySize(this.canvas, cssWidth, cssHeight, pixelRatio);
  }
  getContext() {
    return this.ctx;
  }
  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
  getSize() {
    return { width: this.width, height: this.height, pixelRatio: this.pixelRatio };
  }
};

// src/GridRenderer.ts
import { crispenLineCoordinate } from "@charting-library/utils";
function drawBackground(ctx, width, height, theme) {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
}
function drawGrid(ctx, width, height, timeScale, priceScale, theme, pixelRatio) {
  ctx.save();
  ctx.strokeStyle = theme.gridLines;
  ctx.lineWidth = 1 / pixelRatio;
  ctx.beginPath();
  for (const tick of priceScale.generateTicks()) {
    const y = crispenLineCoordinate(tick.coordinate, pixelRatio);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  for (const tick of timeScale.generateTicks()) {
    const x = crispenLineCoordinate(tick.coordinate, pixelRatio);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();
  ctx.restore();
}

// src/AxisRenderer.ts
var PRICE_AXIS_WIDTH = 64;
var TIME_AXIS_HEIGHT = 28;
var FONT = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
function drawPriceAxis(ctx, width, height, priceScale, theme) {
  ctx.save();
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = theme.axisBorder;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, height);
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const tick of priceScale.generateTicks()) {
    if (tick.coordinate < 0 || tick.coordinate > height) continue;
    ctx.fillText(tick.label, 8, tick.coordinate);
  }
  ctx.restore();
}
function drawTimeAxis(ctx, width, height, timeScale, theme) {
  ctx.save();
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = theme.axisBorder;
  ctx.beginPath();
  ctx.moveTo(0, 0.5);
  ctx.lineTo(width, 0.5);
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (const tick of timeScale.generateTicks()) {
    if (tick.coordinate < 0 || tick.coordinate > width) continue;
    ctx.fillText(tick.label, tick.coordinate, 8);
  }
  ctx.restore();
}

// src/CrosshairRenderer.ts
import { crispenLineCoordinate as crispenLineCoordinate2 } from "@charting-library/utils";
var FONT2 = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
function drawCrosshair(ctx, paneWidth, paneHeight, crosshair, theme, pixelRatio) {
  ctx.save();
  ctx.strokeStyle = theme.crosshairLine;
  ctx.lineWidth = 1 / pixelRatio;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  const x = crispenLineCoordinate2(crosshair.x, pixelRatio);
  const y = crispenLineCoordinate2(crosshair.y, pixelRatio);
  ctx.moveTo(x, 0);
  ctx.lineTo(x, paneHeight);
  ctx.moveTo(0, y);
  ctx.lineTo(paneWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawLabel(ctx, crosshair.priceLabel, paneWidth, crosshair.y, "right", theme);
  drawLabel(ctx, crosshair.timeLabel, crosshair.x, paneHeight, "bottom", theme);
  ctx.restore();
}
function drawLabel(ctx, text, anchorX, anchorY, side, theme) {
  ctx.font = FONT2;
  const paddingX = 6;
  const paddingY = 4;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const boxHeight = 20;
  let boxX;
  let boxY;
  let boxWidth;
  if (side === "right") {
    boxWidth = PRICE_AXIS_WIDTH;
    boxX = anchorX;
    boxY = anchorY - boxHeight / 2;
  } else {
    boxWidth = textWidth + paddingX * 2;
    boxX = anchorX - boxWidth / 2;
    boxY = anchorY;
  }
  ctx.fillStyle = theme.crosshairLabelBackground;
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = theme.crosshairLabelText;
  ctx.textBaseline = "middle";
  ctx.textAlign = side === "right" ? "left" : "center";
  const textX = side === "right" ? boxX + paddingX : boxX + boxWidth / 2;
  ctx.fillText(text, textX, boxY + boxHeight / 2 + paddingY / 2);
}

// src/CandlestickRenderer.ts
import { alignToDevicePixel } from "@charting-library/utils";
var DEFAULT_CANDLESTICK_OPTIONS = {
  bodyWidthRatio: 0.7,
  minBodyWidthPx: 1,
  wickWidthPx: 1
};
function drawCandlesticks(ctx, candles, startIndex, timeScale, priceScale, theme, pixelRatio, options = DEFAULT_CANDLESTICK_OPTIONS) {
  const barSpacing = timeScale.barSpacing();
  const bodyWidth = Math.max(options.minBodyWidthPx, barSpacing * options.bodyWidthRatio);
  const halfBody = bodyWidth / 2;
  ctx.save();
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const index = startIndex + i;
    const centerX = alignToDevicePixel(timeScale.indexToCoordinate(index) + barSpacing / 2, pixelRatio);
    const isUp = candle.close >= candle.open;
    ctx.fillStyle = isUp ? theme.upColor : theme.downColor;
    ctx.strokeStyle = isUp ? theme.upWickColor : theme.downWickColor;
    const yHigh = priceScale.priceToCoordinate(candle.high);
    const yLow = priceScale.priceToCoordinate(candle.low);
    const yOpen = priceScale.priceToCoordinate(candle.open);
    const yClose = priceScale.priceToCoordinate(candle.close);
    ctx.lineWidth = options.wickWidthPx;
    const wickX = alignToDevicePixel(centerX, pixelRatio) + 0.5 / pixelRatio;
    ctx.beginPath();
    ctx.moveTo(wickX, yHigh);
    ctx.lineTo(wickX, yLow);
    ctx.stroke();
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1 / pixelRatio, Math.abs(yClose - yOpen));
    const bodyLeft = alignToDevicePixel(centerX - halfBody, pixelRatio);
    const bodyRight = alignToDevicePixel(centerX + halfBody, pixelRatio);
    ctx.fillRect(bodyLeft, bodyTop, Math.max(1 / pixelRatio, bodyRight - bodyLeft), bodyHeight);
  }
  ctx.restore();
}

// src/LineSeriesRenderer.ts
function drawLineSeries(ctx, values, startIndex, timeScale, priceScale, style, offset = 0) {
  if (values.length === 0) return;
  const barSpacing = timeScale.barSpacing();
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || value === void 0) {
      penDown = false;
      continue;
    }
    const x = timeScale.indexToCoordinate(startIndex + i + offset) + barSpacing / 2;
    const y = priceScale.priceToCoordinate(value);
    if (penDown) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      penDown = true;
    }
  }
  ctx.stroke();
  ctx.restore();
}

// src/OscillatorRenderer.ts
var FONT3 = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
function drawReferenceLevels(ctx, width, levels, priceScale, theme, pixelRatio) {
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1 / pixelRatio;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (const level of levels) {
    const y = priceScale.priceToCoordinate(level);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
function drawOscillatorPriceAxis(ctx, width, height, priceScale, levels, theme) {
  ctx.save();
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = theme.axisBorder;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, height);
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.font = FONT3;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const level of levels) {
    const y = priceScale.priceToCoordinate(level);
    if (y < 0 || y > height) continue;
    ctx.fillText(priceScale.formatPrice(level), 8, y);
  }
  ctx.restore();
}

// src/UtBotRenderer.ts
function drawUtBotStopLine(ctx, points, startIndex, timeScale, priceScale, style) {
  drawMaskedLine(ctx, points, startIndex, timeScale, priceScale, style.upColor, style.lineWidth, (p) => p.aboveStop);
  drawMaskedLine(ctx, points, startIndex, timeScale, priceScale, style.downColor, style.lineWidth, (p) => !p.aboveStop);
}
function drawMaskedLine(ctx, points, startIndex, timeScale, priceScale, color, lineWidth, include) {
  const barSpacing = timeScale.barSpacing();
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.stop === null || !include(point)) {
      penDown = false;
      continue;
    }
    const x = timeScale.indexToCoordinate(startIndex + i) + barSpacing / 2;
    const y = priceScale.priceToCoordinate(point.stop);
    if (penDown) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      penDown = true;
    }
  }
  ctx.stroke();
  ctx.restore();
}
function drawUtBotMarkers(ctx, points, candles, startIndex, timeScale, priceScale, style) {
  const barSpacing = timeScale.barSpacing();
  const size = Math.max(4, Math.min(7, barSpacing * 0.4));
  const gap = size + 3;
  ctx.save();
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const candle = candles[i];
    if (!candle || !point.buySignal && !point.sellSignal) continue;
    const x = timeScale.indexToCoordinate(startIndex + i) + barSpacing / 2;
    if (point.buySignal) {
      const y = priceScale.priceToCoordinate(candle.low) + gap;
      drawTriangle(ctx, x, y, size, style.upColor, "up");
    }
    if (point.sellSignal) {
      const y = priceScale.priceToCoordinate(candle.high) - gap;
      drawTriangle(ctx, x, y, size, style.downColor, "down");
    }
  }
  ctx.restore();
}
function drawTriangle(ctx, cx, cy, size, color, direction) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (direction === "up") {
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx - size, cy + size);
    ctx.lineTo(cx + size, cy + size);
  } else {
    ctx.moveTo(cx, cy + size);
    ctx.lineTo(cx - size, cy - size);
    ctx.lineTo(cx + size, cy - size);
  }
  ctx.closePath();
  ctx.fill();
}

// src/LegendRenderer.ts
var FONT4 = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
var LINE_HEIGHT = 16;
function drawLegend(ctx, x, y, entries, theme) {
  if (entries.length === 0) return;
  ctx.save();
  ctx.font = FONT4;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.shadowColor = theme.background;
  ctx.shadowBlur = 3;
  entries.forEach((entry, i) => {
    ctx.fillStyle = entry.color;
    ctx.fillText(`${entry.label}  ${entry.valueText}`, x, y + i * LINE_HEIGHT);
  });
  ctx.restore();
}

// src/ThresholdLineRenderer.ts
function drawThresholdColoredLine(ctx, values, startIndex, timeScale, priceScale, style) {
  const barSpacing = timeScale.barSpacing();
  ctx.save();
  ctx.lineWidth = style.lineWidth;
  let prevX = null;
  let prevY = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || value === void 0) {
      prevX = null;
      prevY = null;
      continue;
    }
    const x = timeScale.indexToCoordinate(startIndex + i) + barSpacing / 2;
    const y = priceScale.priceToCoordinate(value);
    if (prevX !== null && prevY !== null) {
      ctx.strokeStyle = value > style.highThreshold ? style.highColor : value < style.lowThreshold ? style.lowColor : style.normalColor;
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prevX = x;
    prevY = y;
  }
  ctx.restore();
}

// src/BandRenderer.ts
function drawHorizontalBands(ctx, width, bands, priceScale) {
  ctx.save();
  for (const band of bands) {
    const y1 = priceScale.priceToCoordinate(band.from);
    const y2 = priceScale.priceToCoordinate(band.to);
    const top = Math.min(y1, y2);
    const height = Math.abs(y2 - y1);
    ctx.fillStyle = band.color;
    ctx.fillRect(0, top, width, height);
  }
  ctx.restore();
}

// src/DirectionLineRenderer.ts
function drawDirectionColoredLine(ctx, values, startIndex, timeScale, priceScale, style) {
  const barSpacing = timeScale.barSpacing();
  ctx.save();
  ctx.lineWidth = style.lineWidth;
  let prevX = null;
  let prevY = null;
  let prevValue = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || value === void 0) {
      prevX = null;
      prevY = null;
      prevValue = null;
      continue;
    }
    const x = timeScale.indexToCoordinate(startIndex + i) + barSpacing / 2;
    const y = priceScale.priceToCoordinate(value);
    if (prevX !== null && prevY !== null && prevValue !== null) {
      ctx.strokeStyle = value > prevValue ? style.risingColor : style.fallingColor;
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prevX = x;
    prevY = y;
    prevValue = value;
  }
  ctx.restore();
}

// src/LineBandRenderer.ts
function drawFilledLineBand(ctx, upperValues, lowerValues, startIndex, timeScale, priceScale, color, offset = 0) {
  const n = upperValues.length;
  const barSpacing = timeScale.barSpacing();
  const isValid = (i2) => upperValues[i2] !== null && upperValues[i2] !== void 0 && lowerValues[i2] !== null && lowerValues[i2] !== void 0;
  const coordinateFor = (i2, value) => [
    timeScale.indexToCoordinate(startIndex + i2 + offset) + barSpacing / 2,
    priceScale.priceToCoordinate(value)
  ];
  ctx.save();
  ctx.fillStyle = color;
  let i = 0;
  while (i < n) {
    if (!isValid(i)) {
      i++;
      continue;
    }
    let end = i;
    while (end < n && isValid(end)) end++;
    ctx.beginPath();
    for (let k = i; k < end; k++) {
      const [x, y] = coordinateFor(k, upperValues[k]);
      if (k === i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let k = end - 1; k >= i; k--) {
      const [x, y] = coordinateFor(k, lowerValues[k]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    i = end;
  }
  ctx.restore();
}

// src/PriceLineRenderer.ts
import { crispenLineCoordinate as crispenLineCoordinate3 } from "@charting-library/utils";
var FONT5 = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
var COUNTDOWN_FONT = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
var PRICE_ONLY_HEIGHT = 20;
var WITH_COUNTDOWN_HEIGHT = 32;
function drawCurrentPriceOverlay(ctx, paneWidth, paneHeight, y, priceLabel, countdownLabel, color, pixelRatio) {
  ctx.save();
  if (y >= 0 && y <= paneHeight) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / pixelRatio;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    const crispY = crispenLineCoordinate3(y, pixelRatio);
    ctx.moveTo(0, crispY);
    ctx.lineTo(paneWidth, crispY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const boxHeight = countdownLabel ? WITH_COUNTDOWN_HEIGHT : PRICE_ONLY_HEIGHT;
  const clampedY = Math.max(boxHeight / 2, Math.min(paneHeight - boxHeight / 2, y));
  const boxY = clampedY - boxHeight / 2;
  ctx.fillStyle = color;
  ctx.fillRect(paneWidth, boxY, PRICE_AXIS_WIDTH, boxHeight);
  ctx.textAlign = "left";
  if (countdownLabel) {
    ctx.font = COUNTDOWN_FONT;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.textBaseline = "top";
    ctx.fillText(countdownLabel, paneWidth + 6, boxY + 3);
    ctx.font = FONT5;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "bottom";
    ctx.fillText(priceLabel, paneWidth + 6, boxY + boxHeight - 4);
  } else {
    ctx.font = FONT5;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(priceLabel, paneWidth + 6, clampedY);
  }
  ctx.restore();
}

// src/PositionToolRenderer.ts
import { clamp } from "@charting-library/utils";
var FONT6 = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
var POSITION_TOOL_DELETE_SIZE = 16;
var POSITION_TOOL_EDGE_HIT_PX = 6;
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function drawPositionTool(ctx, args, theme, paneHeight) {
  const left = Math.min(args.x1, args.x2);
  const width = Math.abs(args.x2 - args.x1);
  const profitColor = theme.upColor;
  const lossColor = theme.downColor;
  const borderWidth = args.isSelected ? 2 : 1;
  ctx.save();
  const profitTop = Math.min(args.yEntry, args.yTarget);
  const profitHeight = Math.abs(args.yTarget - args.yEntry);
  ctx.fillStyle = hexToRgba(profitColor, 0.15);
  ctx.fillRect(left, profitTop, width, profitHeight);
  ctx.strokeStyle = profitColor;
  ctx.lineWidth = borderWidth;
  ctx.strokeRect(left + borderWidth / 2, profitTop + borderWidth / 2, width - borderWidth, profitHeight - borderWidth);
  const lossTop = Math.min(args.yEntry, args.yStop);
  const lossHeight = Math.abs(args.yStop - args.yEntry);
  ctx.fillStyle = hexToRgba(lossColor, 0.15);
  ctx.fillRect(left, lossTop, width, lossHeight);
  ctx.strokeStyle = lossColor;
  ctx.strokeRect(left + borderWidth / 2, lossTop + borderWidth / 2, width - borderWidth, lossHeight - borderWidth);
  ctx.strokeStyle = args.isSelected ? theme.crosshairLabelText : theme.text;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(left, args.yEntry);
  ctx.lineTo(left + width, args.yEntry);
  ctx.stroke();
  ctx.setLineDash([]);
  const MIN_Y = 10;
  const MAX_Y = paneHeight - 4;
  ctx.font = FONT6;
  ctx.textAlign = "left";
  const labelX = left + 4;
  ctx.textBaseline = "bottom";
  ctx.fillStyle = profitColor;
  ctx.fillText(args.targetLabel, labelX, clamp(Math.min(args.yTarget - 2, profitTop - 2), MIN_Y, MAX_Y));
  ctx.textBaseline = "top";
  ctx.fillStyle = lossColor;
  ctx.fillText(args.stopLabel, labelX, clamp(Math.max(args.yStop + 2, lossTop + lossHeight + 2), MIN_Y, MAX_Y));
  ctx.textBaseline = args.yEntry <= profitTop + profitHeight / 2 ? "top" : "bottom";
  ctx.fillStyle = theme.text;
  ctx.fillText(args.entryLabel, labelX, clamp(args.yEntry + (ctx.textBaseline === "top" ? 2 : -2), MIN_Y, MAX_Y));
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = theme.text;
  ctx.fillText(args.ratioLabel, left + width / 2, clamp(profitTop - 4, MIN_Y, MAX_Y));
  const boxTop = Math.min(profitTop, lossTop);
  const right = left + width;
  ctx.fillStyle = "rgba(20, 22, 30, 0.85)";
  ctx.fillRect(right - POSITION_TOOL_DELETE_SIZE, boxTop, POSITION_TOOL_DELETE_SIZE, POSITION_TOOL_DELETE_SIZE);
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1;
  const pad = 4;
  ctx.beginPath();
  ctx.moveTo(right - POSITION_TOOL_DELETE_SIZE + pad, boxTop + pad);
  ctx.lineTo(right - pad, boxTop + POSITION_TOOL_DELETE_SIZE - pad);
  ctx.moveTo(right - pad, boxTop + pad);
  ctx.lineTo(right - POSITION_TOOL_DELETE_SIZE + pad, boxTop + POSITION_TOOL_DELETE_SIZE - pad);
  ctx.stroke();
  ctx.restore();
}
export {
  CanvasLayer,
  DARK_THEME,
  DEFAULT_CANDLESTICK_OPTIONS,
  POSITION_TOOL_DELETE_SIZE,
  POSITION_TOOL_EDGE_HIT_PX,
  PRICE_AXIS_WIDTH,
  TIME_AXIS_HEIGHT,
  drawBackground,
  drawCandlesticks,
  drawCrosshair,
  drawCurrentPriceOverlay,
  drawDirectionColoredLine,
  drawFilledLineBand,
  drawGrid,
  drawHorizontalBands,
  drawLegend,
  drawLineSeries,
  drawOscillatorPriceAxis,
  drawPositionTool,
  drawPriceAxis,
  drawReferenceLevels,
  drawThresholdColoredLine,
  drawTimeAxis,
  drawUtBotMarkers,
  drawUtBotStopLine
};
//# sourceMappingURL=index.js.map