import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The fire effect. At Flame Speed 0, the fire shows from above, as a campfire: flames pull to the center of each painted area
 * over a bed of coals. Floating embers rise from the fire in the two views. At a higher Flame Speed, the fire shows from the side: tongues rise in the flame direction past the mask.
 * The flame shape in the two views is "height minus noise": a flame shows where a height field is more than a noise value.
 * A soft light can go past the tile frame, because getBleed makes the mesh larger than the frame.
 */
export class FireShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("fire")
  };

  /** @override */
  static getBleed(fx) {
    const { glowRadius, flameLength, flameSpeed } = fx.params;
    // Side tongues go one flame length past the mask, plus the sway. The flames from above stay near the mask.
    // The flicker makes the side tongues longer, up to the reach limit of the shader (FLICKER_REACH, REACH_MAX).
    const reach = Math.min(1 + (0.22 * 2.5 * fx.params.flickerAmount), 1.6);
    const flames = flameLength * fx.scale * (flameSpeed > 0 ? 1.35 * reach : 0.5);
    return Math.max(glowRadius > 0 ? this.getHaloBleed(glowRadius, fx) : 0, flames);
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.STABLE_PRNG}
    ${this.NOISE}
    ${this.VORONOI_CELLS}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.fire.params).
    uniform float flameAmount;
    uniform float flameLength;
    uniform float turbulence;
    uniform float coreHeat;
    uniform float emberAmount;
    uniform float sparkAmount;
    uniform float glowRadius;
    uniform float glowLight;
    uniform float flickerAmount;
    uniform float flowAngle;
    uniform float flameSpeed;

    // Tuning values of the flame shape.
    const float NOISE_MEAN = 0.57;      // The median of the flame fbm.
    const float NOISE_GAIN = 7.0;       // Gives the flame noise about -1 to 1 for 80% of the pixels.
    // The curl flow. A flow with no divergence rolls the flame shapes around vortices. A plain warp only bends them.
    const float CURL_FREQ = 0.55;       // The vortex frequency, relative to the flame noise.
    const float CURL_STEP = 0.24;       // The move of one step at Turbulence 1, in noise units for a unit slope.
    const float CURL_STEPS = 5.0;       // Small steps follow the curved flow. One large step only shifts the shapes.
    const float CURL_CHANGE = 0.3;      // The change of the vortices with time, in vortex units each second.
    const float TURBULENCE_SCALE = 0.5; // Turbulence 1 gives this curl force. A higher force only distorts the flames.
    const float NOISE_WEIGHT = 0.3;     // The effect of the noise on the flame height.
    const float AMOUNT_WEIGHT = 0.6;    // The effect of Flame Amount on the flame height.
    const float FLICKER_WEIGHT = 0.35;  // The effect of the flicker on the flame density.
    // The effect of the flicker on the flame size. The flicker is at most 0.22 from 1 at Flicker 1. See getBleed.
    const float FLICKER_REACH = 2.5;
    const float REACH_MIN = 0.5;
    const float REACH_MAX = 1.6;
    const float FLAME_SOFT = 0.15;      // The height change from no flame to a full flame.
    const float SIDE_MODE_SPEED = 0.05; // The Flame Speed that gives the full side view. Thus one slider step changes the view.

    // Tuning values of the view from above.
    const float TOP_FREQ = 2.0;         // The flame noise frequency, in noise units for each pattern unit.
    const float COLUMN_RADIUS = 0.8;    // The blur radius of the fire column, in flame lengths.
    const float TOP_DROP = 0.8;         // The height drop from the center of the column to its edge.
    const float TOP_OFFSET = 0.15;
    // Rising flames pull to the center of the fire. A flow map moves the noise to the center. It starts again at each cycle,
    // because a longer move stretches the noise. Two layers half a cycle apart hide the start.
    const float PULL_CYCLE = 0.5;       // The cycles each second.
    const float PULL_SPAN = 1.0;        // The move in one cycle, in flame lengths.
    const float PULL_GAIN = 3.0;        // Changes the slope of the blur to a move direction. A hard edge gives a full move.
    const float TOP_BOIL = 0.4;         // The octave lift of the view from above, in noise units each second. See liftFbm.

    // Tuning values of the side view.
    const float SIDE_FREQ = 2.2;
    const float SIDE_STRETCH = 0.45;    // The frequency along the flame direction, relative to across. A low value gives tall tongues.
    const float RISE_SPEED = 2.0;       // The rise of the noise at Flame Speed 1, in pattern units each second.
    const float SIDE_STEPS = 6.0;       // The mask samples behind the pixel.
    const float SWAY = 0.3;             // The maximum side lean of a tongue tip, in flame lengths.
    const float FUEL_BLUR = 0.06;       // The blur of the mask samples, in pattern units.
    const float SIDE_DROP = 0.6;
    const float SIDE_OFFSET = 0.2;
    // The flames move through the vortices, thus each lash bends and then straightens. Vortices that rise with the flames give rigid lashes.
    const float CURL_RISE = 0.4;        // The rise of the vortices, as a part of the flame rise.
    const float OCTAVE_LIFT = 0.35;     // The added rise of each higher octave, as a part of the flame rise. See liftFbm.
    const float WHIP = 1.5;             // The maximum side bend of the tongues past the mask, in noise units.
    const float BASE_GAP = 0.5;         // The flame drop at the base of the mask at Coal Bed 1. Thus the coals show below the flames.

    // Tuning values of the coals, the floating embers, and the color.
    const float COAL_FREQ = 5.0;        // The number of coal chunks along one pattern unit.
    const float EMBER_CELL = 0.35;      // The cell size of the floating embers, in pattern units. Each cell has a maximum of one ember.
    const float EMBER_DENSITY = 0.5;    // The part of the cells with an ember at Floating Embers 1.
    const float EMBER_LIFE = 0.45;      // The mean lives of an ember each second.
    const float EMBER_RISE = 2.0;       // The rise of an ember at Flame Speed 1, in pattern units each second.
    const float EMBER_SIZE = 0.035;     // The mean core radius, in pattern units.
    const float EMBER_REACH = 1.3;      // The side view embers go out before this distance, in flame lengths. See getBleed.
    const float EMBER = 0.55;           // The brightness of the coolest flame color.
    const float HOT_GAIN = 2.8;         // A higher value moves the hot color more to yellow.
    const float HEAT_GAIN = 1.8;        // Changes the flame height to the heat of the color ramp.
    const float FLAME_COVER = 0.45;     // The alpha of a full flame. The flame light adds to the map below.
    const float GLOW_LIGHT = 0.9;       // The brightness of the light past the mask.
    const float FALLOFF = 0.6;          // A higher value gives less light on a bright map pixel. See GlowShader.

    const mat2 OCTAVE_TURN = mat2(0.8, 0.6, -0.6, 0.8);

    // An octave noise from 0 to 1, with a maximum of 4 octaves.
    float fireFbm(vec2 p, int octaves, float gain) {
      float value = 0.0;
      float amp = 0.5;
      float total = 0.0;
      for ( int i = 0; i < 4; i++ ) {
        if ( i >= octaves ) break;
        value += noise(p) * amp;
        total += amp;
        p = (OCTAVE_TURN * p * 2.03) + 11.3;
        amp *= gain;
      }
      return value / total;
    }

    // The 4 octave fbm of fireFbm, with gain 0.55. Octave i moves by lift * i on the second axis before its turn and scale.
    // Thus the fine detail moves through the large shapes, and the shapes change but do not stretch.
    // stretch scales the second axis, for tall tongues in the side view.
    float liftFbm(vec2 q, float stretch, float lift) {
      float value = 0.0;
      float amp = 0.5;
      float total = 0.0;
      // The octave transform of fireFbm, i times: p -> OCTAVE_TURN * p * 2.03 + 11.3.
      mat2 turn = mat2(1.0);
      vec2 offset = vec2(0.0);
      for ( float i = 0.0; i < 4.0; i++ ) {
        vec2 o = vec2(q.x, (q.y - (lift * i)) * stretch);
        value += noise((turn * o) + offset) * amp;
        total += amp;
        turn = OCTAVE_TURN * turn * 2.03;
        offset = (OCTAVE_TURN * offset * 2.03) + 11.3;
        amp *= 0.55;
      }
      return value / total;
    }

    // The value noise of Foundry (x) and its slope (yz). The slope is exact, thus the curl flow has no divergence.
    vec3 noiseSlope(vec2 uv) {
      vec2 b = floor(uv);
      vec2 f = uv - b;
      vec2 u = f * f * (3.0 - (2.0 * f));
      vec2 du = 6.0 * f * (1.0 - f);
      float r00 = random(b);
      float r10 = random(b + vec2(1.0, 0.0));
      float r01 = random(b + vec2(0.0, 1.0));
      float r11 = random(b + vec2(1.0, 1.0));
      float k = r00 - r10 - r01 + r11;
      return vec3(
        r00 + ((r10 - r00) * u.x) + ((r01 - r00) * u.y) + (k * u.x * u.y),
        du.x * ((r10 - r00) + (k * u.y)),
        du.y * ((r01 - r00) + (k * u.x))
      );
    }

    // The flame shapes, with mean 0. The sample point moves along a curl flow, thus the shapes roll and curl.
    // The flow is isotropic. stretch then scales the second axis of the shapes, for tall tongues in the side view.
    // curlLift moves the vortices on the second axis. lift is the octave lift of liftFbm.
    float flameNoise(vec2 q, float stretch, float curlLift, float lift) {
      float force = CURL_STEP * turbulence * TURBULENCE_SCALE;
      if ( force > 0.0 ) {
        for ( float i = 0.0; i < CURL_STEPS; i++ ) {
          // Two octaves of vortices.
          vec2 c = (q + vec2(0.0, curlLift)) * CURL_FREQ;
          vec2 large = noiseSlope(c + vec2(5.2, 1.3 + (phase * CURL_CHANGE))).yz;
          vec2 small = noiseSlope((c * 2.1) + vec2(9.1 - (phase * CURL_CHANGE * 0.8), 2.7)).yz;
          vec2 slope = large + (small * 0.5);
          q += vec2(slope.y, -slope.x) * force;
        }
      }
      return (liftFbm(q, stretch, lift) - NOISE_MEAN) * NOISE_GAIN;
    }

    // A value near 1. The position input gives separate fires on one tile a different flicker.
    float fireFlicker(vec2 p) {
      vec2 q = p * 0.3;
      float slow = (noise(q + vec2(phase * 2.3, 0.5)) * 2.0) - 1.0;
      float fast = (noise(q + vec2(phase * 7.1, 3.5)) * 2.0) - 1.0;
      return 1.0 - (flickerAmount * ((slow * 0.15) + (fast * 0.07)));
    }

    // The scale of the flame size for a flicker value.
    float flickerReach(float flick) {
      return clamp(1.0 + ((flick - 1.0) * FLICKER_REACH), REACH_MIN, REACH_MAX);
    }

    // The color ramp, from a dark ember through the effect color and a hot color to white.
    // The gain raises the middle channels the most. Thus the hue goes to the next bright hue, and a blue fire has no red.
    vec3 heatColor(float heat) {
      vec3 warm = sqrt(effectColor);
      vec3 hot = min(warm + ((1.0 - warm) * warm * warm * HOT_GAIN), vec3(1.0));
      vec3 color = mix(effectColor * effectColor * EMBER, effectColor, smoothstep(0.0, 0.35, heat));
      color = mix(color, hot, smoothstep(0.35, 0.75, heat));
      return mix(color, vec3(1.0), smoothstep(0.95, 1.3, heat) * 0.8);
    }

    // x: a blur of the mask. yz: the slope of the blur, which points to the center of the fire. Two rings give the slope.
    // The ring directions are in pattern axes, because the radius has the same pattern length on the two axes.
    vec3 columnBlur(vec2 radius) {
      float lod = maskBlurLod(radius * 0.5);
      float inner = 0.0;
      float outer = 0.0;
      vec2 innerSlope = vec2(0.0);
      vec2 outerSlope = vec2(0.0);
      for ( float i = 0.0; i < 6.0; i++ ) {
        float angle = i * (TWOPI / 6.0);
        vec2 dir = vec2(cos(angle), sin(angle));
        float value = maskAlpha(vUvs + (dir * radius * 0.5), lod);
        inner += value;
        innerSlope += dir * value;
      }
      for ( float i = 0.0; i < 12.0; i++ ) {
        float angle = (i + 0.5) * (TWOPI / 12.0);
        vec2 dir = vec2(cos(angle), sin(angle));
        float value = maskAlpha(vUvs + (dir * radius), lod);
        outer += value;
        outerSlope += dir * value;
      }
      // Gaussian weights with a width of half the radius.
      const float W_INNER = 0.61;
      const float W_OUTER = 0.135;
      float blur = (maskAlpha(vUvs, lod) + (inner * W_INNER) + (outer * W_OUTER)) / (1.0 + (6.0 * W_INNER) + (12.0 * W_OUTER));
      return vec3(blur, ((innerSlope / 6.0) * 0.5) + (outerSlope / 12.0));
    }

    // The flame height in the view from above. column.x is the blur, and core gets the hot center.
    float topFlames(vec2 p, vec3 column, float flick, out float core) {
      float blur = column.x;
      core = smoothstep(0.55, 1.0, blur) * flick;
      if ( blur < 0.06 ) return -1.0;

      // The move length goes to 0 with the slope. Thus the noise has no seam at the center line of a long strip.
      vec2 pull = column.yz * PULL_GAIN;
      pull /= max(length(pull), 1.0);
      float span = PULL_SPAN * flameLength;
      float n = 0.0;
      float weights = 0.0;
      for ( float i = 0.0; i < 2.0; i++ ) {
        float cycle = (phase * PULL_CYCLE) + (i * 0.5);
        float tau = fract(cycle);
        float weight = 1.0 - abs((2.0 * tau) - 1.0);
        // A new seed at each cycle, at weight 0. Thus the pattern does not repeat. The seed is small, for float precision.
        vec2 seed = fract((floor(cycle) * vec2(0.3183, 0.2357)) + (i * 0.37)) * 100.0;
        // The octaves turn, thus each octave lifts in a different direction, and the flames boil in place.
        n += weight * flameNoise(((p - (pull * tau * span)) * TOP_FREQ) + seed, 1.0, 0.0, phase * TOP_BOIL);
        weights += weight * weight;
      }
      // A mix of two noises has less contrast. This division gives back the contrast of one noise.
      n /= sqrt(weights);

      // The flicker scales the column, thus the flames grow to the edge and fall back. The gate below does not change, for the bleed.
      float height = ((smoothstep(0.02, 0.75, blur * flickerReach(flick)) - 1.0) * TOP_DROP) + TOP_OFFSET;
      height += (n * NOISE_WEIGHT) + ((flameAmount - 0.5) * AMOUNT_WEIGHT) + ((flick - 1.0) * FLICKER_WEIGHT);
      // No flame far from the mask, thus the flames stay in the bleed of getBleed.
      return height - ((1.0 - smoothstep(0.06, 0.2, blur)) * 0.5);
    }

    // The flame height in the side view. The fuel is the highest mask value behind the pixel, less for a far sample.
    // Thus the tongues go past the mask in the flame direction. base gets the mask at the pixel, for the hot core.
    float sideFlames(vec2 p, vec2 dir, vec2 uvPerUnit, float flick, out float base) {
      vec2 perp = vec2(-dir.y, dir.x);
      float along = dot(p, dir);
      float lod = maskBlurLod(uvPerUnit * FUEL_BLUR);
      // The tongues lean to the side. The lean grows with the distance from the mask.
      float sway = (noise(vec2((along * 1.2) - (phase * flameSpeed * 1.5), phase * 0.7)) - 0.5) * 2.0 * SWAY;
      // The flicker makes the tongues longer and shorter.
      float reach = flameLength * flickerReach(flick);
      float fuel = 0.0;
      // The mean mask behind the pixel. It is low at the base of the mask, where the coals show.
      float body = 0.0;
      base = 0.0;
      for ( float k = 0.0; k <= SIDE_STEPS; k++ ) {
        float f = k / SIDE_STEPS;
        vec2 back = (dir + (perp * sway)) * f * reach;
        float value = maskAlpha(vUvs - (back * uvPerUnit), lod);
        if ( k == 0.0 ) base = value;
        else body += value / SIDE_STEPS;
        fuel = max(fuel, value * (1.0 - f));
      }
      if ( fuel <= 0.02 ) return -1.0;

      // The whip bends the tongues past the mask. The bend moves up the tongue and changes with time.
      float whip = (noise(vec2((along * 1.5) - (phase * flameSpeed * 3.0), phase * 2.0)) - 0.5) * WHIP * (1.0 - smoothstep(0.5, 1.0, fuel));
      float riseQ = phase * flameSpeed * RISE_SPEED * SIDE_FREQ;
      vec2 q = vec2((dot(p, perp) * SIDE_FREQ) + whip, (along * SIDE_FREQ) - riseQ);
      float height = ((fuel - 1.0) * SIDE_DROP) + SIDE_OFFSET;
      height += flameNoise(q, SIDE_STRETCH, riseQ * (1.0 - CURL_RISE), riseQ * OCTAVE_LIFT) * NOISE_WEIGHT;
      height += ((flameAmount - 0.5) * AMOUNT_WEIGHT) + ((flick - 1.0) * FLICKER_WEIGHT);
      // Only in the mask, thus the flames above a thin mask stay.
      height -= (1.0 - body) * emberAmount * BASE_GAP * base;
      base *= flick;
      return height - ((1.0 - smoothstep(0.0, 0.15, fuel)) * 0.3);
    }

    // The coal bed below the flames: dark chunks with a glow in the gaps and gray ash. Premultiplied, with alpha up to s.
    // soft is a softer mask, thus the edge of the bed is not the hard painted edge.
    vec4 coalBed(vec2 p, float s, float soft) {
      vec2 e = p * COAL_FREQ;
      e += (vec2(noise(e * 0.7), noise((e * 0.7) + vec2(3.3, 0.0))) - 0.5) * 0.9;
      vec3 cells = voronoiCells(e, 0.0);
      float gap = 0.35 + (smoothstep(0.25, 0.0, cells.y - cells.x) * 0.3) + (smoothstep(0.2, 0.7, cells.x) * 0.35);
      float glowPatch = smoothstep(0.45, 0.75, fireFbm((e * 0.7) + vec2(5.0, -phase * 0.04), 3, 0.5));
      float fine = fireFbm((e * 2.5) + vec2(0.0, phase * 0.1), 2, 0.5);
      float pulse = 0.75 + (0.25 * sin((phase * 1.1) + (fireFbm(e * 0.5, 2, 0.5) * 12.0)));
      float edge = (noise((p * 3.1) + vec2(9.0, 0.0)) - 0.5) * 0.5;
      float bed = smoothstep(0.35, 0.8, soft + edge);
      float heat = gap * (0.35 + (0.8 * glowPatch)) * (0.7 + (0.6 * fine)) * pulse * bed * emberAmount;
      float alpha = smoothstep(0.15, 0.55, soft + edge) * s * min(emberAmount * 1.5, 1.0) * 0.9;
      float ash = smoothstep(0.55, 0.8, fireFbm((e * 1.6) + vec2(1.0, 0.0), 3, 0.5)) * (1.0 - smoothstep(0.0, 0.3, heat));
      vec3 charcoal = vec3(0.04 + (0.06 * smoothstep(0.5, 0.0, cells.x)) + (0.3 * ash)) * vec3(1.0, 0.95, 0.9);
      vec3 color = charcoal +(heatColor(heat) * smoothstep(0.05, 0.5, heat));
      return vec4(color * alpha, alpha);
    }

    // The light of the floating embers: glowing bits that float up on the hot air, cool from orange to dark red, and go out.
    // In the side view, the cells move in the flame direction, and a fast ember is a short streak.
    // In the view from above, an ember rises to the camera, thus it only floats a short curved path.
    // The search reads 3 x 3 cells, thus an ember can float out of its cell.
    vec3 floatingEmbers(vec2 p, vec2 dir, vec2 uvPerUnit, float side) {
      vec2 perp = vec2(-dir.y, dir.x);
      float rise = flameSpeed * EMBER_RISE * side;
      vec2 shift = dir * rise * phase;
      vec2 q = (p - shift) / EMBER_CELL;
      vec2 home = floor(q);
      float streak = 1.0 + (side * min(flameSpeed, 1.0) * 1.5);
      vec3 total = vec3(0.0);
      for ( float y = -1.0; y <= 1.0; y++ ) {
        for ( float x = -1.0; x <= 1.0; x++ ) {
          vec2 cell = home + vec2(x, y);
          vec2 hash = cellHash(cell);
          if ( fract((hash.x * 13.0) + (hash.y * 7.0)) > (sparkAmount * EMBER_DENSITY) ) continue;

          float rate = EMBER_LIFE * (0.6 + (0.8 * hash.y));
          float age = (phase * rate) + hash.x;
          float life = fract(age);
          // Each life has a new start point and path.
          vec2 seed = cellHash(cell + (fract(floor(age) * vec2(0.1731, 0.2113)) * 1000.0));
          float wave1 = sin((life * 5.0) + (seed.y * 6.0));
          float wave2 = sin((life * 4.0) + (seed.x * 6.0));
          // From above: a drift in a random direction, with a meander.
          float angle = seed.x * TWOPI;
          vec2 topPath = (vec2(cos(angle), sin(angle)) * life * 0.35) + (vec2(wave1, wave2) * 0.2);
          // Side: a sway across the rise, and a small change of the rise speed.
          vec2 sidePath = (perp * ((wave1 * 0.3) + ((seed.x - 0.5) * life * 0.6))) + (dir * (seed.y - 0.5) * life * 0.8);
          vec2 start = cell + 0.5 + ((seed - 0.5) * 0.5);
          vec2 delta = (q - start - mix(topPath, sidePath, side)) * EMBER_CELL;
          vec2 local = vec2(dot(delta, dir) / streak, dot(delta, perp));
          float dist2 = dot(local, local);
          // An ember gets smaller as it burns. A soft halo is around the hot core.
          float size = EMBER_SIZE * (0.6 + (0.8 * seed.y)) * (1.0 - (0.4 * life));
          float shape = exp(-dist2 / (size * size)) + (0.3 * exp(-dist2 / (9.0 * size * size)));
          if ( shape < 0.01 ) continue;

          // An ember shows only if it started in the painted area.
          float travel = rise * (life / rate);
          vec2 origin = (start * EMBER_CELL) + shift - (dir * travel);
          float fuel = maskAlpha(vUvs + ((origin - p) * uvPerUnit), 0.0);
          float reach = 1.0 - smoothstep(0.6, 1.0, travel / (flameLength * EMBER_REACH));
          // The air flow over an ember makes it glow and dim slowly.
          float glow = 0.65 + (0.35 * sin((phase * (4.0 + (4.0 * seed.x))) + (seed.y * 20.0)));
          float heat = mix(0.75, 0.15, life) * glow;
          float fade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
          total += heatColor(heat) * shape * (0.4 + heat) * fade * smoothstep(0.3, 0.7, fuel) * reach;
        }
      }
      return total;
    }

    vec4 _main() {
      float s = maskAlpha(vUvs, 0.0);
      vec2 p = patternPos();
      vec2 uvPerUnit = vec2(gridSize * patternScale) / tileSize;
      float flowRadians = radians(flowAngle);
      vec2 dir = vec2(cos(flowRadians), sin(flowRadians));
      // 0: the view from above. 1: the side view.
      float side = clamp(flameSpeed / SIDE_MODE_SPEED, 0.0, 1.0);
      float flick = fireFlicker(p);

      // The flame height and the core heat of the two views.
      float height = -1.0;
      float core = 0.0;
      float soft = s;
      if ( side < 1.0 ) {
        vec3 column = columnBlur(vec2(COLUMN_RADIUS * flameLength) * uvPerUnit);
        soft = 0.5 * (s + column.x);
        height = topFlames(p, column, flick, core);
      }
      if ( side > 0.0 ) {
        float sideCore;
        float sideHeight = sideFlames(p, dir, uvPerUnit, flick, sideCore);
        height = mix(height, sideHeight, side);
        core = mix(core, sideCore, side);
      }

      // The light past the mask. A full mask area does not read the blur.
      float blur = 0.0;
      if ( (glowRadius > 0.0) && (s < 1.0) ) blur = maskBlur(vec2(glowRadius) * uvPerUnit);
      vec3 spark = sparkAmount > 0.0 ? floatingEmbers(p, dir, uvPerUnit, side) : vec3(0.0);
      if ( (height <= 0.0) && (s <= 0.0) && (blur <= 0.0) && (max(spark.r, max(spark.g, spark.b)) <= 0.0) ) return vec4(0.0);

      float cover = min(intensity, 1.0);
      vec4 coal = ((s > 0.0) && (emberAmount > 0.0)) ? coalBed(p, s, soft) * cover : vec4(0.0);

      float flame = smoothstep(0.0, FLAME_SOFT, height);
      float heat = clamp((height * HEAT_GAIN) + (core * coreHeat * 0.5 * smoothstep(0.0, 0.3, height)), 0.0, 1.3);
      vec3 flameLight = heatColor(heat) * (0.3 + (0.9 * smoothstep(0.0, 1.0, heat))) * flame * intensity;
      float flameAlpha = flame * FLAME_COVER * cover;

      vec4 base = sampleBase(vUvs);
      vec3 light = effectColor * blur * (1.0 - s) * GLOW_LIGHT * glowLight * intensity * flick;
      // Screen-like falloff: a bright map pixel gets less light, so bright areas do not become flat white.
      light *= 1.0 - (FALLOFF * min(base.rgb, vec3(1.0)));

      // The flames are over the coals. The flame light and the floating embers have more color than alpha, thus the blend adds them to the map.
      vec3 color = flameLight + (coal.rgb * (1.0 - flameAlpha)) + light + (spark * intensity);
      float alpha = flameAlpha + (coal.a * (1.0 - flameAlpha));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(min(color, vec3(1.0)), alpha) * tintAlpha.a;
    }
  `;
  }
}
