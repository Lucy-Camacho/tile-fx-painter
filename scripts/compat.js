/**
 * The code that is different between Foundry v13 and v14.
 * The other files call these functions and do not test the Foundry version.
 */

/** @returns {boolean}  True if Foundry is version 14 or later. */
export function isV14() {
  return game.release.generation >= 14;
}

/**
 * Get the frame of a tile: the rectangle that the mask covers.
 * - v13: x and y are the top-left corner of the frame. The tile turns around the frame center.
 * - v14: x and y are the anchor point (texture.anchorX, texture.anchorY). The tile turns around this point.
 * @param {TileDocument} tileDocument
 * @returns {{centerX: number, centerY: number, width: number, height: number, rotation: number}}
 *   The frame center in scene pixels, the frame size, and the rotation in degrees.
 */
export function getTileFrame(tileDocument) {
  if (isV14()) {
    // The shape center includes the anchor and the rotation. The shape also uses the x and y that Foundry clamps to the scene.
    const { center, width, height, rotation } = tileDocument.shape;
    return { centerX: center.x, centerY: center.y, width, height, rotation };
  }
  const { x, y, width, height, rotation } = tileDocument;
  return { centerX: x + (width / 2), centerY: y + (height / 2), width, height, rotation };
}

/**
 * Tell if a tile update moves, resizes, or turns the tile frame.
 * In v13, the texture anchor moves only the tile image in the frame. In v14, it moves the frame.
 * @param {object} changed  The changed data from the "updateTile" hook.
 * @returns {boolean}
 */
export function changesTileFrame(changed) {
  if (["x", "y", "width", "height", "rotation"].some((key) => key in changed)) return true;
  return isV14() && !!changed.texture && ["anchorX", "anchorY"].some((key) => key in changed.texture);
}

/**
 * Get the background image under a tile, and the placement of the image in the scene.
 * - v13: the scene background. Foundry stretches it to the scene rectangle.
 * - v14: the background of the lowest level of the tile. Foundry draws it as a sprite at the center of the scene
 *   rectangle, with the anchor, offset, fit, scale, and rotation of the level textures.
 * The function uses only the document data, not the canvas.
 * @param {TileDocument} tileDocument
 * @returns {{src: string, x: number, y: number, width: number, height: number, anchorX: number, anchorY: number,
 *   rotation: number, fit: string, scaleX: number, scaleY: number}|null}
 *   (x, y) is the anchor point of the image in scene pixels. width and height are the base size of the fit, as in
 *   PrimarySpriteMesh#resize. The rotation is in degrees. The value is null if there is no background image.
 */
export function getBackgroundSource(tileDocument) {
  const scene = tileDocument.parent;
  if (!scene) return null;

  if (isV14()) {
    const level = getLowestLevel(tileDocument);
    const src = level?.background?.src;
    if (!src) return null;
    const { anchorX, anchorY, offsetX, offsetY, fit, scaleX, scaleY, rotation } = level.textures;
    const { center, width, height } = scene.dimensions.sceneRect;
    return { src, x: center.x + offsetX, y: center.y + offsetY, width, height, anchorX, anchorY, rotation, fit, scaleX, scaleY };
  }

  const src = scene.background?.src;
  if (!src) return null;
  // sceneX and sceneY already include the background offset.
  const { sceneX, sceneY, sceneWidth, sceneHeight } = scene.dimensions;
  return {
    src, x: sceneX, y: sceneY, width: sceneWidth, height: sceneHeight,
    anchorX: 0, anchorY: 0, rotation: 0, fit: "fill", scaleX: 1, scaleY: 1
  };
}

/**
 * Get the lowest v14 level of a tile: the level with the lowest bottom elevation. All users see the same level for
 * a tile, thus the effect does not change with the viewed level.
 * An empty tile "levels" set means all levels of the scene (CanvasDocument#includedInLevel).
 * @param {TileDocument} tileDocument
 * @returns {Level|null}
 */
function getLowestLevel(tileDocument) {
  const sceneLevels = tileDocument.parent.levels;
  const levels = tileDocument.levels.size
    ? Array.from(tileDocument.levels, (id) => sceneLevels.get(id)).filter((level) => level)
    : sceneLevels.contents;
  // A null bottom elevation is -Infinity. For the same elevation, use the level order of the scene.
  const bottom = (level) => level.elevation.bottom ?? -Infinity;
  let lowest = null;
  for (const level of levels) {
    if (!lowest || (bottom(level) < bottom(lowest))
      || ((bottom(level) === bottom(lowest)) && (level.sort < lowest.sort))) lowest = level;
  }
  return lowest;
}
