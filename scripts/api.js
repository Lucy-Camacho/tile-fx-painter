import { MODULE_ID } from "./main.js";
import { EFFECTS, HEX_COLOR, SETTING_RANGES, getEffectSettings } from "./effects.js";
import { getDeletionUpdate } from "./compat.js";

/**
 * The public API on game.modules.get("tile-fx-painter").api, for macros and other modules.
 * It writes only the tile flags. The updateTile hook then syncs the effect mesh.
 * A tile with no mask shows no effect. The API does not change the mask.
 *
 * A "tiles" argument is one value or an array. A value is a TileDocument, a Tile, a tile id on the viewed scene,
 * or a tile UUID.
 */

const FLAGS = `flags.${MODULE_ID}`;
const CHANGE_KEYS = new Set(["enabled", "effect", "intensity", "color", "speed", "scale", "params"]);

function fail(message) {
  throw new Error(`${MODULE_ID} | ${message}`);
}

function resolveTile(value) {
  let tile = value;
  if (typeof value === "string") tile = value.includes(".") ? fromUuidSync(value) : canvas.scene?.tiles.get(value);
  else if (value instanceof foundry.canvas.placeables.Tile) tile = value.document;
  if (tile?.documentName !== "Tile") fail(`Cannot find the tile "${value?.id ?? value}".`);
  return tile;
}

function resolveWritableTiles(tiles) {
  const docs = new Set((Array.isArray(tiles) ? tiles : [tiles]).map(resolveTile));
  for (const tile of docs) {
    if (!tile.canUserModify(game.user, "update")) fail(`You do not have the permission to update the tile "${tile.id}".`);
  }
  return Array.from(docs);
}

function validateEffect(effectId) {
  if ((effectId !== "none") && !Object.hasOwn(EFFECTS, effectId)) fail(`Unknown effect "${effectId}".`);
  return effectId;
}

/** The given effect, or the saved effect of the tile. "none" fails, because it has no params. */
function resolveParamsEffect(tile, effectId) {
  const effect = (effectId === undefined) ? getEffectSettings(tile).effect : validateEffect(effectId);
  if (effect === "none") fail(`The tile "${tile.id}" has no effect. Give the effect of the params.`);
  return effect;
}

function clampNumber(value, { min, max }, name) {
  if ((typeof value !== "number") || !Number.isFinite(value)) fail(`"${name}" must be a finite number.`);
  return Math.clamp(value, min, max);
}

function buildParamsUpdate(effectId, params) {
  if ((params === null) || (typeof params !== "object")) fail("The params must be an object.");
  const schema = EFFECTS[effectId].params;
  const update = {};
  for (const [key, value] of Object.entries(params)) {
    if (!Object.hasOwn(schema, key)) fail(`The effect "${effectId}" has no param "${key}".`);
    update[`${FLAGS}.params.${effectId}.${key}`] = clampNumber(value, schema[key], key);
  }
  return update;
}

function buildUpdate(tile, changes) {
  if ((changes === null) || (typeof changes !== "object")) fail("The changes must be an object.");
  for (const key of Object.keys(changes)) {
    if (!CHANGE_KEYS.has(key)) fail(`Unknown change "${key}".`);
  }
  const update = {};
  if ("enabled" in changes) {
    if (typeof changes.enabled !== "boolean") fail(`"enabled" must be true or false.`);
    update[`${FLAGS}.enabled`] = changes.enabled;
  }
  if ("effect" in changes) update[`${FLAGS}.shader`] = validateEffect(changes.effect);
  for (const key of ["intensity", "speed", "scale"]) {
    if (key in changes) update[`${FLAGS}.${key}`] = clampNumber(changes[key], SETTING_RANGES[key], key);
  }
  if ("color" in changes) {
    const color = changes.color;
    // No color flag means the default color of the effect.
    if ((color === null) || (color === "")) Object.assign(update, getDeletionUpdate(`${FLAGS}.color`));
    else if ((typeof color === "string") && HEX_COLOR.test(color)) update[`${FLAGS}.color`] = color;
    else fail(`"color" must be a "#rrggbb" string or null.`);
  }
  if ("params" in changes) Object.assign(update, buildParamsUpdate(resolveParamsEffect(tile, changes.effect), changes.params));
  return update;
}

