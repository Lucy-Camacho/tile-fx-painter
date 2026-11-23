import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The fog effect: soft clouds of the effect color drift over the map and hide it partly.
 * A blur of the mask gives a soft edge, which can go past the tile frame.
 */
export class FogShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("fog")
  };

  /** @override */
  static getBleed(fx) {
    const { edgeSoftness } = fx.params;
    return edgeSoftness > 0 ? this.getHaloBleed(edgeSoftness, fx) : 0;
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.STABLE_PRNG}
    ${this.NOISE}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.fog.params).
    uniform float fogDensity;
    uniform float fogCoverage;
    uniform float detailAmount;
    uniform float shadeAmount;
    uniform float edgeSoftness;
    uniform float flowAngle;
    uniform float flowAmount;
    uniform float swirlAmount;

    // Tuning values.
    const float CLOUD_FREQ = 0.6;       // The number of clouds along one pattern unit.
    const float SMALL_FREQ = 1.7;       // The frequency of the second layer, relative to the first.
    const float SMALL_SPEED = 1.6;      // The second layer drifts faster. Thus the two layers slide and the shapes change.
    const vec2 SMALL_SIDE = vec2(0.03, -0.02);  // A small side drift of the second layer, in pattern units each second.
    const float WARP_FREQ = 0.35;
    const float WARP_FORCE = 1.2;       // The maximum warp, in cloud units, at swirlAmount 1.
    const float WARP_RATE = 0.06;       // The change of the warp with time, at swirlAmount 1.
    const float COVER_NONE = 0.8;       // The threshold at fogCoverage 0.
    const float COVER_ALL = 0.15;       // The threshold at fogCoverage 1.
    const float COVER_SOFT = 0.18;      // The half width of the threshold. A large value keeps the cloud edges soft.
    const float SHADE_STEP = 0.12;      // The slope distance, in cloud units.
    const float SHADE_GAIN = 4.0;
    const vec2 LIGHT_DIR = vec2(0.0, -1.0);  // The light comes from the top of the tile.
    const mat2 OCTAVE_TURN = mat2(0.8, 0.6, -0.6, 0.8);

    // Three octaves. detailAmount scales the small octaves around their mean, thus the mean density does not change.
    float cloudOctaves(vec2 p) {
      float value = noise(p) * 0.5;
      p = (OCTAVE_TURN * p * 2.03) + 11.3;
      value += (0.15 + ((noise(p) - 0.5) * 0.3 * detailAmount));
      p = (OCTAVE_TURN * p * 2.03) + 11.3;
      return value + (0.1 + ((noise(p) - 0.5) * 0.2 * detailAmount));
    }

    // The cloud density before the threshold, from about 0 to 1.
    float cloudField(vec2 p, vec2 drift, vec2 warp) {
      float large = cloudOctaves(p + warp - drift);
      float small = cloudOctaves((OCTAVE_TURN * (p + (warp * 0.5)) * SMALL_FREQ) - (drift * SMALL_SPEED) + (SMALL_SIDE * phase) + 4.3);
      return (large * 0.65) + (small * 0.35);
    }

    float fogArea() {
      if ( edgeSoftness <= 0.0 ) return maskAlpha(vUvs, 0.0);
      return maskBlur(vec2(edgeSoftness * gridSize * patternScale) / tileSize);
    }

    vec4 _main() {
      float area = fogArea();
      if ( area <= 0.0 ) return vec4(0.0);

      vec2 p = patternPos() * CLOUD_FREQ;
      float flowRadians = radians(flowAngle);
      // The drift is in cloud units, thus flowAmount is in pattern units each second.
      vec2 drift = vec2(cos(flowRadians), sin(flowRadians)) * flowAmount * CLOUD_FREQ * phase;
      // The warp moves with the clouds, thus the shapes change in place and do not slide.
      vec2 warpPos = ((p - drift) * WARP_FREQ) + (phase * WARP_RATE * swirlAmount);
      vec2 warp = (vec2(noise(warpPos), noise(warpPos + vec2(5.2, 1.3))) - 0.5) * WARP_FORCE * swirlAmount;

      float field = cloudField(p, drift, warp);
      float threshold = mix(COVER_NONE, COVER_ALL, fogCoverage);
      float clouds = smoothstep(threshold - COVER_SOFT, threshold + COVER_SOFT, field);
      float alpha = clouds * area * fogDensity * min(intensity, 1.0);
      if ( alpha <= 0.0 ) return vec4(0.0);

      vec3 color = effectColor;
      if ( shadeAmount > 0.0 ) {
        // A pixel below a thicker part is in its shadow. A pixel above a thicker part is a lit top.
        float slope = cloudField(p + (LIGHT_DIR * SHADE_STEP), drift, warp) - field;
        float shade = clamp(-slope * SHADE_GAIN * shadeAmount, -0.5, 0.5);
        color = clamp(color * (1.0 + shade), 0.0, 1.0);
      }
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(color * alpha, alpha) * tintAlpha.a;
    }
  `;
  }
}
