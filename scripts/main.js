export const MODULE_ID = "tile-fx-painter";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Tile FX Painter`);

  // The "storage" directory of the module stays after a module update, because module.json sets "persistentStorage".
  game.settings.register(MODULE_ID, "maskDirectory", {
    name: "TILE_FX_PAINTER.Settings.MaskDirectory.Name",
    hint: "TILE_FX_PAINTER.Settings.MaskDirectory.Hint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "folder",
    default: `modules/${MODULE_ID}/storage/masks`
  });
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
});
