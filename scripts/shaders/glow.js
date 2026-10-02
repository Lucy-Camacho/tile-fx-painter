import { TileFxShader } from "./tile-fx-shader.js";

/**
 * The glow effect. It adds light to the map: a bright core in the mask area and a soft halo around it.
 * The output alpha is 0. Thus the premultiplied normal blend adds the light to the color below.
 * The halo stays inside the tile frame, because the mesh covers only the frame.
 */
export class GlowShader extends TileFxShader {
  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PRNG}
    ${this.NOISE}

    // The mask alpha at a mask UV. 0 outside the mask, because the texture clamps at its edge.
    float maskAlpha(vec2 uv) {
      if ( any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))) ) return 0.0;
      return texture(sampler, uv).a;
    }

    // A soft copy of the mask: 2 rings of 8 points around the pixel.
    // The radius is 0.25 grid square at pattern scale 1, in scene pixels. tileSize changes it to UV units.
    float halo() {
      vec2 radius = vec2(0.25 * gridSize * patternScale) / tileSize;
      float total = 0.0;
      for ( int i = 0; i < 8; i++ ) {
        float angle = float(i) * (TWOPI / 8.0);
        vec2 dir = vec2(cos(angle), sin(angle));
        // The inner ring has more weight, so that the halo becomes weaker with distance.
        total += maskAlpha(vUvs + (dir * radius * 0.5)) * 2.0;
        // The outer ring turns by a half step, so that the 16 points do not make a visible star shape.
        float outerAngle = angle + (TWOPI / 16.0);
        total += maskAlpha(vUvs + (vec2(cos(outerAngle), sin(outerAngle)) * radius));
      }
      return total / 24.0;
    }

    vec4 _main() {
      float core = maskAlpha(vUvs);
      float glow = halo();
      if ( (core + glow) <= 0.0 ) return vec4(0.0);

      // A slow pulse for the full area, and a small noise that moves through the pattern.
      vec2 pos = patternPos();
      float pulse = 0.9 + (0.1 * sin(phase * 2.0));
      float flicker = pulse + (0.15 * (noise((pos * 2.0) + vec2(phase * 0.7, -phase * 0.4)) - 0.5));

      // The halo has more weight than the core, so that the effect is an ambient glow, not a bright lamp.
      vec3 light = effectColor * ((core * 0.4) + (glow * 0.6)) * intensity * flicker;
      // The area also gets a little brighter in its own colors. The base color is premultiplied.
      vec3 base = sampleBase(vUvs).rgb;
      light += base * core * 0.2 * intensity;
      // A screen-like falloff: a bright map pixel gets less light. Thus bright areas do not become flat white.
      light *= 1.0 - min(base, vec3(1.0));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(light * tintAlpha.a, 0.0);
    }
  `;
  }
}
