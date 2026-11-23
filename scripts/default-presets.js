/**
 * The default presets: { <effectId>: { <key>: preset } }.
 * In code, not in the world setting, thus no user can delete them and a module update can change them.
 * The name is the localization key "TILE_FX_PAINTER.DefaultPresets.<EffectId>.<Key>". The key is fixed, thus the slug does not change with the language.
 * A param that is not given gets its default, and each value gets the clamps of the world presets.
 */
export const DEFAULT_PRESETS = {
  glow: {
    torchlight: {
      intensity: 1,
      color: "#ff9a3c",
      speed: 1.2,
      scale: 1,
      params: { haloRadius: 0.6, haloLight: 1, coreWhite: 0.35, flickerAmount: 1.5 }
    },
    arcaneRune: {
      intensity: 1,
      color: "#7a5cff",
      speed: 0.6,
      scale: 1,
      params: { haloRadius: 0.35, haloLight: 1.2, coreWhite: 0.5, flickerAmount: 0.3 }
    },
    emberCoals: {
      intensity: 0.8,
      color: "#d9381e",
      speed: 0.5,
      scale: 1,
      params: { haloRadius: 0.3, haloLight: 0.6, coreWhite: 0.15, flickerAmount: 2 }
    }
  },
  metallic: {
    polishedGold: {
      intensity: 1,
      color: "#d4af37",
      speed: 1,
      scale: 1,
      params: { smoothness: 0.9, grainAmount: 0.1, shadowTone: 0.2, shineBand: 1.3, cameraMotion: 1 }
    },
    brushedSteel: {
      intensity: 1,
      color: "#a9b3bd",
      speed: 1,
      scale: 1,
      params: { smoothness: 0.4, grainAmount: 1.2, shadowTone: 0.1, shineBand: 0.8, cameraMotion: 1 }
    },
    tarnishedBronze: {
      intensity: 1,
      color: "#8c6a3f",
      speed: 1,
      scale: 1,
      params: { smoothness: 0.2, grainAmount: 0.8, shadowTone: 0.3, shineBand: 0.5, cameraMotion: 0.6 }
    }
  },
  liquid: {
    oilSlick: {
      intensity: 1,
      color: "#1c2230",
      speed: 1,
      scale: 1,
      params: { warpAmount: 4, bands: 2, filmAmount: 0.45, darken: 0.4, refractAmount: 0.05, specularAmount: 0.8 }
    },
    tarPit: {
      intensity: 1,
      color: "#0d0b0a",
      speed: 0.4,
      scale: 1,
      params: { warpAmount: 2, bands: 1, filmAmount: 0.1, darken: 0.15, refractAmount: 0.02, specularAmount: 0.5 }
    },
    toxicSludge: {
      intensity: 1,
      color: "#2f5a12",
      speed: 0.8,
      scale: 1,
      params: { warpAmount: 5, bands: 3, filmAmount: 0.3, darken: 0.5, refractAmount: 0.08, specularAmount: 0.9 }
    }
  }
};
