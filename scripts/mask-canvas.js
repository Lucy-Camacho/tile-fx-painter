/** The maximum number of undo steps. */
const MAX_HISTORY = 30;

/** The maximum memory in bytes for the undo steps. Each mask step of a large mask uses a lot of memory. */
const MAX_HISTORY_BYTES = 256 * 1024 * 1024;

/**
 * One undo step. It has a copy of the mask, an opacity value, or a "Show Mask" value.
 * @typedef {{mask: ImageData}|{opacity: number}|{showMask: boolean}} HistoryEntry
 */

/**
 * The brush or eraser stroke that the user draws at this time.
 * @typedef {object} Stroke
 * @property {number} pointerId
 * @property {boolean} erase                The stroke removes the mask.
 * @property {number} radius                In mask pixels.
 * @property {number} hardness              From 0 (soft edge) to 1 (hard edge).
 * @property {Uint8ClampedArray} before     The mask pixels before the stroke.
 * @property {{x: number, y: number}} last  The last painted point of the stroke, in mask pixels.
 * @property {{x: number, y: number}[]} pending  The pointer points that are not painted yet.
 * @property {{x0: number, y0: number, x1: number, y1: number}|null} dirty  The changed area that the mask canvas does not show yet.
 */

/**
 * The mask of a tile, the captured image under it, and the view that shows them together.
 * The mask has the same pixel size as the captured image.
 * In the mask, white with full alpha = effect on, transparent = effect off.
 */
export class MaskCanvas {
  /**
   * @param {object} [options]
   * @param {number} [options.opacity]   The opacity of the mask in the view, from 0 to 1.
   * @param {boolean} [options.showMask] Show the mask in the view.
   */
  constructor({ opacity = 0.5, showMask = true } = {}) {
    this.opacity = opacity;
    this.#savedOpacity = opacity;
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
  }

  /**
   * The tool for the pointer: "brush" or "eraser".
   * @type {string}
   */
  tool = "brush";

  /**
   * The diameter of the brush and the eraser, in mask pixels.
   * @type {number}
   */
  brushSize = 64;

  /**
   * The hardness of the brush and the eraser edge, from 0 (soft) to 1 (hard).
   * @type {number}
   */
  brushHardness = 0.8;

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

  /** @type {HistoryEntry[]} */
  #undo = [];

  /** @type {HistoryEntry[]} */
  #redo = [];

  /**
   * The opacity at the last undo entry. The slider changes `opacity` during a drag, thus this value gives the opacity before the drag.
   * @type {number}
   */
  #savedOpacity;

  /** @type {HTMLElement|null} */
  #view = null;

  /** @type {ResizeObserver|null} */
  #observer = null;

  /** @type {number|null} */
  #frame = null;

  /** @type {Stroke|null} */
  #stroke = null;

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

