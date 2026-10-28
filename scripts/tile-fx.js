import { MODULE_ID } from "./main.js";
import { getEffectSettings } from "./effects.js";
import { getBackgroundSource } from "./compat.js";
import { TileFxMesh } from "./tile-fx-mesh.js";
import { GlowShader } from "./shaders/glow.js";
import { MetallicShader } from "./shaders/metallic.js";
import { OilSpillShader } from "./shaders/oil-spill.js";

/** The shader class of each effect. */
const SHADERS = {
  glow: GlowShader,
  metallic: MetallicShader,
  oilSpill: OilSpillShader
};

const meshes = new Map();

/** The number of the newest sync of each tile. A mask load that is not the newest discards its result. */
const syncIds = new Map();

function removeMesh(tileId) {
  const mesh = meshes.get(tileId);
  if (mesh && !mesh.destroyed) mesh.destroy();
  meshes.delete(tileId);
}

/** Make, update, or remove the effect mesh of a tile, from the tile flags. */
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
  const background = getBackgroundSource(tile.document);
  const loadMask = mesh?.maskSrc !== settings.mask;
  const loadBackground = mesh?.backgroundKey !== JSON.stringify(background);
  if (loadMask || loadBackground) {
    const [maskTexture, backgroundTexture] = await Promise.all([
      loadMask ? foundry.canvas.loadTexture(settings.mask) : null,
      (loadBackground && background) ? foundry.canvas.loadTexture(background.src) : null
    ]);
    // A newer sync, a tile deletion, or a canvas teardown can occur during the load.
    if ((syncIds.get(tileId) !== syncId) || tile.destroyed) return;
    if (loadMask) {
      if (!maskTexture) {
        console.warn(`${MODULE_ID} | Cannot load the mask "${settings.mask}" of tile ${tileId}`);
        removeMesh(tileId);
        return;
      }
      if (!mesh) {
        mesh = new TileFxMesh({ texture: maskTexture, name: `${MODULE_ID}.${tileId}`, object: tile, shaderClass: SHADERS[settings.effect] });
        canvas.primary.addChild(mesh);
        meshes.set(tileId, mesh);
      }
      else mesh.texture = maskTexture;
      mesh.maskSrc = settings.mask;
    }
    if (loadBackground) {
      // With no background texture, the effect shows with no background. The mask is still correct.
      if (background && !backgroundTexture) {
        console.warn(`${MODULE_ID} | Cannot load the background "${background.src}" of tile ${tileId}`);
      }
      mesh.setBackground(background, backgroundTexture);
    }
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
  // v14 sets the tile visibility in refreshVisibility. Foundry v14 sets this flag on a tile only with refreshState, but a later release can change this.
  if (flags.refreshState || flags.refreshVisibility || flags.refreshElevation || flags.refreshMesh) mesh.refreshState(tile);
});

/** Tell if the background image under the tile, or its placement, is different from the background of its mesh. */
function changesBackground(tileDocument) {
  const mesh = meshes.get(tileDocument.id);
  return !!mesh && (mesh.backgroundKey !== JSON.stringify(getBackgroundSource(tileDocument)));
}

// Foundry does not draw or refresh a tile after a flag change. See Tile#_onUpdate.
// A change of the tile levels (v14) can change the background image.
Hooks.on("updateTile", (tileDocument, changed) => {
  const flags = changed.flags;
  const changesFlags = !!flags && ((MODULE_ID in flags) || (`-=${MODULE_ID}` in flags));
  if (!changesFlags && !changesBackground(tileDocument)) return;
  if (tileDocument.rendered) syncTile(tileDocument.object);
});

// Foundry draws the canvas again after a background change of a level that the viewed level shows.
// It does not do this for the other levels. Foundry v13 has no levels, thus it does not call these hooks.
for (const hook of ["createLevel", "updateLevel", "deleteLevel"]) {
  Hooks.on(hook, (level) => {
    if (level.parent !== canvas.scene) return;
    for (const mesh of meshes.values()) {
      const tile = mesh.object;
      if (!tile.destroyed && changesBackground(tile.document)) syncTile(tile);
    }
  });
}

Hooks.on("destroyTile", (tile) => {
  if (tile.isPreview) return;
  removeMesh(tile.document.id);
  syncIds.delete(tile.document.id);
});

// The primary group destroys the meshes at teardown. Only the references stay.
Hooks.on("canvasTearDown", () => {
  meshes.clear();
  syncIds.clear();
});
