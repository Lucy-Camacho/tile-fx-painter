import { getTileFrame } from "./compat.js";
import { getBackgroundScale } from "./background-capture.js";

/**
 * The effect mesh of one tile. It is a direct child of canvas.primary, separate from the tile mesh,
 * because Foundry makes no tile mesh for a tile with no image.
 * The texture is the mask. The mesh covers the tile frame, thus vUvs in the shader is the mask UV.
 */
export class TileFxMesh extends foundry.canvas.primary.PrimarySpriteMesh {
  /** The values that the shader reads. The color is RGB, from 0 to 1. */
  fx = { intensity: 1, color: [1, 1, 1], speed: 1, scale: 1 };

  /** The animation time in seconds at speed 1. It wraps at PHASE_WRAP to keep the shader math precise. */
  phase = 0;

  /** The ticker time of the last phase change, in milliseconds. */
  #phaseTime = null;

  /** The size of the tile frame in scene pixels. */
  tileSize = { width: 1, height: 1 };

  /**
   * The mat3 (column-major) that changes a mask UV to a position in the background image, from (0, 0) to (1, 1).
   * It is the identity if there is no background texture.
   */
  baseMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  /** The mat3 (column-major) that changes a mask UV to a position in the scene rectangle, from (0, 0) to (1, 1). */
  sceneMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  /** The path of the current mask texture. A different path causes a new load. */
  maskSrc = null;

  /**
   * The texture of the background image under the tile, or null.
   * The mesh loads it, because in v14 Foundry does not draw the background of a level that the viewed level does not show.
   */
  backgroundTexture = null;

  /** The background source of backgroundTexture, as JSON. A different source causes a new load. */
  backgroundKey = null;

  /** @type {ReturnType<import("./compat.js").getBackgroundSource>} */
  #background = null;

  /**
   * Set the background image under the tile. Call refreshTransform after this, because the base matrix uses it.
   * @param {ReturnType<import("./compat.js").getBackgroundSource>} source
   * @param {PIXI.Texture|null} texture  The texture of source.src.
   */
  setBackground(source, texture) {
    this.#background = source;
    this.backgroundTexture = texture;
    this.backgroundKey = JSON.stringify(source);
  }

  /**
   * Fit the mesh to the tile frame.
   * The mesh ignores the fit, scale, and mirror of the tile image, because the mask uses the frame.
   */
  refreshTransform(tileDocument) {
    const frame = getTileFrame(tileDocument);
    const { centerX, centerY, width, height, rotation } = frame;
    // The mesh turns around the frame center. This gives the same frame as a v14 tile, which turns around its anchor point.
    this.anchor.set(0.5, 0.5);
    this.position.set(centerX, centerY);
    this.angle = rotation;
    this.resize(width, height);
    this.tileSize.width = width;
    this.tileSize.height = height;
    this.#refreshMatrices(frame);
  }

  /**
   * Use the same math as captureBackground:
   * scene point = frame center + rotate(rotation) × ((u − 0.5) × width, (v − 0.5) × height).
   * The background image is a sprite with the transform of getBackgroundSource, as the Foundry background mesh.
   * @param {ReturnType<import("./compat.js").getTileFrame>} frame
   */
  #refreshMatrices({ centerX, centerY, width, height, rotation }) {
    const radians = Math.toRadians(rotation);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // The scene vectors of one unit of u and one unit of v, and the scene point of the mask UV (0, 0).
    const ux = cos * width;
    const uy = sin * width;
    const vx = -sin * height;
    const vy = cos * height;
    const ox = centerX - (0.5 * ux) - (0.5 * vx);
    const oy = centerY - (0.5 * uy) - (0.5 * vy);

    // Column 0 is one unit of u. Column 1 is one unit of v. Column 2 is the position of the mask UV (0, 0).
    const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
    const s = this.sceneMatrix;
    s[0] = ux / sceneWidth;
    s[1] = uy / sceneHeight;
    s[3] = vx / sceneWidth;
    s[4] = vy / sceneHeight;
    s[6] = (ox - sceneX) / sceneWidth;
    s[7] = (oy - sceneY) / sceneHeight;

    const m = this.baseMatrix;
    m.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const source = this.#background;
    const texture = this.backgroundTexture;
    if (!source || !texture?.width || !texture.height) return;
    const { scaleX, scaleY } = getBackgroundScale(source, texture.width, texture.height);
    if (!scaleX || !scaleY) return;
    // The inverse of the sprite transform: turn back by the image rotation, then divide by the image size in the scene.
    const imageRadians = Math.toRadians(source.rotation);
    const imageCos = Math.cos(imageRadians);
    const imageSin = Math.sin(imageRadians);
    const imageWidth = scaleX * texture.width;
    const imageHeight = scaleY * texture.height;
    const toImageX = (x, y) => ((imageCos * x) + (imageSin * y)) / imageWidth;
    const toImageY = (x, y) => ((-imageSin * x) + (imageCos * y)) / imageHeight;
    m[0] = toImageX(ux, uy);
    m[1] = toImageY(ux, uy);
    m[3] = toImageX(vx, vy);
    m[4] = toImageY(vx, vy);
    m[6] = toImageX(ox - source.x, oy - source.y) + source.anchorX;
    m[7] = toImageY(ox - source.x, oy - source.y) + source.anchorY;
  }

  /**
   * Add the elapsed time, scaled by the speed, to the phase. Thus a speed change does not make the pattern jump.
   * Foundry renders a mesh more than one time in a frame (for example the depth pass).
   * The ticker time prevents more than one change in a frame.
   */
  #advancePhase() {
    const now = canvas.app.ticker.lastTime;
    if ( this.#phaseTime !== null ) {
      const seconds = Math.max(now - this.#phaseTime, 0) / 1000;
      this.phase = (this.phase + (seconds * this.fx.speed)) % TileFxMesh.PHASE_WRAP;
    }
    this.#phaseTime = now;
  }

  static PHASE_WRAP = 10000;

  /** @override */
  _render(renderer) {
    this.#advancePhase();
    super._render(renderer);
  }

  /** Copy the display state of the tile, as Tile#_refreshState and Tile#_refreshMesh do. */
  refreshState(tile) {
    const { hidden, elevation, sort, alpha, occlusion } = tile.document;
    this.visible = tile.isVisible;
    this.alpha = tile.alpha * (hidden ? 0.5 : 1);
    this.hidden = hidden;
    this.elevation = elevation;
    this.sort = sort;
    this.sortLayer = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS.TILES;
    // The tile mesh uses 0 to 2. Thus the effect is directly above its tile.
    this.zIndex = 3;
    // The tile opacity also sets the effect strength, because the occlusion code multiplies the output by it.
    this.unoccludedAlpha = alpha;
    this.occludedAlpha = occlusion.alpha;
    const modeChanged = this.occlusionMode !== occlusion.mode;
    this.occlusionMode = occlusion.mode;
    this.hoverFade = this.isOccludable;
    // Foundry refreshes the occlusion states only for a tile with a mesh. A tile with no image has no mesh.
    if (modeChanged) canvas.perception.update({ refreshOcclusionStates: true });
  }

  /** @param {ReturnType<import("./effects.js").getEffectSettings>} settings */
  applySettings(settings) {
    this.fx.intensity = settings.intensity;
    this.fx.color = foundry.utils.Color.from(settings.color).rgb;
    this.fx.speed = settings.speed;
    this.fx.scale = Math.max(settings.scale, 0.01);
  }
}