  /**
   * Set a new captured image.
   * If the size is different from the mask, the mask is scaled to the new size and the full undo history is cleared.
   * The first capture also clears the full undo history.
   * @param {HTMLCanvasElement} base
   */
  setBase(base) {
    this.#stroke = null;
    this.base = base;
    const old = this.mask;
    if (!old || (old.width !== base.width) || (old.height !== base.height)) {
      const { width, height } = base;
      if (old) {
        // Scale the old mask to the new size. This is the only read of pixels from a canvas, thus the temporary canvas can be on the CPU.
        const scaled = document.createElement("canvas");
        scaled.width = width;
        scaled.height = height;
        const ctx = scaled.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(old, 0, 0, width, height);
        this.#pixels = ctx.getImageData(0, 0, width, height);
      } else {
        this.#pixels = new ImageData(width, height);
      }

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
    }
    this.#fit();
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
    const rect = this.display.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.mask.width / rect.width),
      y: (clientY - rect.top) * (this.mask.height / rect.height)
    };
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

    const { width, height } = this.display;
    const ctx = this.display.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    if (!this.base) return;
    ctx.drawImage(this.base, 0, 0, width, height);
    if (this.showMask && this.mask) {
      ctx.globalAlpha = this.opacity;
      ctx.drawImage(this.mask, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    this.#drawCursor(ctx);
  }

  /**
   * Draw the brush circle at the pointer position.
   * The circle has a dark line and a light line, thus it shows on dark and on light images.
   * @param {CanvasRenderingContext2D} ctx
   */
  #drawCursor(ctx) {
    if (!this.#cursor || !this.mask) return;
    const scale = this.display.width / this.mask.width;
    const ratio = window.devicePixelRatio || 1;
    const x = this.#cursor.x * scale;
    const y = this.#cursor.y * scale;
    const radius = Math.max((this.brushSize / 2) * scale, 2 * ratio);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 3 * ratio;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.stroke();
    ctx.lineWidth = ratio;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke();
  }

  /** Keep the mask before a change, so that undo can restore it. Call this before each change to the mask. */
  pushUndo() {
    this.#push({ mask: this.#snapshot() });
  }

  /**
   * Make one undo step for the opacity changes since the last step.
   * The slider sets `opacity` for each small move. Call this function at the end of the move.
   */
  commitOpacity() {
    if (this.opacity === this.#savedOpacity) return;
    this.#push({ opacity: this.#savedOpacity });
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
    if ((event.button !== 0) || !this.base || !this.mask || this.#stroke) return;
    const point = this.toMaskPoint(event.clientX, event.clientY);
    this.#cursor = point;
    // The capture keeps the stroke when the pointer goes out of the display.
    this.display.setPointerCapture(event.pointerId);
    this.#beginStroke(event.pointerId, point);
  }

  /** @param {PointerEvent} event */
  #onPointerMove(event) {
    if (!this.mask) return;
    const stroke = this.#stroke;
    if (stroke && (event.pointerId === stroke.pointerId)) {
      // The browser can join many pointer moves into one event. Keep all of them, so that curves stay smooth.
      // The next animation frame paints them.
      const events = event.getCoalescedEvents?.() ?? [];
      for (const e of (events.length ? events : [event])) stroke.pending.push(this.toMaskPoint(e.clientX, e.clientY));
    }
    this.#cursor = this.toMaskPoint(event.clientX, event.clientY);
    this.requestDraw();
  }

  /** @param {PointerEvent} event */
  #onPointerEnd(event) {
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
   * Start a brush or eraser stroke. The full stroke is one undo step.
   * @param {number} pointerId
   * @param {{x: number, y: number}} point  In mask pixels.
   */
  #beginStroke(pointerId, point) {
    // The undo step and the stroke use the same copy. The stroke only reads it.
    const before = this.#snapshot();
    this.#push({ mask: before });

    const size = this.mask.width * this.mask.height;
    if (this.#strokeAlpha?.length === size) this.#strokeAlpha.fill(0);
    else this.#strokeAlpha = new Uint8Array(size);

    this.#stroke = {
      pointerId,
      erase: this.tool === "eraser",
      radius: Math.max(this.brushSize, 1) / 2,
      hardness: Math.clamp(this.brushHardness, 0, 1),
      before: before.data,
      last: point,
      pending: [],
      dirty: null
    };
    this.#paintSegment(point, point);
    this.#flushStroke();
  }

  /**
   * Paint the pointer points that are not painted yet, and copy the changed area into the mask canvas.
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
    const { radius, hardness, erase, before } = stroke;
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
    // The width of the soft edge. The minimum of 1 pixel gives a smooth edge to a hard brush.
    const invFade = 1 / Math.max(radius * (1 - hardness), 1);

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

        let v = (reach - Math.sqrt(d2)) * invFade;
        if (v > 1) v = 1;
        const s = ((v * v * (3 - (2 * v)) * 255) + 0.5) | 0;
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
   * Make the display fill the view as much as possible, with the aspect ratio of the captured image.
   * The display has the pixel density of the screen, thus the image stays sharp.
   */
  #fit() {
    if (!this.base || !this.#view) return;
    const { clientWidth, clientHeight } = this.#view;
    if (!clientWidth || !clientHeight) return;

    const scale = Math.min(clientWidth / this.base.width, clientHeight / this.base.height);
    const width = Math.max(1, Math.floor(this.base.width * scale));
    const height = Math.max(1, Math.floor(this.base.height * scale));
    this.display.style.width = `${width}px`;
    this.display.style.height = `${height}px`;

    const ratio = window.devicePixelRatio || 1;
    this.display.width = Math.round(width * ratio);
    this.display.height = Math.round(height * ratio);

    // A size change clears the canvas. Draw now, so that the display does not flash.
    this.draw();
  }

  /** @returns {ImageData}  A copy of the mask pixels. */
  #snapshot() {
    return new ImageData(new Uint8ClampedArray(this.#pixels.data), this.#pixels.width, this.#pixels.height);
  }

  /** The memory of one undo step in bytes. */
  get #snapshotBytes() {
    return this.mask.width * this.mask.height * 4;
  }

  /**
   * Add an undo step. A new change removes the redo steps.
   * @param {HistoryEntry} entry
   */
  #push(entry) {
    this.#undo.push(entry);
    this.#savedOpacity = this.opacity;

    // Remove the oldest steps. The memory limit counts only the mask steps, because an opacity step is very small.
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
      to.push({ mask: this.#pixels });
      this.#pixels = entry.mask;
      this.#maskContext.putImageData(this.#pixels, 0, 0);
    } else if ("opacity" in entry) {
      to.push({ opacity: this.opacity });
      this.opacity = this.#savedOpacity = entry.opacity;
    } else {
      to.push({ showMask: this.showMask });
      this.showMask = entry.showMask;
    }
    this.requestDraw();
    this.onHistoryChange?.();
    return true;
  }
}
