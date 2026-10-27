import { MODULE_ID } from "./main.js";
import { getTileFrame } from "./compat.js";

const MAX_SIZE = 4096;

export async function loadImage(src) {
  const img = new Image();
  // The "anonymous" value prevents a tainted canvas when the image is on S3 or a CDN. A tainted canvas cannot give its pixels.
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  return img;
}

/**
 * Capture the part of the scene background image that a tile covers.
 * The function uses only the document data, not the canvas. Thus it also works for a scene that is not on the canvas.
 * The capture follows the tile rotation. The top edge of the capture is the top edge of the tile.
 * @param {TileDocument} tile
 * @returns {Promise<HTMLCanvasElement|null>}  The capture, or null if the scene has no background image that the function can capture.
 * @throws {Error}  If the image does not load.
 */
export async function captureBackground(tile) {
  const scene = tile.parent;
  const src = scene?.background?.src;
  if (!src) return null;

  if (foundry.helpers.media.VideoHelper.hasVideoExtension(src)) {
    ui.notifications.warn("TILE_FX_PAINTER.Editor.VideoNotSupported", { localize: true });
    return null;
  }

  let img;
  try {
    img = await loadImage(src);
  } catch (err) {
    throw new Error(`${MODULE_ID} | Cannot load the scene background "${src}"`, { cause: err });
  }

  // sceneX and sceneY already include the background offset. Foundry stretches the image to this rectangle.
  const { sceneX, sceneY, sceneWidth, sceneHeight } = scene.dimensions;

  // Keep the resolution of the source image. The image can have a different size than the scene.
  const frame = getTileFrame(tile);
  let scale = Math.max(img.naturalWidth / sceneWidth, img.naturalHeight / sceneHeight);
  const longest = Math.max(frame.width, frame.height) * scale;
  if (longest > MAX_SIZE) scale *= MAX_SIZE / longest;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));

  // Change output pixels to scene coordinates. A turn around the frame center gives the same frame as the Foundry
  // rotation, also in v14, where the tile turns around its anchor point.
  // The capture turns the scene in the opposite direction, thus the image edges align with the tile edges.
  // Areas of the tile outside the scene rectangle stay transparent.
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(canvas.width / frame.width, canvas.height / frame.height);
  ctx.rotate(-Math.toRadians(frame.rotation));
  ctx.translate(-frame.centerX, -frame.centerY);
  ctx.drawImage(img, sceneX, sceneY, sceneWidth, sceneHeight);
  return canvas;
}
