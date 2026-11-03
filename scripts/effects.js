import { MODULE_ID } from "./main.js";

/**
 * The effects that a tile can use. The key is the value of the tile flag "shader".
 * Each key of "params" is also the name of a float uniform in the shader of the effect,
 * thus it must not be a name that Foundry or the GLSL code of the shader already uses.
 */
export const EFFECTS = {
  glow: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Glow",
    defaultColor: "#ffb04a",
    params: {
      // The halo radius in grid squares at pattern scale 1.
      haloRadius: { default: 0.5, min: 0.1, max: 2, step: 0.05 },
      haloLight: { default: 0.9, min: 0, max: 2, step: 0.05 },
      // The core color moves this much to white, as the hot center of a light.
      coreWhite: { default: 0.35, min: 0, max: 1, step: 0.05 },
      // A multiplier on the pulse and the noise of the flicker. 0 gives a steady glow.
      flickerAmount: { default: 1, min: 0, max: 3, step: 0.05 }
    }
  },
  metallic: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Metallic",
    defaultColor: "#c9d1d9",
    params: {
      // The specular exponent. It is more than 0, so that pow(0.0, shininess) is defined.
      shininess: { default: 32, min: 4, max: 128, step: 1 },
      // A multiplier on the light of the shine band. 0 removes the band.
      shineBand: { default: 1, min: 0, max: 2, step: 0.05 },
      // A multiplier on the movement of the reflections with the camera. 0 keeps them still.
      cameraMotion: { default: 1, min: 0, max: 2, step: 0.05 },
      // The tone of the darkest map areas. 1 gives a flat metal with no map tone.
      shadowTone: { default: 0.35, min: 0, max: 1, step: 0.05 }
    }
  },
  liquid: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Liquid",
    // The dark color of the liquid, under the rainbow colors.
    defaultColor: "#1c2230",
    params: {
      // The force of the domain warp. A higher value gives more twisted swirls.
      warpAmount: { default: 4, min: 0, max: 8, step: 0.1 },
      // The number of rainbow cycles from the thinnest to the thickest film.
      bands: { default: 2, min: 0.5, max: 5, step: 0.1 },
      // The quantity of rainbow color on the liquid. 0 removes the rainbow.
      filmAmount: { default: 0.35, min: 0, max: 1, step: 0.05 },
      // The quantity of background brightness that stays in the liquid.
      darken: { default: 0.45, min: 0, max: 1, step: 0.05 },
      // The height of the small surface ripples.
      ripple: { default: 0.06, min: 0, max: 0.2, step: 0.01 },
      // The maximum shift of the map under the liquid, in grid squares at pattern scale 1.
      refractAmount: { default: 0.05, min: 0, max: 0.2, step: 0.01 },
      // The brightness of the wet highlights.
      specularAmount: { default: 0.7, min: 0, max: 1.5, step: 0.05 }
    }
  }
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function toNumber(value, fallback) {
  const number = Number(value);
  return (value === null) || (value === "") || !Number.isFinite(number) ? fallback : number;
}

/**
 * The default value of each param of an effect.
 * @param {string} effectId
 * @returns {Record<string, number>}  An empty object for an unknown effect.
 */
export function getParamDefaults(effectId) {
  const schema = EFFECTS[effectId]?.params ?? {};
  return Object.fromEntries(Object.entries(schema).map(([key, param]) => [key, param.default]));
}

/**
 * Read the param flags of one effect ("params.<effectId>.<key>").
 * A missing or invalid value becomes the default, and each value is clamped to its min and max.
 * Thus a value from a macro cannot break the shader.
 * @param {TileDocument} tileDocument
 * @param {string} effectId
 * @returns {Record<string, number>}  An empty object for an unknown effect.
 */
export function getEffectParams(tileDocument, effectId) {
  const schema = EFFECTS[effectId]?.params ?? {};
  const values = tileDocument.flags?.[MODULE_ID]?.params?.[effectId] ?? {};
  return Object.fromEntries(Object.entries(schema).map(([key, param]) => {
    return [key, Math.clamp(toNumber(values[key], param.default), param.min, param.max)];
  }));
}

/**
 * Read the effect flags of a tile and apply the defaults.
 * An unknown effect id becomes "none". An empty or invalid color becomes the default color of the effect.
 * @param {TileDocument} tileDocument
 * @returns {{enabled: boolean, effect: string, intensity: number, color: string|null, speed: number, scale: number,
 *   mask: string|null, params: Record<string, number>}}
 *   The color is null when the effect is "none". The params are the values of the active effect.
 */
export function getEffectSettings(tileDocument) {
  const flags = tileDocument.flags?.[MODULE_ID] ?? {};
  const effect = Object.hasOwn(EFFECTS, flags.shader) ? flags.shader : "none";
  const color = HEX_COLOR.test(flags.color ?? "") ? flags.color : (EFFECTS[effect]?.defaultColor ?? null);
  return {
    enabled: flags.enabled === true,
    effect,
    intensity: toNumber(flags.intensity, 1),
    color,
    speed: toNumber(flags.speed, 1),
    scale: toNumber(flags.scale, 1),
    mask: flags.mask || null,
    params: getEffectParams(tileDocument, effect)
  };
}
