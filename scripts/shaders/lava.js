import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The lava effect: solid crust islands on molten rock with a network of hot veins.
 * The two parts have separate patterns. The crust pattern has no time input, thus an island moves only as one solid piece with the flow.
 * The veins move and change, but the warp slope has a limit, thus they do not stretch.
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
    ${this.STABLE_PRNG}
    ${this.NOISE}
    ${this.VORONOI_CELLS}
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

    // Tuning values of the crust.
    const float CRUST_FREQ = 1.15;      // The number of crust islands along one grid square at Pattern Scale 1.
    const float ISLAND_SIZE = 0.42;     // The distance from the island point that has the mean height, in Voronoi cell units.
    const float ISLAND_SLOPE = 0.62;    // The height change for a distance of one Voronoi cell.
    const float ISLAND_VARIATION = 0.4;  // The change of the island size. A high value removes some islands.
    const float ISLAND_BEND = 0.9;      // The irregular shape of the islands.
    const float CRUST_DRIFT = 0.5;      // The speed of the crust, as a part of the flow speed.
    const float CRUST_ALL = -0.78;      // The crust limit at Molten Area 0. All pixels are above it, also at Surface Detail 2.
    const float CRUST_NONE = 0.75;      // The crust limit at Molten Area 1. No pixel is above it, also at Surface Detail 2.
    const float CRUST_EDGE = 0.008;     // The half width of the change from crust to molten rock, in height units.
    const float RIM_OUT = 0.14;         // The height distance where the molten rock next to the crust gets its full heat.
    const float RIM_IN = 0.05;          // The height distance where the crust next to the molten rock shows a red light.
    const float CRUST_EMBER = 0.08;     // The part of the ember color in all of the crust.
    const float SOFT_MASK_CRUST = 0.7;  // The height increase at a soft mask edge. Only the crust stays there.
    const float ROCK_FREQ = 9.0;        // The frequency of the crust surface for the light.
    const float NORMAL_STEP = 0.05;     // The distance of the height samples for the normal, in rock noise units.
    const float BUMP = 0.25;            // The tilt of the surface normal for a height change at Surface Relief 1.

    // Tuning values of the molten rock.
    const float MOLTEN_FREQ = 3.2;      // The number of large vein cells in one pattern unit.
    const float MOLTEN_SPEED = 0.08;    // The speed of the vein layers, in noise units each second.
    const float SWIRL_FREQ = 0.45;       // The frequency of the warp noise, relative to the veins.
    // The warp bends the veins. The slope of the warp must stay small, because a large slope stretches the veins.
    // The maximum slope of the noise is 1.5. Thus the warp changes a distance by at most 1.5 * SWIRL_GAIN * SWIRL_FREQ * Swirl.
    const float SWIRL_GAIN = 0.7;
    const float SWIRL_SPEED = 0.05;     // The change of the warp, in noise units each second.
    const float VEIN_SHARP = 5.0;       // A higher value gives thinner veins.
    const float GLOW_SHARP = 2.0;       // A higher value gives a thinner soft light around the veins.
    const float BODY_HEAT = 0.13;        // The heat of the molten rock with no vein.
    const float CLOUD_HEAT = 0.16;       // The change of the heat from the soft clouds.
    const float GLOW_HEAT = 0.38;       // The added heat of the soft light around the veins.
    const float VEIN_HEAT = 0.6;        // The added heat at the center of a vein.
    const float RIM_FAR = 0.3;          // The height distance from the crust that gets all of FAR_HEAT.
    const float FAR_HEAT = 0.08;        // The added heat far from the crust.
    const float FLOW_SPEED = 1.0;       // The flow at Flow Speed 1, in grid squares each second at Pattern Scale 1.
    const float PULSE_RATE = 1.2;       // The speed of the heat pulse, in radians each second.
    const float PULSE_DROP = 0.3;       // The maximum heat drop at Heat Pulse 1.

    // Tuning values of the color and the light.
    const float EMBER = 0.55;           // The brightness of the coolest molten color.
    const float HOT_GAIN = 2.8;         // A higher value moves the hot color more to yellow.
    const float HEAT_LIGHT = 0.8;       // The brightness of the light past the mask.
    const float FALLOFF = 0.6;          // A higher value gives less light on a bright map pixel. See GlowShader.
    const vec3 NO_MAP_CRUST = vec3(0.2, 0.16, 0.14);  // The crust with no background image, before crustBrightness.

    // Each octave turns, because octaves on the same axes give the value noise a square shape.
    const mat2 OCTAVE_TURN = mat2(0.8, 0.6, -0.6, 0.8);

    // The coolest molten color. The square of the effect color keeps its hue. The default color gives a dark red.
    vec3 emberColor() {
      return effectColor * effectColor * EMBER;
    }

    // The color of molten rock, from a dark ember through the effect color to a light hot color.
    // The gain raises the middle channels the most, and the high and low channels the least. Thus the hue goes to the next
    // bright hue and not to white. The default color gives a saturated yellow.
    vec3 heatColor(float heat) {
      vec3 warm = sqrt(effectColor);
      vec3 hot = min(warm + ((1.0 - warm) * warm * warm * HOT_GAIN), vec3(1.0));
      vec3 color = mix(emberColor(), effectColor, smoothstep(0.0, 0.32, heat));
      color = mix(color, hot, smoothstep(0.42, 0.85, heat));
      return mix(color, vec3(1.0), smoothstep(0.92, 1.0, heat) * 0.12);
    }

    // The height of the crust. A value above the crust limit is crust.
    // This field has no time input, thus the shape of a crust island cannot change. The mean of the field is 0.
    float crustHeight(vec2 p) {
      // One island for each Voronoi cell gives even spaces between the islands, and they do not join into long chains.
      // Only the distance to the point is used, thus the cell edges do not show. The noise gives each island a different size.
      // The bend gives the islands an irregular shape.
      vec2 bend = vec2(noise((p * 1.4) + vec2(3.1, 7.7)), noise((p * 1.4) + vec2(9.4, 2.2))) - 0.5;
      float height = (ISLAND_SIZE - voronoiCells(p + (bend * ISLAND_BEND), 0.0).x) * ISLAND_SLOPE;
      height += (noise((p * 0.7) + 31.7) - 0.5) * ISLAND_VARIATION;
      p = (OCTAVE_TURN * p * 2.03) + 11.3;
      height += (noise(p) - 0.5) * 0.3;
      // More octaves show as square blocks when the camera zooms in.
      float amp = 0.2 * detailAmount;
      for ( int i = 0; i < 3; i++ ) {
        p = (OCTAVE_TURN * p * 2.03) + 11.3;
        height += (noise(p) - 0.5) * amp;
        amp *= 0.7;
      }
      return height;
    }

    // The surface of the crust for the light. With fewer octaves, the light shows long streaks across its direction.
    float rockHeight(vec2 p) {
      float height = noise(p) * 0.5;
      p = (OCTAVE_TURN * p * 2.03) + 5.7;
      height += noise(p) * 0.3;
      p = (OCTAVE_TURN * p * 2.03) + 5.7;
      return height + (noise(p) * 0.2);
    }

    // x: the height of the vein ridges, from 0 to 1. y: the soft clouds, with mean 0.
    // Each layer moves only by translation, in its own direction. Thus the veins join and separate like a liquid and do not stretch.
    vec2 moltenPattern(vec2 p, float t) {
      vec2 swirlPos = p * SWIRL_FREQ;
      vec2 swirl = vec2(noise(swirlPos + vec2(0.0, t * SWIRL_SPEED)), noise(swirlPos + vec2(5.2, 1.3) - vec2(t * SWIRL_SPEED, 0.0))) - 0.5;
      vec2 q = p + (swirl * warpAmount * SWIRL_GAIN);

      float crease = abs((noise(q + (vec2(0.8, 0.6) * t * MOLTEN_SPEED)) * 2.0) - 1.0) * 0.62;
      q = (OCTAVE_TURN * q * 2.03) + 3.1;
      crease += abs((noise(q + (vec2(-0.7, 0.7) * t * MOLTEN_SPEED * 1.6)) * 2.0) - 1.0) * 0.28;
      q = (OCTAVE_TURN * q * 2.03) + 3.1;
      crease += abs((noise(q + (vec2(0.3, -0.95) * t * MOLTEN_SPEED * 2.4)) * 2.0) - 1.0) * 0.1 * detailAmount;

      return vec2(clamp(1.0 - crease, 0.0, 1.0), swirl.x + swirl.y);
    }

    // The color of the crust and the molten rock at this pixel. The base color is premultiplied.
    vec3 lavaColor(vec4 base, float s) {
      // The flow is in the tile frame axes, thus it turns with the tile.
      float flowRadians = radians(flowAngle);
      vec2 flow = vec2(cos(flowRadians), sin(flowRadians)) * flowAmount * FLOW_SPEED * phase;
      vec2 grid = patternPos();

      // Height above the crust limit. The molten rock cools at a soft mask edge, and only the crust stays there.
      float limit = mix(CRUST_ALL, CRUST_NONE, moltenAmount);
      float above = crustHeight((grid - (flow * CRUST_DRIFT)) * CRUST_FREQ) - limit + ((1.0 - smoothstep(0.2, 0.9, s)) * SOFT_MASK_CRUST);
      float cover = smoothstep(-CRUST_EDGE, CRUST_EDGE, above);
      // Heat Level 0 removes all red and molten color. All pixels then show as crust with no light.
      float heatFade = min(heatLevel * 4.0, 1.0);
      float hide = max(cover, 1.0 - heatFade);

      // The molten rock is hidden under a full crust, thus these pixels do not read its noise.
      vec3 color = vec3(0.0);
      if ( hide < 1.0 ) {
        vec2 molten = moltenPattern((grid - flow) * MOLTEN_FREQ, phase);
        // The pulse changes only the color, thus the crust edge does not move. Each cloud has its own pulse time.
        float wave = 0.5 + (0.5 * sin((phase * PULSE_RATE) + (molten.y * TWOPI * 2.0)));
        float heat = BODY_HEAT + (molten.y * CLOUD_HEAT) + (pow(molten.x, GLOW_SHARP) * GLOW_HEAT) + (pow(molten.x, VEIN_SHARP) * VEIN_HEAT)
          - (pulseAmount * PULSE_DROP * wave * 0.5);
        // The molten rock next to the crust is cooler. This gives the dark red rim of each island.
        heat *= smoothstep(0.0, RIM_OUT, -above);
        heat += smoothstep(RIM_OUT, RIM_FAR, -above) * FAR_HEAT;
        color = heatColor(clamp(heat * heatLevel, 0.0, 1.0));
      }

      if ( hide > 0.0 ) {
        float shade = 1.0;
        float specular = 0.0;
        if ( reliefAmount > 0.0 ) {
          // The crust surface moves with the crust, and it has no time. A light at the top left of the tile frame gives a flat surface the value 1.
          vec2 rockPos = (grid - (flow * CRUST_DRIFT)) * ROCK_FREQ;
          float rock = rockHeight(rockPos);
          vec2 slope = vec2(rockHeight(rockPos + vec2(NORMAL_STEP, 0.0)) - rock, rockHeight(rockPos + vec2(0.0, NORMAL_STEP)) - rock) / NORMAL_STEP;
          vec3 normal = normalize(vec3(-slope * BUMP * reliefAmount, 1.0));
          vec3 lightDir = normalize(vec3(-0.4, -0.6, 1.0));
          shade = max(dot(normal, lightDir) / lightDir.z, 0.0);
          specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
        }
        vec3 map = base.a > 0.0 ? unpremultiply(base) : NO_MAP_CRUST;
        vec3 crust = (map * crustBrightness * shade) + (vec3(0.06) * specular * reliefAmount);
        // A small part of the ember color stays in all of the crust. The crust next to the molten rock shows a stronger red light.
        // This prevents a sudden change from black to orange.
        crust += emberColor() * (CRUST_EMBER + ((1.0 - smoothstep(0.0, RIM_IN, above)) * 0.6)) * heatFade * shade;
        color = mix(color, crust, hide);
      }
      return color;
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
