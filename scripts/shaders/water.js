import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The water effect: clear water on the map, with light patterns on the bottom, surface waves, and foam at the shore.
 * The depth comes from a blur of the mask. Thus a hard mask edge also gets a shore.
 * A mask that touches the tile frame gets a false shore there, because the blur sees no mask past the frame.
 */
export class WaterShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    ...getParamDefaults("water")
  };

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PRNG}
    ${this.NOISE}
    ${this.VORONOI_CELLS}
    ${this.MASK_BLUR}

    // The params of the tile (EFFECTS.water.params).
    uniform float depthTint;
    uniform float shoreWidth;
    uniform float foamAmount;
    uniform float causticAmount;
    uniform float waveHeight;
    uniform float refractAmount;
    uniform float specularAmount;
    uniform float flowAngle;
    uniform float flowAmount;

    // Tuning values.
    const float FLOW_SPEED = 1.0;      // The flow at Flow Speed 1, in pattern units each second.
    const float WAVE_FREQ = 2.5;       // The number of large waves in one pattern unit.
    const float WAVE_SPEED = 0.35;     // The movement of the large waves, in wave units each second.
    const float RIPPLE_SCALE = 2.3;    // The size of the large waves, relative to the small waves.
    const float RIPPLE_HEIGHT = 0.3;   // The height of the small waves, relative to the large waves.
    const float NORMAL_STEP = 0.03;    // The distance of the height samples for the normal, in wave units.
    const float BUMP = 0.5;            // The tilt of the surface normal for a height change at Waves 1.
    const float REFRACT_GAIN = 2.0;    // Usual waves tilt the normal by much less than 1. Thus the shift is near the Distortion value.
    const float SHORE_START = 0.5;     // The mask blur at a straight hard edge. Depth 0 is here.
    const float SHORE_END = 0.95;      // The mask blur where the deep water starts.
    const float CAUSTIC_FREQ = 1.8;    // The number of light cells in one pattern unit.
    const float CAUSTIC_SPEED = 0.25;  // The movement of the light cells, in cell units each second.
    const float CAUSTIC_TURN = 1.2;    // The turn of the cell points, in radians each second.
    const float CAUSTIC_WARP = 0.3;    // The bend of the light lines by the waves, in cell units.
    const float CAUSTIC_BEND = 0.12;   // The bend of the light lines with no waves, in cell units.
    const float CAUSTIC_SHARP = 12.0;  // A higher value gives thinner light lines.
    const float CAUSTIC_DEEP = 0.8;    // The part of the light patterns that the deep water removes.
    const float FOAM_FREQ = 9.0;       // The number of foam spots in one pattern unit.
    const float FOAM_WIDTH = 0.165;    // The width of the foam, in grid squares at pattern scale 1. See shoreFoam.
    const float FOAM_SPEED = 0.8;      // The speed of the foam band movement, in radians each second.

    // Value noise follows its grid. These turns hide the grid, because the two layers then have different axes.
    const mat2 WAVE_TURN_A = mat2(0.8, 0.6, -0.6, 0.8);
    const mat2 WAVE_TURN_B = mat2(0.28, -0.96, 0.96, 0.28);

    // The surface height: two noise layers that move in different directions.
    float surfaceHeight(vec2 pos, float t) {
      vec2 large = (WAVE_TURN_A * pos * WAVE_FREQ) + vec2(t, t * 0.6);
      vec2 small = (WAVE_TURN_B * pos * WAVE_FREQ * RIPPLE_SCALE) + vec2(-t * 1.4, t * 0.9);
      return noise(large) + (RIPPLE_HEIGHT * noise(small));
    }

    // The surface normal is in the tile frame axes, the same axes as vUvs.
    vec3 surfaceNormal(vec2 pos, float t) {
      float height = surfaceHeight(pos, t);
      vec2 slope = vec2(surfaceHeight(pos + vec2(NORMAL_STEP, 0.0), t) - height,
                        surfaceHeight(pos + vec2(0.0, NORMAL_STEP), t) - height) / NORMAL_STEP;
      return normalize(vec3(-slope * BUMP * waveHeight, 1.0));
    }

    // One layer of light lines. The line is on the cell edge, where F2 - F1 is 0.
    float causticLayer(vec2 pos, float turn) {
      vec3 cells = voronoiCells(pos, turn);
      return exp(-CAUSTIC_SHARP * (cells.y - cells.x));
    }

    // The light patterns on the bottom. Two layers that move in different directions make the lines change their shape.
    float caustics(vec2 pos, vec3 normal) {
      float t = phase * CAUSTIC_SPEED;
      vec2 cellPos = (pos * CAUSTIC_FREQ) + (normal.xy * CAUSTIC_WARP / BUMP);
      // The edges of Voronoi cells are straight lines. This cheap bend also shows when the surface is flat.
      cellPos += CAUSTIC_BEND * sin((cellPos.yx * 3.1) + vec2(t * 2.0, -t * 1.5));
      float turn = phase * CAUSTIC_TURN;
      float a = causticLayer(cellPos + vec2(t, t * 0.5), turn);
      float b = causticLayer((WAVE_TURN_A * cellPos * 1.3) + vec2(-t * 0.7, t), -turn);
      // The sum gives the lines, and the product makes them brighter where they cross.
      return (0.35 * (a + b)) + (1.5 * a * b);
    }

    // The foam near the mask edge: noise spots that get fewer with depth. The band moves slowly, as small waves on the shore.
    // The depth goes from 0 to 1 over the shore. Thus divide by the shore width, else a wide shore shows only foam.
    float shoreFoam(vec2 pos, vec3 normal, float depth) {
      float foamDepth = min(FOAM_WIDTH / shoreWidth, 1.0);
      float band = (depth / foamDepth) + (0.15 * sin((phase * FOAM_SPEED) + (pos.x * 3.0) + (pos.y * 2.0)));
      if ( band >= 1.0 ) return 0.0;
      vec2 foamPos = (pos * FOAM_FREQ) + (normal.xy * 2.0);
      float spots = noise(foamPos) + (0.5 * noise((WAVE_TURN_B * foamPos * 2.1) + vec2(phase * 0.3)));
      return smoothstep(0.0, 0.1, (spots / 1.5) - mix(0.38, 0.75, max(band, 0.0)));
    }

    vec4 _main() {
      float s = min(strength(), 1.0);
      if ( s <= 0.0 ) return vec4(0.0);

      // The flow is in the tile frame axes, thus it turns with the tile.
      float flowRadians = radians(flowAngle);
      vec2 flow = vec2(cos(flowRadians), sin(flowRadians)) * flowAmount * FLOW_SPEED * phase;
      vec2 pos = patternPos() - flow;

      float blur = maskBlurCoarse(vec2(shoreWidth * gridSize * patternScale) / tileSize);
      float depth = smoothstep(SHORE_START, SHORE_END, blur);

      vec3 normal = surfaceNormal(pos, phase * WAVE_SPEED);

      // The water bends the map below it. patternScale keeps the shift in proportion to the waves.
      vec2 shift = normal.xy * REFRACT_GAIN * refractAmount * gridSize * patternScale / tileSize;
      vec4 base = sampleBase(vUvs + shift);
      // Near the edge of the background, the shifted sample can be outside it.
      if ( base.a <= 0.0 ) base = sampleBase(vUvs);

      // With no background, the water is the effect color.
      vec3 map = base.a > 0.0 ? unpremultiply(base) : effectColor;
      vec3 color = mix(map, effectColor, depth * depthTint);

      // Less light goes to the bottom of deep water. The square root of the effect color keeps its hue, with a lighter color.
      if ( causticAmount > 0.0 ) {
        vec3 causticColor = mix(vec3(1.0), sqrt(effectColor), 0.4);
        color += causticColor * caustics(pos, normal) * causticAmount * (1.0 - (CAUSTIC_DEEP * depth));
      }

      // A light at the top left of the tile frame. A flat surface reflects no highlight to the eye.
      vec3 lightDir = normalize(vec3(-0.4, -0.6, 1.0));
      color += vec3(specularAmount) * pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 48.0);

      if ( foamAmount > 0.0 ) color = mix(color, vec3(1.0), shoreFoam(pos, normal, depth) * foamAmount);

      // The color must not be more than the alpha (s), because the output is premultiplied. Alpha s is at most 1.
      color = min(color, vec3(1.0));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(color * s, s) * tintAlpha.a;
    }
  `;
  }
}
