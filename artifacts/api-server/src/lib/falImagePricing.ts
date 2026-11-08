import type { ImageGenerationReference } from './imageGenerationPayload';

// FLUX.2 Pro Edit: $0.03 for first output MP, $0.015 for each
// additional input/output MP. A megapixel is 1024 x 1024 pixels.
// Round each input separately; images over 4 MP are billed as 4 MP.
// Keep this model-specific rate card under review before enabling paid calls.
export const FAL_FIRST_OUTPUT_MP_USD = 0.03;
export const FAL_ADDITIONAL_MP_USD = 0.015;
export const FAL_MP_PIXELS = 1_000_000;
export const FAL_OUTPUT_WIDTH = 768;
export const FAL_OUTPUT_HEIGHT = 1024;
export const FAL_MAX_INPUT_MP_PER_REFERENCE = 2;

export function imageDimensions(ref: ImageGenerationReference): { width: number; height: number } {
  const b = ref.bytes;
  if (ref.mimeType === 'image/png') {
    if (b.length < 24 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('INVALID_PNG_DIMENSIONS');
    return validate(b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (ref.mimeType === 'image/webp') {
    if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') throw Error('INVALID_WEBP_DIMENSIONS');
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return validate(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
    if (kind === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return validate((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (kind === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return validate(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    }
    throw Error('UNSUPPORTED_WEBP_DIMENSIONS');
  }
  if (ref.mimeType === 'image/jpeg') {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw Error('INVALID_JPEG_DIMENSIONS');
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) throw Error('INVALID_JPEG_SEGMENT');
      while (i < b.length && b[i] === 0xff) i++;
      const marker = b[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > b.length) break;
      const length = b.readUInt16BE(i);
      if (length < 2 || i + length > b.length) throw Error('INVALID_JPEG_SEGMENT');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 7) throw Error('INVALID_JPEG_DIMENSIONS');
        return validate(b.readUInt16BE(i + 3), b.readUInt16BE(i + 5));
      }
      i += length;
    }
    throw Error('JPEG_DIMENSIONS_NOT_FOUND');
  }
  throw Error('UNSUPPORTED_IMAGE_FORMAT');
}
function validate(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) throw Error('INVALID_IMAGE_DIMENSIONS');
  return { width, height };
}
export function falProEditEstimatedCostUsd(references: ImageGenerationReference[], outputWidth = FAL_OUTPUT_WIDTH, outputHeight = FAL_OUTPUT_HEIGHT): number {
  if (references.length < 1 || references.length > 4) throw Error('INVALID_FAL_REFERENCE_COUNT');
  const outputMp = Math.max(1, Math.ceil(outputWidth * outputHeight / FAL_MP_PIXELS));
  if (outputMp > 4) throw Error('FAL_OUTPUT_TOO_LARGE');
  let additionalMp = outputMp - 1;
  let totalInputPixels = 0;
  for (const ref of references) {
    const { width, height } = imageDimensions(ref);
    const pixels = width * height;
    if (pixels > FAL_MAX_INPUT_MP_PER_REFERENCE * FAL_MP_PIXELS) throw Error('FAL_REFERENCE_RESOLUTION_EXCEEDS_BUDGET');
    totalInputPixels += pixels;
  }
  // Charge conservatively by rounding each reference up separately.
  // Never underestimate the sum even if the provider rounds aggregate input.
  for (const ref of references) {
    const { width, height } = imageDimensions(ref);
    additionalMp += Math.ceil(width * height / FAL_MP_PIXELS);
  }
  if (totalInputPixels > 9 * FAL_MP_PIXELS) throw Error('FAL_TOTAL_INPUT_RESOLUTION_EXCEEDS_LIMIT');
  return Number((FAL_FIRST_OUTPUT_MP_USD + additionalMp * FAL_ADDITIONAL_MP_USD).toFixed(8));
}
