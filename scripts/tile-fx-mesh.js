/**
 * The effect mesh of one tile. It is a direct child of canvas.primary, separate from the tile mesh,
 * because Foundry makes no tile mesh for a tile with no image.
 * The texture is the mask. The mesh covers the tile frame, thus vUvs in the shader is the mask UV.
 */
export class TileFxMesh extends foundry.canvas.primary.PrimarySpriteMesh {
  /** The effect values that the shader reads. The color is RGB, with values from 0 to 1. */
  fx = { intensity: 1, color: [1, 1, 1], speed: 1, scale: 1 };

  /**
   * The animation time of the effect, in seconds at speed 1.
   * It wraps at PHASE_WRAP, so that the shader math stays precise in a long session.
   */
  phase = 0;

  /** The ticker time of the last phase change, in milliseconds. */
  #phaseTime = null;

  /** The size of the tile frame in scene pixels. */
  tileSize = { width: 1, height: 1 };

  /** The mat3 (column-major) that changes a mask UV to a position in the scene rectangle, from (0, 0) to (1, 1). */
  baseMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  /** The mask path of the current texture. A different path makes a new load. */
  maskSrc = null;

  /**
   * Fit the mesh to the tile frame.
   * The mesh ignores the fit, scale, and mirror of the tile image, because the mask uses the frame.
   * @param {TileDocument} tileDocument
   */
  refreshTransform(tileDocument) {
    const { x, y, width, height, rotation } = tileDocument;
    this.anchor.set(0.5, 0.5);
    this.position.set(x + (width / 2), y + (height / 2));
    this.angle = rotation;
    this.resize(width, height);
    this.tileSize.width = width;
    this.tileSize.height = height;
    this.#refreshBaseMatrix(tileDocument);
  }

  /**
   * Use the same math as captureBackground:
   * scene point = frame center + rotate(rotation) × ((u − 0.5) × width, (v − 0.5) × height).
   * The scene rectangle (sceneX, sceneY, sceneWidth, sceneHeight) is where Foundry draws the background image.
   * @param {TileDocument} tileDocument
   */
  #refreshBaseMatrix(tileDocument) {
    const { x, y, width, height, rotation } = tileDocument;
    const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
    const radians = Math.toRadians(rotation);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const centerX = x + (width / 2);
    const centerY = y + (height / 2);
    const m = this.baseMatrix;
    // Column 0: the change for one unit of u.
    m[0] = (cos * width) / sceneWidth;
    m[1] = (sin * width) / sceneHeight;
    // Column 1: the change for one unit of v.
    m[3] = (-sin * height) / sceneWidth;
    m[4] = (cos * height) / sceneHeight;
    // Column 2: the scene position of the mask UV (0, 0).
    m[6] = (centerX - (0.5 * cos * width) + (0.5 * sin * height) - sceneX) / sceneWidth;
    m[7] = (centerY - (0.5 * sin * width) - (0.5 * cos * height) - sceneY) / sceneHeight;
  }

  /**
   * Add the time since the last change to the phase, at the current speed.
   * Thus a speed change does not make the pattern jump, and speed 0 stops it.
   * Foundry renders a mesh more than one time in a frame (for example the depth pass),
   * thus the ticker time prevents more than one change in a frame.
   */
  #advancePhase() {
    const now = canvas.app.ticker.lastTime;
    if ( this.#phaseTime !== null ) {
      const seconds = Math.max(now - this.#phaseTime, 0) / 1000;
      this.phase = (this.phase + (seconds * this.fx.speed)) % TileFxMesh.PHASE_WRAP;
    }
    this.#phaseTime = now;
  }

  /** The phase value where the phase goes back to 0. */
  static PHASE_WRAP = 10000;

  /** @override */
  _render(renderer) {
    this.#advancePhase();
    super._render(renderer);
  }

  /**
   * Copy the display state of the tile, as Tile#_refreshState and Tile#_refreshMesh do.
   * @param {Tile} tile
   */
  refreshState(tile) {
    const { hidden, elevation, sort, alpha, occlusion } = tile.document;
    this.visible = tile.isVisible;
    // tile.alpha is lower for the original tile during a drag.
    this.alpha = tile.alpha * (hidden ? 0.5 : 1);
    this.hidden = hidden;
    this.elevation = elevation;
    this.sort = sort;
    this.sortLayer = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS.TILES;
    // The tile mesh uses 0 to 2. Thus the effect is directly above its tile.
    this.zIndex = 3;
    // The tile Opacity also sets the effect strength. The occlusion code multiplies the output by this value.
    this.unoccludedAlpha = alpha;
    this.occludedAlpha = occlusion.alpha;
    const modeChanged = this.occlusionMode !== occlusion.mode;
    this.occlusionMode = occlusion.mode;
    this.hoverFade = this.isOccludable;
    // Foundry refreshes the occlusion states only for a tile with a mesh. A tile with no image has no mesh.
    if (modeChanged) canvas.perception.update({ refreshOcclusionStates: true });
  }

  /**
   * Keep the effect values of the tile flags.
   * @param {ReturnType<import("./effects.js").getEffectSettings>} settings
   */
  applySettings(settings) {
    this.fx.intensity = settings.intensity;
    this.fx.color = foundry.utils.Color.from(settings.color).rgb;
    this.fx.speed = settings.speed;
    this.fx.scale = Math.max(settings.scale, 0.01);
  }
}
