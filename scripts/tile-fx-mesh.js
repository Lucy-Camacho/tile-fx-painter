/**
 * The effect mesh of one tile. It is a direct child of canvas.primary, separate from the tile mesh,
 * because Foundry makes no tile mesh for a tile with no image.
 * The texture is the mask. The mesh covers the tile frame, thus vUvs in the shader is the mask UV.
 */
export class TileFxMesh extends foundry.canvas.primary.PrimarySpriteMesh {
  /** The effect values that the shader reads. The color is RGB, with values from 0 to 1. */
  fx = { intensity: 1, color: [1, 1, 1], speed: 1, scale: 1 };

  /** The animation time of the effect, in seconds at speed 1. */
  phase = 0;

  /** The size of the tile frame in scene pixels. */
  tileSize = { width: 1, height: 1 };

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
