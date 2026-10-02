/** The maximum number of undo steps. */
const MAX_HISTORY = 30;

/** The maximum memory in bytes for the undo steps. Each mask step of a large mask uses a lot of memory. */
const MAX_HISTORY_BYTES = 256 * 1024 * 1024;

/** The RGB distance between black and white. Tolerance 100% of the color select accepts this distance. */
const MAX_COLOR_DISTANCE = Math.sqrt(3) * 255;

/** A click nearer than this distance (in screen pixels) to the first point of a polygon closes the polygon. */
const POLYGON_CLOSE_DISTANCE = 8;

/**
 * A click nearer than this distance (in screen pixels) to the last point of a polygon does not add a point.
 * Thus the second click of a double-click does not add a second point at the same place.
 */
const POLYGON_SAME_POINT_DISTANCE = 3;

/** The tools that draw a shape. */
const SHAPE_TOOLS = ["rect", "ellipse", "polygon"];

/** The maximum zoom shows one mask pixel as a square of this size, in screen pixels. */
const MAX_PIXEL_SIZE = 32;

/** The zoom change for one unit of mouse wheel movement. One wheel step (100 units) changes the zoom by approximately 22%. */
const ZOOM_SPEED = 0.002;

/** The opacity of the white mask over the captured image in the view. The mask file always has the full alpha values. */
const MASK_VIEW_OPACITY = 0.75;

/** The brush profile has this number of samples for each mask pixel of distance from the brush center. */
const PROFILE_SAMPLES = 4;

/**
 * The steepness of the feathered edge of the brush. A larger value makes a thinner visible edge with a longer faint tail.
 * At 4, the alpha at the middle of the feathered edge is approximately 36%.
 */
const FEATHER_FALLOFF = 4;

/**
 * One undo step. It has a copy of the mask and its version, or a "Show Mask" value.
 * @typedef {{mask: ImageData, version: number}|{showMask: boolean}} HistoryEntry
 */

/**
 * The brush or eraser stroke that the user draws at this time.
 * @typedef {object} Stroke
 * @property {number} pointerId
 * @property {boolean} erase                The stroke removes the mask.
 * @property {number} radius                In mask pixels.
 * @property {Uint8Array} profile           The stroke alpha (0 to 255) at each distance from the brush center. See `#brushProfile`.
 * @property {Uint8ClampedArray} before     The mask pixels before the stroke.
 * @property {{x: number, y: number}} last  The last painted point of the stroke, in mask pixels.
 * @property {{x: number, y: number}[]} pending  The pointer points that the stroke did not paint yet.
 * @property {{x0: number, y0: number, x1: number, y1: number}|null} dirty  The changed area that the mask canvas does not show yet.
 */

/**
 * The shape that the user draws at this time. All points are in mask pixels.
 * A rectangle or an ellipse fills the box between its two corners. The user drags it with one pointer.
 * A polygon gets one point for each click.
 * @typedef {{tool: "rect"|"ellipse", pointerId: number, start: {x: number, y: number}, end: {x: number, y: number}}
 *   |{tool: "polygon", points: {x: number, y: number}[]}} Shape
 */

/**
 * The mask of a tile, the captured image under it, and the view that shows them together.
 * The mask has the same pixel size as the captured image.
 * In the mask, white with full alpha = effect on, transparent = effect off.
 */
