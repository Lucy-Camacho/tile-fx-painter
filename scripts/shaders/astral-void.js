import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The astral void effect: a hole into space, with stars and color clouds that are far below the map.
 * The pattern uses the scene axes, not the tile frame axes. A camera movement is in the scene axes, thus a turned tile also moves the stars
 * in the correct direction. Two tiles next to each other show one continuous void.
 * The void does not use the map color. A soft mask edge fades the void to the map. A light on the two sides of the mask edge can go past the tile frame.
 */
export class AstralVoidShader extends TileFxShader {
  static usesMaskMipmaps = true;

  static defaultUniforms = {
    ...super.defaultUniforms,
    sceneSize: [1, 1],
    cameraPos: [0, 0],
    ...getParamDefaults("astralVoid")
  };

  /** @override */
  static getBleed(fx) {
    const { rimRadius, rimLight } = fx.params;
    return rimLight > 0 ? this.getHaloBleed(rimRadius, fx) : 0;
  }

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.STABLE_PRNG}
    ${this.NOISE}
    ${this.VORONOI_CELLS}
    ${this.MASK_BLUR}

    // The size of the scene rectangle, and the camera center in the same axes, in scene pixels.
    uniform vec2 sceneSize;
    uniform vec2 cameraPos;

    // The params of the tile (EFFECTS.astralVoid.params).
    uniform float starDensity;
    uniform float starBrightness;
    uniform float twinkleAmount;
    uniform float nebulaAmount;
    uniform float depthAmount;
    uniform float rimRadius;
    uniform float rimLight;

    // Tuning values of the stars.
    const float STAR_MARGIN = 0.2;      // The star center stays this far from the cell edge, in cell units. It is also the maximum star radius.
    const float STAR_PIXELS = 1.5;      // The minimum star radius, in pixels. With one pixel, a movement of half a pixel changes the brightness by 2 times.
    const float STAR_SHARP = 2.0;       // A higher value gives fewer bright stars.
    const float HALO_LIGHT = 0.3;       // The brightness of the soft light around the brightest stars.
    const float TWINKLE_RATE = 1.6;     // The mean speed of the twinkle, in radians each second.
    const float TINT_CHANCE = 0.25;     // The part of the stars that has a color.

    // Tuning values of the clouds.
    const float NEBULA_DEPTH = 1.5;     // The depth of the clouds. They are behind all of the stars.
    const float NEBULA_FREQ = 0.95;     // The number of large clouds along one grid square at Pattern Scale 1.
    const float NEBULA_SPEED = 0.02;    // The change of the clouds, in noise units each second.
    const float NEBULA_WARP = 1.1;      // The force of the domain warp. A higher value gives more twisted clouds.
    const float NEBULA_LOW = 0.44;      // The noise value where a cloud starts.
    const float NEBULA_HIGH = 0.8;      // The noise value with the full cloud density.
    const float NEBULA_HUE = 40.0;      // The hue difference of the second cloud color, in degrees.
    const float NEBULA_WARP_FREQ = 0.7; // The frequency of the warp noise, relative to the clouds.
    const float NEBULA_LIGHT = 0.6;     // The quantity of light color in the densest parts of a cloud.
    const float SPACE_TINT = 0.05;      // The quantity of effect color in the empty space.

    // Tuning values of the light at the mask edge.
    const float RIM_INNER = 0.8;        // The brightness of the light inside the mask.
    const float RIM_OUTER = 0.7;        // The brightness of the light outside the mask.
    const float RIM_SHARP = 2.0;        // A higher value gives a thinner light.
    const float RIM_FREQ = 2.5;         // The number of bright and dark areas along one grid square at Pattern Scale 1.
    const float RIM_SPEED = 0.25;       // The change of the bright and dark areas, in noise units each second.
    const float RIM_CHANGE = 0.5;       // The part of the light that the bright and dark areas change.
    const float FALLOFF = 0.6;          // A higher value gives less light on a bright map pixel. See GlowShader.

    // Each octave turns, because octaves on the same axes give the value noise a square shape.
    const mat2 OCTAVE_TURN = mat2(0.8, 0.6, -0.6, 0.8);

    // A position in a layer with this depth, in grid squares at Pattern Scale 1. A layer follows the camera by a part of its movement.
    // Thus a camera movement moves the layer less than the map, and a far layer moves the least. A zoom does not change the camera center, thus the layer does not shift.
    // The pattern size does not change with the Depth setting, thus Depth does not change the star size.
    vec2 layerPos(vec2 world, float depth) {
      float follow = depth * depthAmount;
      return (world - (cameraPos * (follow / (1.0 + follow)))) / (gridSize * patternScale);
    }

    // One layer of stars. A cell has a maximum of one star, and the star stays away from the cell edge. Thus this reads only one cell.
    // The pixel size sets the minimum star radius, so that a small star does not flash when the camera moves at a low zoom.
    vec3 starLayer(vec2 pos, float pixel, float freq, float radius, float salt) {
      float minRadius = pixel * freq * STAR_PIXELS;
      // At a low zoom, the minimum radius cannot stay in the star margin. The layer fades, because the stars would flash.
      float fade = 1.0 - smoothstep(STAR_MARGIN * 0.6, STAR_MARGIN, minRadius);
      if ( fade <= 0.0 ) return vec3(0.0);

      vec2 cellPos = (pos * freq) + salt;
      vec2 cell = floor(cellPos);
      vec2 hash = cellHash(cell);
      if ( fract(hash.x * 7.0) >= starDensity ) return vec3(0.0);

      vec2 extra = cellHash(cell + 41.0);
      vec2 center = STAR_MARGIN + ((1.0 - (2.0 * STAR_MARGIN)) * hash);
      float dist = length(cellPos - cell - center);

      float level = pow(extra.x, STAR_SHARP);
      float size = radius * mix(0.5, 1.0, level);
      float drawn = min(max(size, minRadius), STAR_MARGIN);
      // The light of a star spreads over the pixels at a low zoom, thus a star with a larger radius is dimmer.
      float core = max(1.0 - ((dist * dist) / (drawn * drawn)), 0.0);
      core = core * core * (size / drawn);
      float halo = max(1.0 - (dist / STAR_MARGIN), 0.0);
      float light = (core + (halo * halo * halo * level * HALO_LIGHT)) * mix(0.35, 1.0, level);

      // Each star has its own speed and start time.
      float twinkle = 0.5 + (0.5 * sin((phase * TWINKLE_RATE * (0.5 + extra.y)) + (fract(extra.y * 11.0) * TWOPI)));
      light *= 1.0 - (twinkleAmount * twinkle);

      vec3 tint = fract(extra.y * 23.0) < TINT_CHANCE ? mix(vec3(1.0), sqrt(effectColor), 0.7) : vec3(1.0);
      return tint * light * fade;
    }

    // A far layer has more cells, thus its stars are smaller. Each grid has a different turn, because cells on one axis show as rows of stars.
    vec3 starField(vec2 world, float pixelSize) {
      vec3 total = starLayer(OCTAVE_TURN * layerPos(world, 1.0), pixelSize, 7.0, 0.07, 0.0);
      total += starLayer(OCTAVE_TURN * OCTAVE_TURN * layerPos(world, 0.5), pixelSize, 3.4, 0.06, 13.0);
      total += starLayer(layerPos(world, 0.25), pixelSize, 1.5, 0.05, 29.0);
      return total * starBrightness;
    }

    // Soft noise from 0 to 1, with a mean near 0.5.
    float softClouds(vec2 p) {
      float total = noise(p) * 0.5;
      p = (OCTAVE_TURN * p * 2.03) + 7.1;
      total += noise(p) * 0.27;
      p = (OCTAVE_TURN * p * 2.03) + 7.1;
      total += noise(p) * 0.15;
      p = (OCTAVE_TURN * p * 2.03) + 7.1;
      return total + (noise(p) * 0.08);
    }

    // The noise of the warp. It has only two octaves, because fine detail in the warp folds the clouds into hard edges.
    float warpNoise(vec2 p) {
      return (noise(p) * 0.65) + (noise((OCTAVE_TURN * p * 2.03) + 3.3) * 0.35);
    }

    // The effect color, with its hue turned around the grey axis. A small turn keeps the two colors of the clouds near each other.
    // A swizzle such as effectColor.brg turns the hue by 120 degrees, and it gives a red void green clouds.
    vec3 secondColor() {
      const vec3 axis = vec3(0.57735);
      float angle = radians(NEBULA_HUE);
      vec3 turned = (effectColor * cos(angle)) + (cross(axis, effectColor) * sin(angle)) + (axis * dot(axis, effectColor) * (1.0 - cos(angle)));
      return clamp(turned, 0.0, 1.0);
    }

    // The color clouds: a domain-warped noise on a far layer. The warp slope stays small, because a large slope stretches the fine noise into streaks.
    vec3 nebula(vec2 world) {
      vec2 p = layerPos(world, NEBULA_DEPTH) * NEBULA_FREQ;
      float t = phase * NEBULA_SPEED;
      vec2 warpPos = p * NEBULA_WARP_FREQ;
      vec2 warp = vec2(warpNoise(warpPos + vec2(t, 1.7)), warpNoise(warpPos + vec2(5.2, -t))) - 0.5;
      float cloud = softClouds(p + (warp * NEBULA_WARP) + vec2(-t * 0.5, t * 0.5));
      float density = smoothstep(NEBULA_LOW, NEBULA_HIGH, cloud);
      vec3 color = mix(effectColor, secondColor(), smoothstep(-0.05, 0.3, warp.y));
      // A dense part of a cloud is lighter, and it keeps the hue.
      color = mix(color, sqrt(color), density * density * NEBULA_LIGHT);
      return color * density * nebulaAmount;
    }

    // Bright and dark areas that move along the mask edge.
    float rimChange(vec2 world) {
      vec2 p = (world / (gridSize * patternScale)) * RIM_FREQ;
      return 1.0 - RIM_CHANGE + (2.0 * RIM_CHANGE * noise(p + vec2(phase * RIM_SPEED, -phase * RIM_SPEED * 0.7)));
    }

    vec4 _main() {
      vec2 world = (sceneMatrix * vec3(vUvs, 1.0)).xy * sceneSize;
      // Do not put this in a branch, because the derivative of a pixel needs its neighbors.
      vec2 grid = world / (gridSize * patternScale);
      float pixelSize = max(fwidth(grid.x), fwidth(grid.y));

      float s = min(strength(), 1.0);
      bool hasRim = (rimRadius > 0.0) && (rimLight > 0.0);
      vec2 rimUv = vec2(rimRadius * gridSize * patternScale) / tileSize;

      // The light outside the mask shows only where the void does not cover the map. Thus a full mask area does not read this large blur.
      float outerBlur = 0.0;
      if ( hasRim && (s < 1.0) ) outerBlur = maskBlur(rimUv);
      if ( (s + outerBlur) <= 0.0 ) return vec4(0.0);

      vec3 color = vec3(0.0);
      float rim = hasRim ? rimChange(world) * rimLight : 0.0;
      if ( s > 0.0 ) {
        color = effectColor * SPACE_TINT;
        if ( nebulaAmount > 0.0 ) color += nebula(world);
        if ( (starDensity > 0.0) && (starBrightness > 0.0) ) color += starField(world, pixelSize);
        if ( hasRim ) {
          // The blur divided by the local mask alpha is 0.5 at a hard edge and near 1 on a flat or a soft mask.
          // Thus a low mask alpha and a soft edge do not make a light in all of their area.
          float ratio = clamp(maskBlurCoarse(rimUv) / maskValue(texture(sampler, vUvs)), 0.0, 1.0);
          float inner = pow(1.0 - smoothstep(0.5, 1.0, ratio), RIM_SHARP);
          color += mix(effectColor, sqrt(effectColor), inner) * inner * rim * RIM_INNER;
        }
      }
      // The color must not be more than the alpha (s), because the output is premultiplied. Alpha s is at most 1.
      color = min(color, vec3(1.0)) * s;

      vec3 light = vec3(0.0);
      if ( outerBlur > 0.0 ) {
        float outer = pow(min(outerBlur * 2.0, 1.0), RIM_SHARP);
        light = effectColor * outer * (1.0 - s) * rim * RIM_OUTER * intensity;
        // Screen-like falloff: a bright map pixel gets less light, so bright areas do not become flat white.
        light *= 1.0 - (FALLOFF * min(sampleBase(vUvs).rgb, vec3(1.0)));
      }

      // The light has no alpha, thus the premultiplied blend adds it to the color below.
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(color + light, s) * tintAlpha.a;
    }
  `;
  }

  /** @override */
  _preRender(mesh, renderer) {
    super._preRender(mesh, renderer);
    const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
    const { pivot } = canvas.stage;
    const uniforms = this.uniforms;
    uniforms.sceneSize[0] = sceneWidth;
    uniforms.sceneSize[1] = sceneHeight;
    uniforms.cameraPos[0] = pivot.x - sceneX;
    uniforms.cameraPos[1] = pivot.y - sceneY;
  }
}
