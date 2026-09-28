import { MODULE_ID } from "./main.js";

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
}

// An editor for a deleted tile cannot save its mask. Close it.
Hooks.on("deleteTile", (tile) => {
  foundry.applications.instances.get(EffectEditor.getId(tile))?.close();
});
