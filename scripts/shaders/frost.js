import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/** The maximum size of jagShift in GLSL. */
const JAG_REACH = 0.7;

/**
 * The frost effect: a sheet of ice with large deep and light areas, a fine straight grain, chalky white patches, and straight scratches and jagged cracks.
 * The scratches and the cracks are true line segments, because the contours of noise are curves, and ice lines are straight.
 * The grain has fixed directions that change softly from area to area. Thus the ice has no visible cells, and the grain does not curve.
 * The local mask level and the cover set the ice thresholds. A lower value opens holes in the sheet that fade slowly to the map (sheetAlpha), and a very low value shows only thin cracks.
 * A sudden change of the mask, for example the edge of a hole, has no threshold range. There, the ice fades to the map (iceEdge).
 * A soft fog drifts along the border of the mask, on the ice and on the map. It can go past the tile frame.
 * The ice has no time input, because a growth with time needs a start time that all clients share. Only the sparkles and the fog move.
 */
export class FrostShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("frost")
  };

  /**
   * The fog goes past the frame. The jags can also move the ice past the frame, by a maximum of 0.7 times the roughness.
   * @override
   */
  static getBleed(fx) {
    const { fogAmount, fogRadius, edgeRoughness } = fx.params;
    const fog = fogAmount > 0 ? this.getHaloBleed(fogRadius, fx) : 0;
    return fog + (edgeRoughness * JAG_REACH * fx.scale);
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.STABLE_PRNG}
    ${this.NOISE}
    ${this.VORONOI_CELLS}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.frost.params).
    uniform float frostCover;
    uniform float edgeRoughness;
    uniform float edgeFade;
    uniform float fogRadius;
    uniform float fogAmount;
    uniform float frostBlur;
    uniform float frostTint;
    uniform float ridgeAmount;
    uniform float sparkleAmount;

    // Tuning values of the large tone areas.
    const float ZONE_FREQ = 0.42;       // The number of deep and light areas along one pattern unit.
    const float ZONE_TONE = 1.3;        // The change of the tone from the areas.
    const float CLOUD_FREQ = 1.3;       // The number of clouds along one pattern unit.
    const float CLOUD_TONE = 0.95;      // The change of the tone from the clouds.

    // Tuning values of the grain. Each grain direction has three scales. The hard planes give the look of cut ice.
    const float GRAIN_AREA = 1.4;       // The number of areas with one grain direction along one pattern unit.
    const vec2 PLANE_FREQ = vec2(1.0, 7.0);    // The frequency of the hard planes, along and across the grain.
    const vec2 MID_FREQ = vec2(1.9, 17.0);     // The frequency of the middle grain, along and across the grain.
    const vec2 FINE_FREQ = vec2(3.2, 31.0);    // The frequency of the fine grain, along and across the grain.
    const float SPECKLE_FREQ = 30.0;    // The frequency of the fine speckle, which has no direction.
    const float PLANE_TONE = 0.12;      // The change of the tone from the hard planes.
    const float MID_TONE = 0.26;        // The change of the tone from the middle grain.
    const float FINE_TONE = 0.4;        // The change of the tone from the fine grain.
    const float SPECKLE_TONE = 0.3;     // The change of the tone from the fine speckle.

    // Tuning values of the white patches. The white is many small flecks, thus a patch does not look like smoke.
    const float PATCH_FREQ = 1.2;       // The number of white patches along one pattern unit.
    const float PATCH_START = 0.5;      // The patch noise where a white patch starts.
    const float PATCH_END = 0.76;       // The patch noise of a full white patch.
    const float FLECK_HIGH = 0.7;       // The fleck limit at the patch edge. A high limit gives few flecks.
    const float FLECK_LOW = 0.42;       // The fleck limit at the patch center.
    const float FLECK_SOFT = 0.3;       // The change from no fleck to a full fleck.
    const float PATCH_HAZE = 0.4;       // The soft white below the flecks.
    const float PATCH_WHITE = 0.9;      // The quantity of white in a full fleck.

    // Tuning values of the lines. Each cell has a maximum of one line. A line can reach one cell from its center, because the search reads 3 x 3 cells.
    // A width is a half width in pattern units. A chance is the part of the cells that has a line.
    const float CRACK_FREQ = 0.6;       // The number of crack cells along one pattern unit.
    const float CRACK_CHANCE = 0.65;
    const float CRACK_LINE = 0.005;
    const float CRACK_GLOW = 0.28;      // The added tone near a crack.
    const float CRACK_SOFT = 11.0;      // A higher value gives a thinner light around a crack.
    const float MEDIUM_FREQ = 1.7;      // The number of cells of the long scratches along one pattern unit.
    const float MEDIUM_CHANCE = 0.85;
    const float MEDIUM_LINE = 0.0032;
    const float SMALL_FREQ = 4.0;       // The number of cells of the short scratches along one pattern unit.
    const float SMALL_CHANCE = 0.9;
    const float SMALL_LINE = 0.0026;
    const float HAIR_FREQ = 9.0;        // The number of cells of the hair lines along one pattern unit.
    const float HAIR_CHANCE = 0.9;
    const float HAIR_LINE = 0.0022;
    const float VEIN_FREQ = 2.4;        // The number of cells of the dark veins along one pattern unit.
    const float VEIN_CHANCE = 0.85;
    const float VEIN_LINE = 0.006;
    const float VEIN_TONE = 0.4;        // The drop of the tone at a dark vein.
    const float LINE_SPREAD = 1.5;      // The change of the line direction from one line to the next, in radians.
    const float JAG_FREQ = 1.1;         // The number of jags along one pattern unit.
    const float JAG_SIZE = 0.09;        // The size of the jags on the cracks, in pattern units.

    // Tuning values of the threshold and the color.
    const float ICE_EDGE = 0.03;        // The half width of the change from no line to a line, in height units.
    const float ICE_NONE = 0.95;        // The threshold with no cover. No pixel is above it.
    const float ICE_ALL = -0.03;        // The threshold at full cover. It is ICE_EDGE below 0, thus height 0 has full ice.
    const float COVER_CURVE = 0.6;      // Below 1, a low mask alpha gets more ice. Thus a soft edge is not empty.
    const float SHEET_FREQ = 0.6;       // The number of thick and thin areas of the sheet along one pattern unit. They show only below full cover.
    const float SHEET_LOW = 0.3;        // The cloud value of the thinnest sheet. The clouds are rarely outside SHEET_LOW and SHEET_HIGH.
    const float SHEET_HIGH = 0.7;       // The cloud value of the thickest sheet.
    const float SHEET_FADE = 0.3;       // The half width of the fade from the sheet to the map, in height units. A higher value gives a slower fade.
    const float SHEET_GONE = 0.3;       // The cover where the sheet stops. Below it, only thin cracks show.
    const float DEEP_COLOR = 0.8;       // The brightness of the deepest color.
    const float TONE_BASE = 0.55;       // The mean tone. Above 0.5, the ice is mostly lighter than the effect color.

    // Tuning values of the map blur and the sparkles.
    const float BLUR_DIAGONAL = 0.7;    // The distance of the diagonal blur points, as a part of the radius.
    const float SPARKLE_FREQ = 7.0;     // The number of sparkle cells in one pattern unit.
    const float SPARKLE_CHANCE = 0.35;  // The part of the cells that has a sparkle.
    const float SPARKLE_RADIUS = 0.1;   // The radius of a sparkle, in sparkle cell units.
    const float SPARKLE_RATE = 1.1;     // The speed of the sparkle brightness, in radians each second.
    const float SPARKLE_SHARP = 10.0;   // A higher value gives shorter flashes.

    // Tuning values of the fog.
    const float FOG_FREQ = 0.9;         // The number of fog clouds along one pattern unit.
    const vec2 FOG_DRIFT_A = vec2(0.05, 0.02);   // The movement of the large clouds, in pattern units each second.
    const vec2 FOG_DRIFT_B = vec2(-0.03, 0.04);  // The movement of the small clouds, in a different direction. Thus the fog changes its shape.
    const float FOG_THIN = 0.25;        // The density at the thinnest part of a cloud. Above 0, the fog has no gaps on the border.
    const float FOG_MAX = 0.9;          // The maximum alpha of the fog. Thus the ice and the map always show a little.
    const float FOG_WHITE = 0.75;       // The quantity of white in the fog color.

    // Each octave turns, because octaves on the same axes give the value noise a square shape.
    const mat2 OCTAVE_TURN = mat2(0.8, 0.6, -0.6, 0.8);

    // The three grain directions: -35, 20, and 70 degrees. An area changes from A to B, or from B to C.
    // Each of these pairs has less than a right angle, because a right angle shows as a plaid where they mix.
    const mat2 GRAIN_A = mat2(0.819, -0.574, 0.574, 0.819);
    const mat2 GRAIN_B = mat2(0.94, 0.342, -0.342, 0.94);
    const mat2 GRAIN_C = mat2(0.342, 0.94, -0.94, 0.342);
    // A small turn of 7 degrees between the grain scales. Stretched noise follows its lattice, and with one lattice the rows show as a comb.
    const mat2 GRAIN_TILT = mat2(0.993, 0.122, -0.122, 0.993);

    // A piecewise straight shift, from about -0.7 to 0.7. It keeps a straight line straight between its corners.
    // Thus a crack or a mask edge gets sharp jags. A smooth noise shift gives waves.
    vec2 jagShift(vec2 pos) {
      vec2 large = (abs(fract((pos.yx * JAG_FREQ) + vec2(0.3, 0.7)) - 0.5) * 2.0) - 0.5;
      vec2 small = (abs(fract((OCTAVE_TURN * pos.yx * JAG_FREQ * 2.7) + vec2(0.1, 0.4)) - 0.5) * 2.0) - 0.5;
      return large + (small * 0.4);
    }

    // One ring of the edge blur. It adds to the weighted total, and it keeps the highest sample.
    void edgeRing(vec2 uv, vec2 radius, float count, float weight, float lod, inout float total, inout float peak) {
      float offset = (TWOPI / count) * 0.5 * radius.x / max(radius.x, radius.y);
      for ( float i = 0.0; i < count; i++ ) {
        float angle = (i * (TWOPI / count)) + offset;
        float value = maskAlpha(uv + (vec2(cos(angle), sin(angle)) * radius), lod);
        total += value * weight;
        peak = max(peak, value);
      }
    }

    // The mask at a position that the jags move. Thus the edge of the ice is rough.
    // x: the local mask level, the highest sample near the pixel. y: the fade of the ice, from 0 at a hard mask edge to 1 inside.
    // The ratio of the mean to the highest sample is near 1 on a soft or a flat mask, and 0.5 on a hard edge. Thus a low alpha keeps its
    // thin cracks, and only a sudden change fades. The level is 1 in the fade band of a hard edge, thus the band shows no holes of the sheet.
    vec2 iceEdge(vec2 pos) {
      vec2 uv = vUvs + (jagShift(pos) * edgeRoughness * gridSize * patternScale / tileSize);
      if ( edgeFade <= 0.0 ) return vec2(maskAlpha(uv, 0.0), 1.0);

      vec2 radius = vec2(edgeFade * gridSize * patternScale) / tileSize;
      float lod = maskBlurLod(radius * 0.5);
      // Two mip levels higher, one texel is two radii. Thus this read covers all the samples below, and most pixels stop here.
      float wide = maskAlpha(uv, lod + 2.0);
      if ( wide <= 0.0 ) return vec2(0.0);
      if ( wide >= 1.0 ) return vec2(1.0);

      float inner = exp(-0.25 / (2.0 * MASK_BLUR_SIGMA * MASK_BLUR_SIGMA));
      float outer = exp(-1.0 / (2.0 * MASK_BLUR_SIGMA * MASK_BLUR_SIGMA));
      float center = maskAlpha(uv, lod);
      float total = center;
      float peak = center;
      edgeRing(uv, radius * 0.5, 6.0, inner, lod, total, peak);
      edgeRing(uv, radius, 12.0, outer, lod, total, peak);
      if ( peak <= 0.0 ) return vec2(0.0);
      float mean = total / (1.0 + (inner * 6.0) + (outer * 12.0));
      return vec2(peak, smoothstep(0.5, 1.0, mean / peak));
    }

    // A line with a soft edge. A line that is thinner than a pixel stays one pixel wide, with a lower brightness.
    float brightLine(float dist, float halfWidth, float pixelSize) {
      float width = halfWidth + pixelSize;
      return (1.0 - smoothstep(0.0, width, dist)) * min((2.0 * halfWidth) / pixelSize, 1.0);
    }

    // A fine pattern at each pixel: x has hard planes, y has the middle grain, z has the fine grain. The mean of y and z is 0.
    vec3 grainLayer(vec2 p, vec2 fades) {
      vec2 mid = GRAIN_TILT * p;
      vec2 fine = GRAIN_TILT * mid;
      // A faded scale reads no noise. At a low zoom, this saves the most pixels.
      return vec3(smoothstep(0.47, 0.53, noise(p * PLANE_FREQ)),
        fades.x > 0.0 ? (noise((mid * MID_FREQ) + 3.7) - 0.5) * fades.x : 0.0,
        fades.y > 0.0 ? (noise((fine * FINE_FREQ) + 7.1) - 0.5) * fades.y : 0.0);
    }

    // The grain of the three directions. Each area has mostly one direction, with a soft change to the next direction.
    // A direction that turned with a noise value would bend and stretch the grain.
    vec3 iceGrain(vec2 pos, float pixelSize) {
      // At a low zoom, the grain fades. Else it flashes when the camera moves.
      vec2 fades = vec2(smoothstep(1.5, 4.0, 1.0 / (MID_FREQ.y * pixelSize)), smoothstep(1.5, 4.0, 1.0 / (FINE_FREQ.y * pixelSize)));
      float pick = noise((pos * GRAIN_AREA) + vec2(5.1, 2.3));
      float a = 1.0 - smoothstep(0.34, 0.5, pick);
      float c = smoothstep(0.5, 0.66, pick);
      float b = 1.0 - a - c;
      vec3 grain = vec3(0.0);
      if ( a > 0.0 ) grain += grainLayer(GRAIN_A * pos, fades) * a;
      if ( b > 0.0 ) grain += grainLayer(GRAIN_B * pos, fades) * b;
      if ( c > 0.0 ) grain += grainLayer(GRAIN_C * pos, fades) * c;
      return grain;
    }

    // The direction of the lines at a position. Near lines have near directions, thus the scratches make groups, as in real ice.
    // This uses sines and no noise, because each pixel asks for it many times.
    float lineAngle(vec2 pos) {
      return (1.6 * sin((pos.x * 0.61) + (1.3 * sin(pos.y * 0.43)))) + (1.3 * sin((pos.y * 0.83) + 1.7));
    }

    // One straight line in delta from its center. The line gets thinner and dimmer to its ends.
    // x: the distance from the line. y: the taper, 1 at the center and 0 at the ends.
    vec2 lineSegment(vec2 delta, float angle, float halfLength) {
      vec2 dir = vec2(cos(angle), sin(angle));
      float along = dot(delta, dir) / halfLength;
      return vec2(abs(dot(delta, vec2(-dir.y, dir.x))), max(1.0 - (along * along), 0.0));
    }

    // A layer of scratches, at most one for each cell. The result is the brightness.
    float scratchLayer(vec2 pos, float freq, float seed, float chance, float halfWidth, float pixelSize) {
      vec2 p = pos * freq;
      vec2 cell = floor(p);
      float result = 0.0;
      for ( float y = -1.0; y <= 1.0; y++ ) {
        for ( float x = -1.0; x <= 1.0; x++ ) {
          vec2 id = cell + vec2(x, y);
          vec2 hash = cellHash(id + seed);
          if ( fract(hash.x * 7.0) > chance ) continue;
          vec2 delta = p - (id + hash);
          float lengthValue = fract(hash.y * 5.0);
          float halfLength = mix(0.3, 1.0, lengthValue * lengthValue);
          // Most pixels are far from the line. Do not calculate the turn for them.
          if ( dot(delta, delta) >= (halfLength * halfLength) ) continue;
          float angle = lineAngle((id + hash) / freq) + ((fract(hash.y * 11.0) - 0.5) * LINE_SPREAD);
          vec2 line = lineSegment(delta, angle, halfLength);
          float width = halfWidth * freq * line.y;
          result = max(result, brightLine(line.x, width, pixelSize * freq) * line.y * mix(0.4, 1.0, fract(hash.x * 3.0)));
        }
      }
      return result;
    }

    // The long cracks. Each one is a line with one branch, and the jags make corners on them.
    // x: the brightness. y: the soft light near the cracks.
    vec2 crackLayer(vec2 pos, float pixelSize) {
      vec2 p = (pos + (jagShift(pos) * JAG_SIZE)) * CRACK_FREQ;
      vec2 cell = floor(p);
      vec2 result = vec2(0.0);
      for ( float y = -1.0; y <= 1.0; y++ ) {
        for ( float x = -1.0; x <= 1.0; x++ ) {
          vec2 id = cell + vec2(x, y);
          vec2 hash = cellHash(id + 41.0);
          if ( fract(hash.x * 7.0) > CRACK_CHANCE ) continue;
          vec2 center = id + hash;
          vec2 delta = p - center;
          // A crack and its branch reach less than one cell. Past this distance, the soft light is also near 0.
          if ( dot(delta, delta) >= 1.0 ) continue;
          float angle = lineAngle(center / CRACK_FREQ) + ((fract(hash.y * 11.0) - 0.5) * LINE_SPREAD);
          float halfLength = mix(0.55, 0.8, fract(hash.y * 5.0));
          vec2 trunk = lineSegment(delta, angle, halfLength);
          result.x = max(result.x, brightLine(trunk.x, CRACK_LINE * CRACK_FREQ * trunk.y, pixelSize * CRACK_FREQ) * trunk.y);
          result.y = max(result.y, exp(-(trunk.x / CRACK_FREQ) * CRACK_SOFT) * trunk.y);

          // The branch starts on the line and goes to one side. The sum of its reach is less than one cell, as the search needs.
          float side = (fract(hash.x * 3.0) - 0.5) * 0.8;
          float branchAngle = angle + (side > 0.0 ? 0.55 : -0.55);
          float branchHalf = 0.28 * halfLength / 0.8;
          vec2 start = vec2(cos(angle), sin(angle)) * side * halfLength;
          vec2 branchDelta = delta - start - (vec2(cos(branchAngle), sin(branchAngle)) * branchHalf);
          vec2 branch = lineSegment(branchDelta, branchAngle, branchHalf);
          result.x = max(result.x, brightLine(branch.x, CRACK_LINE * 0.6 * CRACK_FREQ * branch.y, pixelSize * CRACK_FREQ) * branch.y * 0.8);
        }
      }
      return result;
    }

    // Noise with three octaves. Its mean is 0.5.
    float softClouds(vec2 p) {
      float value = noise(p) * 0.5;
      p = (OCTAVE_TURN * p * 2.03) + 11.3;
      value += noise(p) * 0.3;
      p = (OCTAVE_TURN * p * 2.03) + 11.3;
      return value + (noise(p) * 0.2);
    }

    // x: the tone, from 0 (deep) to 1 (light). y: the white patches, from 0 to 1. z: the bright lines, from 0 to 1.
    // No value has a time input, thus the ice does not move.
    vec3 iceSurface(vec2 pos, float pixelSize) {
      vec3 grain = iceGrain(pos, pixelSize);
      vec2 crack = crackLayer(pos, pixelSize);
      float medium = scratchLayer(pos, MEDIUM_FREQ, 13.0, MEDIUM_CHANCE, MEDIUM_LINE, pixelSize);
      float small = scratchLayer(pos, SMALL_FREQ, 29.0, SMALL_CHANCE, SMALL_LINE, pixelSize);
      float hair = scratchLayer(pos, HAIR_FREQ, 53.0, HAIR_CHANCE, HAIR_LINE, pixelSize);
      float vein = scratchLayer(pos, VEIN_FREQ, 71.0, VEIN_CHANCE, VEIN_LINE, pixelSize);

      // At a low zoom, the speckle fades, the same as the grain.
      float speckle = (noise(pos * SPECKLE_FREQ) - 0.5) * smoothstep(1.5, 4.0, 1.0 / (SPECKLE_FREQ * pixelSize));
      // The turn hides the square lattice of the noise, which shows clearly at this large scale.
      float zone = noise((OCTAVE_TURN * pos * ZONE_FREQ) + vec2(7.3, 1.9));
      float clouds = softClouds((pos * CLOUD_FREQ) + vec2(2.7, 9.4));
      float tone = TONE_BASE + ((zone - 0.5) * ZONE_TONE) + ((clouds - 0.5) * CLOUD_TONE)
        + ((grain.x - 0.5) * PLANE_TONE) + (grain.y * MID_TONE) + (grain.z * FINE_TONE) + (speckle * SPECKLE_TONE) + (crack.y * CRACK_GLOW) - (vein * VEIN_TONE);

      // The patches are more in the light areas. The grain gives the flecks the same direction as the ice below them.
      // This area needs no fine shape, because the flecks give its detail. Thus two octaves are sufficient.
      vec2 patchPos = (pos * PATCH_FREQ) + vec2(4.1, 6.6);
      float patchValue = (noise(patchPos) * 0.62) + (noise((OCTAVE_TURN * patchPos * 2.03) + 11.3) * 0.38) + ((zone - 0.5) * 0.25) + (crack.y * 0.16);
      float patchArea = smoothstep(PATCH_START, PATCH_END, patchValue);
      float fleck = smoothstep(0.0, FLECK_SOFT, (grain.y * 0.2) + (grain.z * 1.2) + (speckle * 0.2) + 0.5 - mix(FLECK_HIGH, FLECK_LOW, patchArea));
      float white = patchArea * (PATCH_HAZE + ((PATCH_WHITE - PATCH_HAZE) * fleck));

      // The white patches have more scratches, thus a patch looks feathered.
      float scratches = max(medium * 0.85, max(small * 0.75, hair * 0.6)) * (0.75 + (0.5 * patchArea));
      float lines = min(max(crack.x, scratches), 1.0);
      return vec3(clamp(tone, 0.0, 1.0), white, lines);
    }

    // The alpha of the sheet of ice, from the cover. The height has no sudden steps and the threshold range is wide.
    // Thus a lower cover opens holes that fade slowly to the map. A height with steps, for example from Voronoi cells, gives hard hole edges.
    float sheetAlpha(vec2 pos, float cover) {
      // Do not calculate the clouds for a full sheet.
      if ( cover >= 1.0 ) return 1.0;
      if ( cover <= SHEET_GONE ) return 0.0;
      float height = clamp((softClouds((pos * SHEET_FREQ) + vec2(8.2, 3.6)) - SHEET_LOW) / (SHEET_HIGH - SHEET_LOW), 0.0, 1.0);
      // At the two ends of the threshold range, all heights are on one side of the fade.
      float threshold = mix(1.0 + SHEET_FADE, -SHEET_FADE, (cover - SHEET_GONE) / (1.0 - SHEET_GONE));
      return smoothstep(threshold - SHEET_FADE, threshold + SHEET_FADE, height);
    }

    // The color of the ice, from a deep color through the effect color to a light color.
    // The square and the square root of the effect color keep its hue.
    vec3 iceColor(float tone) {
      vec3 color = mix(effectColor * effectColor * DEEP_COLOR, effectColor, smoothstep(0.0, 0.5, tone));
      return mix(color, sqrt(effectColor), smoothstep(0.5, 1.0, tone));
    }

    // The map below the ice: the center and 8 fixed points. A random turn at each pixel would show as grain.
    // Do not use mipmaps here, because Foundry shares this texture with its own background mesh.
    // A point outside the map uses the center color. Thus the blur shows no dark line at the map edge.
    vec3 blurredMap(vec4 center) {
      vec3 color = unpremultiply(center);
      if ( frostBlur <= 0.0 ) return color;
      vec2 radius = vec2(frostBlur * gridSize * patternScale) / tileSize;
      vec3 centerColor = color;
      for ( float x = -1.0; x <= 1.0; x++ ) {
        for ( float y = -1.0; y <= 1.0; y++ ) {
          if ( (x == 0.0) && (y == 0.0) ) continue;
          float dist = (x * y) != 0.0 ? BLUR_DIAGONAL : 1.0;
          vec4 point = sampleBase(vUvs + (vec2(x, y) * radius * dist));
          color += point.a > 0.0 ? unpremultiply(point) : centerColor;
        }
      }
      return color / 9.0;
    }

    // Small points that flash at different times. A point has a position away from the cell edge, thus this reads only one cell.
    // The pixel size sets the minimum softness, so that a point does not flash when the camera moves at a low zoom.
    float sparkles(vec2 pos, float pixelSize) {
      vec2 cellPos = pos * SPARKLE_FREQ;
      vec2 cell = floor(cellPos);
      vec2 hash = cellHash(cell);
      float chance = fract(hash.x * 7.0);
      if ( chance > SPARKLE_CHANCE ) return 0.0;
      vec2 center = 0.25 + (0.5 * hash);
      vec2 delta = cellPos - cell - center;
      float size = SPARKLE_RADIUS + (pixelSize * SPARKLE_FREQ);
      float point = max(1.0 - (length(delta) / size), 0.0);
      // A thin cross gives a glint in place of a round dot.
      float glint = max(1.0 - (abs(delta.x * delta.y) * 400.0), 0.0) * max(1.0 - (length(delta) / (size * 2.5)), 0.0);
      float flash = pow(0.5 + (0.5 * sin((phase * SPARKLE_RATE) + (fract(hash.y * 11.0) * TWOPI))), SPARKLE_SHARP);
      // The light of a point spreads over the pixels at a low zoom, thus a smaller point is dimmer.
      return (point + glint) * flash * (SPARKLE_RADIUS / size);
    }

    // The alpha of the fog. The blur is 0.5 on a hard mask edge, and 0 or 1 away from it. Thus the fog follows the border on both sides.
    // This does not use the jags, because a fog has no sharp shape.
    float borderFog(vec2 pos) {
      if ( (fogRadius <= 0.0) || (fogAmount <= 0.0) ) return 0.0;
      float blur = maskBlurCoarse(vec2(fogRadius * gridSize * patternScale) / tileSize);
      float band = 1.0 - abs((2.0 * blur) - 1.0);
      if ( band <= 0.0 ) return 0.0;
      vec2 p = pos * FOG_FREQ;
      float clouds = (softClouds(p + (FOG_DRIFT_A * phase)) * 0.6) + (softClouds((OCTAVE_TURN * p * 1.7) + (FOG_DRIFT_B * phase) + 4.3) * 0.4);
      float density = mix(FOG_THIN, 1.0, smoothstep(0.32, 0.68, clouds));
      return min(smoothstep(0.0, 1.0, band) * density * fogAmount * min(intensity, 1.0), FOG_MAX);
    }

    // The ice with its premultiplied color. It is vec4(0.0) where the pixel has no ice.
    vec4 iceLayer(vec2 pos, float pixelSize) {
      vec2 edge = iceEdge(pos);
      float mask = min(edge.x * intensity, 1.0);
      if ( (mask <= 0.0) || (edge.y <= 0.0) ) return vec4(0.0);

      vec3 surface = iceSurface(pos, pixelSize);
      float cover = pow(mask, COVER_CURVE) * frostCover;
      float threshold = mix(ICE_NONE, ICE_ALL, cover);
      // The lines have their own narrow threshold, thus they stay thin and sharp where the sheet fades.
      float lines = smoothstep(threshold - ICE_EDGE, threshold + ICE_EDGE, surface.z * ICE_NONE);
      float ice = max(lines, sheetAlpha(pos, cover)) * edge.y;
      if ( ice <= 0.0 ) return vec4(0.0);

      // With no background, the ice color replaces the map.
      vec4 base = sampleBase(vUvs);
      vec3 map = base.a > 0.0 ? blurredMap(base) : iceColor(surface.x);
      vec3 color = mix(map, iceColor(surface.x), frostTint);

      vec3 whiteColor = mix(sqrt(effectColor), vec3(1.0), 0.7);
      color = mix(color, whiteColor, surface.y);
      color += whiteColor * surface.z * ridgeAmount;
      if ( sparkleAmount > 0.0 ) color += vec3(sparkles(pos, pixelSize) * sparkleAmount);

      // The color must not be more than the alpha (ice), because the output is premultiplied.
      return vec4(clamp(color, 0.0, 1.0) * ice, ice);
    }

    vec4 _main() {
      vec2 pos = patternPos();
      // Do not put this in a branch, because the derivative of a pixel needs its neighbors.
      float pixelSize = max(fwidth(pos.x), fwidth(pos.y));

      vec4 result = iceLayer(pos, pixelSize);
      float fog = borderFog(pos);
      if ( fog > 0.0 ) result = mix(result, vec4(mix(sqrt(effectColor), vec3(1.0), FOG_WHITE), 1.0), fog);
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return result * tintAlpha.a;
    }
  `;
  }
}
