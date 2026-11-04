import { MODULE_ID } from "./main.js";

/**
 * The effects that a tile can use. The key is the value of the tile flag "shader".
 * Each key of "params" is also the name of a float uniform in the shader of the effect,
 * thus it must not be a name that Foundry or the GLSL code of the shader already uses.
 * The "group" of a param is its collapsible section in the tile sheet. The params of a group must be adjacent,
 * and the order of the params sets the order of the groups.
 */
export const EFFECTS = {
  glow: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Glow",
    defaultColor: "#ffb04a",
    params: {
      // The halo radius in grid squares at pattern scale 1.
      haloRadius: { default: 0.5, min: 0.1, max: 2, step: 0.05, group: "light" },
      haloLight: { default: 0.9, min: 0, max: 2, step: 0.05, group: "light" },
      // The core color moves this much to white, as the hot center of a light.
      coreWhite: { default: 0.35, min: 0, max: 1, step: 0.05, group: "light" },
      // A multiplier on the pulse and the noise of the flicker. 0 gives a steady glow.
      flickerAmount: { default: 1, min: 0, max: 3, step: 0.05, group: "motion" }
    }
  },
  metallic: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Metallic",
    defaultColor: "#c9d1d9",
    params: {
      // The tone of the darkest map areas. 1 gives a flat metal with no map tone.
      shadowTone: { default: 0.35, min: 0, max: 1, step: 0.05, group: "surface" },
      // The specular exponent. It is more than 0, so that pow(0.0, shininess) is defined.
      shininess: { default: 32, min: 4, max: 128, step: 1, group: "surface" },
      // A multiplier on the light of the shine band. 0 removes the band.
      shineBand: { default: 1, min: 0, max: 2, step: 0.05, group: "reflections" },
      // A multiplier on the movement of the reflections with the camera. 0 keeps them still.
      cameraMotion: { default: 1, min: 0, max: 2, step: 0.05, group: "reflections" }
    }
  },
  liquid: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Liquid",
    // The dark color of the liquid, under the rainbow colors.
    defaultColor: "#1c2230",
    params: {
      // The force of the domain warp. A higher value gives more twisted swirls.
      warpAmount: { default: 4, min: 0, max: 8, step: 0.1, group: "film" },
      // The number of rainbow cycles from the thinnest to the thickest film.
      bands: { default: 2, min: 0.5, max: 5, step: 0.1, group: "film" },
      // The quantity of rainbow color on the liquid. 0 removes the rainbow.
      filmAmount: { default: 0.35, min: 0, max: 1, step: 0.05, group: "film" },
      // The quantity of background brightness that stays in the liquid.
      darken: { default: 0.45, min: 0, max: 1, step: 0.05, group: "surface" },
      // The height of the small surface ripples.
      ripple: { default: 0.06, min: 0, max: 0.2, step: 0.01, group: "surface" },
      // The maximum shift of the map under the liquid, in grid squares at pattern scale 1.
      refractAmount: { default: 0.05, min: 0, max: 0.2, step: 0.01, group: "surface" },
      // The brightness of the wet highlights.
      specularAmount: { default: 0.7, min: 0, max: 1.5, step: 0.05, group: "surface" }
    }
  },
  lava: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Lava",
    defaultColor: "#e8400a",
    params: {
      // The part of the surface that is molten. A low value gives mostly crust.
      moltenAmount: { default: 0.6, min: 0, max: 1, step: 0.05, group: "moltenRock" },
      // The position on the color ramp of the molten rock. A higher value gives more yellow and white.
      heatLevel: { default: 1, min: 0, max: 2, step: 0.05, group: "moltenRock" },
      // The bend of the molten veins. The crust does not bend. The maximum keeps the veins from a visible stretch.
      warpAmount: { default: 1, min: 0, max: 1.5, step: 0.05, group: "moltenRock" },
      // The size of the light past the mask, in grid squares at pattern scale 1. 0 removes the light.
      heatRadius: { default: 0.4, min: 0, max: 2, step: 0.05, group: "moltenRock" },
      // The quantity of map brightness in the crust. 0 gives a black crust.
      crustBrightness: { default: 0.1, min: 0, max: 1, step: 0.05, group: "crust" },
      // The roughness of the crust edges and the quantity of small veins. 0 gives smooth edges.
      detailAmount: { default: 1, min: 0, max: 2, step: 0.05, group: "crust" },
      // The height of the rough crust surface in the light. 0 gives a flat crust.
      reliefAmount: { default: 1, min: 0, max: 2, step: 0.05, group: "crust" },
      // The change of the molten heat with time. The crust shape does not change. 0 removes the pulse.
      pulseAmount: { default: 0.5, min: 0, max: 1, step: 0.05, group: "motion" },
      // The flow direction in degrees, in the tile frame axes.
      flowAngle: { default: 0, min: 0, max: 360, step: 5, group: "motion" },
      // The flow speed. The crust moves at half of this speed, as a solid piece. At 0, the crust stays still and the veins still change.
      flowAmount: { default: 0.05, min: 0, max: 1, step: 0.05, group: "motion" }
    }
  },
  water: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Water",
    // The color of the deep water.
    defaultColor: "#1f6f8b",
    params: {
      // The quantity of effect color at the center of the water.
      depthTint: { default: 0.55, min: 0, max: 1, step: 0.05, group: "shore" },
      // The distance from the mask edge to the deep water, in grid squares at pattern scale 1.
      // It is more than 0, because the mask blur needs a radius.
      shoreWidth: { default: 0.75, min: 0.1, max: 3, step: 0.05, group: "shore" },
      // The brightness of the foam at the mask edge. 0 removes the foam.
      foamAmount: { default: 0.4, min: 0, max: 1, step: 0.05, group: "shore" },
      // The height of the surface waves. 0 gives a flat surface.
      waveHeight: { default: 0.5, min: 0, max: 2, step: 0.05, group: "surface" },
      // The maximum shift of the map under the water, in grid squares at pattern scale 1.
      refractAmount: { default: 0.04, min: 0, max: 0.2, step: 0.01, group: "surface" },
      // The brightness of the light patterns on the bottom.
      causticAmount: { default: 0.6, min: 0, max: 2, step: 0.05, group: "light" },
      // The brightness of the sun highlights on the waves.
      specularAmount: { default: 0.6, min: 0, max: 1.5, step: 0.05, group: "light" },
      // The flow direction in degrees, in the tile frame axes.
      flowAngle: { default: 0, min: 0, max: 360, step: 5, group: "motion" },
      // The flow speed. 0 gives a still pool.
      flowAmount: { default: 0, min: 0, max: 1, step: 0.05, group: "motion" }
    }
  },
  frost: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Frost",
    // The middle tone of the ice. The shader makes the deep and the light tones from this color.
    defaultColor: "#2f7fb5",
    params: {
      // The quantity of ice at full mask alpha. A low value shows only thin cracks.
      frostCover: { default: 1, min: 0, max: 1, step: 0.05, group: "coverage" },
      // The shift of the mask edge by noise, in grid squares at pattern scale 1. 0 keeps the painted edge.
      edgeRoughness: { default: 0.15, min: 0, max: 0.5, step: 0.01, group: "coverage" },
      // The width of the fade from the ice to the map at a hard mask edge, in grid squares at pattern scale 1. 0 gives a sudden edge.
      edgeFade: { default: 0.3, min: 0, max: 1, step: 0.05, group: "coverage" },
      // The quantity of effect color in the ice. 0 gives clear ice.
      frostTint: { default: 0.5, min: 0, max: 1, step: 0.05, group: "surface" },
      // The blur radius of the map below the ice, in grid squares at pattern scale 1.
      frostBlur: { default: 0.03, min: 0, max: 0.15, step: 0.01, group: "surface" },
      // The brightness of the cracks and scratches.
      ridgeAmount: { default: 0.8, min: 0, max: 1.5, step: 0.05, group: "surface" },
      // The brightness of the sparkles. 0 removes them.
      sparkleAmount: { default: 0.6, min: 0, max: 2, step: 0.05, group: "light" },
      // The brightness of the soft reflections on the surface. 0 removes them.
      shineAmount: { default: 0.25, min: 0, max: 1, step: 0.05, group: "light" },
      // The distance of the fog from the mask border, in grid squares at pattern scale 1. 0 removes the fog.
      fogRadius: { default: 0.4, min: 0, max: 2, step: 0.05, group: "fog" },
      // The density of the fog. 0 removes the fog.
      fogAmount: { default: 0.4, min: 0, max: 1, step: 0.05, group: "fog" },
      // The strength of the water that moves below the ice. 0 removes it.
      currentAmount: { default: 0.6, min: 0, max: 1.5, step: 0.05, group: "underIce" },
      // The strength of the pieces of ice that float below the surface. 0 removes them.
      floeAmount: { default: 0.6, min: 0, max: 1.5, step: 0.05, group: "underIce" }
    }
  },
  astralVoid: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.AstralVoid",
    // The color of the clouds and the light at the mask edge. The second cloud color comes from this color.
    defaultColor: "#5b2be0",
    params: {
      // The part of the cells that has a star.
      starDensity: { default: 0.5, min: 0, max: 1, step: 0.05, group: "stars" },
      // The brightness of the stars.
      starBrightness: { default: 1, min: 0, max: 2, step: 0.05, group: "stars" },
      // The change of the star brightness with time. 0 gives steady stars.
      twinkleAmount: { default: 0.5, min: 0, max: 1, step: 0.05, group: "stars" },
      // The movement of the stars for a camera movement. 0 keeps them on the map.
      depthAmount: { default: 0.5, min: 0, max: 2, step: 0.05, group: "stars" },
      // The brightness of the color clouds. 0 removes them.
      nebulaAmount: { default: 0.7, min: 0, max: 1.5, step: 0.05, group: "nebula" },
      // The size of the light around the mask edge, in grid squares at pattern scale 1. 0 removes it.
      rimRadius: { default: 0.25, min: 0, max: 1, step: 0.05, group: "rim" },
      // The brightness of the light around the mask edge.
      rimLight: { default: 1, min: 0, max: 2, step: 0.05, group: "rim" }
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
