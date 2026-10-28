/**
 * The base class of all effect shaders. The sampler is the mask texture, and vUvs is the mask UV.
 * The Foundry parent class adds the occlusion code after _main(), thus the effect fades with its tile.
 * A subclass gives only the GLSL function "vec4 _main()" in the static field _effectShader.
 * The output color must be premultiplied.
 */
export class TileFxShader extends foundry.canvas.rendering.shaders.PrimaryBaseSamplerShader {
  /** No batch plugin: each mesh draws alone, so it can have its own uniforms. */
  static classPluginName = null;

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
    float strength() {
      return texture(sampler, vUvs).a * intensity;
    }

    // One unit is one grid square at pattern scale 1. Thus a pattern has the same size on all tiles.
    vec2 patternPos() {
      return vUvs * tileSize / (gridSize * patternScale);
    }
  `;

  /** Each subclass overrides this field. The base class shows no effect. */
  static _effectShader = `
    vec4 _main() {
      return vec4(0.0);
    }
  `;

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
