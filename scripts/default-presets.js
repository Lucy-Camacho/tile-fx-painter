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
  },
  lava: {
    flowingLava: {
      intensity: 1,
      color: "#e8400a",
      speed: 1,
      scale: 1,
      params: {
        moltenAmount: 0.7, heatLevel: 1.2, heatRadius: 0.5, crustBrightness: 0.1, detailAmount: 1, reliefAmount: 1,
        pulseAmount: 0.5, flowAngle: 0, flowAmount: 0.15
      }
    },
    coolingCrust: {
      intensity: 1,
      color: "#b8300a",
      speed: 0.5,
      scale: 1,
      params: {
        moltenAmount: 0.45, heatLevel: 1.05, heatRadius: 0.2, crustBrightness: 0.15, detailAmount: 1.3, reliefAmount: 1.4,
        pulseAmount: 0.3, flowAngle: 0, flowAmount: 0
      }
    },
    magmaPool: {
      intensity: 1.2,
      color: "#ff5a1a",
      speed: 1,
      scale: 1,
      params: {
        moltenAmount: 0.9, heatLevel: 1.6, heatRadius: 0.8, crustBrightness: 0.05, detailAmount: 0.6, reliefAmount: 0.6,
        pulseAmount: 0.8, flowAngle: 0, flowAmount: 0
      }
    }
  },
  water: {
    calmPond: {
      intensity: 1,
      color: "#2a6f6a",
      speed: 0.7,
      scale: 1,
      params: {
        depthTint: 0.5, shoreWidth: 1, foamAmount: 0.15, waveHeight: 0.3, refractAmount: 0.03, causticAmount: 0.5,
        specularAmount: 0.5, flowAngle: 0, flowAmount: 0
      }
    },
    riverCurrent: {
      intensity: 1,
      color: "#1f6f8b",
      speed: 1,
      scale: 1,
      params: {
        depthTint: 0.55, shoreWidth: 0.6, foamAmount: 0.5, waveHeight: 0.8, refractAmount: 0.05, causticAmount: 0.6,
        specularAmount: 0.7, flowAngle: 0, flowAmount: 0.4
      }
    },
    swamp: {
      intensity: 1,
      color: "#3b4a1e",
      speed: 0.5,
      scale: 1,
      params: {
        depthTint: 0.8, shoreWidth: 0.5, foamAmount: 0.05, waveHeight: 0.15, refractAmount: 0.01, causticAmount: 0.1,
        specularAmount: 0.3, flowAngle: 0, flowAmount: 0
      }
    }
  },
  frost: {
    frozenLake: {
      intensity: 1,
      color: "#2f7fb5",
      speed: 1,
      scale: 1,
      params: {
        frostCover: 1, edgeRoughness: 0.15, edgeFade: 0.3, frostTint: 0.5, frostBlur: 0.04, ridgeAmount: 0.8,
        sparkleAmount: 0.6, shineAmount: 0.3, fogRadius: 0.4, fogAmount: 0.3, currentAmount: 0.8, floeAmount: 0.8
      }
    },
    thinRime: {
      intensity: 1,
      color: "#8fc4e8",
      speed: 1,
      scale: 1,
      params: {
        frostCover: 0.4, edgeRoughness: 0.25, edgeFade: 0.5, frostTint: 0.25, frostBlur: 0.01, ridgeAmount: 1,
        sparkleAmount: 1, shineAmount: 0.15, fogRadius: 0.2, fogAmount: 0.2, currentAmount: 0, floeAmount: 0
      }
    },
    glacierIce: {
      intensity: 1,
      color: "#1d5f99",
      speed: 0.6,
      scale: 1,
      params: {
        frostCover: 1, edgeRoughness: 0.05, edgeFade: 0.1, frostTint: 0.8, frostBlur: 0.1, ridgeAmount: 0.5,
        sparkleAmount: 0.4, shineAmount: 0.5, fogRadius: 0.8, fogAmount: 0.6, currentAmount: 0.2, floeAmount: 1.2
      }
    }
  },
  astralVoid: {
    deepSpace: {
      intensity: 1,
      color: "#2a1f6b",
      speed: 0.6,
      scale: 1,
      params: {
        starDensity: 0.6, starBrightness: 1, twinkleAmount: 0.4, depthAmount: 0.8, nebulaAmount: 0.3, rimRadius: 0.15,
        rimLight: 0.6
      }
    },
    nebulaRift: {
      intensity: 1,
      color: "#c02be0",
      speed: 1,
      scale: 1,
      params: {
        starDensity: 0.4, starBrightness: 1.2, twinkleAmount: 0.6, depthAmount: 0.5, nebulaAmount: 1.2, rimRadius: 0.35,
        rimLight: 1.4
      }
    },
    eldritchPortal: {
      intensity: 1.2,
      color: "#3fbf7f",
      speed: 1.2,
      scale: 1,
      params: {
        starDensity: 0.7, starBrightness: 1.5, twinkleAmount: 0.8, depthAmount: 1.2, nebulaAmount: 0.8, rimRadius: 0.5,
        rimLight: 1.8
      }
    }
  },
  fog: {
    morningMist: {
      intensity: 1,
      color: "#d4dce3",
      speed: 0.6,
      scale: 1.5,
      params: {
        fogDensity: 0.5, fogCoverage: 0.75, detailAmount: 0.5, shadeAmount: 0.1, edgeSoftness: 1,
        flowAngle: 0, flowAmount: 0.05, swirlAmount: 0.3
      }
    },
    // flowAngle 270 is up on the screen, because the tile frame y axis points down.
    campfireSmoke: {
      intensity: 1,
      color: "#8a8784",
      speed: 1,
      scale: 0.75,
      params: {
        fogDensity: 0.6, fogCoverage: 0.45, detailAmount: 1.4, shadeAmount: 0.3, edgeSoftness: 0.4,
        flowAngle: 270, flowAmount: 0.3, swirlAmount: 0.8
      }
    },
    billowingSmoke: {
      intensity: 1,
      color: "#2e2b29",
      speed: 1,
      scale: 1,
      params: {
        fogDensity: 0.9, fogCoverage: 0.8, detailAmount: 1.2, shadeAmount: 0.6, edgeSoftness: 0.6,
        flowAngle: 270, flowAmount: 0.2, swirlAmount: 1
      }
    }
  },
  treeSway: {
    gentleBreeze: {
      intensity: 1,
      color: "#eef4d0",
      speed: 1,
      scale: 1,
      params: {
        swayAmount: 0.05, plantSize: 1.75, swayRate: 0.5, leafDetail: 0.6, swayVariation: 1, gustAmount: 0.4, gustSize: 5,
        flutterAmount: 0.4, sheenAmount: 0.1, flowAngle: 0, flowAmount: 0.7
      }
    },
    windyForest: {
      intensity: 1,
      color: "#eef4d0",
      speed: 1,
      scale: 1,
      params: {
        swayAmount: 0.1, plantSize: 1.75, swayRate: 0.6, leafDetail: 0.6, swayVariation: 1, gustAmount: 0.7, gustSize: 4,
        flutterAmount: 0.5, sheenAmount: 0.15, flowAngle: 0, flowAmount: 1
      }
    },
    stormWinds: {
      intensity: 1,
      color: "#e4ebdc",
      speed: 1,
      scale: 1,
      params: {
        swayAmount: 0.15, plantSize: 1.75, swayRate: 0.9, leafDetail: 0.5, swayVariation: 1, gustAmount: 0.85, gustSize: 7,
        flutterAmount: 0.6, sheenAmount: 0.2, flowAngle: 0, flowAmount: 1.3
      }
    }
  }
};
