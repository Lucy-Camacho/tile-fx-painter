import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The tree sway effect: the painted tree crowns bend and sway in gusts.
 * Each plant is a height field (mask × crown dome × image light). A higher point leans more.
 * A parallax march shows the lean, thus a moved crown covers the ground downwind and the ground stays still.
 */
export class TreeSwayShader extends TileFxShader {
  static usesMaskMipmaps = true;

  /** The maximum flutter offset at flutterAmount 1, in pattern units. getBleed also uses it. */
  static FLUTTER_SHIFT = 0.012;

  /** The maximum lean along the wind, as a part of swayAmount. Same as LEAN_MAX in the GLSL. */
  static LEAN_MAX = 1.3;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("treeSway")
  };

  /** @override */
  static getBleed(fx) {
    const lean = fx.params.swayAmount * this.LEAN_MAX * Math.min(fx.intensity, 2);
    return (lean + this.FLUTTER_SHIFT) * fx.scale;
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.STABLE_PRNG}
    ${this.NOISE}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.treeSway.params).
    uniform float swayAmount;
    uniform float plantSize;
    uniform float swayRate;
    uniform float leafDetail;
    uniform float swayVariation;
    uniform float gustAmount;
    uniform float gustSize;
    uniform float flutterAmount;
    uniform float sheenAmount;
    uniform float flowAngle;
    uniform float flowAmount;

    // Tuning values.
    const float GUST_SPEED = 2.0;       // The speed of the gust fronts at flowAmount 1, in pattern units each second.
    const float GUST_STRETCH = 2.5;     // Gust fronts are wider across the wind than along it.
    const float GUST_MORPH = 0.15;      // The change of the front shapes with time.
    const float SWAY_FREQ = 0.6;        // The sway frequency at swayRate 1, in cycles each second.
    const float SWAY_SHARE = 0.35;      // The spring sway, as a part of the lean in a full gust.
    const float SWAY_CALM = 0.3;        // The part of the spring sway in calm air. A gust adds the remainder.
    const float CROSS_SWAY = 0.35;      // The sway across the wind, relative to the sway along it. It gives an ellipse.
    const float LEAN_MIN = -0.4;        // A plant goes back past its rest position only a little.
    const float LEAN_MAX = ${this.LEAN_MAX.toFixed(2)};
    const float PHASE_CELLS = 1.5;      // The size of a phase noise cell, in plant sizes. Thus one crown keeps about one phase.
    const float WAVE_LENGTH = 0.5;      // The length of the coherent sway wave, as a part of gustSize.
    const float DOME_EDGE = 0.35;       // The crown height at a hard mask edge. Thus the crown edge also moves over the ground.
    const float MARCH_STEPS = 8.0;
    const float FLUTTER_FREQ = 6.0;     // The number of flutter cells in one pattern unit.
    const float FLUTTER_RATE = 3.0;     // The movement of the flutter layers, in cells each second.
    const float FLUTTER_SHIFT = ${this.FLUTTER_SHIFT.toFixed(4)};
    const float FLUTTER_LIGHT = 0.25;   // The maximum light change of the flutter.
    const float SHEEN_GAIN = 0.6;
    const vec3 LUMA = vec3(0.299, 0.587, 0.114);
    const mat2 OCTAVE_TURN = mat2(0.8, 0.6, -0.6, 0.8);

    // The mip level of the crown dome. Set once in _main, because h() runs in the march.
    float domeLod;

    // The light of the image at a mask UV, mapped to 0 to 1. Light leaves and blade tips are higher than the gaps.
    float leafLight(vec2 q) {
      vec4 c = sampleBase(q);
      return smoothstep(0.1, 0.9, dot(unpremultiply(c), LUMA));
    }

    // The height of a point, from 0 to 1. One mip sample replaces maskBlur, because the march reads many points.
    float plantHeight(vec2 q) {
      float m = maskAlpha(q, 0.0);
      if ( m <= 0.0 ) return 0.0;
      float dome = mix(DOME_EDGE, 1.0, smoothstep(0.5, 1.0, maskAlpha(q, domeLod)));
      return leafDetail > 0.0 ? m * dome * mix(1.0, leafLight(q), leafDetail) : m * dome;
    }

    // The gust force from 0 to 1. The fronts move downwind. The smoothstep keeps calm air between them.
    float gustForce(float along, float across) {
      vec2 g = vec2(along - (GUST_SPEED * flowAmount * phase), across / GUST_STRETCH) / gustSize;
      float n = (0.65 * noise(g)) + (0.35 * noise((OCTAVE_TURN * g * 2.1) + vec2(phase * GUST_MORPH, 7.3)));
      return smoothstep(0.4, 0.7, n);
    }

    vec4 _main() {
      vec2 toUv = vec2(gridSize * patternScale) / tileSize;
      float leanScale = swayAmount * min(intensity, 2.0);

      // No plant can move onto this pixel if the mask is 0 in the reach of the maximum lean.
      vec2 reach = toUv * ((leanScale * LEAN_MAX) + (FLUTTER_SHIFT * flutterAmount));
      if ( maskAlpha(vUvs, maskBlurLod(reach)) <= 0.0 ) return vec4(0.0);

      float flowRadians = radians(flowAngle);
      vec2 dir = vec2(cos(flowRadians), sin(flowRadians));
      vec2 side = vec2(-dir.y, dir.x);
      vec2 p = patternPos();
      float along = dot(p, dir);
      float gust = gustForce(along, dot(p, side));
      // At gustAmount 0 the force is steady, and the plants only sway.
      float force = mix(0.5, gust, gustAmount);

      // One frequency for all points. Different frequencies drift apart with time and make a fine ripple.
      vec2 phasePos = p / (PHASE_CELLS * plantSize);
      float w = TWOPI * SWAY_FREQ * swayRate * phase;
      float swaySize = SWAY_SHARE * (SWAY_CALM + ((1.0 - SWAY_CALM) * force));
      // At swayVariation 0, the trees sway in waves that move downwind. Random phases in small cells look like water refraction.
      // Each harmonic uses its own multiple of the wave phase, thus all harmonics move at the same speed.
      float wavePhi = -TWOPI * along / (WAVE_LENGTH * gustSize);
      float phi1 = mix(wavePhi, TWOPI * noise(phasePos), swayVariation);
      float phi2 = mix(1.618 * wavePhi, TWOPI * noise(phasePos + vec2(17.1, 3.4)), swayVariation);
      float phi3 = mix(1.27 * wavePhi, TWOPI * noise(phasePos + vec2(-5.3, 11.7)), swayVariation);
      float spring = (0.6 * sin(w + phi1)) + (0.4 * sin((1.618 * w) + phi2));
      // A steady lean does not show on a static map. It would only stretch the map, thus the lean has no constant part.
      float leanAlong = clamp((gustAmount * gust) + (spring * swaySize), LEAN_MIN, LEAN_MAX);
      // Only separate plants (trees) move on an ellipse. A cross sway in a field makes the parts move in different directions.
      float leanAcross = CROSS_SWAY * swayVariation * swaySize * sin((1.27 * w) + phi3);
      vec2 lean = ((dir * leanAlong) + (side * leanAcross)) * leanScale * toUv;

      // Parallax march: the first point from the top with a height of t or more is the highest point that the lean moves onto this pixel.
      // The lean comes from this pixel, not from the point. It changes slowly in space, thus the error is small.
      float hitT = 0.0;
      if ( dot(lean, lean) > 0.0 ) {
        domeLod = maskBlurLod(vec2(0.5 * plantSize) * toUv);
        float prevT = 1.0;
        float prevH = 0.0;
        for ( float i = 0.0; i <= MARCH_STEPS; i++ ) {
          float t = 1.0 - (i / MARCH_STEPS);
          float h = plantHeight(vUvs - (lean * t));
          if ( h >= t ) {
            // One linear step between the last two samples gives a more exact t.
            float before = prevT - prevH;
            float after = h - t;
            hitT = (i > 0.0) ? mix(prevT, t, before / max(before + after, 1e-5)) : 1.0;
            break;
          }
          prevT = t;
          prevH = h;
        }
      }
      vec2 q = vUvs - (lean * hitT);

      float mask = maskAlpha(q, 0.0);
      // Outside the mask with no moved plant, the map shows unchanged. Return 0, thus the tiles below stay visible.
      if ( (mask <= 0.0) && (hitT <= 0.0) ) return vec4(0.0);
      float light = leafLight(q);

      // Flutter: two fine layers that move in opposite directions. Thus the pattern changes in place and does not slide.
      float flutter = 0.0;
      if ( flutterAmount > 0.0 ) {
        vec2 fp = p * FLUTTER_FREQ;
        float n1 = noise(fp + (dir * phase * FLUTTER_RATE));
        float n2 = noise((OCTAVE_TURN * fp) - (dir * phase * FLUTTER_RATE * 1.3) + 3.7);
        float weight = flutterAmount * force * mask * mix(0.4, 1.0, light);
        // Only downwind: a random 2D offset in each cell looks like refraction, not like leaves.
        q -= dir * n1 * FLUTTER_SHIFT * weight * toUv;
        flutter = (n1 + n2 - 1.0) * FLUTTER_LIGHT * weight;
      }

      vec4 base = sampleBase(q);
      if ( base.a <= 0.0 ) return vec4(0.0);
      vec3 color = unpremultiply(base) * (1.0 + flutter);

      // Bent leaves show more light. Screen-like, thus dark pixels change less than in an add.
      float bend = clamp(leanAlong, 0.0, 1.0);
      float sheen = sheenAmount * SHEEN_GAIN * bend * mask * mix(0.5, 1.0, light) * min(intensity, 1.0);
      color += (1.0 - color) * effectColor * sheen;

      color = clamp(color, 0.0, 1.0);
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(color * base.a, base.a) * tintAlpha.a;
    }
  `;
  }
}
