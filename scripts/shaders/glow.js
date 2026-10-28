import { TileFxShader } from "./tile-fx-shader.js";

/**
 * The glow effect: a bright core in the mask area and a soft halo around it.
 * The output alpha is 0, thus the premultiplied blend adds the light to the color below.
 * The halo stays inside the tile frame, because the mesh covers only the frame.
 */
export class GlowShader extends TileFxShader {
  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PRNG}
    ${this.NOISE}

    // Tuning values.
    const float HALO_RADIUS = 0.5;    // The halo radius in grid squares at pattern scale 1.
    const float HALO_SIGMA = 0.4;     // The Gaussian width, as a fraction of the halo radius.
    const float HALO_GAIN = 5.0;      // A higher value makes the halo of a thin stroke stronger.
    const float HALO_LIGHT = 0.9;
    const float CORE_LIGHT = 0.7;
    const float CORE_WHITE = 0.35;    // The core color moves this much to white, as the hot center of a light.
    const float BASE_LIGHT = 0.3;
    const float FALLOFF = 0.6;        // 1 is a full screen blend. A lower value keeps more light on bright pixels.

    // The mask alpha at a mask UV and mip level. It is 0 outside the texture, because the texture clamps at its edge.
    float maskAlpha(vec2 uv, float lod) {
      if ( any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))) ) return 0.0;
      return textureLod(sampler, uv, lod).a;
    }

    // One ring of the halo blur. Each ring turns by a different part of its step, to avoid a visible star shape.
    float haloRing(vec2 radius, float dist, float count, float lod) {
      float total = 0.0;
      float offset = dist * (TWOPI / count) * 0.5;
      for ( float i = 0.0; i < count; i++ ) {
        float angle = (i * (TWOPI / count)) + offset;
        total += maskAlpha(vUvs + (vec2(cos(angle), sin(angle)) * radius * dist), lod);
      }
      return total / count;
    }

    // A Gaussian blur of the mask: the center and 3 rings, about one third of the radius apart.
    // The samples read a mip level with one texel for each sample step. Thus the samples overlap, and the halo
    // shows no ring bands. GlowShader#_preRender turns on the mipmaps of the mask.
    // The exponential curve makes the halo of a thin stroke stronger, but a full area does not go above 1.
    float halo() {
      vec2 radius = vec2(HALO_RADIUS * gridSize * patternScale) / tileSize;
      vec2 stepTexels = (radius / 3.0) * vec2(textureSize(sampler, 0));
      float lod = max(log2(max(stepTexels.x, stepTexels.y)), 0.0);
      float w1 = exp(-(1.0 / 9.0) / (2.0 * HALO_SIGMA * HALO_SIGMA));
      float w2 = exp(-(4.0 / 9.0) / (2.0 * HALO_SIGMA * HALO_SIGMA));
      float w3 = exp(-1.0 / (2.0 * HALO_SIGMA * HALO_SIGMA));
      // The ring weights also count the ring sizes (6, 12, 18 samples), because a larger ring covers more area.
      float total = maskAlpha(vUvs, lod)
        + (haloRing(radius, 1.0 / 3.0, 6.0, lod) * w1 * 6.0)
        + (haloRing(radius, 2.0 / 3.0, 12.0, lod) * w2 * 12.0)
        + (haloRing(radius, 1.0, 18.0, lod) * w3 * 18.0);
      float blur = total / (1.0 + (w1 * 6.0) + (w2 * 12.0) + (w3 * 18.0));
      return 1.0 - exp(-HALO_GAIN * blur);
    }

    vec4 _main() {
      float core = maskAlpha(vUvs, 0.0);
      float glow = halo();
      if ( (core + glow) <= 0.0 ) return vec4(0.0);

      // A slow pulse for the full area, plus a small noise that moves through the pattern.
      vec2 pos = patternPos();
      float pulse = 0.9 + (0.1 * sin(phase * 2.0));
      float flicker = pulse + (0.15 * (noise((pos * 2.0) + vec2(phase * 0.7, -phase * 0.4)) - 0.5));

      vec3 hot = mix(effectColor, vec3(1.0), CORE_WHITE * core);
      vec3 light = ((effectColor * glow * HALO_LIGHT) + (hot * core * CORE_LIGHT)) * intensity * flicker;
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

  /** @override */
  _preRender(mesh, renderer) {
    super._preRender(mesh, renderer);
    // The halo blur reads the mip levels of the mask. The core "mipmap" setting can be off, thus turn them on here.
    // The setter does nothing if the value is the same. Else PIXI makes the mipmaps at the next bind of the texture.
    const baseTexture = mesh.texture?.baseTexture;
    if ( baseTexture && !baseTexture.destroyed ) baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
  }
}
