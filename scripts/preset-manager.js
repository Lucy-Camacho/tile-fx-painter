import { MODULE_ID } from "./main.js";
import { EFFECTS } from "./effects.js";
import { PRESETS_CHANGED_HOOK, countPresets, exportPresets, importPresets } from "./presets.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The "Manage Presets" window of the module settings: export and import of the world presets. */
class PresetManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-preset-manager`,
    classes: [MODULE_ID, "preset-manager"],
    tag: "div",
    window: {
      title: "TILE_FX_PAINTER.PresetManager.Title",
      icon: "fa-solid fa-sliders"
    },
    position: { width: 400 },
    actions: {
      export: PresetManager.#onExport,
      import: PresetManager.#onImport
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/preset-manager.hbs`
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const counts = countPresets();
    return Object.assign(context, {
      effects: Object.entries(EFFECTS).map(([effectId, effect]) => ({ label: effect.label, count: counts[effectId] }))
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector("input[type=file]").addEventListener("change", (event) => this.#importFile(event));
  }

  static #onExport() {
    if (!exportPresets()) ui.notifications.warn("TILE_FX_PAINTER.PresetManager.ExportEmpty", { localize: true });
  }

  /** A button opens the file dialog, because a file input cannot have the core button style. */
  static #onImport() {
    this.element.querySelector("input[type=file]").click();
  }

  async #importFile(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    // Without this, the same file selected again sends no change event.
    input.value = "";
    if (!file) return;
    try {
      const result = await importPresets(await foundry.utils.readTextFromFile(file));
      ui.notifications.info("TILE_FX_PAINTER.PresetManager.Imported", { localize: true, format: result });
    } catch(err) {
      console.error(err);
      ui.notifications.error("TILE_FX_PAINTER.PresetManager.ImportFailed", { localize: true });
    }
  }
}

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "presetManager", {
    name: "TILE_FX_PAINTER.Settings.Presets.Name",
    label: "TILE_FX_PAINTER.Settings.Presets.Label",
    hint: "TILE_FX_PAINTER.Settings.Presets.Hint",
    icon: "fa-solid fa-sliders",
    type: PresetManager,
    restricted: true
  });
});

// The counts change also after a save or a delete in a tile sheet.
Hooks.on(PRESETS_CHANGED_HOOK, () => {
  for (const app of foundry.applications.instances.values()) {
    if ((app instanceof PresetManager) && app.rendered) app.render();
  }
});
