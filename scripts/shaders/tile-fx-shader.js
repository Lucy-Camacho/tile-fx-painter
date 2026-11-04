/**
 * The base class of all effect shaders. The sampler is the mask texture, and vUvs is the mask UV.
 * The Foundry parent class adds the occlusion code after _main(), thus the effect fades with its tile.
 * A subclass gives only the GLSL function "vec4 _main()" in the static field _effectShader.
 * The output color must be premultiplied.
 */
export class TileFxShader extends foundry.canvas.rendering.shaders.PrimaryBaseSamplerShader {
  /** No batch plugin: each mesh draws alone, so it can have its own uniforms. */
  static classPluginName = null;

  /** A subclass with MASK_BLUR sets this to true, because the blur reads the mip levels of the mask. */
  static usesMaskMipmaps = false;

  /** A subclass with VIEW_OFFSET sets this to true, and adds viewTransform to its default uniforms. */
  static usesViewTransform = false;

  static defaultUniforms = {
    ...super.defaultUniforms,
    intensity: 1,
    effectColor: [1, 1, 1],
    phase: 0,
    patternScale: 1,
    tileSize: [1, 1],
    gridSize: 100,
    baseSampler: null,
    baseMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    sceneMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    baseFrame: [0, 0, 1, 1],
    hasBase: 0,
    baseTexelSize: [1, 1]
  };

  /**
   * The uniforms and the GLSL helpers for all effect shaders.
   * - baseMatrix changes a mask UV to a position in the background image, from (0, 0) to (1, 1).
   * - sceneMatrix changes a mask UV to a position in the scene rectangle, from (0, 0) to (1, 1).
   * - baseFrame changes a position in the background image to a UV of the background texture.
   *   It is (x, y, width, height) of the texture frame in UV units.
   * - baseTexelSize is the size of one background texture pixel in UV units.
   */
  static FX_COMMON = `
    uniform float intensity;
    uniform vec3 effectColor;
    uniform float phase;
    uniform float patternScale;
    uniform vec2 tileSize;
    uniform float gridSize;
    uniform sampler2D baseSampler;
    uniform mat3 baseMatrix;
    uniform mat3 sceneMatrix;
    uniform vec4 baseFrame;
    uniform float hasBase;
    uniform vec2 baseTexelSize;

    // Change a mask UV to a background texture UV.
    // Returns false outside the background image, or when the tile has no background image.
    bool baseUv(vec2 maskUv, out vec2 uv) {
      vec2 imagePos = (baseMatrix * vec3(maskUv, 1.0)).xy;
      uv = baseFrame.xy + (imagePos * baseFrame.zw);
      return (hasBase > 0.5) && all(greaterThanEqual(imagePos, vec2(0.0))) && all(lessThanEqual(imagePos, vec2(1.0)));
    }

    // The premultiplied background color under a mask UV. It is vec4(0.0) when baseUv returns false.
    vec4 sampleBase(vec2 maskUv) {
      vec2 uv;
      if ( !baseUv(maskUv, uv) ) return vec4(0.0);
      return texture(baseSampler, uv);
    }

    // Keep a background texture UV half a pixel inside the texture frame.
    // Thus a sample near the scene edge does not read the pixels next to the frame.
    vec2 clampBaseUv(vec2 uv) {
      vec2 halfTexel = baseTexelSize * 0.5;
      return clamp(uv, baseFrame.xy + halfTexel, baseFrame.xy + baseFrame.zw - halfTexel);
    }

    // The straight (not premultiplied) color of a premultiplied color. It is black when the alpha is 0.
    vec3 unpremultiply(vec4 color) {
      return color.a > 0.0 ? color.rgb / color.a : vec3(0.0);
    }

    // The mask alpha times the intensity. It can be more than 1.
    // It is 0 outside the tile frame, because the texture clamps at its edge and would show streaks in the bleed area.
    float strength() {
      vec2 inside = step(vec2(0.0), vUvs) * step(vUvs, vec2(1.0));
      return texture(sampler, vUvs).a * inside.x * inside.y * intensity;
    }

    // One unit is one grid square at pattern scale 1. Thus a pattern has the same size on all tiles.
    vec2 patternPos() {
      return vUvs * tileSize / (gridSize * patternScale);
    }
  `;

