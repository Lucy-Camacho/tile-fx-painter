import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The glow effect: a bright core in the mask area and a soft halo around it.
 * The output alpha is 0, thus the premultiplied blend adds the light to the color below.
 * The halo can go past the tile frame, because getBleed makes the mesh larger than the frame.
 */
export class GlowShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("glow")
  };

  /** @override */
  static getBleed(fx) {
    return this.getHaloBleed(fx.params.haloRadius, fx);
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PRNG}
    ${this.NOISE}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.glow.params).
    uniform float haloRadius;         // The halo radius in grid squares at pattern scale 1.
    uniform float haloLight;
    uniform float coreWhite;          // The core color moves this much to white, as the hot center of a light.
    uniform float flickerAmount;

    // Tuning values.
    const float HALO_GAIN = 5.0;      // A higher value makes the halo of a thin stroke stronger.
    const float CORE_LIGHT = 0.7;
    const float BASE_LIGHT = 0.3;
    const float FALLOFF = 0.6;        // 1 is a full screen blend. A lower value keeps more light on bright pixels.

    // The blur of the mask with an exponential curve.
    // The curve makes the halo of a thin stroke stronger, but a full area does not go above 1.
    float halo() {
      vec2 radius = vec2(haloRadius * gridSize * patternScale) / tileSize;
      return 1.0 - exp(-HALO_GAIN * maskBlur(radius));
    }

    vec4 _main() {
      float core = maskAlpha(vUvs, 0.0);
      float glow = halo();
      if ( (core + glow) <= 0.0 ) return vec4(0.0);

      // A slow pulse for the full area, plus a small noise that moves through the pattern.
      // The pulse is from -0.2 to 0, thus flickerAmount 1 gives a pulse from 0.8 to 1.
      vec2 pos = patternPos();
      float pulse = (0.1 * sin(phase * 2.0)) - 0.1;
      float wobble = 0.15 * (noise((pos * 2.0) + vec2(phase * 0.7, -phase * 0.4)) - 0.5);
      float flicker = 1.0 + (flickerAmount * (pulse + wobble));

      vec3 hot = mix(effectColor, vec3(1.0), coreWhite * core);
      vec3 light = ((effectColor * glow * haloLight) + (hot * core * CORE_LIGHT)) * intensity * flicker;
      // The area also gets brighter in its own colors. The base color is premultiplied.
      vec3 base = sampleBase(vUvs).rgb;
      light += base * core * BASE_LIGHT * intensity;
      // Screen-like falloff: a bright map pixel gets less light, so bright areas do not become flat white.
      light *= 1.0 - (FALLOFF * min(base, vec3(1.0)));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(light * tintAlpha.a, 0.0);
    }
  `;
  }
}
