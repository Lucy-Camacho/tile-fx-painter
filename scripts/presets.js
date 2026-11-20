import { MODULE_ID } from "./main.js";
import { EFFECTS, HEX_COLOR, clampParams, clampSetting } from "./effects.js";

/**
 * The effect presets, in a hidden world setting: { <effectId>: { <slug>: preset } }.
 * Not files in "storage/", because the Foundry server cannot delete a file.
 */

const PRESETS_SETTING = "presets";

/** The UI listens to this hook. A hook, not an import, thus this file does not import the UI files. */
export const PRESETS_CHANGED_HOOK = `${MODULE_ID}.presetsChanged`;

const EXPORT_FORMAT_VERSION = 1;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, PRESETS_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    // Runs on all clients, thus all open sheets show the new list.
    onChange: () => Hooks.callAll(PRESETS_CHANGED_HOOK)
  });
});

/** @returns {boolean}  A world setting write needs this permission. */
export function canEditPresets() {
  return game.user.can("SETTINGS_MODIFY");
}

function isObject(value) {
  return (value !== null) && (typeof value === "object") && !Array.isArray(value);
}

/** A copy, thus a change does not touch the cached setting value before the write. */
function getStoredPresets() {
  const value = game.settings.get(MODULE_ID, PRESETS_SETTING);
  return isObject(value) ? foundry.utils.deepClone(value) : {};
}

function writePresets(presets) {
  return game.settings.set(MODULE_ID, PRESETS_SETTING, presets);
}

/**
 * The key of a preset. Two names with the same slug are the same preset.
 * @param {string} name
 * @returns {string}  An empty string if the name has no letter or digit.
 */
export function getPresetSlug(name) {
  return String(name ?? "").slugify({ strict: true });
}

/**
 * A preset can come from an import or a macro, thus each value gets the defaults and the clamps.
 * @param {string} effectId  The effect key of the preset.
 * @param {*} data
 * @returns {{name: string, effect: string, intensity: number, color: string|null, speed: number, scale: number,
 *   params: Record<string, number>}|null}  Null if the data has no name or is for a different effect.
 */
function sanitizePreset(effectId, data) {
  if ((data === null) || (typeof data !== "object") || (data.effect !== effectId)) return null;
  const name = (typeof data.name === "string") ? data.name.trim() : "";
  if (!name) return null;
  return {
    name,
    effect: effectId,
    intensity: clampSetting("intensity", data.intensity),
    // Null keeps the default color of the effect, the same as an empty color field.
    color: ((typeof data.color === "string") && HEX_COLOR.test(data.color)) ? data.color : null,
    speed: clampSetting("speed", data.speed),
    scale: clampSetting("scale", data.scale),
    params: clampParams(effectId, data.params)
  };
}

/**
 * Get the presets of an effect, sorted by name. A bad entry is skipped.
 * @param {string} effectId
 * @returns {object[]}  Each preset has the values of sanitizePreset and its "slug".
 */
export function listPresets(effectId) {
  if (!Object.hasOwn(EFFECTS, effectId)) return [];
  const entries = getStoredPresets()[effectId];
  if (!isObject(entries)) return [];
  const presets = [];
  for (const [slug, data] of Object.entries(entries)) {
    const preset = sanitizePreset(effectId, data);
    if (preset) presets.push({ ...preset, slug });
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * @param {string} effectId
 * @param {string} name
 * @returns {object|undefined}  The preset with the same slug as this name.
 */
export function findPreset(effectId, name) {
  const slug = getPresetSlug(name);
  return listPresets(effectId).find((preset) => preset.slug === slug);
}

/**
 * Save a preset. A preset with the same slug is replaced.
 * @param {string} effectId
 * @param {string} name
 * @param {{intensity: number, color: string|null, speed: number, scale: number, params: Record<string, number>}} settings
 * @returns {Promise<object>}  The saved preset, with its slug.
 */
export async function savePreset(effectId, name, settings) {
  const slug = getPresetSlug(name);
  const preset = Object.hasOwn(EFFECTS, effectId) ? sanitizePreset(effectId, { ...settings, name, effect: effectId }) : null;
  if (!slug || !preset) throw new Error(`${MODULE_ID} | The preset name "${name}" is not valid.`);
  const presets = getStoredPresets();
  if (!isObject(presets[effectId])) presets[effectId] = {};
  presets[effectId][slug] = preset;
  await writePresets(presets);
  return { ...preset, slug };
}

/**
 * @param {string} effectId
 * @param {string} slug
 * @returns {Promise<void>}
 */
export async function deletePreset(effectId, slug) {
  const presets = getStoredPresets();
  if (!isObject(presets[effectId]) || !Object.hasOwn(presets[effectId], slug)) return;
  delete presets[effectId][slug];
  if (foundry.utils.isEmpty(presets[effectId])) delete presets[effectId];
  await writePresets(presets);
}

/**
 * The number of valid presets of each effect.
 * @returns {Record<string, number>}
 */
export function countPresets() {
  return Object.fromEntries(Object.keys(EFFECTS).map((effectId) => [effectId, listPresets(effectId).length]));
}

/**
 * Download all valid presets as a JSON file.
 * @returns {number}  The number of exported presets. The download does not start for 0.
 */
export function exportPresets() {
  const presets = {};
  let count = 0;
  for (const effectId of Object.keys(EFFECTS)) {
    const list = listPresets(effectId);
    if (!list.length) continue;
    presets[effectId] = Object.fromEntries(list.map(({ slug, ...preset }) => [slug, preset]));
    count += list.length;
  }
  if (!count) return 0;
  const data = { module: MODULE_ID, formatVersion: EXPORT_FORMAT_VERSION, presets };
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", `${MODULE_ID}-presets.json`);
  return count;
}

/**
 * Merge the presets of an export file into the world presets. A preset with the same slug is replaced.
 * The slug comes from the name, not from the file key, thus a key changed by hand cannot make a second copy.
 * @param {string} text  The text of the export file.
 * @returns {Promise<{added: number, replaced: number, skipped: number}>}
 *   Skipped are the presets of unknown effects and the presets with no valid name.
 */
export async function importPresets(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch(err) {
    throw new Error(`${MODULE_ID} | The file is not valid JSON.`, { cause: err });
  }
  if ((data?.module !== MODULE_ID) || !isObject(data.presets)) {
    throw new Error(`${MODULE_ID} | The file is not a ${MODULE_ID} preset export.`);
  }

  const presets = getStoredPresets();
  const result = { added: 0, replaced: 0, skipped: 0 };
  for (const [effectId, entries] of Object.entries(data.presets)) {
    if (!isObject(entries)) continue;
    for (const entry of Object.values(entries)) {
      const preset = Object.hasOwn(EFFECTS, effectId) ? sanitizePreset(effectId, entry) : null;
      const slug = preset ? getPresetSlug(preset.name) : "";
      if (!slug) {
        result.skipped++;
        continue;
      }
      if (!isObject(presets[effectId])) presets[effectId] = {};
      if (Object.hasOwn(presets[effectId], slug)) result.replaced++;
      else result.added++;
      presets[effectId][slug] = preset;
    }
  }
  if (result.added || result.replaced) await writePresets(presets);
  return result;
}
