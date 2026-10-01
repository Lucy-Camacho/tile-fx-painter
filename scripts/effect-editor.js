import { MODULE_ID } from "./main.js";
import { captureBackground, loadImage } from "./background-capture.js";
import { MaskCanvas } from "./mask-canvas.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Get the mask directory from the setting.
 * The folder picker of the setting keeps only the path, not the file source. For an S3 folder, the path does not
 * include the bucket. Thus the editor uses only the "data" source, and refuses a path that is not in the user data.
 * @returns {string|null}  A path without a "/" at the start or the end, or null if the path is not in the user data.
 */
function getMaskDirectory() {
  const dir = game.settings.get(MODULE_ID, "maskDirectory").trim().replace(/^\/+|\/+$/g, "");
  if (/^[a-z][a-z\d+.-]*:/i.test(dir)) return null;
  // The FilePicker also uses this list to find paths in the "public" source.
  if (CONST.FILE_PICKER_PUBLIC_DIRS.includes(dir.split("/")[0])) return null;
  return dir;
}

/**
 * Make a directory in the user data, and each parent directory that does not exist.
 * @param {string} dir  A path without a "/" at the start or the end.
 * @returns {Promise<void>}
 */
async function ensureDirectory(dir) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  try {
    await FilePicker.browse("data", dir);
    return;
  } catch {
    // The directory does not exist. Make it below.
  }
  const parts = dir.split("/");
  for (let i = 1; i <= parts.length; i++) {
    try {
      await FilePicker.createDirectory("data", parts.slice(0, i).join("/"));
    } catch {
      // The directory exists already. If there is a different problem, the upload fails and tells the user.
    }
  }
}

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
      clearMask: EffectEditor.#onClearMask,
      saveMask: EffectEditor.#onSaveMask
    }
  };

  /** The tools for the pointer, in the order of the tool buttons. */
  static TOOLS = [
    { id: "brush", icon: "fa-solid fa-paintbrush", label: "TILE_FX_PAINTER.Editor.Brush" },
    { id: "eraser", icon: "fa-solid fa-eraser", label: "TILE_FX_PAINTER.Editor.Eraser" },
    { id: "select", icon: "fa-solid fa-wand-magic-sparkles", label: "TILE_FX_PAINTER.Editor.ColorSelect" },
    { id: "rect", icon: "fa-regular fa-square", label: "TILE_FX_PAINTER.Editor.Rectangle" },
    { id: "ellipse", icon: "fa-regular fa-circle", label: "TILE_FX_PAINTER.Editor.Ellipse" },
    { id: "polygon", icon: "fa-solid fa-draw-polygon", label: "TILE_FX_PAINTER.Editor.Polygon" }
  ];

  /** The modes of the color select and the shapes. */
  static MASK_MODES = {
    add: "TILE_FX_PAINTER.Editor.SelectAdd",
    subtract: "TILE_FX_PAINTER.Editor.SelectSubtract"
  };

  /** The tile fields that change the area under the tile. A change to one of them makes a new capture necessary. */
  static CAPTURE_FIELDS = ["x", "y", "width", "height", "rotation"];

  /**
   * A counter for the captures. A capture can take a long time. Only the result of the last capture goes into the view.
   * @type {number}
   */
  #captureId = 0;

  /** The saved mask of the tile is in the mask. The editor loads it only one time, at the first capture. */
  #maskLoaded = false;

  /** A save is in progress. */
  #saving = false;

  /** The "unsaved changes" dialog is open. */
  #confirmingClose = false;

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

  /**
   * The tile and its scene exist, and no deletion removed them.
   * Foundry removes a deleted document from its collection before all delete and close hooks. Thus this value is correct in each close path.
   * @type {boolean}
   */
  get #tileExists() {
    const scene = this.tile.parent;
    return !!this.tile.collection?.has(this.tile.id) && !!scene?.collection?.has(scene.id);
  }

  /** The mask has changes to save, and no save is in progress. */
  get canSave() {
    return this.mask.isDirty && !this.#saving;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      tools: EffectEditor.TOOLS.map((tool) => ({ ...tool, active: tool.id === this.mask.tool })),
      brushSize: this.mask.brushSize,
      brushHardness: Math.round(this.mask.brushHardness * 100),
      showBrushOptions: this.#toolHasOptions(this.mask.tool, "brush eraser"),
      showSelectOptions: this.#toolHasOptions(this.mask.tool, "select"),
      selectTolerance: this.mask.selectTolerance,
      selectMode: this.mask.selectMode,
      maskModes: EffectEditor.MASK_MODES,
      selectContiguous: this.mask.selectContiguous,
      showShapeOptions: this.#toolHasOptions(this.mask.tool, "rect ellipse polygon"),
      showPolygonHint: this.#toolHasOptions(this.mask.tool, "polygon"),
      shapeMode: this.mask.shapeMode,
      opacity: Math.round(this.mask.opacity * 100),
      showMask: this.mask.showMask,
      canUndo: this.mask.canUndo,
      canRedo: this.mask.canRedo,
      canSave: this.canSave
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
    el.querySelector("[name=selectTolerance]").addEventListener("input", (event) => {
      this.mask.selectTolerance = event.currentTarget.valueAsNumber;
      event.currentTarget.nextElementSibling.textContent = `${event.currentTarget.value}%`;
    });
    el.querySelector("[name=selectMode]").addEventListener("change", (event) => {
      this.mask.selectMode = event.currentTarget.value;
    });
    el.querySelector("[name=selectContiguous]").addEventListener("change", (event) => {
      this.mask.selectContiguous = event.currentTarget.checked;
    });
    el.querySelector("[name=shapeMode]").addEventListener("change", (event) => {
      this.mask.shapeMode = event.currentTarget.value;
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

  /**
   * Ask the user before the editor closes with unsaved mask changes.
   * The close button, the Escape key, and the close of the tile sheet all come here.
   * The editor cannot save the mask of a deleted tile, thus it closes without a question after a tile or scene deletion.
   * @param {object} [options]
   * @param {boolean} [options.discard]  Close without a question, and discard the unsaved changes.
   * @override
   */
  async close(options = {}) {
    if (!options.discard && this.rendered && this.mask.isDirty && this.#tileExists) {
      // A second close request (for example, a second Escape) must not open a second dialog.
      if (this.#confirmingClose) return this;
      this.#confirmingClose = true;
      let discard;
      try {
        discard = await DialogV2.confirm({
          window: { title: "TILE_FX_PAINTER.Editor.UnsavedTitle", icon: "fa-solid fa-triangle-exclamation" },
          content: `<p>${game.i18n.localize("TILE_FX_PAINTER.Editor.UnsavedContent")}</p>`,
          rejectClose: false,
          modal: true
        });
      } finally {
        this.#confirmingClose = false;
      }
      if (!discard) return this;
    }
    return super.close(options);
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
    // Load the saved mask at the same time as the capture. The mask gets its size from the capture, thus the load waits for it.
    const savedMask = this.#maskLoaded ? null : this.#loadSavedMask();

    let capture = null;
    let message = "TILE_FX_PAINTER.Editor.NoBackground";
    try {
      capture = await captureBackground(this.tile);
    } catch (err) {
      console.error(err);
      message = "TILE_FX_PAINTER.Editor.CaptureFailed";
    }
    const savedImage = await savedMask;

    // A newer capture started, or the window closed, while this capture loaded.
    const view = this.element?.querySelector(".tile-fx-painter-editor-view");
    if ((captureId !== this.#captureId) || !view) return;

    if (capture) {
      this.mask.setBase(capture);
      if (savedMask) {
        this.#maskLoaded = true;
        if (savedImage) this.mask.load(savedImage);
      }
      this.mask.attach(view);
    } else {
      this.mask.detach();
      const hint = document.createElement("p");
      hint.classList.add("hint");
      hint.textContent = game.i18n.localize(message);
      view.replaceChildren(hint);
    }
  }

  /**
   * Save the mask as a PNG file in the mask directory, and keep the file path in the tile flag "mask".
   * @returns {Promise<boolean>}  True if the editor saved the mask.
   */
  async save() {
    if (!this.canSave || !this.mask.mask) return false;
    const dir = getMaskDirectory();
    if (dir === null) {
      ui.notifications.error("TILE_FX_PAINTER.Editor.InvalidDirectory", { localize: true });
      return false;
    }
    this.#saving = true;
    this.#updateToolbar();
    try {
      // The last pointer points of a stroke go into the mask canvas only in the next frame. The file must include them.
      this.mask.endStroke();
      // The browser takes the canvas pixels when toBlob starts. Changes after this point stay unsaved.
      const version = this.mask.version;
      const blob = await new Promise((resolve) => this.mask.mask.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`${MODULE_ID} | The mask canvas did not give a PNG file`);
      const file = new File([blob], `${this.tile.parent.id}-${this.tile.id}.png`, { type: "image/png" });

      if (dir) await ensureDirectory(dir);
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      const result = await FilePicker.upload("data", dir, file, {}, { notify: false });
      if (!result?.path) throw new Error(`${MODULE_ID} | The upload of "${file.name}" to "${dir}" failed`);

      // The file name stays the same for each save. The timestamp makes a new URL, thus the browser does not show an old cached image.
      // "render: false" stops a new render of the open tile sheets on all clients. A new render fills the form from the saved
      // data and removes the changes that the user did not submit. The sheets do not show the "mask" flag, thus they stay correct.
      await this.tile.update({ [`flags.${MODULE_ID}.mask`]: `${result.path}?v=${Date.now()}` }, { render: false });
      this.mask.markSaved(version);
      ui.notifications.info("TILE_FX_PAINTER.Editor.Saved", { localize: true });
      return true;
    } catch (err) {
      console.error(err);
      ui.notifications.error("TILE_FX_PAINTER.Editor.SaveFailed", { localize: true });
      return false;
    } finally {
      this.#saving = false;
      this.#updateToolbar();
    }
  }

  /**
   * Load the saved mask image of the tile.
   * @returns {Promise<HTMLImageElement|null>}  The image, or null if the tile has no saved mask or the image does not load.
   */
  async #loadSavedMask() {
    const path = this.tile.flags[MODULE_ID]?.mask;
    if (!path) return null;
    try {
      return await loadImage(path);
    } catch (err) {
      console.error(`${MODULE_ID} | Cannot load the saved mask "${path}"`, err);
      ui.notifications.warn(game.i18n.format("TILE_FX_PAINTER.Editor.LoadFailed", { path }));
      return null;
    }
  }

  /**
   * Tell if a tool uses a group of tool options.
   * @param {string} tool
   * @param {string} tools  The tools of the option group, with a space between them.
   * @returns {boolean}
   */
  #toolHasOptions(tool, tools) {
    return tools.split(" ").includes(tool);
  }

  /** Show the values after an undo or redo, and enable or disable the undo, redo, and save buttons. */
  #updateToolbar() {
    const toolbar = this.element?.querySelector(".tile-fx-painter-editor-toolbar");
    if (!toolbar) return;
    toolbar.querySelector("[name=opacity]").value = Math.round(this.mask.opacity * 100);
    toolbar.querySelector("[name=showMask]").checked = this.mask.showMask;
    toolbar.querySelector("[data-action=undoMask]").disabled = !this.mask.canUndo;
    toolbar.querySelector("[data-action=redoMask]").disabled = !this.mask.canRedo;
    toolbar.querySelector("[data-action=saveMask]").disabled = !this.canSave;
  }

  /**
   * Ctrl+Z = undo. Ctrl+Y or Ctrl+Shift+Z = redo. The Cmd key on macOS does the same as the Ctrl key.
   * During a shape: Escape = cancel the shape. Enter = close the polygon. Backspace = remove the last polygon point.
   * @param {KeyboardEvent} event
   */
  #onKeyDown(event) {
    if (event.altKey) return;
    // Some browsers send a keydown event without a key when they autocomplete a value.
    const key = event.key?.toLowerCase();
    if (!(event.ctrlKey || event.metaKey)) {
      // These keys do their usual action when there is no shape. For example, Escape closes the editor.
      let used = false;
      if (key === "escape") used = this.mask.cancelShape();
      else if (key === "enter") used = this.mask.closePolygon();
      else if (key === "backspace") used = this.mask.removePolygonPoint();
      if (!used) return;
    }
    else if ((key === "z") && !event.shiftKey) this.mask.undo();
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
    for (const group of this.element.querySelectorAll(".tile-fx-painter-editor-options")) {
      group.hidden = !this.#toolHasOptions(this.mask.tool, group.dataset.tools);
    }
    // The brush circle shows only for the brush and the eraser. The tool change also removes a shape preview.
    this.mask.requestDraw();
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

  /** @this {EffectEditor} */
  static #onSaveMask() {
    this.save();
  }
}

// The capture uses the saved tile data. Capture again when the area under the tile changes.
Hooks.on("updateTile", (tile, changes) => {
  if (!EffectEditor.CAPTURE_FIELDS.some((field) => field in changes)) return;
  foundry.applications.instances.get(EffectEditor.getId(tile))?.recapture();
});

/**
 * Close the editor of a deleted tile without a question. The editor cannot save the mask of a deleted tile.
 * @param {TileDocument} tile
 */
function discardEditor(tile) {
  foundry.applications.instances.get(EffectEditor.getId(tile))?.close({ discard: true });
}

Hooks.on("deleteTile", (tile) => discardEditor(tile));

// A scene deletion does not call "deleteTile" for the tiles of the scene. The scene keeps its tiles collection after the deletion.
Hooks.on("deleteScene", (scene) => scene.tiles.forEach(discardEditor));

// The editor is a part of the tile sheet for the user. Close it with the sheet.
// "Update Tile" also closes the sheet, thus it also closes the editor.
Hooks.on("closeTileConfig", (app) => {
  foundry.applications.instances.get(EffectEditor.getId(app.document))?.close();
});
