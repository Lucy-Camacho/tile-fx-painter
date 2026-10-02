/**
 * The base class of all effect shaders. The sampler is the mask texture, and vUvs is the mask UV.
 * The Foundry parent class adds the occlusion code after _main(). Thus the effect fades with its tile.
 * A subclass gives only the GLSL function "vec4 _main()" in the static field _effectShader.
 * The output color must be premultiplied.
 */
export class TileFxShader extends foundry.canvas.rendering.shaders.PrimaryBaseSamplerShader {
  /** No batch: each effect mesh draws alone, so the shader can have its own uniforms. */
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
    baseFrame: [0, 0, 1, 1],
    hasBase: 0,
    baseTexelSize: [1, 1]
  };

  /**
   * The uniforms and the GLSL helpers that all effect shaders can use,
   * in addition to the uniforms of the Foundry parent class.
   * - baseMatrix changes a mask UV to a position in the scene rectangle, from (0, 0) to (1, 1).
   * - baseFrame changes a position in the scene rectangle to a UV of the background texture.
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
    uniform vec4 baseFrame;
    uniform float hasBase;
    uniform vec2 baseTexelSize;

    // Change a mask UV to a UV of the background texture.
    // Gives false outside the scene rectangle, or when the scene has no background image.
    bool baseUv(vec2 maskUv, out vec2 uv) {
      vec2 scenePos = (baseMatrix * vec3(maskUv, 1.0)).xy;
      uv = baseFrame.xy + (scenePos * baseFrame.zw);
      return (hasBase > 0.5) && all(greaterThanEqual(scenePos, vec2(0.0))) && all(lessThanEqual(scenePos, vec2(1.0)));
    }

    // The premultiplied scene background color under a mask UV.
    // vec4(0.0) outside the scene rectangle, or when the scene has no background image.
    vec4 sampleBase(vec2 maskUv) {
      vec2 uv;
      if ( !baseUv(maskUv, uv) ) return vec4(0.0);
      return texture(baseSampler, uv);
    }

    // The effect strength at this pixel: the mask alpha times the intensity. It can be more than 1.
    float strength() {
      return texture(sampler, vUvs).a * intensity;
    }

    // The pattern position at this pixel. One unit is one grid square at pattern scale 1.
    // Thus a pattern has the same size on all tiles, and it does not stretch on a long tile.
    vec2 patternPos() {
      return vUvs * tileSize / (gridSize * patternScale);
    }
  `;

  /**
   * The test effect: the inverted background color, plus a diagonal stripe that moves with the phase.
   * The stripe moves one pattern unit each second at speed 1.
   * tintAlpha.a is the alpha of the mesh, for example 0.5 for a hidden tile.
   */
  static _effectShader = `
    vec4 _main() {
      float s = min(strength(), 1.0);
      vec4 base = sampleBase(vUvs);
      // Invert a premultiplied color. Outside the background, the color stays transparent.
      vec4 color = vec4(base.a - base.rgb, base.a);
      vec2 pos = patternPos();
      float stripe = step(0.85, fract(pos.x + pos.y - phase));
      color = mix(color, vec4(1.0), stripe * 0.8);
      return color * s * tintAlpha.a;
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

    // Read the background each frame, because it has no event when its texture changes.
    const background = canvas.primary.background;
    const texture = background?.texture;
    const hasBase = !!background?.visible && !!texture?.valid
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
