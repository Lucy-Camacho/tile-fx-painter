import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The glow effect: a bright core in the mask area and a soft halo around it.
 * The output alpha is 0, thus the premultiplied blend adds the light to the color below.
 * The halo can go past the tile frame, because getBleed makes the mesh larger than the frame.
 */
export class GlowShader extends TileFxShader {
  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("glow")
  };

  /**
   * The halo radius, plus the fade of maskAlpha past the frame. At the outer ring, this fade is half of a mip texel,
   * and a mip texel is one third of the radius. Thus the halo is 0 at the mesh edge and shows no hard line there.
   * @override
   */
  static getBleed(fx) {
    return fx.params.haloRadius * fx.scale * (7 / 6);
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PRNG}
    ${this.NOISE}

    // The params of the tile (EFFECTS.glow.params).
    uniform float haloRadius;         // The halo radius in grid squares at pattern scale 1.
    uniform float haloLight;
    uniform float coreWhite;          // The core color moves this much to white, as the hot center of a light.
    uniform float flickerAmount;

    // Tuning values.
    const float HALO_SIGMA = 0.4;     // The Gaussian width, as a fraction of the halo radius.
    const float HALO_GAIN = 5.0;      // A higher value makes the halo of a thin stroke stronger.
    const float CORE_LIGHT = 0.7;
    const float BASE_LIGHT = 0.3;
    const float FALLOFF = 0.6;        // 1 is a full screen blend. A lower value keeps more light on bright pixels.

    // The mask alpha at a mask UV and mip level. It goes to 0 outside the texture, because the texture clamps at its edge.
    // The alpha fades over one mip texel at the edge. A sudden stop would show each halo sample as a hard line past the frame.
    float maskAlpha(vec2 uv, float lod) {
      vec2 texel = exp2(lod) / vec2(textureSize(sampler, 0));
      vec2 cover = clamp((min(uv, 1.0 - uv) / texel) + 0.5, 0.0, 1.0);
      return textureLod(sampler, uv, lod).a * cover.x * cover.y;
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
      vec2 radius = vec2(haloRadius * gridSize * patternScale) / tileSize;
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

  /** @override */
  _preRender(mesh, renderer) {
    super._preRender(mesh, renderer);
    // The halo blur reads the mip levels of the mask. The core "mipmap" setting can be off, thus turn them on here.
    // The setter does nothing if the value is the same. Else PIXI makes the mipmaps at the next bind of the texture.
    const baseTexture = mesh.texture?.baseTexture;
    if ( baseTexture && !baseTexture.destroyed ) baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
  }
}