export class MaskCanvas {
  /**
   * @param {object} [options]
   * @param {boolean} [options.showMask] Show the mask in the view.
   */
  constructor({ showMask = true } = {}) {
    this.showMask = showMask;
    this.display = document.createElement("canvas");
    this.display.classList.add("tile-fx-painter-display");

    // The display stays for the full life of the mask, thus the listeners also stay after a render of the window.
    const end = this.#onPointerEnd.bind(this);
    this.display.addEventListener("pointerdown", this.#onPointerDown.bind(this));
    this.display.addEventListener("pointermove", this.#onPointerMove.bind(this));
    this.display.addEventListener("pointerup", end);
    this.display.addEventListener("pointercancel", end);
    this.display.addEventListener("lostpointercapture", end);
    this.display.addEventListener("pointerleave", this.#onPointerLeave.bind(this));
    this.display.addEventListener("dblclick", this.#onDoubleClick.bind(this));
    // A passive listener cannot stop the page scroll.
    this.display.addEventListener("wheel", this.#onWheel.bind(this), { passive: false });
  }

  /** @type {string} */
  #tool = "brush";

  /**
   * The tool for the pointer: "brush", "eraser", "select" (color select), "rect", "ellipse", or "polygon".
   * A tool change cancels the shape that the user draws at this time.
   * @type {string}
   */
  get tool() {
    return this.#tool;
  }

  set tool(tool) {
    if (tool === this.#tool) return;
    this.#tool = tool;
    this.cancelShape();
    this.requestDraw();
  }

  /**
   * The shapes add their area to the mask ("add"), or remove it from the mask ("subtract").
   * @type {string}
   */
  shapeMode = "add";

  /**
   * The color difference that the color select accepts, from 0 (the same color only) to 100 (all colors).
   * @type {number}
   */
  selectTolerance = 15;

  /**
   * The color select adds the selected pixels to the mask ("add"), or removes them from the mask ("subtract").
   * @type {string}
   */
  selectMode = "add";

  /**
   * The color select gets only the pixels that connect to the clicked pixel. If false, it gets all pixels with a near color.
   * @type {boolean}
   */
  selectContiguous = true;

  /**
   * The diameter of the brush and the eraser, in mask pixels.
   * @type {number}
   */
  brushSize = 64;

  /**
   * The part of the brush and eraser radius that has full alpha, from 0 to 1. The remaining outer part has a feathered edge.
   * At 0, the feathered edge starts at the brush center. At 1, the edge is hard.
   * @type {number}
   */
  brushHardness = 0.8;

  /**
   * The maximum alpha of the brush and the eraser, from 0 to 1.
   * One stroke does not go above this value where it crosses itself. A second stroke on the same area adds to the first.
   * @type {number}
   */
  brushOpacity = 1;

  /**
   * The captured image under the tile.
   * @type {HTMLCanvasElement|null}
   */
  base = null;

  /**
   * The mask.
   * @type {HTMLCanvasElement|null}
   */
  mask = null;

  /**
   * A function that the mask calls when the undo or redo state changes.
   * @type {Function|null}
   */
  onHistoryChange = null;

  /** @type {CanvasRenderingContext2D|null} */
  #maskContext = null;

  /**
   * The mask pixels. All changes go into this data first, and then into the mask canvas with `putImageData`.
   * Thus the code never reads pixels back from the mask canvas, and the browser can keep the canvas on the GPU.
   * @type {ImageData|null}
   */
  #pixels = null;

  /**
   * The pixels of the captured image. The color select reads them at its first click after each capture.
   * @type {ImageData|null}
   */
  #basePixels = null;

  /**
   * The version of the mask pixels. Each change to the mask gets a new version, and undo and redo restore the old version.
   * Thus the mask has no unsaved changes when this value is the same as `#savedVersion`, also after an undo back to the saved mask.
   * @type {number}
   */
  #version = 0;

  /** The highest version that the mask gave to a change. A new change never gets a version that the history also has. */
  #lastVersion = 0;

  /** The version at the last save or load. */
  #savedVersion = 0;

  /** @type {HistoryEntry[]} */
  #undo = [];

  /** @type {HistoryEntry[]} */
  #redo = [];

  /** @type {HTMLElement|null} */
  #view = null;

  /** @type {ResizeObserver|null} */
  #observer = null;

  /** @type {number|null} */
  #frame = null;

  /** The size of the view, in CSS pixels. The display fills the full view. */
  #viewWidth = 0;

  /** @type {number} */
  #viewHeight = 0;

  /** The scale (CSS pixels for each mask pixel) at zoom 1. Zoom 1 fits the full image in the view. */
  #fitScale = 1;

  /** The zoom, from 1 to `#maxZoom`. */
  #zoom = 1;

  /**
   * The position of the top left corner of the mask on the display, in CSS pixels.
   * @type {{x: number, y: number}}
   */
  #offset = { x: 0, y: 0 };

  /**
   * The pan that the user does at this time with the middle mouse button. The point is the last pointer position, in client pixels.
   * @type {{pointerId: number, x: number, y: number}|null}
   */
  #pan = null;

  /** The user holds the pan key (Space). A drag with the left mouse button then pans. */
  #panKey = false;

  /** @type {Stroke|null} */
  #stroke = null;

  /** @type {Shape|null} */
  #shape = null;

  /**
   * The alpha of the current stroke for each mask pixel. The array stays between strokes, so that a stroke does not make a new large array.
   * @type {Uint8Array|null}
   */
  #strokeAlpha = null;

  /**
   * The pointer position on the display, in mask pixels. The display shows the brush circle there.
   * @type {{x: number, y: number}|null}
   */
  #cursor = null;

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  /** The CSS pixels on the display for each mask pixel. */
  get #scale() {
    return this.#fitScale * this.#zoom;
  }

  /**
   * The zoom that shows one mask pixel as a square of `MAX_PIXEL_SIZE` CSS pixels.
   * A very small image can have larger pixels at zoom 1. Then the maximum zoom is 1.
   */
  get #maxZoom() {
    return Math.max(1, MAX_PIXEL_SIZE / this.#fitScale);
  }

  /**
   * The version of the mask pixels at this time. Give it to `markSaved` after the save.
   * @type {number}
   */
  get version() {
    return this.#version;
  }

  /**
   * The mask has changes after the last save or load. "Show Mask" changes are not mask changes.
   * @type {boolean}
   */
  get isDirty() {
    return this.#version !== this.#savedVersion;
  }

  /**
   * Record a version of the mask as the saved version.
   * @param {number} [version]  The version in the saved file. Changes after this version stay unsaved.
   */
  markSaved(version = this.#version) {
    this.#savedVersion = version;
    this.onHistoryChange?.();
  }

  /**
   * Set a new captured image.
   * If the size is different from the mask, this function scales the mask to the new size and clears the full undo history.
   * The first capture also clears the full undo history.
   * @param {HTMLCanvasElement} base
   */
  setBase(base) {
    this.#stroke = null;
    // The points of a shape are in mask pixels. They are not correct after a size change.
    this.#shape = null;
    this.base = base;
    this.#basePixels = null;
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

      // The first capture and each tile resize start a new history.
      this.#undo.length = 0;
      this.#redo.length = 0;
      this.onHistoryChange?.();

      // The pan position is in mask pixels of the old size.
      this.#zoom = 1;
    }
    this.#fit();
  }

  /**
   * Replace the mask with a saved mask image. If the image size is different from the mask, this function scales the image to the mask size.
   * This function also clears the full undo history, so that undo cannot go back to the empty mask before the load.
   * Call this after `setBase`, because `setBase` sets the mask size.
   * @param {CanvasImageSource} image
   */
  load(image) {
    if (!this.mask) return;
    this.#stroke = null;
    this.#pixels = MaskCanvas.#readScaled(image, this.mask.width, this.mask.height);
    this.#putPixels();
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#version = this.#savedVersion = ++this.#lastVersion;
    this.onHistoryChange?.();
  }

  /** Paint the pointer points that the stroke did not paint yet, and stop the stroke. Call this before a save, so that the file has the full stroke. */
  endStroke() {
    this.#flushStroke();
    this.#stroke = null;
  }

  /**
   * Put the display canvas into a view element. The display then fits the view size.
   * @param {HTMLElement} view
   */
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

  /** Stop the updates of the display. The mask data stays. */
  detach() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#view = null;
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  /**
   * Change pointer coordinates to mask pixel coordinates.
   * The values are not rounded, and can be outside the mask.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x: number, y: number}}
   */
  toMaskPoint(clientX, clientY) {
    const point = this.#toViewPoint(clientX, clientY);
    const scale = this.#scale;
    return {
      x: (point.x - this.#offset.x) / scale,
      y: (point.y - this.#offset.y) / scale
    };
  }

  /**
   * Change pointer coordinates to CSS pixels on the display.
   * Foundry can scale a window with a CSS transform. Then the client pixels are not the same as the CSS pixels of the view.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x: number, y: number}}
   */
  #toViewPoint(clientX, clientY) {
    const rect = this.display.getBoundingClientRect();
    const ratio = this.#viewWidth / rect.width;
    return { x: (clientX - rect.left) * ratio, y: (clientY - rect.top) * ratio };
  }

  /**
   * Zoom the view, and keep the mask point under the pointer at the same position.
   * @param {number} factor   The zoom multiplier. A value more than 1 zooms in.
   * @param {number} clientX
   * @param {number} clientY
   */
  zoomAt(factor, clientX, clientY) {
    if (!this.base || !this.#viewWidth) return;
    const zoom = Math.clamp(this.#zoom * factor, 1, this.#maxZoom);
    if (zoom === this.#zoom) return;
    const point = this.toMaskPoint(clientX, clientY);
    const view = this.#toViewPoint(clientX, clientY);
    this.#zoom = zoom;
    this.#offset.x = view.x - (point.x * this.#scale);
    this.#offset.y = view.y - (point.y * this.#scale);
    this.#clampOffset();
    this.#cursor = this.toMaskPoint(clientX, clientY);
    this.requestDraw();
  }

  /** The user holds the pan key. */
  get panKey() {
    return this.#panKey;
  }

  /**
   * Tell the mask that the user pushed or released the pan key (Space).
   * A release during a drag does not stop the pan. The pan stops when the mouse button goes up.
   * @param {boolean} down
   */
  setPanKey(down) {
    if (down === this.#panKey) return;
    this.#panKey = down;
    this.display.classList.toggle("pan-ready", down);
    // The brush circle does not show while the pan key is down.
    this.requestDraw();
  }

  /** Set the zoom back to 1 and remove the pan. The full image then fits in the view, at the center. */
  resetView() {
    if (!this.base) return;
    this.#zoom = 1;
    this.#clampOffset();
    this.requestDraw();
  }

  /**
   * Keep the image in the view.
   * On an axis where the image is smaller than the view, the image is at the center.
   * On an axis where the image is larger than the view, the image fills the view and shows no empty area.
   */
  #clampOffset() {
    const scale = this.#scale;
    const axes = [["x", this.#viewWidth, this.base.width], ["y", this.#viewHeight, this.base.height]];
    for (const [axis, view, size] of axes) {
      const length = size * scale;
      this.#offset[axis] = (length <= view) ? (view - length) / 2 : Math.clamp(this.#offset[axis], view - length, 0);
    }
  }

  /** Draw the display in the next animation frame. More requests in the same frame cause only one draw. */
  requestDraw() {
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => this.draw());
  }

  /** Draw the captured image, and then the white mask on it. */
  draw() {
    // Paint the pointer points of this frame. All the points of one frame then need only one canvas update.
    // Do this before the frame is reset. Then the draw request of the paint does not start one more frame.
    this.#flushStroke();

    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;

    const ctx = this.display.getContext("2d");
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.display.width, this.display.height);
    if (!this.base || !this.#viewWidth) return;

    // All the drawings below are in mask pixels. The transform moves them to the zoom and pan position.
    const ratio = this.display.width / this.#viewWidth;
    const scale = this.#scale * ratio;
    ctx.setTransform(scale, 0, 0, scale, this.#offset.x * ratio, this.#offset.y * ratio);
    // At a high zoom, show each mask pixel as a sharp square, so that the user can see the exact mask edge.
    ctx.imageSmoothingEnabled = scale < 2;
    ctx.drawImage(this.base, 0, 0);
    if (this.showMask && this.mask) {
      ctx.globalAlpha = MASK_VIEW_OPACITY;
      ctx.drawImage(this.mask, 0, 0);
      ctx.globalAlpha = 1;
    }
    // The line widths must be in mask pixels too. One unit is one CSS pixel.
    const unit = 1 / this.#scale;
    this.#drawShape(ctx, unit);
    this.#drawCursor(ctx, unit);
  }

  /**
   * Draw the brush circle at the pointer position.
   * @param {CanvasRenderingContext2D} ctx  The transform of the context must change mask pixels to display pixels.
   * @param {number} unit                   One CSS pixel, in mask pixels.
   */
  #drawCursor(ctx, unit) {
    // The other tools use only the crosshair pointer of the display.
    if (!this.#cursor || this.#pan || this.#panKey || !this.mask || !["brush", "eraser"].includes(this.tool)) return;
    const path = new Path2D();
    path.arc(this.#cursor.x, this.#cursor.y, Math.max(this.brushSize / 2, 2 * unit), 0, Math.PI * 2);
    MaskCanvas.#strokeOutline(ctx, path, unit);
  }

  /**
   * Draw the outline of the shape that the user draws at this time.
   * A polygon also shows a line to the pointer, and a circle on its first point. A click on the circle closes the polygon.
   * @param {CanvasRenderingContext2D} ctx  The transform of the context must change mask pixels to display pixels.
   * @param {number} unit                   One CSS pixel, in mask pixels.
   */
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

  /**
   * Draw a path with a dark line and a light line, thus it shows on dark and on light images.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Path2D} path
   * @param {number} unit  The width of the light line, in the units of the current transform.
   */
  static #strokeOutline(ctx, path, unit) {
    ctx.lineWidth = 3 * unit;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.stroke(path);
    ctx.lineWidth = unit;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke(path);
  }

  /** Keep the mask before a change, so that undo can restore it. Call this before each change to the mask. */
  pushUndo() {
    this.#pushMask(this.#snapshot());
  }

  /**
   * Show or hide the mask in the view, as one undo step.
   * @param {boolean} showMask
   */
  setShowMask(showMask) {
    if (showMask === this.showMask) return;
    const old = this.showMask;
    // Change the value before the push. The push updates the toolbar, and the toolbar must get the new value.
    this.showMask = showMask;
    this.#push({ showMask: old });
    this.requestDraw();
  }

  /**
   * Restore the mask before the last change.
   * @returns {boolean}  False if there is no change to undo.
   */
  undo() {
    return this.#restore(this.#undo, this.#redo);
  }

  /**
   * Do again the last change that undo reversed.
   * @returns {boolean}  False if there is no change to redo.
   */
  redo() {
    return this.#restore(this.#redo, this.#undo);
  }

  /** Invert the mask. The effect turns on where it was off, and off where it was on. */
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

  /** Remove the full mask. */
  clear() {
    if (!this.mask) return;
    this.pushUndo();
    this.#pixels.data.fill(0);
    this.#putPixels();
  }

  /**
   * Select the pixels of the captured image that have a color near the color at a point.
   * Add the selection to the mask or remove it from the mask, as one undo step.
   * The selection ignores transparent pixels, for example the area outside the scene background.
   * @param {{x: number, y: number}} point  In mask pixels.
   * @returns {boolean}  False if the mask did not change.
   */
  selectColor(point) {
    if (!this.base || !this.mask) return false;
    const { width, height } = this.mask;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if ((x < 0) || (y < 0) || (x >= width) || (y >= height)) return false;

    // One read for each capture. More reads can make the browser move the captured image from the GPU to the CPU.
    this.#basePixels ??= this.base.getContext("2d").getImageData(0, 0, width, height);
    const src = this.#basePixels.data;
    const start = (y * width) + x;
    const so = start * 4;
    if (!src[so + 3]) return false;

    const r = src[so];
    const g = src[so + 1];
    const b = src[so + 2];
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

    // Change the pixels first, and make the undo step only if a pixel changed. Then a click on a masked area in the
    // "add" mode does not make an empty undo step or an unsaved change.
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

  /**
   * Find the pixels that connect to a start pixel through matching pixels. Diagonal pixels do not connect.
   *
   * This is a scanline fill. It fills a full row run at a time, and keeps only one stack entry for each run in the rows above
   * and below. A stack entry for each pixel can need a very large stack on a large mask.
   * @param {number} width
   * @param {number} height
   * @param {number} start               The index of the start pixel. It must match.
   * @param {(i: number) => boolean} match  Tells if the pixel with an index is in the selection.
   * @returns {Uint8Array}  1 for each selected pixel.
   */
  static #floodFill(width, height, start, match) {
    const selected = new Uint8Array(width * height);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      // Two runs can add the same pixel to the stack.
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

  /**
   * Close the polygon that the user draws at this time, and apply it to the mask.
   * @returns {boolean}  False if there is no polygon, or if the polygon has less than 3 points. A polygon with less than 3 points stays open.
   */
  closePolygon() {
    const shape = this.#shape;
    if ((shape?.tool !== "polygon") || (shape.points.length < 3)) return false;
    this.#shape = null;
    this.#fillShape(shape);
    this.requestDraw();
    return true;
  }

  /**
   * Remove the last point of the polygon that the user draws at this time. The removal of the only point cancels the polygon.
   * @returns {boolean}  False if there is no polygon.
   */
  removePolygonPoint() {
    const points = this.#shape?.points;
    if (!points) return false;
    points.pop();
    if (!points.length) this.#shape = null;
    this.requestDraw();
    return true;
  }

  /**
   * Stop the shape that the user draws at this time. The mask does not change.
   * @returns {boolean}  False if there is no shape.
   */
  cancelShape() {
    if (!this.#shape) return false;
    this.#shape = null;
    this.requestDraw();
    return true;
  }

  /**
   * Add the area of a shape to the mask or remove it from the mask, as one undo step.
   * The edge of the shape is smooth (anti-aliased).
   * @param {Shape} shape
   * @returns {boolean}  False if the mask did not change.
   */
  #fillShape(shape) {
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

    // The canvas draws the shape with a smooth edge. A temporary canvas with only the area of the shape keeps the read small.
    const w = x1 - x0;
    const h = y1 - y0;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.translate(-x0, -y0);
    ctx.fill(path);
    const shapePx = ctx.getImageData(0, 0, w, h).data;

    // Change the pixels first, and make the undo step only if a pixel changed. The calculation is the same as the brush.
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

  /**
   * Make the path of a shape, in mask pixels.
   * @param {Shape} shape
   * @returns {Path2D|null}  Null if the shape has no area.
   */
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

  /**
   * Tell if a click at a point closes the polygon that the user draws at this time.
   * @param {{x: number, y: number}|null} point  In mask pixels.
   * @returns {boolean}
   */
  #canClosePolygonAt(point) {
    const points = this.#shape?.points;
    return !!point && (points?.length >= 3) && this.#isNear(point, points[0], POLYGON_CLOSE_DISTANCE);
  }

  /**
   * Tell if two points are near on the screen. The distance limit stays the same at all display sizes.
   * @param {{x: number, y: number}} a     In mask pixels.
   * @param {{x: number, y: number}} b     In mask pixels.
   * @param {number} distance              The limit, in screen pixels.
   * @returns {boolean}
   */
  #isNear(a, b, distance) {
    const screenScale = this.#scale * (this.display.getBoundingClientRect().width / this.#viewWidth);
    return Math.hypot(a.x - b.x, a.y - b.y) <= distance / screenScale;
  }

  /**
   * Add a point to the polygon, or start a new polygon. A click on the first point closes the polygon.
   * @param {{x: number, y: number}} point  In mask pixels.
   */
  #addPolygonPoint(point) {
    const shape = this.#shape;
    if (!shape) this.#shape = { tool: "polygon", points: [point] };
    else if (this.#canClosePolygonAt(point)) this.closePolygon();
    else if (!this.#isNear(point, shape.points.at(-1), POLYGON_SAME_POINT_DISTANCE)) shape.points.push(point);
    this.requestDraw();
  }

  /**
   * Copy the mask pixels into the mask canvas, and draw the display again.
   * @param {{x0: number, y0: number, x1: number, y1: number}} [rect]  Copy only this area. The default is the full mask.
   */
  #putPixels(rect) {
    if (rect) this.#maskContext.putImageData(this.#pixels, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    else this.#maskContext.putImageData(this.#pixels, 0, 0);
    this.requestDraw();
  }

  /** @param {PointerEvent} event */
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
    // A second pointer must not start a second rectangle or ellipse during a drag.
    if (this.#shape) return;
    // The capture keeps the stroke or the drag when the pointer goes out of the display.
    this.display.setPointerCapture(event.pointerId);
    if (SHAPE_TOOLS.includes(this.tool)) {
      this.#shape = { tool: this.tool, pointerId: event.pointerId, start: point, end: point };
      this.requestDraw();
      return;
    }
    this.#beginStroke(event.pointerId, point);
  }

  /** @param {PointerEvent} event */
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
      // The browser can join many pointer moves into one event. Keep all of them, so that curves stay smooth.
      // The next animation frame paints them.
      const events = event.getCoalescedEvents?.() ?? [];
      for (const e of (events.length ? events : [event])) stroke.pending.push(this.toMaskPoint(e.clientX, e.clientY));
    }
    this.#cursor = this.toMaskPoint(event.clientX, event.clientY);
    if (this.#shape?.pointerId === event.pointerId) this.#shape.end = this.#cursor;
    this.requestDraw();
  }

  /**
   * End a stroke, a pan, or the drag of a rectangle or an ellipse.
   * Only "pointerup" applies the shape. A "pointercancel" or a lost pointer capture cancels it.
   * @param {PointerEvent} event
   */
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

  /** @param {PointerEvent} event */
  #onPointerLeave(event) {
    if (this.#stroke?.pointerId === event.pointerId) return;
    this.#cursor = null;
    this.requestDraw();
  }

  /**
   * A double-click closes the polygon.
   * If the first click of the double-click closed the polygon, the second click started a new polygon with one point. Remove that polygon.
   * @param {MouseEvent} event
   */
  #onDoubleClick(event) {
    if ((event.button !== 0) || (this.tool !== "polygon")) return;
    if (!this.closePolygon() && (this.#shape?.points.length === 1)) this.cancelShape();
  }

  /**
   * Start a pan with the middle mouse button, or with the left mouse button while the pan key is down.
   * @param {PointerEvent} event
   */
  #beginPan(event) {
    // Stop the auto-scroll of the browser, which starts with the middle button.
    event.preventDefault();
    if (this.#pan) return;
    this.display.setPointerCapture(event.pointerId);
    this.#pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    this.display.classList.add("panning");
    this.requestDraw();
  }

  /**
   * Zoom with the mouse wheel. The mask point under the pointer stays under the pointer.
   * @param {WheelEvent} event
   */
  #onWheel(event) {
    if (!this.base || !this.#viewWidth) return;
    event.preventDefault();
    // The delta can be in lines or in pages, not in pixels.
    let delta = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= this.#viewHeight;
    this.zoomAt(Math.exp(-delta * ZOOM_SPEED), event.clientX, event.clientY);
  }

  /**
   * Start a brush or eraser stroke. The full stroke is one undo step.
   * @param {number} pointerId
   * @param {{x: number, y: number}} point  In mask pixels.
   */
  #beginStroke(pointerId, point) {
    // The undo step and the stroke use the same copy. The stroke only reads it.
    const before = this.#snapshot();
    this.#pushMask(before);

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

  /**
   * Paint the pointer points that the stroke did not paint yet, and copy the changed area into the mask canvas.
   *
   * A fast mouse sends many points in each frame. Each segment paints a full brush width, thus most of the pixels again and again.
   * Points that are nearer than a half brush radius to the last painted point are skipped. For a large brush, this removes most segments.
   * The last point of the frame is always painted, so that the stroke stays at the pointer.
   */
  #flushStroke() {
    const stroke = this.#stroke;
    if (!stroke) return;
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

  /**
   * Paint the stroke from one point to the next point.
   * @param {{x: number, y: number}} from
   * @param {{x: number, y: number}} to
   */
  #paintSegment(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // A long diagonal line has a very large bounding box. Short parts keep the number of changed pixels small.
    const parts = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(this.#stroke.radius, 8)));
    for (let i = 0; i < parts; i++) {
      const a = { x: from.x + (dx * i / parts), y: from.y + (dy * i / parts) };
      const b = { x: from.x + (dx * (i + 1) / parts), y: from.y + (dy * (i + 1) / parts) };
      this.#paintCapsule(a, b);
    }
  }

  /**
   * Paint a line with round ends from point a to point b into the mask.
   *
   * Each pixel keeps the highest stroke alpha of the full stroke, and the mask gets the pixels before the stroke plus that alpha.
   * Thus the parts of a stroke that overlap do not add together, and a soft edge stays soft.
   * @param {{x: number, y: number}} a
   * @param {{x: number, y: number}} b
   */
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

    // This loop runs for each pixel under the brush. It uses only simple operations, because function calls such as
    // Math.hypot are slow here. It also skips the pixels that do not change, which are most pixels when segments overlap.
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

    const dirty = stroke.dirty;
    if (!dirty) stroke.dirty = { x0, y0, x1, y1 };
    else {
      dirty.x0 = Math.min(dirty.x0, x0);
      dirty.y0 = Math.min(dirty.y0, y0);
      dirty.x1 = Math.max(dirty.x1, x1);
      dirty.y1 = Math.max(dirty.y1, y1);
    }
  }

  /**
   * Make the alpha profile of the brush. Entry `i` is the alpha at the distance `i / PROFILE_SAMPLES` from the brush center.
   * The paint loop reads this table, because a calculation of the curve for each pixel is slow.
   *
   * The profile has full alpha in the core (`hardness` of the reach), and a feathered edge out to the reach.
   * The edge uses a Gaussian curve that goes to 0 at the reach. The alpha falls quickly after the core and ends in a long faint tail.
   * Thus a soft brush has no solid core. A smoothstep curve stays near full alpha for most of the edge, and looks almost hard.
   * @param {number} reach     The distance where the alpha becomes 0, in mask pixels.
   * @param {number} hardness  From 0 (feathered from the center) to 1 (hard edge).
   * @param {number} opacity   The alpha at the center, from 0 to 1.
   * @returns {Uint8Array}
   */
  static #brushProfile(reach, hardness, opacity) {
    // The minimum width of 1 pixel gives a smooth (anti-aliased) edge to a hard brush.
    const fade = Math.max(reach * (1 - Math.clamp(hardness, 0, 1)), 1);
    const core = reach - fade;
    const max = Math.clamp(opacity, 0, 1) * 255;
    const tail = Math.exp(-FEATHER_FALLOFF);
    // One more entry, because the paint loop rounds the index, and a distance just below the reach can round up.
    const profile = new Uint8Array(Math.ceil(reach * PROFILE_SAMPLES) + 2);
    for (let i = 0; i < profile.length; i++) {
      const d = i / PROFILE_SAMPLES;
      if (d >= reach) break;
      const u = Math.max(d - core, 0) / fade;
      // Subtract the tail value, so that the alpha is exactly 0 at the reach and the edge has no visible step.
      const v = (Math.exp(-FEATHER_FALLOFF * u * u) - tail) / (1 - tail);
      profile[i] = Math.round(v * max);
    }
    return profile;
  }

  /**
   * Give the display the size of the view, and calculate the scale at zoom 1 again.
   * The display has the pixel density of the screen, thus the image stays sharp.
   * The zoom stays, and the mask point at the center of the view stays at the center.
   */
  #fit() {
    if (!this.base || !this.#view) return;
    const { clientWidth, clientHeight } = this.#view;
    if (!clientWidth || !clientHeight) return;

    // The first fit has no center point. The clamp below then puts the image at the center.
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

    // A size change clears the canvas. Draw now, so that the display does not flash.
    this.draw();
  }

  /** @returns {ImageData}  A copy of the mask pixels. */
  #snapshot() {
    return new ImageData(new Uint8ClampedArray(this.#pixels.data), this.#pixels.width, this.#pixels.height);
  }

  /**
   * Draw an image with a new size into a temporary canvas, and read its pixels.
   * This is the only read of pixels from a canvas, thus the temporary canvas can be on the CPU.
   * @param {CanvasImageSource} image
   * @param {number} width
   * @param {number} height
   * @returns {ImageData}
   */
  static #readScaled(image, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    // The canvas keeps colors multiplied by alpha. Thus a transparent pixel comes back black. Only the alpha is the mask.
    const px = pixels.data;
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255;
    return pixels;
  }

  /** The memory of one undo step in bytes. */
  get #snapshotBytes() {
    return this.mask.width * this.mask.height * 4;
  }

  /**
   * Add an undo step for a change to the mask, and give the changed mask a new version.
   * @param {ImageData} before  A copy of the mask before the change.
   */
  #pushMask(before) {
    const version = this.#version;
    // Set the new version before the push. The push updates the toolbar, and the toolbar shows the unsaved state.
    this.#version = ++this.#lastVersion;
    this.#push({ mask: before, version });
  }

  /**
   * Add an undo step. A new change removes the redo steps.
   * @param {HistoryEntry} entry
   */
  #push(entry) {
    this.#undo.push(entry);

    // Remove the oldest steps. The memory limit counts only the mask steps, because a "Show Mask" step is very small.
    const maskLimit = this.mask ? Math.max(1, Math.floor(MAX_HISTORY_BYTES / this.#snapshotBytes)) : Infinity;
    let masks = this.#undo.filter((e) => "mask" in e).length;
    while ((this.#undo.length > MAX_HISTORY) || (masks > maskLimit)) {
      if ("mask" in this.#undo.shift()) masks--;
    }

    this.#redo.length = 0;
    this.onHistoryChange?.();
  }

  /**
   * Apply the last entry of one stack. Keep the current state of the same type in the other stack.
   * @param {HistoryEntry[]} from
   * @param {HistoryEntry[]} to
   * @returns {boolean}
   */
  #restore(from, to) {
    if (!from.length) return false;
    // Ctrl+Z during a stroke stops the stroke. Else the next pointer move paints on the restored mask with old data.
    this.#stroke = null;
    const entry = from.pop();
    if ("mask" in entry) {
      // Exchange the data objects. A copy is not necessary, because the history entry is not in a stack after this.
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
