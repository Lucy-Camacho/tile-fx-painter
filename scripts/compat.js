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
