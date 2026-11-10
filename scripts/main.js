export const MODULE_ID = "tile-fx-painter";

/** The saved mask pixels for each scene pixel. Relative to scene pixels, thus the limit follows the tile size and the grid size. */
const MASK_QUALITY_SCALES = { high: 1, medium: 0.5, low: 0.25 };

/** @returns {number}  The value of the "maskQuality" setting as mask pixels for each scene pixel. */
export function getMaskQualityScale() {
  return MASK_QUALITY_SCALES[game.settings.get(MODULE_ID, "maskQuality")] ?? MASK_QUALITY_SCALES.medium;
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Tile FX Painter`);
  game.settings.register(MODULE_ID, "maskQuality", {
    name: "TILE_FX_PAINTER.Settings.MaskQuality.Name",
    hint: "TILE_FX_PAINTER.Settings.MaskQuality.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      high: "TILE_FX_PAINTER.Settings.MaskQuality.Choices.High",
      medium: "TILE_FX_PAINTER.Settings.MaskQuality.Choices.Medium",
      low: "TILE_FX_PAINTER.Settings.MaskQuality.Choices.Low"
    },
    default: "medium"
  });
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
});
