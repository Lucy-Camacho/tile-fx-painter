import { MODULE_ID } from "./main.js";
import { getEffectSettings } from "./effects.js";
import { TileFxMesh } from "./tile-fx-mesh.js";
import { TileFxShader } from "./shaders/tile-fx-shader.js";
import { GlowShader } from "./shaders/glow.js";
import { MetallicShader } from "./shaders/metallic.js";

/** The shader class of each effect. Iridescent Sheen uses the test shader until its step. */
const SHADERS = {
  glow: GlowShader,
  metallic: MetallicShader,
  iridescent: TileFxShader
};

/** The effect meshes on the canvas, by tile id. */
const meshes = new Map();

/** The number of the newest sync of each tile. A mask load that is not the newest discards its result. */
const syncIds = new Map();

function removeMesh(tileId) {
  const mesh = meshes.get(tileId);
  if (mesh && !mesh.destroyed) mesh.destroy();
  meshes.delete(tileId);
}

/**
 * Make, update, or remove the effect mesh of a tile, from the tile flags.
 * @param {Tile} tile
 */
async function syncTile(tile) {
  if (tile.isPreview) return;
  const tileId = tile.document.id;
  const syncId = (syncIds.get(tileId) ?? 0) + 1;
  syncIds.set(tileId, syncId);

  const settings = getEffectSettings(tile.document);
  if (!settings.enabled || !settings.mask || !Object.hasOwn(SHADERS, settings.effect)) {
    removeMesh(tileId);
    return;
  }

  let mesh = meshes.get(tileId);
  if (mesh?.maskSrc !== settings.mask) {
    const texture = await foundry.canvas.loadTexture(settings.mask);
    // A newer sync, a tile deletion, or a canvas teardown can occur during the load.
    if ((syncIds.get(tileId) !== syncId) || tile.destroyed) return;
    if (!texture) {
      console.warn(`${MODULE_ID} | Cannot load the mask "${settings.mask}" of tile ${tileId}`);
      removeMesh(tileId);
      return;
    }
    if (!mesh) {
      mesh = new TileFxMesh({ texture, name: `${MODULE_ID}.${tileId}`, object: tile, shaderClass: SHADERS[settings.effect] });
      canvas.primary.addChild(mesh);
      meshes.set(tileId, mesh);
    }
    else mesh.texture = texture;
    mesh.maskSrc = settings.mask;
  }

  mesh.setShaderClass(SHADERS[settings.effect]);
  mesh.applySettings(settings);
  mesh.refreshTransform(tile.document);
  mesh.refreshState(tile);
}

Hooks.on("drawTile", (tile) => syncTile(tile));

Hooks.on("refreshTile", (tile, flags) => {
  const mesh = meshes.get(tile.document.id);
  if (!mesh || tile.isPreview) return;
  if (flags.refreshPosition || flags.refreshRotation || flags.refreshSize) mesh.refreshTransform(tile.document);
  if (flags.refreshState || flags.refreshElevation || flags.refreshMesh) mesh.refreshState(tile);
});

// Foundry does not draw or refresh a tile after a flag change. See Tile#_onUpdate.
Hooks.on("updateTile", (tileDocument, changed) => {
  const flags = changed.flags;
  if (!flags || !((MODULE_ID in flags) || (`-=${MODULE_ID}` in flags))) return;
  if (tileDocument.rendered) syncTile(tileDocument.object);
});

Hooks.on("destroyTile", (tile) => {
  if (tile.isPreview) return;
  removeMesh(tile.document.id);
  syncIds.delete(tile.document.id);
});

// The primary group destroys its children at teardown. Only the references stay.
Hooks.on("canvasTearDown", () => {
  meshes.clear();
  syncIds.clear();
});
