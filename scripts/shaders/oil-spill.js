import { TileFxShader } from "./tile-fx-shader.js";

/**
 * The oil spill effect: a thin film of slow rainbow colors on a dark oil surface.
 * The oil is the background color, made darker and tinted with the effect color. Thus the map stays visible.
 */
export class OilSpillShader extends TileFxShader {
  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PRNG}
    ${this.NOISE}
    ${this.FBM(4, 0.5)}

    // The number of swirls in one pattern unit. A higher value gives smaller swirls.
    const float SWIRL_FREQ = 1.5;
    // The flow speed of the film, in pattern units each second at speed 1.
    const float FLOW = 0.15;
    // The force of the domain warp. A higher value gives more twisted swirls.
    const float WARP = 4.0;
    // The number of rainbow cycles from the thinnest to the thickest film.
    const float BANDS = 2.0;
    // The quantity of rainbow color on the oil. Keep it low, so that the colors stay soft.
    const float FILM = 0.35;
    // The quantity of background brightness that stays in the oil.
    const float DARKEN = 0.45;
    // The height of the small surface ripples, and their number in one swirl unit.
    const float RIPPLE = 0.06;
    const float RIPPLE_FREQ = 5.0;
    // The tilt of the surface normal for a height change. A higher value gives a rougher liquid.
    const float BUMP = 0.15;
    // The maximum shift of the map under the liquid, in grid squares at pattern scale 1.
    const float REFRACT = 0.05;
    // The brightness of the wet highlights.
    const float SPECULAR = 0.7;
    // The distance of the height samples for the normal, in swirl units.
    const float NORMAL_STEP = 0.02;

    // The film thickness, from about 0 to 1. The FBM position moves with a second FBM (a domain warp),
    // so that the bands bend into swirls, as on real oil.
    float thickness(vec2 pos, float t) {
      vec2 warp = vec2(fbm(pos + vec2(0.0, t)), fbm(pos + vec2(5.2, 1.3) - t));
      return fbm(pos + (WARP * warp) + vec2(t * 0.5, -t * 0.3)) * 1.07;
    }

    // The surface height: the film swirls plus small ripples that move faster than the film.
    float surface(vec2 pos, float t, float film) {
      return film + (RIPPLE * noise((pos * RIPPLE_FREQ) + vec2(t * 3.0, t * 2.0)));
    }

    vec4 _main() {
      float s = min(strength(), 1.0);
      if ( s <= 0.0 ) return vec4(0.0);

      vec2 pos = patternPos() * SWIRL_FREQ;
      float t = phase * FLOW;
      float film = thickness(pos, t);

      // The surface normal is in the tile frame axes, the same axes as vUvs.
      vec2 dx = vec2(NORMAL_STEP, 0.0);
      vec2 dy = vec2(0.0, NORMAL_STEP);
      float height = surface(pos, t, film);
      vec2 slope = vec2(surface(pos + dx, t, thickness(pos + dx, t)) - height,
                        surface(pos + dy, t, thickness(pos + dy, t)) - height) / NORMAL_STEP;
      vec3 normal = normalize(vec3(-slope * BUMP, 1.0));

      // A light at the top left of the tile frame. A flat surface reflects no highlight to the eye.
      vec3 light = normalize(vec3(-0.4, -0.6, 1.0));
      float specular = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), 48.0);

      // A tilted surface shows a longer path through the film, thus the rainbow color shifts.
      float filmPath = (film * BANDS) + ((1.0 - normal.z) * 2.0);
      vec3 rainbow = 0.5 + (0.5 * cos(TWOPI * (filmPath + vec3(0.0, 0.33, 0.67))));
      // The colors are strongest in the middle of the thickness range. Thus some areas show only the dark oil.
      float sheen = smoothstep(0.15, 0.45, film) * (1.0 - smoothstep(0.75, 1.0, film));

      // The liquid bends the map below it. patternScale keeps the shift in proportion to the swirl size.
      vec2 shift = normal.xy * REFRACT * gridSize * patternScale / tileSize;
      vec4 base = sampleBase(vUvs + shift);
      // Near the edge of the background, the shifted sample can be outside it.
      if ( base.a <= 0.0 ) base = sampleBase(vUvs);

      // With no background, the oil is the effect color.
      vec3 oil = effectColor;
      if ( base.a > 0.0 ) oil = mix(unpremultiply(base) * DARKEN, effectColor, 0.5);

      vec3 color = oil + (rainbow * FILM * sheen) + (vec3(SPECULAR) * specular);
      // The color must not be more than the alpha (s), because the output is premultiplied. Alpha s is at most 1.
      color = min(color, vec3(1.0));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(color * s, s) * tintAlpha.a;
    }
  `;
  }
}
