const MAX_HISTORY = 30;

const MAX_HISTORY_BYTES = 256 * 1024 * 1024;

const MAX_COLOR_DISTANCE = Math.sqrt(3) * 255;

const POLYGON_CLOSE_DISTANCE = 8;

const POLYGON_SAME_POINT_DISTANCE = 3;

const SHAPE_TOOLS = ["rect", "ellipse", "polygon"];

const MAX_PIXEL_SIZE = 32;

const ZOOM_SPEED = 0.002;

const MASK_VIEW_OPACITY = 0.75;

const PROFILE_SAMPLES = 4;

const FEATHER_FALLOFF = 4;

// Owns the base image, the mask, the display canvas, the tools, the view, and the undo history.
// Mask convention: white with full alpha is "effect on". Transparent is "effect off".
export class MaskCanvas {
  constructor({ showMask = true } = {}) {
    this.showMask = showMask;
    this.display = document.createElement("canvas");
    this.display.classList.add("tile-fx-painter-display");

    const end = this.#onPointerEnd.bind(this);
    this.display.addEventListener("pointerdown", this.#onPointerDown.bind(this));
    this.display.addEventListener("pointermove", this.#onPointerMove.bind(this));
    this.display.addEventListener("pointerup", end);
    this.display.addEventListener("pointercancel", end);
    this.display.addEventListener("lostpointercapture", end);
    this.display.addEventListener("pointerleave", this.#onPointerLeave.bind(this));
    this.display.addEventListener("dblclick", this.#onDoubleClick.bind(this));
    // Not passive, because the handler calls preventDefault to stop the page scroll.
    this.display.addEventListener("wheel", this.#onWheel.bind(this), { passive: false });
  }

  #tool = "brush";

  get tool() {
    return this.#tool;
  }

  set tool(tool) {
    if (tool === this.#tool) return;
    this.#tool = tool;
    this.cancelShape();
    this.requestDraw();
  }

  shapeMode = "add";

  selectTolerance = 15;

  selectMode = "add";

  selectContiguous = true;

  brushSize = 64;

  brushHardness = 0.8;

  brushOpacity = 1;

  base = null;

  mask = null;

  onHistoryChange = null;

  #maskContext = null;

  // The source of the mask. Change it first, then call #putPixels.
  // Do not read pixels back from the mask canvas. It is slow on large masks.
  #pixels = null;

  #basePixels = null;

  // #version identifies the current mask state. Each change takes a new number from #lastVersion.
  // The mask is dirty when #version is not #savedVersion. An undo restores the old number.
  #version = 0;

  #lastVersion = 0;

  #savedVersion = 0;

  #undo = [];

  #redo = [];

  #view = null;

  #observer = null;

  #frame = null;

  #viewWidth = 0;

  #viewHeight = 0;

  #fitScale = 1;

  #zoom = 1;

  #offset = { x: 0, y: 0 };

  #pan = null;

  #panKey = false;

  #stroke = null;

  #shape = null;

  #strokeAlpha = null;

  #cursor = null;

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  get #scale() {
    return this.#fitScale * this.#zoom;
  }

  get #maxZoom() {
    return Math.max(1, MAX_PIXEL_SIZE / this.#fitScale);
  }

  get version() {
    return this.#version;
  }

  get isDirty() {
    return this.#version !== this.#savedVersion;
  }

  markSaved(version = this.#version) {
    this.#savedVersion = version;
    this.onHistoryChange?.();
  }

  setBase(base) {
    this.#stroke = null;
    this.#shape = null;
    this.base = base;
    this.#basePixels = null;
    // A new size keeps the old mask, scaled. It also clears the history, because the snapshots do not fit.
    const old = this.mask;
    if (!old || (old.width !== base.width) || (old.height !== base.height)) {
      const { width, height } = base;
      this.#pixels = old ? MaskCanvas.#readScaled(old, width, height) : new ImageData(width, height);

      const mask = document.createElement("canvas");
      mask.width = width;
      mask.height = height;
      this.#maskContext = mask.getContext("2d");
      this.mask = mask;
      this.#putPixels();

      this.#undo.length = 0;
      this.#redo.length = 0;
      this.onHistoryChange?.();

      this.#zoom = 1;
    }
    this.#fit();
  }

  load(image) {
    if (!this.mask) return;
    this.#stroke = null;
    this.#pixels = MaskCanvas.#readScaled(image, this.mask.width, this.mask.height);
    this.#putPixels();
    this.#undo.length = 0;
    this.#redo.length = 0;
    // A loaded file is the saved state, so the mask is not dirty.
    this.#version = this.#savedVersion = ++this.#lastVersion;
    this.onHistoryChange?.();
  }

  endStroke() {
    this.#flushStroke();
    this.#stroke = null;
  }

  attach(view) {
    if ((this.#view === view) && (this.display.parentElement === view)) {
      this.#fit();
      return;
    }
    this.detach();
    this.#view = view;
    view.replaceChildren(this.display);
    this.#observer = new ResizeObserver(() => this.#fit());
    this.#observer.observe(view);
    this.#fit();
  }

  detach() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#view = null;
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  // Converts client (screen) coordinates to mask pixels.
  toMaskPoint(clientX, clientY) {
    const point = this.#toViewPoint(clientX, clientY);
    const scale = this.#scale;
    return {
      x: (point.x - this.#offset.x) / scale,
      y: (point.y - this.#offset.y) / scale
    };
  }

  #toViewPoint(clientX, clientY) {
    // A CSS transform (for example, the window scale) makes the rect size differ from #viewWidth.
    const rect = this.display.getBoundingClientRect();
    const ratio = this.#viewWidth / rect.width;
    return { x: (clientX - rect.left) * ratio, y: (clientY - rect.top) * ratio };
  }

  zoomAt(factor, clientX, clientY) {
    if (!this.base || !this.#viewWidth) return;
    const zoom = Math.clamp(this.#zoom * factor, 1, this.#maxZoom);
    if (zoom === this.#zoom) return;
    // Keep the mask point under the pointer at the same screen position.
    const point = this.toMaskPoint(clientX, clientY);
    const view = this.#toViewPoint(clientX, clientY);
    this.#zoom = zoom;
    this.#offset.x = view.x - (point.x * this.#scale);
    this.#offset.y = view.y - (point.y * this.#scale);
    this.#clampOffset();
    this.#cursor = this.toMaskPoint(clientX, clientY);
    this.requestDraw();
  }

  get panKey() {
    return this.#panKey;
  }

  setPanKey(down) {
    if (down === this.#panKey) return;
    this.#panKey = down;
    this.display.classList.toggle("pan-ready", down);
    this.requestDraw();
  }

  resetView() {
    if (!this.base) return;
    this.#zoom = 1;
    this.#clampOffset();
    this.requestDraw();
  }

  #clampOffset() {
    const scale = this.#scale;
    const axes = [["x", this.#viewWidth, this.base.width], ["y", this.#viewHeight, this.base.height]];
    for (const [axis, view, size] of axes) {
      const length = size * scale;
      this.#offset[axis] = (length <= view) ? (view - length) / 2 : Math.clamp(this.#offset[axis], view - length, 0);
    }
  }

  requestDraw() {
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => this.draw());
  }

  draw() {
    this.#flushStroke();

    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;

    const ctx = this.display.getContext("2d");
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.display.width, this.display.height);
    if (!this.base || !this.#viewWidth) return;

    // ratio is the device pixel ratio. The transform maps mask pixels to display canvas pixels.
    const ratio = this.display.width / this.#viewWidth;
    const scale = this.#scale * ratio;
    ctx.setTransform(scale, 0, 0, scale, this.#offset.x * ratio, this.#offset.y * ratio);
    // Smooth when zoomed out. Show sharp pixels when zoomed in.
    ctx.imageSmoothingEnabled = scale < 2;
    ctx.drawImage(this.base, 0, 0);
    if (this.showMask && this.mask) {
      ctx.globalAlpha = MASK_VIEW_OPACITY;
      ctx.drawImage(this.mask, 0, 0);
      ctx.globalAlpha = 1;
    }
    // unit is one screen pixel in mask pixels. It keeps the overlay line width constant at any zoom.
    const unit = 1 / this.#scale;
    this.#drawShape(ctx, unit);
    this.#drawCursor(ctx, unit);
  }

  #drawCursor(ctx, unit) {
    if (!this.#cursor || this.#pan || this.#panKey || !this.mask || !["brush", "eraser"].includes(this.tool)) return;
    const path = new Path2D();
    path.arc(this.#cursor.x, this.#cursor.y, Math.max(this.brushSize / 2, 2 * unit), 0, Math.PI * 2);
    MaskCanvas.#strokeOutline(ctx, path, unit);
  }

  #drawShape(ctx, unit) {
    const shape = this.#shape;
    if (!shape || !this.mask) return;
    if (shape.tool === "polygon") {
      const points = this.#cursor ? [...shape.points, this.#cursor] : shape.points;
      const path = new Path2D();
      points.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
      MaskCanvas.#strokeOutline(ctx, path, unit);

      const first = shape.points[0];
      const marker = new Path2D();
      marker.arc(first.x, first.y, 4 * unit, 0, Math.PI * 2);
      if (this.#canClosePolygonAt(this.#cursor)) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fill(marker);
      }
      MaskCanvas.#strokeOutline(ctx, marker, unit);
    } else {
      const path = MaskCanvas.#shapePath(shape);
      if (path) MaskCanvas.#strokeOutline(ctx, path, unit);
    }
  }

  static #strokeOutline(ctx, path, unit) {
    ctx.lineWidth = 3 * unit;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.stroke(path);
    ctx.lineWidth = unit;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke(path);
  }

  pushUndo() {
    this.#pushMask(this.#snapshot());
  }

  setShowMask(showMask) {
    if (showMask === this.showMask) return;
    const old = this.showMask;
    this.showMask = showMask;
    this.#push({ showMask: old });
    this.requestDraw();
  }

  undo() {
    return this.#restore(this.#undo, this.#redo);
  }

  redo() {
    return this.#restore(this.#redo, this.#undo);
  }

  invert() {
    if (!this.mask) return;
    this.pushUndo();
    const px = this.#pixels.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = 255 - px[i + 3];
    }
    this.#putPixels();
  }

  clear() {
    if (!this.mask) return;
    this.pushUndo();
    this.#pixels.data.fill(0);
    this.#putPixels();
  }

  selectColor(point) {
    if (!this.base || !this.mask) return false;
    const { width, height } = this.mask;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if ((x < 0) || (y < 0) || (x >= width) || (y >= height)) return false;

    this.#basePixels ??= this.base.getContext("2d").getImageData(0, 0, width, height);
    const src = this.#basePixels.data;
    const start = (y * width) + x;
    const so = start * 4;
    if (!src[so + 3]) return false;

    const r = src[so];
    const g = src[so + 1];
    const b = src[so + 2];
    // selectTolerance is 0 to 100 percent of the largest RGB distance. Compare squared distances.
    const limit = (Math.clamp(this.selectTolerance, 0, 100) / 100) * MAX_COLOR_DISTANCE;
    const limit2 = limit * limit;
    const match = (i) => {
      const o = i * 4;
      if (!src[o + 3]) return false;
      const dr = src[o] - r;
      const dg = src[o + 1] - g;
      const db = src[o + 2] - b;
      return ((dr * dr) + (dg * dg) + (db * db)) <= limit2;
    };

    let selected;
    if (this.selectContiguous) selected = MaskCanvas.#floodFill(width, height, start, match);
    else {
      selected = new Uint8Array(width * height);
      for (let i = 0; i < selected.length; i++) if (match(i)) selected[i] = 1;
    }

    const before = this.#snapshot();
    const px = this.#pixels.data;
    const value = (this.selectMode === "subtract") ? 0 : 255;
    let changed = false;
    for (let i = 0; i < selected.length; i++) {
      if (!selected[i]) continue;
      const o = i * 4;
      if (px[o + 3] === value) continue;
      px[o] = px[o + 1] = px[o + 2] = 255;
      px[o + 3] = value;
      changed = true;
    }
    if (!changed) return false;
    this.#pushMask(before);
    this.#putPixels();
    return true;
  }

  // Scanline fill. Each stack entry is one pixel. The loop expands it to a full run in its row,
  // then pushes one seed for each run that matches in the rows above and below.
  static #floodFill(width, height, start, match) {
    const selected = new Uint8Array(width * height);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      if (selected[i]) continue;
      const row = i - (i % width);
      let left = i;
      while ((left > row) && !selected[left - 1] && match(left - 1)) left--;
      let right = i;
      while ((right < row + width - 1) && !selected[right + 1] && match(right + 1)) right++;
      selected.fill(1, left, right + 1);

      for (const next of [row - width, row + width]) {
        if ((next < 0) || (next >= selected.length)) continue;
        const end = right - row + next;
        let inRun = false;
        for (let j = left - row + next; j <= end; j++) {
          const ok = !selected[j] && match(j);
          if (ok && !inRun) stack.push(j);
          inRun = ok;
        }
      }
    }
    return selected;
  }

  closePolygon() {
    const shape = this.#shape;
    if ((shape?.tool !== "polygon") || (shape.points.length < 3)) return false;
    this.#shape = null;
    this.#fillShape(shape);
    this.requestDraw();
    return true;
  }

  removePolygonPoint() {
    const points = this.#shape?.points;
    if (!points) return false;
    points.pop();
    if (!points.length) this.#shape = null;
    this.requestDraw();
    return true;
  }

  cancelShape() {
    if (!this.#shape) return false;
    this.#shape = null;
    this.requestDraw();
    return true;
  }

  #fillShape(shape) {
    // Draw the shape on a small canvas that covers only its bounds. The canvas gives anti-aliased alpha.
    const path = MaskCanvas.#shapePath(shape);
    if (!path) return false;
    const { width, height } = this.mask;
    const points = shape.points ?? [shape.start, shape.end];
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(width, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(height, Math.ceil(Math.max(...ys)));
    if ((x1 <= x0) || (y1 <= y0)) return false;

    const w = x1 - x0;
    const h = y1 - y0;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.translate(-x0, -y0);
    ctx.fill(path);
    const shapePx = ctx.getImageData(0, 0, w, h).data;

    const before = this.#snapshot();
    const px = this.#pixels.data;
    const subtract = this.shapeMode === "subtract";
    let changed = false;
    for (let y = 0; y < h; y++) {
      const row = ((y + y0) * width) + x0;
      for (let x = 0; x < w; x++) {
        const a = shapePx[(((y * w) + x) * 4) + 3];
        if (!a) continue;
        const o = (row + x) * 4;
        const old = px[o + 3];
        // Integer alpha blend, rounded to the nearest value. Add: "over" with white. Subtract: scale the old alpha down.
        const value = subtract ? (((old * (255 - a)) + 127) / 255) | 0 : old + ((((a * (255 - old)) + 127) / 255) | 0);
        if (value === old) continue;
        px[o] = px[o + 1] = px[o + 2] = 255;
        px[o + 3] = value;
        changed = true;
      }
    }
    if (!changed) return false;
    this.#pushMask(before);
    this.#putPixels({ x0, y0, x1, y1 });
    return true;
  }

  static #shapePath(shape) {
    const path = new Path2D();
    if (shape.tool === "polygon") {
      if (shape.points.length < 3) return null;
      shape.points.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
      path.closePath();
      return path;
    }
    const { start, end } = shape;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (!w || !h) return null;
    if (shape.tool === "rect") path.rect(x, y, w, h);
    else path.ellipse(x + (w / 2), y + (h / 2), w / 2, h / 2, 0, 0, Math.PI * 2);
    return path;
  }

  #canClosePolygonAt(point) {
    const points = this.#shape?.points;
    return !!point && (points?.length >= 3) && this.#isNear(point, points[0], POLYGON_CLOSE_DISTANCE);
  }

  // The distance is in screen pixels. The points are in mask pixels.
  #isNear(a, b, distance) {
    const screenScale = this.#scale * (this.display.getBoundingClientRect().width / this.#viewWidth);
    return Math.hypot(a.x - b.x, a.y - b.y) <= distance / screenScale;
  }

  #addPolygonPoint(point) {
    const shape = this.#shape;
    if (!shape) this.#shape = { tool: "polygon", points: [point] };
    else if (this.#canClosePolygonAt(point)) this.closePolygon();
    else if (!this.#isNear(point, shape.points.at(-1), POLYGON_SAME_POINT_DISTANCE)) shape.points.push(point);
    this.requestDraw();
  }

  // Copies #pixels to the mask canvas. The optional rect (mask pixels, x1 and y1 exclusive) limits the copy.
  #putPixels(rect) {
    if (rect) this.#maskContext.putImageData(this.#pixels, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    else this.#maskContext.putImageData(this.#pixels, 0, 0);
    this.requestDraw();
  }

  #onPointerDown(event) {
    if (!this.base || !this.mask) return;
    if ((event.button === 1) || ((event.button === 0) && this.#panKey)) {
      this.#beginPan(event);
      return;
    }
    if ((event.button !== 0) || this.#stroke || this.#pan) return;
    const point = this.toMaskPoint(event.clientX, event.clientY);
    this.#cursor = point;
    if (this.tool === "select") {
      this.selectColor(point);
      return;
    }
    if (this.tool === "polygon") {
      this.#addPolygonPoint(point);
      return;
    }
    if (this.#shape) return;
    this.display.setPointerCapture(event.pointerId);
    if (SHAPE_TOOLS.includes(this.tool)) {
      this.#shape = { tool: this.tool, pointerId: event.pointerId, start: point, end: point };
      this.requestDraw();
      return;
    }
    this.#beginStroke(event.pointerId, point);
  }

  #onPointerMove(event) {
    if (!this.mask) return;
    const pan = this.#pan;
    if (pan?.pointerId === event.pointerId) {
      const from = this.#toViewPoint(pan.x, pan.y);
      const to = this.#toViewPoint(event.clientX, event.clientY);
      this.#offset.x += to.x - from.x;
      this.#offset.y += to.y - from.y;
      this.#clampOffset();
      pan.x = event.clientX;
      pan.y = event.clientY;
    }
    const stroke = this.#stroke;
    if (stroke && (event.pointerId === stroke.pointerId)) {
      // The browser can merge several moves into one event. Use all of them for a smooth stroke.
      const events = event.getCoalescedEvents?.() ?? [];
      for (const e of (events.length ? events : [event])) stroke.pending.push(this.toMaskPoint(e.clientX, e.clientY));
    }
    this.#cursor = this.toMaskPoint(event.clientX, event.clientY);
    if (this.#shape?.pointerId === event.pointerId) this.#shape.end = this.#cursor;
    this.requestDraw();
  }

  #onPointerEnd(event) {
    if (this.#pan?.pointerId === event.pointerId) {
      this.#pan = null;
      this.display.classList.remove("panning");
      this.requestDraw();
      return;
    }
    const shape = this.#shape;
    if (shape && (shape.pointerId === event.pointerId)) {
      this.#shape = null;
      if (event.type === "pointerup") {
        shape.end = this.toMaskPoint(event.clientX, event.clientY);
        this.#fillShape(shape);
      }
      this.requestDraw();
      return;
    }
    if (this.#stroke?.pointerId !== event.pointerId) return;
    this.#flushStroke();
    this.#stroke = null;
  }

  #onPointerLeave(event) {
    if (this.#stroke?.pointerId === event.pointerId) return;
    this.#cursor = null;
    this.requestDraw();
  }

  #onDoubleClick(event) {
    if ((event.button !== 0) || (this.tool !== "polygon")) return;
    if (!this.closePolygon() && (this.#shape?.points.length === 1)) this.cancelShape();
  }

  #beginPan(event) {
    event.preventDefault();
    if (this.#pan) return;
    this.display.setPointerCapture(event.pointerId);
    this.#pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    this.display.classList.add("panning");
    this.requestDraw();
  }

  #onWheel(event) {
    if (!this.base || !this.#viewWidth) return;
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= this.#viewHeight;
    this.zoomAt(Math.exp(-delta * ZOOM_SPEED), event.clientX, event.clientY);
  }

  #beginStroke(pointerId, point) {
    // The snapshot is both the undo entry and the base for the stroke blend.
    const before = this.#snapshot();
    this.#pushMask(before);

    // #strokeAlpha holds the highest brush alpha per pixel in this stroke.
    const size = this.mask.width * this.mask.height;
    if (this.#strokeAlpha?.length === size) this.#strokeAlpha.fill(0);
    else this.#strokeAlpha = new Uint8Array(size);

    const radius = Math.max(this.brushSize, 1) / 2;
    this.#stroke = {
      pointerId,
      erase: this.tool === "eraser",
      radius,
      profile: MaskCanvas.#brushProfile(radius + 0.5, this.brushHardness, this.brushOpacity),
      before: before.data,
      last: point,
      pending: [],
      dirty: null
    };
    this.#paintSegment(point, point);
    this.#flushStroke();
  }

  #flushStroke() {
    const stroke = this.#stroke;
    if (!stroke) return;
    // Skip points closer than the spacing, but always paint the last point.
    const spacing = Math.max(stroke.radius / 2, 1);
    const pending = stroke.pending;
    for (let i = 0; i < pending.length; i++) {
      const point = pending[i];
      const far = Math.hypot(point.x - stroke.last.x, point.y - stroke.last.y) >= spacing;
      if (!far && (i < pending.length - 1)) continue;
      this.#paintSegment(stroke.last, point);
      stroke.last = point;
    }
    pending.length = 0;

    if (!stroke.dirty) return;
    this.#putPixels(stroke.dirty);
    stroke.dirty = null;
  }

  #paintSegment(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Split a long segment into short capsules, so that the bounding box of each stays small.
    const parts = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(this.#stroke.radius, 8)));
    for (let i = 0; i < parts; i++) {
      const a = { x: from.x + (dx * i / parts), y: from.y + (dy * i / parts) };
      const b = { x: from.x + (dx * (i + 1) / parts), y: from.y + (dy * (i + 1) / parts) };
      this.#paintCapsule(a, b);
    }
  }

  // Paints a capsule (the segment a-b with the brush radius). Each pixel uses its distance to the segment.
  // A pixel changes only when the new alpha is higher than the stroke alpha it has. It blends with the
  // pixels from before the stroke, so overlap in one stroke does not add up.
  #paintCapsule(a, b) {
    const stroke = this.#stroke;
    const { radius, profile, erase, before } = stroke;
    const alpha = this.#strokeAlpha;
    const px = this.#pixels.data;
    const { width, height } = this.mask;

    const reach = radius + 0.5;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach));
    const x1 = Math.min(width, Math.ceil(Math.max(a.x, b.x) + reach));
    const y1 = Math.min(height, Math.ceil(Math.max(a.y, b.y) + reach));
    if ((x1 <= x0) || (y1 <= y0)) return;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = (dx * dx) + (dy * dy);
    const invLength2 = length2 ? 1 / length2 : 0;
    const reach2 = reach * reach;

    for (let y = y0; y < y1; y++) {
      const ry = (y + 0.5) - a.y;
      const row = y * width;
      for (let x = x0; x < x1; x++) {
        const rx = (x + 0.5) - a.x;
        let t = ((rx * dx) + (ry * dy)) * invLength2;
        t = (t < 0) ? 0 : ((t > 1) ? 1 : t);
        const ex = rx - (t * dx);
        const ey = ry - (t * dy);
        const d2 = (ex * ex) + (ey * ey);
        if (d2 >= reach2) continue;

        const s = profile[((Math.sqrt(d2) * PROFILE_SAMPLES) + 0.5) | 0];
        const i = row + x;
        if (s <= alpha[i]) continue;
        alpha[i] = s;

        const o = i * 4;
        const old = before[o + 3];
        px[o] = px[o + 1] = px[o + 2] = 255;
        px[o + 3] = erase ? (((old * (255 - s)) + 127) / 255) | 0 : old + ((((s * (255 - old)) + 127) / 255) | 0);
      }
    }

    // Grow the dirty rect, so that #flushStroke uploads only the changed area.
    const dirty = stroke.dirty;
    if (!dirty) stroke.dirty = { x0, y0, x1, y1 };
    else {
      dirty.x0 = Math.min(dirty.x0, x0);
      dirty.y0 = Math.min(dirty.y0, y0);
      dirty.x1 = Math.max(dirty.x1, x1);
      dirty.y1 = Math.max(dirty.y1, y1);
    }
  }

  // Builds a lookup table of alpha (0 to 255) by distance from the brush center, in steps of 1/PROFILE_SAMPLES pixel.
  // The core has full alpha. The feather is a Gaussian that goes to 0 at reach. The tail term moves it down to exactly 0.
  static #brushProfile(reach, hardness, opacity) {
    const fade = Math.max(reach * (1 - Math.clamp(hardness, 0, 1)), 1);
    const core = reach - fade;
    const max = Math.clamp(opacity, 0, 1) * 255;
    const tail = Math.exp(-FEATHER_FALLOFF);
    const profile = new Uint8Array(Math.ceil(reach * PROFILE_SAMPLES) + 2);
    for (let i = 0; i < profile.length; i++) {
      const d = i / PROFILE_SAMPLES;
      if (d >= reach) break;
      const u = Math.max(d - core, 0) / fade;
      const v = (Math.exp(-FEATHER_FALLOFF * u * u) - tail) / (1 - tail);
      profile[i] = Math.round(v * max);
    }
    return profile;
  }

  #fit() {
    if (!this.base || !this.#view) return;
    const { clientWidth, clientHeight } = this.#view;
    if (!clientWidth || !clientHeight) return;

    // Keep the mask point at the view center fixed when the view size changes.
    const center = this.#viewWidth ? {
      x: ((this.#viewWidth / 2) - this.#offset.x) / this.#scale,
      y: ((this.#viewHeight / 2) - this.#offset.y) / this.#scale
    } : { x: 0, y: 0 };

    this.#viewWidth = clientWidth;
    this.#viewHeight = clientHeight;
    this.#fitScale = Math.min(clientWidth / this.base.width, clientHeight / this.base.height);
    this.#zoom = Math.min(this.#zoom, this.#maxZoom);
    this.#offset.x = (clientWidth / 2) - (center.x * this.#scale);
    this.#offset.y = (clientHeight / 2) - (center.y * this.#scale);
    this.#clampOffset();

    const ratio = window.devicePixelRatio || 1;
    this.display.width = Math.round(clientWidth * ratio);
    this.display.height = Math.round(clientHeight * ratio);

    this.draw();
  }

  #snapshot() {
    return new ImageData(new Uint8ClampedArray(this.#pixels.data), this.#pixels.width, this.#pixels.height);
  }

  static #readScaled(image, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    // Only the alpha is data. The canvas gives premultiplied color, so set the color to white.
    const pixels = ctx.getImageData(0, 0, width, height);
    const px = pixels.data;
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255;
    return pixels;
  }

  get #snapshotBytes() {
    return this.mask.width * this.mask.height * 4;
  }

  // Call this before the change. The entry stores the old pixels and the old version.
  #pushMask(before) {
    const version = this.#version;
    this.#version = ++this.#lastVersion;
    this.#push({ mask: before, version });
  }

  #push(entry) {
    this.#undo.push(entry);

    // Drop the oldest entries when there are too many or the snapshots use too much memory.
    const maskLimit = this.mask ? Math.max(1, Math.floor(MAX_HISTORY_BYTES / this.#snapshotBytes)) : Infinity;
    let masks = this.#undo.filter((e) => "mask" in e).length;
    while ((this.#undo.length > MAX_HISTORY) || (masks > maskLimit)) {
      if ("mask" in this.#undo.shift()) masks--;
    }

    this.#redo.length = 0;
    this.onHistoryChange?.();
  }

  // Moves one entry from one stack to the other and puts the current state on the other stack.
  #restore(from, to) {
    if (!from.length) return false;
    this.#stroke = null;
    const entry = from.pop();
    if ("mask" in entry) {
      to.push({ mask: this.#pixels, version: this.#version });
      this.#pixels = entry.mask;
      this.#version = entry.version;
      this.#maskContext.putImageData(this.#pixels, 0, 0);
    } else {
      to.push({ showMask: this.showMask });
      this.showMask = entry.showMask;
    }
    this.requestDraw();
    this.onHistoryChange?.();
    return true;
  }
}
