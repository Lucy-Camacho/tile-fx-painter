import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The metallic effect. It changes the mask area to brushed metal, tinted with the effect color.
 * The brush lines go along the x axis of the tile. Such a surface spreads each reflection across the lines,
 * thus the reflections are bands along the y axis. The bands move slowly with time and with the camera of each client.
 * The background brightness sets the tone of the metal.
 */
export class MetallicShader extends TileFxShader {
  static usesViewTransform = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    viewTransform: [1, 1, 0, 0],
    ...getParamDefaults("metallic")
  };

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PERCEIVED_BRIGHTNESS}
    ${this.VIEW_OFFSET}
    ${this.STABLE_PRNG}
    ${this.NOISE}

    // The params of the tile (EFFECTS.metallic.params).
    uniform float smoothness;         // 0 is rough metal, and 1 is polished metal.
    uniform float grainAmount;        // A multiplier on the depth of the brush lines.
    uniform float shadowTone;         // The tone of the darkest map areas.
    uniform float shineBand;          // A multiplier on the light of the reflection bands.
    uniform float cameraMotion;       // A multiplier on BAND_PARALLAX.

    // The shift of the bands at camera offset 1, in grid squares at pattern scale 1. 0 keeps the bands on the metal.
    const float BAND_PARALLAX = 1.5;
    // The distance between the wide bands and between the thin bands, in grid squares at pattern scale 1.
    const float WIDE_BAND_CELL = 3.5;
    const float THIN_BAND_CELL = 0.9;

    // The sum of soft bands, with one band of random position, width, and brightness in each cell of size 1.
    // The width must be at most 0.27, because a band must end before the cell after its neighbor. Else the bands show a seam.
    // The brightness of a band is from minLight to 1.
    float bandLayer(float u, float seed, float width, float minLight) {
      float cell = floor(u);
      float total = 0.0;
      for ( float i = -1.0; i <= 1.0; i++ ) {
        float id = cell + i;
        float center = id + 0.2 + (0.6 * random(vec2(id, seed)));
        float size = width * mix(0.5, 1.5, random(vec2(id, seed + 7.0)));
        float light = mix(minLight, 1.0, smoothstep(0.3, 0.8, random(vec2(id, seed + 13.0))));
        float dist = (u - center) / size;
        total += light * exp(-dist * dist);
      }
      return total;
    }

    // The brush lines, from -0.5 to 0.5. Each line is much longer than it is wide.
    // Each layer fades when its lines become smaller than a pixel, because else they flicker when the camera moves.
    float brushLayer(vec2 pos, float pixelSize, float density, float stretch, float seed) {
      float visible = 1.0 - smoothstep(0.7, 1.4, pixelSize * density);
      return (noise(vec2((pos.x * stretch) + seed, pos.y * density)) - 0.5) * visible;
    }

    float brushLines(vec2 pos, float pixelSize) {
      return (brushLayer(pos, pixelSize, 22.0, 0.5, 0.0) * 0.25)
        + (brushLayer(pos, pixelSize, 55.0, 0.9, 11.0) * 0.5)
        + (brushLayer(pos, pixelSize, 120.0, 1.6, 23.0) * 0.65);
    }

    vec4 _main() {
      vec2 pos = patternPos();
      // Do not put this after a return, because the derivative of a pixel needs its neighbors.
      float pixelSize = fwidth(pos.y);

      float s = min(strength(), 1.0);
      if ( s <= 0.0 ) return vec4(0.0);

      // With no background, the metal is of medium brightness.
      vec4 base = sampleBase(vUvs);
      float luma = base.a > 0.0 ? perceivedBrightness(unpremultiply(base)) : 0.5;
      // A dark area does not become black.
      float tone = shadowTone + ((1.0 - shadowTone) * smoothstep(0.1, 0.9, luma));

      float grain = brushLines(pos, pixelSize) * grainAmount;

      // The lines scatter the reflection, thus a rough surface has feathered band edges.
      vec2 offset = viewOffset();
      float u = pos.x - (phase * 0.15) + ((offset.x + offset.y) * BAND_PARALLAX * cameraMotion)
        + (grain * 0.4 * pow(0.03, smoothness));

      // A rough surface spreads the same light over a larger area. Thus a wide band is dim, and a narrow band is bright.
      float width = 0.27 * pow(0.2, smoothness);
      float bandLight = mix(0.25, 1.5, smoothness);
      // Each wide band is bright, but most thin bands are dim, as on real metal.
      float bands = bandLayer(u / WIDE_BAND_CELL, 1.0, width, 0.55) + (0.2 * bandLayer(u / THIN_BAND_CELL, 2.0, width, 0.15));
      // A slow change of the metal tone between the bands.
      float sheen = (noise(vec2(u * 0.7, 3.0)) - 0.5) * 0.2;

      // Polished metal shows only its reflections, thus it is darker between the bands.
      float body = mix(0.85, 0.62, smoothness) + sheen;
      vec3 metal = effectColor * tone * body * (1.0 + (grain * mix(0.5, 0.12, smoothness)));
      // The highlights mix white and the tint, as on real metal. The lines also show in the highlights.
      metal += mix(vec3(1.0), effectColor, 0.3) * bands * bandLight * shineBand * (1.0 + (grain * 0.25));
      // The color must not be more than the alpha (s), because the output is premultiplied. Alpha s is at most 1.
      metal = clamp(metal, 0.0, 1.0);
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(metal * s, s) * tintAlpha.a;
    }
  `;
  }
}
