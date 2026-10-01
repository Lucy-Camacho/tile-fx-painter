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
    gridSize: 100
  };

  /** The uniforms that all effect shaders can read, in addition to the uniforms of the Foundry parent class. */
  static FX_UNIFORMS = `
    uniform float intensity;
    uniform vec3 effectColor;
    uniform float phase;
    uniform float patternScale;
    uniform vec2 tileSize;
    uniform float gridSize;
  `;

  /**
   * The test effect: a flat color with the mask alpha as its strength.
   * tintAlpha.a is the alpha of the mesh, for example 0.5 for a hidden tile.
   */
  static _effectShader = `
    vec4 _main() {
      float s = min(texture(sampler, vUvs).a * intensity, 1.0) * 0.6;
      return vec4(effectColor * s, s) * tintAlpha.a;
    }
  `;

  /** @override */
  static get _fragmentShader() {
    return `${this.FX_UNIFORMS}\n${this._effectShader}`;
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
  }
}
