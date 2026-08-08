// src/InMemoryDatafeed.ts
var InMemoryDatafeed = class {
  constructor(initialCandles) {
    this.initialCandles = initialCandles;
    this.handlers = null;
  }
  subscribe(handlers) {
    this.handlers = handlers;
    handlers.onInitialData(this.initialCandles);
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }
  /** Pushes a new or updated bar to the currently subscribed chart, if any. */
  push(candle) {
    this.handlers?.onBarUpdate(candle);
  }
};
export {
  InMemoryDatafeed
};
//# sourceMappingURL=index.js.map