// Left-side drawing-tool toolbar: Cursor / Long Position / Short Position / Clear
// all — plus a floating "Remove drawing" button docked to the right side of the
// chart, shown whenever a drawing is selected (clicked). Thin app-level wiring over
// the library's public setDrawingTool/addLongPosition/addShortPosition/
// onShapesChange/onDrawingToolChange/onSelectedShapeChange API — mirrors
// indicatorPanel.js's relationship to addEMA/addRSI/....
//
// `initialShapes`: `{ kind, options }[]` to restore immediately (e.g. from a saved
// session) instead of starting empty.
// `onChange`: called with the current `{ kind, options }[]` after every drawing
// add/remove/drag-release, so a caller can persist "what's on the chart right now".
export function setupDrawingToolPanel(chart, chartContainer, { initialShapes = [], onChange } = {}) {
  const toolbar = document.createElement("div");
  toolbar.id = "drawing-toolbar";

  const cursorBtn = makeButton("Cursor", "Cursor — pan/zoom/hover (default)");
  const longBtn = makeButton("Long", "Draw a Long Position");
  const shortBtn = makeButton("Short", "Draw a Short Position");
  const clearBtn = makeButton("Clear", "Remove every drawing");

  cursorBtn.addEventListener("click", () => chart.setDrawingTool(null));
  longBtn.addEventListener("click", () => chart.setDrawingTool("LONG_POSITION"));
  shortBtn.addEventListener("click", () => chart.setDrawingTool("SHORT_POSITION"));
  clearBtn.addEventListener("click", () => chart.clearPositionTools());

  chart.onDrawingToolChange((kind) => {
    cursorBtn.classList.toggle("active", kind === null);
    longBtn.classList.toggle("active", kind === "LONG_POSITION");
    shortBtn.classList.toggle("active", kind === "SHORT_POSITION");
  });
  chart.onShapesChange((shapes) => onChange?.(shapes));

  toolbar.append(cursorBtn, longBtn, shortBtn, clearBtn);
  chartContainer.appendChild(toolbar);
  cursorBtn.classList.add("active");

  const removeBtn = document.createElement("button");
  removeBtn.id = "drawing-remove-button";
  removeBtn.type = "button";
  removeBtn.hidden = true;
  chartContainer.appendChild(removeBtn);

  let selected = null;
  removeBtn.addEventListener("click", () => selected?.remove());
  chart.onSelectedShapeChange((sel) => {
    selected = sel;
    removeBtn.hidden = !sel;
    if (sel) removeBtn.textContent = `Remove ${sel.kind === "LONG_POSITION" ? "Long" : "Short"} Position`;
  });

  for (const saved of initialShapes) {
    if (saved.kind === "LONG_POSITION") chart.addLongPosition(saved.options);
    else if (saved.kind === "SHORT_POSITION") chart.addShortPosition(saved.options);
  }
}

function makeButton(label, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.title = title;
  return btn;
}
