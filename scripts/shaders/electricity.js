import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/** The size of the arc uniform arrays. It is also the max of arcCount in EFFECTS. */
const MAX_ARCS = 7;

/** The longer side of the mask copy that selects the arc end points. */
const MASK_SAMPLE_SIZE = 512;

// Tuning values of the arc selection. The arc length is relative to arcLength.
const SLOT_RATE = 1.5;                 // The strikes of one arc each second, at Animation Speed 1.
const ARC_MIN = 0.6;                   // The arc length: ARC_MIN to ARC_MIN + ARC_SPREAD.
const ARC_SPREAD = 0.6;
const PATH_CHECKS = [0.25, 0.5, 0.75, 1];  // These points of an arc must be in the mask, thus an arc does not jump over a gap.
const LENGTH_TRIES = [1, 0.6, 0.35];   // A shorter arc fits in a thin stroke.
const ANGLE_TRIES = 8;

/** A low-resolution copy of each mask, or null if the mask cannot be read. */
const maskSamples = new WeakMap();

/**
 * Copy the mask values into a small array, and list the painted pixels. The arc end points come from this copy.
 * @param {PIXI.BaseTexture} baseTexture
 * @returns {{width: number, height: number, values: Uint8Array, painted: Uint32Array}|null}
 */
function getMaskSample(baseTexture) {
  if ( maskSamples.has(baseTexture) ) return maskSamples.get(baseTexture);
  const source = baseTexture.resource?.source;
  // Do not keep null for a texture that still loads.
  if ( !baseTexture.valid || !source ) return null;
  let sample = null;
  try {
    const fit = Math.min(1, MASK_SAMPLE_SIZE / Math.max(baseTexture.realWidth, baseTexture.realHeight));
    const width = Math.max(Math.round(baseTexture.realWidth * fit), 1);
    const height = Math.max(Math.round(baseTexture.realHeight * fit), 1);
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    context.canvas.width = width;
    context.canvas.height = height;
    context.drawImage(source, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const values = new Uint8Array(width * height);
    const painted = [];
    for ( let i = 0; i < values.length; i++ ) {
      // The same value as maskValue in the shader.
      values[i] = Math.min(data[i * 4], data[(i * 4) + 3]);
      if ( values[i] > 127 ) painted.push(i);
    }
    sample = { width, height, values, painted: Uint32Array.from(painted) };
  } catch(err) {
    console.error(err);
  }
  maskSamples.set(baseTexture, sample);
  return sample;
}

function isPainted(sample, u, v) {
  if ( (u < 0) || (u >= 1) || (v < 0) || (v >= 1) ) return false;
  return sample.values[(Math.floor(v * sample.height) * sample.width) + Math.floor(u * sample.width)] > 127;
}

/** A random generator with a seed (mulberry32). The same seed gives the same arc on each frame of its slot. */
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Find an arc end in the mask. Try other directions, then shorter arcs.
 * @returns {number[]|null}  The end point in mask UV, or null if no arc fits.
 */
function findArcEnd(sample, ax, ay, angle, lengthX, lengthY) {
  for ( const factor of LENGTH_TRIES ) {
    for ( let k = 0; k < ANGLE_TRIES; k++ ) {
      const a = angle + ((k * 2 * Math.PI) / ANGLE_TRIES);
      const dx = Math.cos(a) * lengthX * factor;
      const dy = Math.sin(a) * lengthY * factor;
      if ( PATH_CHECKS.every(t => isPainted(sample, ax + (dx * t), ay + (dy * t))) ) return [ax + dx, ay + dy];
    }
  }
  return null;
}

/**
 * Select the arcs of this frame, and write them to the arcEnds and arcInfo uniforms.
 * Each arc index shows one arc at a time. At the end of its slot, it strikes again at a new place.
 * The shader cannot select points in the mask, because each pixel would need many mask reads.
 */
function writeArcs(uniforms, mesh) {
  const ends = uniforms.arcEnds;
  const info = uniforms.arcInfo;
  info.fill(0);
  const baseTexture = mesh.texture?.baseTexture;
  const sample = (baseTexture && !baseTexture.destroyed) ? getMaskSample(baseTexture) : null;
  if ( !sample?.painted.length ) return;
  const { params, scale } = mesh.fx;
  const count = Math.clamp(Math.round(params.arcCount), 0, MAX_ARCS);
  const unit = canvas.dimensions.size * scale;
  const uvPerUnitX = unit / mesh.tileSize.width;
  const uvPerUnitY = unit / mesh.tileSize.height;
  for ( let i = 0; i < count; i++ ) {
    // Each index has its own rate and offset, thus the arcs do not strike at the same time.
    const indexRandom = seededRandom((i * 7919) + 17);
    const rate = SLOT_RATE * (0.8 + (0.4 * indexRandom()));
    const slotTime = (mesh.phase * rate) + indexRandom();
    const slot = Math.floor(slotTime);
    const random = seededRandom(Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(slot, 0x85EBCA6B));
    const start = sample.painted[Math.floor(random() * sample.painted.length)];
    const ax = ((start % sample.width) + random()) / sample.width;
    const ay = (Math.floor(start / sample.width) + random()) / sample.height;
    const length = params.arcLength * (ARC_MIN + (ARC_SPREAD * random()));
    const end = findArcEnd(sample, ax, ay, random() * 2 * Math.PI, length * uvPerUnitX, length * uvPerUnitY);
    if ( !end ) continue;
    const j = i * 4;
    ends[j] = ax;
    ends[j + 1] = ay;
    ends[j + 2] = end[0];
    ends[j + 3] = end[1];
    info[j] = slotTime - slot;
    info[j + 1] = random();
    info[j + 2] = random();
    info[j + 3] = 1;
  }
}

/**
 * The electricity effect: a set number of jagged arcs jump between points in the painted area, over small crackling sparks.
 * The output alpha is 0, thus the premultiplied blend adds the light to the map.
 * A halo can go past the tile frame, because getBleed makes the mesh larger than the frame.
 */
export class ElectricityShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("electricity"),
    // Plain arrays, because Foundry clones them for each shader. A typed array would be shared by all meshes.
    arcEnds: new Array(MAX_ARCS * 4).fill(0),
    arcInfo: new Array(MAX_ARCS * 4).fill(0)
  };

  /** @override */
  static getBleed(fx) {
    const { glowRadius, arcWidth } = fx.params;
    const halo = glowRadius > 0 ? this.getHaloBleed(glowRadius, fx) : 0;
    // The arc glow goes past the mask by about two glow widths (ARC_GLOW_WIDTH).
    return Math.max(halo, 2 * 0.05 * arcWidth * fx.scale);
  }

  /** @override */
  _preRender(mesh, renderer) {
    super._preRender(mesh, renderer);
    writeArcs(this.uniforms, mesh);
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.STABLE_PRNG}
    ${this.NOISE}
    ${this.VORONOI_CELLS}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.electricity.params).
    uniform float arcCount;           // writeArcs reads it. The shader reads arcInfo.
    uniform float arcLength;
    uniform float arcWidth;
    uniform float jaggedness;
    uniform float branchAmount;
    uniform float crackleAmount;
    uniform float glowRadius;
    uniform float glowLight;

    // The arcs of this frame, from writeArcs.
    uniform vec4 arcEnds[${MAX_ARCS}];  // The two end points in mask UV.
    uniform vec4 arcInfo[${MAX_ARCS}];  // x: the life in the slot (0 to 1). y: the path seed. z: the branch seed. w: 1 if the arc shows.

    const int MAX_ARCS = ${MAX_ARCS};

    // Tuning values of the arcs.
    const float JITTER_RATE = 14.0;       // The fine shape and the brightness of the arcs change this many times each second.
    const float JAG_AMP = 0.15;           // The maximum side shift at Jaggedness 1, in arc lengths.
    const float JAG_SEGMENTS = 4.0;       // The straight segments of the coarse octave.
    const float CORE_WIDTH = 0.012;       // The white core width at Arc Width 1, in pattern units.
    const float ARC_GLOW_WIDTH = 0.05;    // The color glow width at Arc Width 1, in pattern units. See getBleed.
    const float CORE_LIGHT = 1.4;
    const float ARC_GLOW = 0.7;
    const float CORE_WHITE = 0.85;        // The core color moves this much to white.
    const float STRIKE_FLASH = 1.5;       // The added light at the start of an arc.
    const float BRANCH_MAX = 0.4;         // The branch length in main arc lengths: 0.25 to BRANCH_MAX.
    // Tuning values of the crackle. The sparks strike and go out with no drift, thus they do not look like a liquid.
    const float CRACKLE_CELL = 0.4;       // The cell size of the sparks, in pattern units.
    const float CRACKLE_RATE = 6.0;       // The strikes of one cell each second.
    const float CRACKLE_CHANCE = 0.4;     // The part of the strikes with a spark at Crackle 1.
    const float CRACKLE_JAG = 0.3;
    const float CRACKLE_GLOW_WIDTH = 0.02;
    const float CRACKLE_LIGHT = 0.8;
    // Tuning values of the halo.
    const float HALO_GAIN = 5.0;          // A higher value makes the halo of a thin stroke stronger. See GlowShader.
    const float HALO_LIGHT = 0.45;
    const float HALO_BASE = 0.25;         // The halo light with no arc near.
    const float FALLOFF = 0.6;            // A higher value gives less light on a bright map pixel. See GlowShader.

    // Linear noise from -1 to 1, and its slope. The straight segments give the sharp kinks of a spark.
    vec2 kinkNoise(float x, float seed) {
      float i = floor(x);
      float a = random(vec2(i, seed));
      float b = random(vec2(i + 1.0, seed));
      return vec2((mix(a, b, x - i) * 2.0) - 1.0, (b - a) * 2.0);
    }

    // The side shift of an arc path at t (0 to 1), about -1 to 1, and its slope for t.
    // sin(PI * t) keeps the two ends on the end points. The fine octaves change at JITTER_RATE, thus the arc crawls.
    vec2 arcShift(float t, float seed, float jitter) {
      float x = t * JAG_SEGMENTS;
      vec2 n = (kinkNoise(x, seed) * vec2(0.5, 0.5 * JAG_SEGMENTS))
        + (kinkNoise((x * 2.0) + 3.7, seed + 17.0) * vec2(0.27, 0.54 * JAG_SEGMENTS))
        + (kinkNoise((x * 4.0) + 1.3, jitter) * vec2(0.15, 0.6 * JAG_SEGMENTS))
        + (kinkNoise((x * 8.0) + 5.1, jitter + 29.0) * vec2(0.08, 0.64 * JAG_SEGMENTS));
      float envelope = sin(PI * t);
      return vec2(n.x * envelope, (n.y * envelope) + (n.x * PI * cos(PI * t)));
    }

    // The distance from q to a jagged path from a to b, in the units of q. t is the position of q along the path (0 to 1 on the path).
    float arcDistance(vec2 q, vec2 a, vec2 b, float amp, float seed, float jitter, out float t) {
      vec2 d = b - a;
      float len = length(d);
      vec2 dir = d / len;
      vec2 rel = q - a;
      t = dot(rel, dir) / len;
      float tc = clamp(t, 0.0, 1.0);
      vec2 shift = arcShift(tc, seed, jitter) * amp;
      // A steep part of the path is thinner across the segment. The slope corrects the width.
      float across = (dot(rel, vec2(-dir.y, dir.x)) - (shift.x * len)) / sqrt(1.0 + (shift.y * shift.y));
      float past = (t - tc) * len;
      return sqrt((across * across) + (past * past));
    }

    // The white core and the color glow of a path at a distance in pattern units.
    vec3 arcLight(float dist, float coreWidth, float coreGain, float glowWidth) {
      float core = exp(-(dist * dist) / (coreWidth * coreWidth)) * coreGain;
      float glow = exp(-dist / glowWidth);
      return (mix(effectColor, vec3(1.0), CORE_WHITE) * core * CORE_LIGHT) + (effectColor * glow * ARC_GLOW);
    }

    // The light of the arcs from writeArcs. unitsPerUv changes a mask UV to pattern units.
    // activity is the flash of the arcs near p, for the halo.
    vec3 arcs(vec2 p, float coreWidth, float coreGain, vec2 unitsPerUv, out float activity) {
      float glowWidth = ARC_GLOW_WIDTH * arcWidth;
      float amp = jaggedness * JAG_AMP;
      float jitterStep = floor(phase * JITTER_RATE);
      float haloReach = glowRadius + 0.5;
      vec3 total = vec3(0.0);
      activity = 0.0;

      for ( int i = 0; i < MAX_ARCS; i++ ) {
        vec4 info = arcInfo[i];
        if ( info.w < 0.5 ) continue;
        vec2 a = arcEnds[i].xy * unitsPerUv;
        vec2 b = arcEnds[i].zw * unitsPerUv;
        float life = info.x;
        // A fast strike, a hold, and a fade just before the next strike of this arc. A random flicker at JITTER_RATE.
        float flash = smoothstep(0.0, 0.02, life) * (1.0 - smoothstep(0.75, 0.95, life)) * (1.0 + (STRIKE_FLASH * exp(-life * 12.0)));
        flash *= 0.6 + (0.4 * random(vec2(jitterStep, info.y * 517.0)));

        // The distance to the straight segment. A far arc gives only halo light.
        vec2 d = b - a;
        float len = max(length(d), 1e-4);
        vec2 rel = p - a;
        float segmentDist = length(rel - (d * clamp(dot(rel, d) / (len * len), 0.0, 1.0)));
        activity += flash * exp(-segmentDist / haloReach);
        if ( segmentDist > ((len * ((1.4 * amp) + BRANCH_MAX)) + (5.0 * glowWidth)) ) continue;

        float pathSeed = info.y * 523.0;
        float jitter = (info.y * 311.0) + (fract(jitterStep * 0.618034) * 1000.0);
        float t;
        vec3 light = arcLight(arcDistance(p, a, b, amp, pathSeed, jitter, t), coreWidth, coreGain, glowWidth);

        // One branch from a point on the main arc. It gets thinner to its tip.
        if ( info.z < branchAmount ) {
          float tb = 0.3 + (0.4 * fract(info.z * 11.0));
          vec2 perp = vec2(-d.y, d.x) / len;
          vec2 start = a + (d * tb) + (perp * arcShift(tb, pathSeed, jitter).x * amp * len);
          float branchSide = fract(info.z * 37.0) > 0.5 ? 1.0 : -1.0;
          float branchAngle = atan(d.y, d.x) + (branchSide * (0.4 + (0.6 * fract(info.z * 7.0))));
          float branchLen = len * mix(0.25, BRANCH_MAX, fract(info.z * 29.0));
          vec2 end = start + (vec2(cos(branchAngle), sin(branchAngle)) * branchLen);
          float bt;
          float branchDist = arcDistance(p, start, end, amp, pathSeed + 71.0, jitter + 53.0, bt);
          float taper = 1.0 - (0.7 * clamp(bt, 0.0, 1.0));
          light += arcLight(branchDist, coreWidth * taper, coreGain, glowWidth * taper) * mix(0.4, 1.0, branchAmount) * taper;
        }
        total += light * flash;
      }
      return total;
    }

    // Small sparks that strike at random points in the mask and go out fast. cellToUv changes a position in cells to a mask UV.
    // The search reads 3 x 3 cells. A spark stays within 1.2 cells of its cell center.
    vec3 crackle(vec2 p, float coreWidth, float coreGain, vec2 cellToUv) {
      vec2 q = p / CRACKLE_CELL;
      vec2 home = floor(q);
      float chance = CRACKLE_CHANCE * crackleAmount;
      vec3 total = vec3(0.0);
      for ( float y = -1.0; y <= 1.0; y++ ) {
        for ( float x = -1.0; x <= 1.0; x++ ) {
          vec2 cell = home + vec2(x, y);
          // Each cell has its own rate and offset, thus the sparks do not strike together.
          vec2 hash = cellHash(cell);
          float strikeTime = (phase * CRACKLE_RATE * (0.7 + (0.6 * hash.y))) + hash.x;
          float strike = floor(strikeTime);
          vec2 seed = cellHash(cell + (fract(strike * vec2(0.1731, 0.2113)) * 1000.0));
          if ( seed.x >= chance ) continue;
          vec2 seed2 = cellHash((seed * 517.0) + 3.1);
          vec2 center = cell + 0.5 + ((seed2 - 0.5) * 0.5);
          float angle = fract(seed2.x * 13.0) * TWOPI;
          vec2 halfSpark = vec2(cos(angle), sin(angle)) * (0.2 + (0.35 * seed2.y));
          float t;
          float dist = arcDistance(q, center - halfSpark, center + halfSpark, CRACKLE_JAG, seed2.x * 523.0, seed2.y * 311.0, t) * CRACKLE_CELL;
          if ( dist > (6.0 * CRACKLE_GLOW_WIDTH) ) continue;
          if ( maskAlpha(center * cellToUv, 0.0) <= 0.5 ) continue;
          float life = strikeTime - strike;
          float flash = smoothstep(0.0, 0.03, life) * exp(-life * 8.0);
          float core = exp(-(dist * dist) / (coreWidth * coreWidth)) * coreGain;
          float glow = exp(-dist / CRACKLE_GLOW_WIDTH);
          total += ((mix(effectColor, vec3(1.0), CORE_WHITE) * core) + (effectColor * glow * 0.5)) * flash;
        }
      }
      return total * mix(0.5, 1.0, crackleAmount) * CRACKLE_LIGHT;
    }

    vec4 _main() {
      vec2 p = patternPos();
      // fwidth needs uniform control flow, thus it is before the first return.
      float pixelSize = max(fwidth(p.x), fwidth(p.y));
      vec2 uvPerUnit = vec2(gridSize * patternScale) / tileSize;

      float s = maskAlpha(vUvs, 0.0);
      // The arc glow fades at the mask edge over one glow width, thus the edge does not cut the glow.
      float area = maskAlpha(vUvs, maskBlurLod(vec2(ARC_GLOW_WIDTH * arcWidth) * uvPerUnit));
      float blur = 0.0;
      if ( glowRadius > 0.0 ) blur = maskBlur(vec2(glowRadius) * uvPerUnit);
      if ( (area <= 0.0) && (blur <= 0.0) ) return vec4(0.0);

      // A core thinner than a pixel flickers as the camera moves. A wider core gets less light, thus the arc keeps its brightness.
      float coreWidth = max(CORE_WIDTH * arcWidth, 0.7 * pixelSize);
      float coreGain = (CORE_WIDTH * arcWidth) / coreWidth;
      float edge = smoothstep(0.0, 0.5, area);
      float activity;
      vec3 light = arcs(p, coreWidth, coreGain, 1.0 / uvPerUnit, activity) * edge;
      if ( (area > 0.0) && (crackleAmount > 0.0) ) light += crackle(p, coreWidth, coreGain, uvPerUnit * CRACKLE_CELL) * edge;

      // The halo flashes with the near arcs. Less halo in the mask, thus the arcs stay clear.
      float flash = HALO_BASE + min(activity, 1.5);
      light += effectColor * (1.0 - exp(-HALO_GAIN * blur)) * (1.0 - (0.5 * s)) * HALO_LIGHT * glowLight * flash;

      light *= intensity;
      // Screen-like falloff: a bright map pixel gets less light, so bright areas do not become flat white.
      light *= 1.0 - (FALLOFF * min(sampleBase(vUvs).rgb, vec3(1.0)));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(min(light, vec3(1.0)) * tintAlpha.a, 0.0);
    }
  `;
  }
}