  /**
   * A replacement of the Foundry PRNG, for the Foundry NOISE and FBM helpers. A subclass adds it in place of PRNG.
   * The Foundry PRNG multiplies each coordinate by large values. Near coordinate 1000, a 32-bit float keeps only 16 different
   * results, and their mean is 0.35. The mod() in that PRNG also moves each negative coordinate near 1000.
   * Thus a flow or a large tile makes the noise blocky and darker. This function uses fract first, thus all coordinates give the same quality.
   */
  static STABLE_PRNG = `
    float random(in vec2 uv) {
      vec3 v = fract(uv.xyx * 0.1031);
      v += dot(v, v.yzx + 33.33);
      return fract((v.x + v.y) * v.z);
    }
  `;

  /**
   * A Voronoi pattern that also gives the cell edges. The Foundry VORONOI helper gives only the nearest distance,
   * and its cell points are all on a diagonal of the cell.
   * It is not a part of FX_COMMON, because it needs TWOPI. A subclass adds this field after CONSTANTS.
   */
  static VORONOI_CELLS = `
    // Two random values from 0 to 1 for a cell. It uses no integers, because the int precision of this shader can be
    // mediump, and no sin, because the result of a large sin is different on some drivers.
    vec2 cellHash(vec2 cell) {
      vec3 v = fract(vec3(cell.x, cell.y, cell.x + cell.y) * vec3(0.1127, 0.1301, 0.0877));
      v += dot(v, v.yzx + 23.17);
      return fract(vec2(v.x + v.y, v.y + v.z) * v.zx);
    }

    // x: the distance to the nearest cell point (F1). y: the distance to the second nearest point (F2).
    // z: a random value of the nearest cell, from 0 to 1.
    // F2 - F1 is 0 on a cell edge. It is not the exact distance to the edge, but it reads only 9 cells.
    // Each point moves with t on a small circle. The point stays in its cell, thus 9 cells always contain the nearest point.
    vec3 voronoiCells(vec2 pos, float t) {
      vec2 cell = floor(pos);
      vec2 local = pos - cell;
      float nearest = 8.0;
      float second = 8.0;
      float id = 0.0;
      for ( float y = -1.0; y <= 1.0; y++ ) {
        for ( float x = -1.0; x <= 1.0; x++ ) {
          vec2 neighbor = vec2(x, y);
          vec2 hash = cellHash(cell + neighbor);
          float angle = t + (TWOPI * fract(hash.x * 13.0));
          vec2 delta = neighbor + 0.15 + (0.7 * hash) + (0.15 * vec2(cos(angle), sin(angle))) - local;
          float dist = dot(delta, delta);
          if ( dist < nearest ) {
            second = nearest;
            nearest = dist;
            id = fract(hash.y * 13.0);
          }
          else if ( dist < second ) second = dist;
        }
      }
      return vec3(sqrt(nearest), sqrt(second), id);
    }
  `;

