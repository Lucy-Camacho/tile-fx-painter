import { MODULE_ID } from "./main.js";
import { captureBackground } from "./background-capture.js";
import { MaskCanvas } from "./mask-canvas.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The window where the user makes the effect mask for one tile.
 * The window id comes from the tile id, thus each tile has a maximum of one editor.
 */
export class EffectEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {TileDocument} options.document  The tile to edit.
   */
  constructor({ document, ...options } = {}) {
    super({ ...options, id: EffectEditor.getId(document) });
    this.tile = document;
    // The mask stays when the window renders again.
    this.mask = new MaskCanvas();
    this.mask.onHistoryChange = () => this.#updateToolbar();
  }

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "effect-editor"],
    window: {
      icon: "fa-solid fa-pen-ruler",
      resizable: true
    },
    position: {
      width: 720,
      height: 560
    },
    actions: {
      selectTool: EffectEditor.#onSelectTool,
      undoMask: EffectEditor.#onUndoMask,
      redoMask: EffectEditor.#onRedoMask,
      invertMask: EffectEditor.#onInvertMask,
      clearMask: EffectEditor.#onClearMask
    }
  };

  /** The tools for the pointer, in the order of the tool buttons. */
  static TOOLS = [
    { id: "brush", icon: "fa-solid fa-paintbrush", label: "TILE_FX_PAINTER.Editor.Brush" },
    { id: "eraser", icon: "fa-solid fa-eraser", label: "TILE_FX_PAINTER.Editor.Eraser" }
  ];

  /** The tile fields that change the area under the tile. A change to one of them makes a new capture necessary. */
  static CAPTURE_FIELDS = ["x", "y", "width", "height", "rotation"];

  /**
   * A counter for the captures. A capture can take a long time. Only the result of the last capture goes into the view.
   * @type {number}
   */
  #captureId = 0;

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/effect-editor.hbs`
    }
  };

  /**
   * Get the window id of the editor for a tile.
   * @param {TileDocument} tile
   * @returns {string}
   */
  static getId(tile) {
    return `${MODULE_ID}-editor-${tile.id}`;
  }

  /**
   * Bring the open editor of a tile to the front, or open a new editor.
   * @param {TileDocument} tile
   * @returns {EffectEditor}
   */
  static open(tile) {
    const existing = foundry.applications.instances.get(EffectEditor.getId(tile));
    if (existing) {
      existing.bringToFront();
      return existing;
    }
    const editor = new EffectEditor({ document: tile });
    editor.render({ force: true });
    return editor;
  }

  /** @override */
  get title() {
    // Tiles do not have a name, thus the title shows the tile id.
    return game.i18n.format("TILE_FX_PAINTER.Editor.Title", { id: this.tile.id });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      tools: EffectEditor.TOOLS.map((tool) => ({ ...tool, active: tool.id === this.mask.tool })),
      brushSize: this.mask.brushSize,
      brushHardness: Math.round(this.mask.brushHardness * 100),
      opacity: Math.round(this.mask.opacity * 100),
      showMask: this.mask.showMask,
      canUndo: this.mask.canUndo,
      canRedo: this.mask.canRedo
    });
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // A tabindex lets a click in the window give it focus. Then the window gets the keyboard shortcuts.
    this.element.tabIndex = -1;
    this.element.addEventListener("keydown", this.#onKeyDown.bind(this));
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.querySelector("[name=brushSize]").addEventListener("input", (event) => {
      this.mask.brushSize = event.currentTarget.valueAsNumber;
      event.currentTarget.nextElementSibling.textContent = this.mask.brushSize;
    });
    el.querySelector("[name=brushHardness]").addEventListener("input", (event) => {
      this.mask.brushHardness = event.currentTarget.valueAsNumber / 100;
      event.currentTarget.nextElementSibling.textContent = `${event.currentTarget.value}%`;
    });
    el.querySelector("[name=opacity]").addEventListener("input", (event) => {
      this.mask.opacity = event.currentTarget.valueAsNumber / 100;
      this.mask.requestDraw();
    });
    // "change" occurs at the end of a drag. Thus one drag gives one undo step.
    el.querySelector("[name=opacity]").addEventListener("change", () => this.mask.commitOpacity());
    el.querySelector("[name=showMask]").addEventListener("change", (event) => {
      this.mask.setShowMask(event.currentTarget.checked);
    });

    // Show the mask of an earlier capture at once. The new capture replaces it when it is ready.
    if (this.mask.base) this.mask.attach(this.element.querySelector(".tile-fx-painter-editor-view"));
    this.element.focus();
    await this.recapture();
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    // The element stays until the close animation ends. A capture that ends in that time must not attach the view again.
    this.#captureId++;
    this.mask.detach();
  }

  /**
   * Capture the background under the tile again and show it in the view area.
   * The capture uses the saved tile data.
   * @returns {Promise<void>}
   */
  async recapture() {
    const captureId = ++this.#captureId;

    let capture = null;
    let message = "TILE_FX_PAINTER.Editor.NoBackground";
    try {
      capture = await captureBackground(this.tile);
    } catch (err) {
      console.error(err);
      message = "TILE_FX_PAINTER.Editor.CaptureFailed";
    }

    // A newer capture started, or the window closed, while this capture loaded.
    const view = this.element?.querySelector(".tile-fx-painter-editor-view");
    if ((captureId !== this.#captureId) || !view) return;

    if (capture) {
      this.mask.setBase(capture);
      this.mask.attach(view);
    } else {
      this.mask.detach();
      const hint = document.createElement("p");
      hint.classList.add("hint");
      hint.textContent = game.i18n.localize(message);
      view.replaceChildren(hint);
    }
  }

  /** Show the values after an undo or redo, and enable or disable the undo and redo buttons. */
  #updateToolbar() {
    const toolbar = this.element?.querySelector(".tile-fx-painter-editor-toolbar");
    if (!toolbar) return;
    toolbar.querySelector("[name=opacity]").value = Math.round(this.mask.opacity * 100);
    toolbar.querySelector("[name=showMask]").checked = this.mask.showMask;
    toolbar.querySelector("[data-action=undoMask]").disabled = !this.mask.canUndo;
    toolbar.querySelector("[data-action=redoMask]").disabled = !this.mask.canRedo;
  }

  /**
   * Ctrl+Z = undo. Ctrl+Y or Ctrl+Shift+Z = redo. The Cmd key on macOS does the same as the Ctrl key.
   * @param {KeyboardEvent} event
   */
  #onKeyDown(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    // Some browsers send a keydown event without a key when they autocomplete a value.
    const key = event.key?.toLowerCase();
    if ((key === "z") && !event.shiftKey) this.mask.undo();
    else if ((key === "y") || (key === "z")) this.mask.redo();
    else return;
    // Foundry listens for keys on the window. Without this, Ctrl+Z also reverses the last change on the canvas.
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * @this {EffectEditor}
   * @param {PointerEvent} event
   * @param {HTMLButtonElement} target
   */
  static #onSelectTool(event, target) {
    this.mask.tool = target.dataset.tool;
    for (const button of this.element.querySelectorAll("[data-action=selectTool]")) {
      const active = button === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  /** @this {EffectEditor} */
  static #onUndoMask() {
    this.mask.undo();
  }

  /** @this {EffectEditor} */
  static #onRedoMask() {
    this.mask.redo();
  }

  /** @this {EffectEditor} */
  static #onInvertMask() {
    this.mask.invert();
  }

  /** @this {EffectEditor} */
  static #onClearMask() {
    this.mask.clear();
  }
}

// The capture uses the saved tile data. Capture again when the area under the tile changes.
Hooks.on("updateTile", (tile, changes) => {
  if (!EffectEditor.CAPTURE_FIELDS.some((field) => field in changes)) return;
  foundry.applications.instances.get(EffectEditor.getId(tile))?.recapture();
});

// An editor for a deleted tile cannot save its mask. Close it.
Hooks.on("deleteTile", (tile) => {
  foundry.applications.instances.get(EffectEditor.getId(tile))?.close();
});

// The editor is a part of the tile sheet for the user. Close it with the sheet.
// "Update Tile" also closes the sheet, thus it also closes the editor.
Hooks.on("closeTileConfig", (app) => {
  foundry.applications.instances.get(EffectEditor.getId(app.document))?.close();
});
