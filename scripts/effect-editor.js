import { MODULE_ID } from "./main.js";
import { captureBackground } from "./background-capture.js";

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
    }
  };

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
  async _onRender(context, options) {
    await super._onRender(context, options);
    const view = this.element.querySelector(".tile-fx-painter-editor-view");

    let capture = null;
    let message = "TILE_FX_PAINTER.Editor.NoBackground";
    try {
      capture = await captureBackground(this.tile);
    } catch (err) {
      console.error(err);
      message = "TILE_FX_PAINTER.Editor.CaptureFailed";
    }

    if (capture) {
      capture.classList.add("tile-fx-painter-capture");
      view.replaceChildren(capture);
    } else {
      const hint = document.createElement("p");
      hint.classList.add("hint");
      hint.textContent = game.i18n.localize(message);
      view.replaceChildren(hint);
    }
  }
}

// An editor for a deleted tile cannot save its mask. Close it.
Hooks.on("deleteTile", (tile) => {
  foundry.applications.instances.get(EffectEditor.getId(tile))?.close();
});

// The editor is a part of the tile sheet for the user. Close it with the sheet.
// "Update Tile" also closes the sheet, thus it also closes the editor.
Hooks.on("closeTileConfig", (app) => {
  foundry.applications.instances.get(EffectEditor.getId(app.document))?.close();
});
