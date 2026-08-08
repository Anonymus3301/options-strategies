// src/Delegate.ts
var Delegate = class {
  constructor() {
    this.listeners = [];
  }
  subscribe(listener) {
    this.listeners.push(listener);
    return () => this.unsubscribe(listener);
  }
  unsubscribe(listener) {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }
  fire(payload) {
    const snapshot = this.listeners.slice();
    for (const listener of snapshot) listener(payload);
  }
  destroy() {
    this.listeners.length = 0;
  }
};

// src/PointerSource.ts
var PointerSource = class {
  constructor(target) {
    this.moved = new Delegate();
    this.pressed = new Delegate();
    this.released = new Delegate();
    this.doubleClicked = new Delegate();
    this.wheel = new Delegate();
    this.left = new Delegate();
    this.onMouseMove = (e) => this.moved.fire(this.toLocal(e));
    this.onMouseDown = (e) => {
      if (e.button !== 0) return;
      this.pressed.fire(this.toLocal(e));
    };
    this.onMouseUp = (e) => {
      if (e.button !== 0) return;
      this.released.fire(this.toLocal(e));
    };
    this.onDoubleClick = (e) => this.doubleClicked.fire(this.toLocal(e));
    this.onMouseLeave = () => this.left.fire();
    this.onWheel = (e) => {
      e.preventDefault();
      const local = this.toLocal(e);
      this.wheel.fire({ ...local, deltaY: e.deltaY, deltaX: e.deltaX, shiftKey: e.shiftKey });
    };
    this.target = target;
    target.addEventListener("mousemove", this.onMouseMove);
    target.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    target.addEventListener("dblclick", this.onDoubleClick);
    target.addEventListener("mouseleave", this.onMouseLeave);
    target.addEventListener("wheel", this.onWheel, { passive: false });
  }
  toLocal(e) {
    const rect = this.target.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  destroy() {
    this.target.removeEventListener("mousemove", this.onMouseMove);
    this.target.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.target.removeEventListener("dblclick", this.onDoubleClick);
    this.target.removeEventListener("mouseleave", this.onMouseLeave);
    this.target.removeEventListener("wheel", this.onWheel);
    this.moved.destroy();
    this.pressed.destroy();
    this.released.destroy();
    this.doubleClicked.destroy();
    this.wheel.destroy();
    this.left.destroy();
  }
};
export {
  Delegate,
  PointerSource
};
//# sourceMappingURL=index.js.map