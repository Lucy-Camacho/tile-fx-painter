import { MODULE_ID } from "./main.js";

/** The effects that a tile can use. The key is the value of the tile flag "shader". */
export const EFFECTS = {
  glow: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Glow",
    defaultColor: "#ffb04a"
  },
  metallic: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Metallic",
    defaultColor: "#c9d1d9"
  },
  oilSpill: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.OilSpill",
    // The dark film color under the rainbow colors.
    defaultColor: "#1c2230"
  }
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function toNumber(value, fallback) {
  const number = Number(value);
  return (value === null) || (value === "") || !Number.isFinite(number) ? fallback : number;
}

/**
 * Read the effect flags of a tile and apply the defaults.
 * An unknown effect id becomes "none". An empty or invalid color becomes the default color of the effect.
 * @param {TileDocument} tileDocument
 * @returns {{enabled: boolean, effect: string, intensity: number, color: string|null, speed: number, scale: number, mask: string|null}}
 *   The color is null when the effect is "none".
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
    mask: flags.mask || null
  };
}