  /**
   * A soft blur of the mask. A subclass adds this field after CONSTANTS, because it needs TWOPI.
   * It also sets usesMaskMipmaps to true.
   * The radius is in mask UV units. It must be more than 0, because the mip level uses log2. The caller tests this.
   */
  static MASK_BLUR = `
    const float MASK_BLUR_SIGMA = 0.4;  // The Gaussian width, as a fraction of the radius.

    // The mask alpha at a mask UV and mip level. It goes to 0 outside the texture, because the texture clamps at its edge.
    // The alpha fades over one mip texel at the edge. A sudden stop would show each blur sample as a hard line past the frame.
    float maskAlpha(vec2 uv, float lod) {
      vec2 texel = exp2(lod) / vec2(textureSize(sampler, 0));
      vec2 cover = clamp((min(uv, 1.0 - uv) / texel) + 0.5, 0.0, 1.0);
      return textureLod(sampler, uv, lod).a * cover.x * cover.y;
    }

    // The mip level with one texel for each sample step. Thus the samples overlap, and the blur shows no ring bands.
    float maskBlurLod(vec2 sampleStep) {
      vec2 stepTexels = sampleStep * vec2(textureSize(sampler, 0));
      return max(log2(max(stepTexels.x, stepTexels.y)), 0.0);
    }

    // One ring of the blur. Each ring turns by a different part of its step, to avoid a visible star shape.
    float maskBlurRing(vec2 radius, float dist, float count, float lod) {
      float total = 0.0;
      float offset = dist * (TWOPI / count) * 0.5;
      for ( float i = 0.0; i < count; i++ ) {
        float angle = (i * (TWOPI / count)) + offset;
        total += maskAlpha(vUvs + (vec2(cos(angle), sin(angle)) * radius * dist), lod);
      }
      return total / count;
    }

    // A Gaussian blur of the mask: the center and 3 rings, about one third of the radius apart (37 samples).
    float maskBlur(vec2 radius) {
      float lod = maskBlurLod(radius / 3.0);
      float w1 = exp(-(1.0 / 9.0) / (2.0 * MASK_BLUR_SIGMA * MASK_BLUR_SIGMA));
      float w2 = exp(-(4.0 / 9.0) / (2.0 * MASK_BLUR_SIGMA * MASK_BLUR_SIGMA));
      float w3 = exp(-1.0 / (2.0 * MASK_BLUR_SIGMA * MASK_BLUR_SIGMA));
      // The ring weights also count the ring sizes (6, 12, 18 samples), because a larger ring covers more area.
      float total = maskAlpha(vUvs, lod)
        + (maskBlurRing(radius, 1.0 / 3.0, 6.0, lod) * w1 * 6.0)
        + (maskBlurRing(radius, 2.0 / 3.0, 12.0, lod) * w2 * 12.0)
        + (maskBlurRing(radius, 1.0, 18.0, lod) * w3 * 18.0);
      return total / (1.0 + (w1 * 6.0) + (w2 * 12.0) + (w3 * 18.0));
    }

    // A cheaper blur with no fine detail: the center and one ring of 6 points at two thirds of the radius (7 samples).
    // The 6 points are one ring distance apart, thus the mip level uses this distance as its step.
    float maskBlurCoarse(vec2 radius) {
      float dist = 2.0 / 3.0;
      float lod = maskBlurLod(radius * dist);
      float w = exp(-(dist * dist) / (2.0 * MASK_BLUR_SIGMA * MASK_BLUR_SIGMA));
      float total = maskAlpha(vUvs, lod) + (maskBlurRing(radius, dist, 6.0, lod) * w * 6.0);
      return total / (1.0 + (w * 6.0));
    }
  `;

  /**
   * The position of a pixel relative to the camera. A subclass adds this field, and it also sets usesViewTransform to true.
   * Thus a reflection or a deep layer can move with the camera of each client.
   */
  static VIEW_OFFSET = `
    // Changes a position in the scene rectangle (from sceneMatrix) to the offset from the camera center.
    // The offset is 1 at the view radius: offset = scenePos * viewTransform.xy + viewTransform.zw.
    uniform vec4 viewTransform;

    vec2 viewOffset() {
      return ((sceneMatrix * vec3(vUvs, 1.0)).xy * viewTransform.xy) + viewTransform.zw;
    }
  `;

  /** Each subclass overrides this field. The base class shows no effect. */
  static _effectShader = `
    vec4 _main() {
      return vec4(0.0);
    }
  `;

