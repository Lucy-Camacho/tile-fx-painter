import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The lava effect: molten rock with large hot areas, black crust, and small hot flecks between them.
 * The crust is the map color, made darker. A soft light can go past the tile frame, because getBleed makes the mesh larger than the frame.
 */
export class LavaShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("lava")
  };

  /** @override */
  static getBleed(fx) {
    return this.getHaloBleed(fx.params.heatRadius, fx);
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PRNG}
    ${this.NOISE}
    ${this.FBM(4, 0.5)}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.lava.params).
    uniform float moltenAmount;
    uniform float heatLevel;
    uniform float crustBrightness;
    uniform float warpAmount;
    uniform float detailAmount;
    uniform float reliefAmount;
    uniform float pulseAmount;
    uniform float flowAngle;
    uniform float flowAmount;
    uniform float heatRadius;

    // Tuning values.
    const float AREA_FREQ = 1.3;      // The number of large hot areas in one pattern unit.
    const float FINE_FREQ = 5.0;      // The size of the large hot areas, relative to the surface grain.
    const float STREAK = 5.0;         // The stretch of the surface grain along the swirls.
    const float DRIFT = 0.04;         // The change of the swirls, in area units each second.
    const float FLOW_SPEED = 1.0;     // The flow at Flow Speed 1, in area units each second.
    const float DETAIL_GAIN = 2.2;    // The change of the heat from the surface grain at Surface Detail 1.
    const float HEAT_RANGE = 0.8;     // The increase above the crust limit that gives the hottest color.
    const float EMBER_RANGE = 0.3;    // The decrease below the crust limit where the crust shows a red light.
    const float NORMAL_STEP = 0.04;   // The distance of the height samples for the normal, in surface grain units.
    const float BUMP = 0.5;           // The tilt of the surface normal for a height change at Surface Relief 1.
    const float PULSE_RATE = 1.2;     // The speed of the heat pulse, in radians each second.
    const float PULSE_DROP = 0.3;     // The maximum heat drop at Heat Pulse 1.
    const float EMBER = 0.6;          // The brightness of the coolest molten color.
    const float HEAT_LIGHT = 0.8;     // The brightness of the light past the mask.
    const float FALLOFF = 0.6;        // A higher value gives less light on a bright map pixel. See GlowShader.
    const vec3 NO_MAP_CRUST = vec3(0.2, 0.16, 0.14);  // The crust with no background image, before crustBrightness.

    // The coolest molten color. The square of the effect color keeps its hue. The default color gives a dark red.
    vec3 emberColor() {
      return effectColor * effectColor * EMBER;
    }

    // The color of molten rock, from a dark ember through the effect color to a light hot color.
    // The square root of the effect color also keeps its hue. The default color gives a golden yellow.
    vec3 heatColor(float heat) {
      vec3 color = mix(emberColor(), effectColor, smoothstep(0.0, 0.35, heat));
      return mix(color, mix(sqrt(effectColor), vec3(1.0), 0.1), smoothstep(0.35, 0.85, heat));
    }

    // The color of the crust and the molten rock at this pixel. The base color is premultiplied.
    vec3 lavaColor(vec4 base, float s) {
      // The flow is in the tile frame axes, thus it turns with the tile.
      float flowRadians = radians(flowAngle);
      vec2 flow = vec2(cos(flowRadians), sin(flowRadians)) * flowAmount * FLOW_SPEED * phase;
      vec2 pos = (patternPos() * AREA_FREQ) - flow;
      float t = phase * DRIFT;

      // A domain warp bends the large areas into swirls.
      vec2 warp = vec2(fbm(pos + vec2(0.0, t)), fbm(pos + vec2(5.2, 1.3) - t)) - 0.47;
      float area = smoothstep(0.2, 0.72, fbm(pos + (warp * warpAmount) + vec2(t, -t * 0.7)));

      // The same warp, with a larger force, stretches the grain into streaks along the swirls.
      // The normal uses a constant warp for this pixel. It is not exact, but it needs 8 less noise reads for each height sample.
      vec2 grainPos = (pos * FINE_FREQ) + (warp * warpAmount * STREAK);
      float grain = fbm(grainPos);
      vec2 slope = vec2(fbm(grainPos + vec2(NORMAL_STEP, 0.0)) - grain, fbm(grainPos + vec2(0.0, NORMAL_STEP)) - grain) / NORMAL_STEP;
      vec3 normal = normalize(vec3(-slope * BUMP * reliefAmount, 1.0));

      // A light at the top left of the tile frame. A flat surface has the value 1.
      vec3 lightDir = normalize(vec3(-0.4, -0.6, 1.0));
      float shade = dot(normal, lightDir) / lightDir.z;
      float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);

      // Each area has its own pulse time. The molten rock cools at a soft mask edge, and only the crust stays there.
      float wave = 0.5 + (0.5 * sin((phase * PULSE_RATE) + (area * TWOPI * 2.0)));
      float level = area + ((grain - 0.47) * detailAmount * DETAIL_GAIN) - (pulseAmount * PULSE_DROP * wave) - (1.0 - smoothstep(0.2, 0.9, s));
      float heat = (level - mix(0.85, 0.05, moltenAmount)) / HEAT_RANGE;

      vec3 map = base.a > 0.0 ? unpremultiply(base) : NO_MAP_CRUST;
      vec3 crust = (map * crustBrightness * max(shade, 0.0)) + (vec3(0.12) * specular * reliefAmount);
      // Heat Level 0 removes all red and molten color.
      float heatFade = min(heatLevel * 4.0, 1.0);
      // The crust next to the molten rock shows a red light. This prevents a sudden change from black to orange.
      crust += emberColor() * smoothstep(-EMBER_RANGE, 0.0, heat) * 0.6 * heatFade * max(shade, 0.0);
      vec3 molten = heatColor(clamp(heat * heatLevel, 0.0, 1.0)) * mix(1.0, clamp(shade, 0.55, 1.25), 0.8);
      return mix(crust, molten, smoothstep(0.0, 0.05, heat) * heatFade);
    }

    vec4 _main() {
      float s = min(strength(), 1.0);

      // The light shows only where the lava does not cover the map. Thus a full mask area does not read the blur.
      float blur = 0.0;
      if ( (heatRadius > 0.0) && (s < 1.0) ) blur = maskBlur(vec2(heatRadius * gridSize * patternScale) / tileSize);
      if ( (s + blur) <= 0.0 ) return vec4(0.0);

      vec4 base = sampleBase(vUvs);
      vec3 color = s > 0.0 ? lavaColor(base, s) : vec3(0.0);
      // The color must not be more than the alpha (s), because the output is premultiplied. Alpha s is at most 1.
      color = min(color, vec3(1.0)) * s;

      float pulse = 1.0 - (pulseAmount * PULSE_DROP * 0.5 * (0.5 + (0.5 * sin(phase * PULSE_RATE))));
      vec3 light = effectColor * blur * (1.0 - s) * HEAT_LIGHT * heatLevel * intensity * pulse;
      // Screen-like falloff: a bright map pixel gets less light, so bright areas do not become flat white.
      light *= 1.0 - (FALLOFF * min(base.rgb, vec3(1.0)));

      // The light has no alpha, thus the premultiplied blend adds it to the color below.
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(color + light, s) * tintAlpha.a;
    }
  `;
  }
}
