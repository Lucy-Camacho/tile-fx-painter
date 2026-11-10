/**
 * The encode of a mask as a small grayscale PNG for the tile flag "mask".
 * The browser encoder writes only RGBA, but the mask has only one channel.
 */

/** The start of an embedded mask value. Other "data:" values are not valid masks. */
export const EMBEDDED_MASK_PREFIX = "data:image/png;base64,";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable = null;

function crc32(bytes, crc = 0xffffffff) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function makeChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  // The CRC includes the type, not the length.
  view.setUint32(8 + data.length, (crc32(chunk.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return chunk;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Packs the values into PNG scanlines, each with the filter that gives the smallest sum of signed bytes.
 * This is the libpng heuristic. It usually gives the best deflate result.
 */
function filterRows(values, width, height, bitDepth) {
  const rowBytes = Math.ceil((width * bitDepth) / 8);
  const levels = (1 << bitDepth) - 1;
  const pixelsPerByte = 8 / bitDepth;
  const out = new Uint8Array(height * (rowBytes + 1));
  let prev = new Uint8Array(rowBytes);
  let row = new Uint8Array(rowBytes);
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(rowBytes));

  for (let y = 0; y < height; y++) {
    const src = y * width;
    if (bitDepth === 8) row.set(values.subarray(src, src + width));
    else {
      row.fill(0);
      for (let x = 0; x < width; x++) {
        const v = Math.round((values[src + x] * levels) / 255);
        const shift = 8 - bitDepth * ((x % pixelsPerByte) + 1);
        row[(x / pixelsPerByte) | 0] |= v << shift;
      }
    }

    // A pixel below 8 bits uses the byte to the left as its neighbor, as the PNG standard says.
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const line = candidates[f];
      let sum = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i > 0 ? row[i - 1] : 0;
        const b = prev[i];
        const c = i > 0 ? prev[i - 1] : 0;
        let p;
        if (f === 0) p = 0;
        else if (f === 1) p = a;
        else if (f === 2) p = b;
        else if (f === 3) p = (a + b) >> 1;
        else p = paeth(a, b, c);
        const d = (row[i] - p) & 0xff;
        line[i] = d;
        sum += d < 128 ? d : 256 - d;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    const offset = y * (rowBytes + 1);
    out[offset] = best;
    out.set(candidates[best], offset + 1);
    [prev, row] = [row, prev];
  }
  return out;
}

async function deflate(bytes) {
  // The "deflate" format is zlib (RFC 1950), which is the format that PNG needs.
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Make a grayscale PNG (color type 0) from one mask value for each pixel.
 * @param {Uint8Array|Uint8ClampedArray} values  The mask values, 0 to 255, row by row.
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {1|2|4|8} [options.bitDepth=8]  A depth below 8 rounds each value to fewer levels.
 * @returns {Promise<Blob>}
 */
export async function encodeMaskPng(values, width, height, { bitDepth = 8 } = {}) {
  if (![1, 2, 4, 8].includes(bitDepth)) throw new Error(`Bit depth ${bitDepth} is not valid`);
  if (values.length !== width * height) throw new Error(`The mask has ${values.length} values, not ${width * height}`);

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = bitDepth;
  // Color type 0 (grayscale), compression 0, filter method 0, no interlace.
  const idat = await deflate(filterRows(values, width, height, bitDepth));

  return new Blob(
    [PNG_SIGNATURE, makeChunk("IHDR", header), makeChunk("IDAT", idat), makeChunk("IEND", new Uint8Array(0))],
    { type: "image/png" }
  );
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}  A "data:" URL.
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {unknown} src  A value of the tile flag "mask".
 * @returns {boolean}  True if the value is an embedded PNG mask, not a file path.
 */
export function isEmbeddedMask(src) {
  return typeof src === "string" && src.startsWith(EMBEDDED_MASK_PREFIX);
}

/**
 * The size of the PNG data in an embedded mask, from the base64 length.
 * @param {string} src  An embedded mask.
 * @returns {number}  The size in bytes.
 */
export function getEmbeddedMaskSize(src) {
  const data = src.length - EMBEDDED_MASK_PREFIX.length;
  const padding = src.endsWith("==") ? 2 : src.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data * 3) / 4) - padding);
}

/**
 * A short text for a mask in messages, because an embedded mask can have millions of characters.
 * @param {string} src  A value of the tile flag "mask".
 * @returns {string}
 */
export function getMaskLabel(src) {
  if (!isEmbeddedMask(src)) return String(src);
  const size = Math.max(1, Math.round(getEmbeddedMaskSize(src) / 1024));
  return game.i18n.format("TILE_FX_PAINTER.Editor.EmbeddedMaskLabel", { size });
}