  /**
   * The distance that the effect can draw past the tile frame, in grid squares. The mesh gets larger by this distance.
   * A subclass overrides this only if it draws outside the mask. Each added pixel runs the shader, thus keep the distance small.
   * @param {import("../tile-fx-mesh.js").TileFxMesh["fx"]} fx
   * @returns {number}
   */
  static getBleed(fx) {
    return 0;
  }

  /**
   * The bleed of a light from maskBlur: the radius, plus the fade of maskAlpha past the frame. At the outer ring, this fade is
   * half of a mip texel, and a mip texel is one third of the radius. Thus the light is 0 at the mesh edge and shows no hard line there.
   * @param {number} radius  The blur radius in grid squares at pattern scale 1.
   * @param {import("../tile-fx-mesh.js").TileFxMesh["fx"]} fx
   * @returns {number}
   */
  static getHaloBleed(radius, fx) {
    return radius * fx.scale * (7 / 6);
  }

  /** @override */
  static get _fragmentShader() {
    return `${this.FX_COMMON}\n${this._effectShader}`;
  }

  /** @override */
  _preRender(mesh, renderer) {
    super._preRender(mesh, renderer);
    const uniforms = this.uniforms;
    const { fx, tileSize } = mesh;
    uniforms.intensity = fx.intensity;
    uniforms.effectColor = fx.color;
    uniforms.phase = mesh.phase;
    uniforms.patternScale = fx.scale;
    uniforms.tileSize[0] = tileSize.width;
    uniforms.tileSize[1] = tileSize.height;
    uniforms.gridSize = canvas.dimensions.size;
    uniforms.baseMatrix = mesh.baseMatrix;
    uniforms.sceneMatrix = mesh.sceneMatrix;
    // The param key is the uniform name. Copy each frame, thus a new shader class gets the params in the next frame.
    for ( const [key, value] of Object.entries(fx.params) ) uniforms[key] = value;

    // The core "mipmap" setting can be off, thus turn the mipmaps on here.
    // The setter does nothing if the value is the same. Else PIXI makes the mipmaps at the next bind of the texture.
    if ( this.constructor.usesMaskMipmaps ) {
      const maskTexture = mesh.texture?.baseTexture;
      if ( maskTexture && !maskTexture.destroyed ) maskTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    }

    if ( this.constructor.usesViewTransform ) {
      // The view radius is half of the longer screen side, in scene pixels. One radius for both axes prevents a stretched offset.
      const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
      const [screenWidth, screenHeight] = canvas.screenDimensions;
      const { pivot, scale } = canvas.stage;
      const radius = Math.max((0.5 * Math.max(screenWidth, screenHeight)) / scale.x, 1);
      const view = uniforms.viewTransform;
      view[0] = sceneWidth / radius;
      view[1] = sceneHeight / radius;
      view[2] = (sceneX - pivot.x) / radius;
      view[3] = (sceneY - pivot.y) / radius;
    }

    // Check the texture each frame, because the Foundry texture cache can unload it.
    const texture = mesh.backgroundTexture;
    const hasBase = mesh.hasBaseMatrix && !!texture?.valid && !!texture.baseTexture && !texture.baseTexture.destroyed
      && (texture !== PIXI.Texture.EMPTY) && (texture !== PIXI.Texture.WHITE);
    uniforms.hasBase = hasBase ? 1 : 0;
    uniforms.baseSampler = hasBase ? texture : PIXI.Texture.EMPTY;
    if ( hasBase ) {
      const { frame, baseTexture } = texture;
      const frameUvs = uniforms.baseFrame;
      frameUvs[0] = frame.x / baseTexture.width;
      frameUvs[1] = frame.y / baseTexture.height;
      frameUvs[2] = frame.width / baseTexture.width;
      frameUvs[3] = frame.height / baseTexture.height;
      uniforms.baseTexelSize[0] = 1 / baseTexture.realWidth;
      uniforms.baseTexelSize[1] = 1 / baseTexture.realHeight;
    }
  }
}
