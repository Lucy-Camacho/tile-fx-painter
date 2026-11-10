import { MODULE_ID } from "./main.js";
import { getBackgroundSource, getSavedTileFrame, getSavedTileImageSource } from "./compat.js";

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
 * Get the scale of a background image in the scene, with the same math as PrimarySpriteMesh#resize.
 * @param {object} source  The background source from getBackgroundSource.
 * @param {number} imageWidth  The size of the image in pixels.
 * @param {number} imageHeight
 * @returns {{scaleX: number, scaleY: number}}  Scene pixels for each image pixel. A negative value mirrors the image.
 */
export function getBackgroundScale({ width, height, fit, scaleX, scaleY }, imageWidth, imageHeight) {
  const fitX = width / imageWidth;
  const fitY = height / imageHeight;
  let sx;
  let sy;
  switch (fit) {
    case "cover": sx = sy = Math.max(fitX, fitY); break;
    case "contain": sx = sy = Math.min(fitX, fitY); break;
    case "width": sx = sy = fitX; break;
    case "height": sx = sy = fitY; break;
    default: sx = fitX; sy = fitY;
  }
  return { scaleX: sx * scaleX, scaleY: sy * scaleY };
}

/**
 * @typedef {object} TileCapture
 * @property {HTMLCanvasElement|null} background
 * @property {HTMLCanvasElement|null} image
 * @property {number} width  The size of the two canvases.
 * @property {number} height
 */

/**
 * The function uses only the saved document data, thus it also works for a scene that is not on the canvas.
 * The two layers have one size for all editor modes, because the mask size and the undo history depend on it.
 * @param {TileDocument} tile
 * @returns {Promise<TileCapture|null>}
 * @throws {Error}  If an image does not load.
 */
export async function captureTile(tile) {
  const sources = [
    { source: getBackgroundSource(tile), label: "scene background" },
    { source: getSavedTileImageSource(tile), label: "tile image" }
  ];

  // Show one warning, not one for each image.
  let video = false;
  for (const entry of sources) {
    if (entry.source && foundry.helpers.media.VideoHelper.hasVideoExtension(entry.source.src)) {
      entry.source = null;
      video = true;
    }
  }
  if (video) ui.notifications.warn("TILE_FX_PAINTER.Editor.VideoNotSupported", { localize: true });

  const layers = await Promise.all(sources.map(({ source, label }) => source && loadLayer(source, label)));
  const [backgroundLayer, imageLayer] = layers;
  if (!backgroundLayer && !imageLayer) return null;

  // Use the higher resolution of the two images, thus no image loses detail.
  const frame = getSavedTileFrame(tile);
  let scale = 0;
  for (const layer of layers) {
    if (layer) scale = Math.max(scale, 1 / Math.abs(layer.scaleX), 1 / Math.abs(layer.scaleY));
  }
  const longest = Math.max(frame.width, frame.height) * scale;
  if (longest > MAX_SIZE) scale *= MAX_SIZE / longest;
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));

  const background = backgroundLayer && drawLayer(backgroundLayer, frame, width, height);
  const image = imageLayer && drawLayer(imageLayer, frame, width, height);
  // No tile alpha, because the user must see the image clearly in the editor.
  if (image) applyTint(image, imageLayer.source.tint);
  return { background, image, width, height };
}

/**
 * @param {object} source  From getBackgroundSource or getSavedTileImageSource.
 * @param {string} label  For the error message.
 * @returns {Promise<{source: object, img: HTMLImageElement, scaleX: number, scaleY: number}|null>}
 *   Null if the image is not visible.
 */
async function loadLayer(source, label) {
  let img;
  try {
    img = await loadImage(source.src);
  } catch (err) {
    throw new Error(`${MODULE_ID} | Cannot load the ${label} "${source.src}"`, { cause: err });
  }
  const { scaleX, scaleY } = getBackgroundScale(source, img.naturalWidth, img.naturalHeight);
  // A texture scale of 0 makes the image invisible on the canvas.
  if (!scaleX || !scaleY) return null;
  return { source, img, scaleX, scaleY };
}

/**
 * @param {{source: object, img: HTMLImageElement, scaleX: number, scaleY: number}} layer
 * @param {ReturnType<import("./compat.js").getSavedTileFrame>} frame
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
function drawLayer({ source, img, scaleX, scaleY }, frame, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  // Change output pixels to scene coordinates. A turn around the frame center gives the same frame as the Foundry
  // rotation, also in v14, where the tile turns around its anchor point.
  // The capture turns the scene in the opposite direction, thus the image edges align with the tile edges.
  // Areas of the tile outside the image stay transparent.
  const ctx = canvas.getContext("2d");
  ctx.translate(width / 2, height / 2);
  ctx.scale(width / frame.width, height / frame.height);
  ctx.rotate(-Math.toRadians(frame.rotation));
  ctx.translate(-frame.centerX, -frame.centerY);

  // Change image pixels to scene coordinates, in the same order as the PIXI transform of the sprite:
  // position, rotation, scale. The anchor point of the image goes to (x, y).
  ctx.translate(source.x, source.y);
  ctx.rotate(Math.toRadians(source.rotation));
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(img, -source.anchorX * img.naturalWidth, -source.anchorY * img.naturalHeight);
  return canvas;
}

/**
 * Tint as Foundry tints the tile mesh. The function changes the pixel data, because a "multiply" composite
 * operation also tints the semi-transparent edge pixels.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} tint  RGB from 0 to 1.
 */
function applyTint(canvas, [r, g, b]) {
  if ((r === 1) && (g === 1) && (b === 1)) return;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    data[i] *= r;
    data[i + 1] *= g;
    data[i + 2] *= b;
  }
  ctx.putImageData(imageData, 0, 0);
}