/**
 * Validate all updates before the first write, thus a bad value writes nothing.
 * @param {*} tiles
 * @param {(tile: TileDocument) => object} getUpdate
 * @returns {Promise<TileDocument[]>}
 */
async function writeTiles(tiles, getUpdate) {
  const docs = resolveWritableTiles(tiles);
  const updatesByScene = new Map();
  for (const tile of docs) {
    const update = { _id: tile.id, ...getUpdate(tile) };
    if (!updatesByScene.has(tile.parent)) updatesByScene.set(tile.parent, []);
    updatesByScene.get(tile.parent).push(update);
  }
  await Promise.all(Array.from(updatesByScene, ([scene, updates]) => scene.updateEmbeddedDocuments("Tile", updates)));
  return docs;
}

const api = {
  /**
   * @returns {typeof EFFECTS}  A copy of the effects: the label, the default color, and the params with their default, min, and max.
   */
  getEffects() {
    return foundry.utils.deepClone(EFFECTS);
  },

  /**
   * Get the saved settings of a tile, with the defaults and the clamps applied.
   * @param {TileDocument|Tile|string} tile
   * @returns {object}  The same as getEffectSettings, with hasMask in place of the mask, because a mask data URL can be very large.
   */
  getSettings(tile) {
    const { mask, ...settings } = getEffectSettings(resolveTile(tile));
    return { ...settings, hasMask: !!mask };
  },

  /**
   * Change the settings of tiles. A number is clamped to its range. A bad value throws, and no tile changes.
   * @param {*} tiles
   * @param {{enabled?: boolean, effect?: string, intensity?: number, color?: string|null, speed?: number, scale?: number,
   *   params?: Record<string, number>}} changes  The params are for the new effect if "effect" is given, else for the saved effect.
   *   A null color sets the default color of the effect.
   * @returns {Promise<TileDocument[]>}
   */
  update(tiles, changes) {
    return writeTiles(tiles, (tile) => buildUpdate(tile, changes));
  },

  /** @returns {Promise<TileDocument[]>} */
  enable(tiles) {
    return writeTiles(tiles, (tile) => buildUpdate(tile, { enabled: true }));
  },

  /** @returns {Promise<TileDocument[]>} */
  disable(tiles) {
    return writeTiles(tiles, (tile) => buildUpdate(tile, { enabled: false }));
  },

  /** Each tile gets the opposite of its own state. @returns {Promise<TileDocument[]>} */
  toggle(tiles) {
    return writeTiles(tiles, (tile) => buildUpdate(tile, { enabled: !getEffectSettings(tile).enabled }));
  },

  /**
   * @param {*} tiles
   * @param {string} effectId  A key of getEffects(), or "none".
   * @returns {Promise<TileDocument[]>}
   */
  setEffect(tiles, effectId) {
    return writeTiles(tiles, (tile) => buildUpdate(tile, { effect: effectId }));
  },

  /**
   * Each effect keeps its own params, thus this does not change the effect of the tile.
   * @param {*} tiles
   * @param {Record<string, number>} params
   * @param {{effect?: string}} [options]  The effect of the params. The default is the saved effect of each tile.
   * @returns {Promise<TileDocument[]>}
   */
  setParams(tiles, params, { effect } = {}) {
    return writeTiles(tiles, (tile) => buildParamsUpdate(resolveParamsEffect(tile, effect), params));
  },

  /**
   * Remove the param flags of an effect, thus the defaults apply.
   * @param {*} tiles
   * @param {{effect?: string}} [options]  The default is the saved effect of each tile.
   * @returns {Promise<TileDocument[]>}
   */
  resetParams(tiles, { effect } = {}) {
    return writeTiles(tiles, (tile) => getDeletionUpdate(`${FLAGS}.params.${resolveParamsEffect(tile, effect)}`));
  }
};

Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = Object.freeze(api);
});
