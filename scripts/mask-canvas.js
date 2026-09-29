/** The maximum number of undo steps. */
const MAX_HISTORY = 30;

/** The maximum memory in bytes for the undo steps. Each mask step of a large mask uses a lot of memory. */
const MAX_HISTORY_BYTES = 256 * 1024 * 1024;

/**
 * One undo step. It has a copy of the mask, an opacity value, or a "Show Mask" value.
 * @typedef {{mask: ImageData}|{opacity: number}|{showMask: boolean}} HistoryEntry
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
  }

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
    this.base = base;
    const old = this.mask;
    if (!old || (old.width !== base.width) || (old.height !== base.height)) {
      const mask = document.createElement("canvas");
      mask.width = base.width;
      mask.height = base.height;
      // The history reads the mask pixels for each change.
      this.#maskContext = mask.getContext("2d", { willReadFrequently: true });
      if (old) this.#maskContext.drawImage(old, 0, 0, mask.width, mask.height);
      this.mask = mask;

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
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;

    const { width, height } = this.display;
    const ctx = this.display.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    if (!this.base) return;
    ctx.drawImage(this.base, 0, 0, width, height);
    if (!this.showMask || !this.mask) return;

    ctx.globalAlpha = this.opacity;
    ctx.drawImage(this.mask, 0, 0, width, height);
    ctx.globalAlpha = 1;
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
    const data = this.#snapshot();
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = 255 - px[i + 3];
    }
    this.#maskContext.putImageData(data, 0, 0);
    this.requestDraw();
  }

  /** Remove the full mask. */
  clear() {
    if (!this.mask) return;
    this.pushUndo();
    this.#maskContext.clearRect(0, 0, this.mask.width, this.mask.height);
    this.requestDraw();
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

  /** @returns {ImageData} */
  #snapshot() {
    return this.#maskContext.getImageData(0, 0, this.mask.width, this.mask.height);
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
    const entry = from.pop();
    if ("mask" in entry) {
      to.push({ mask: this.#snapshot() });
      this.#maskContext.putImageData(entry.mask, 0, 0);
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
