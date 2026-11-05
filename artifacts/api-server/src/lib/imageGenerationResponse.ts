/**
 * Network-free response decoder for image results returned as data URLs.
 * Do not accept arbitrary remote URLs: those could expose private prompts
 * and complicate billing/storage. This decoder does not call a provider.
 */
export type GeneratedImage = {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
};
const MAX_GENERATED_BYTES = 15 * 1024 * 1024;
const MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function decodeGeneratedImageDataUrl(value: unknown): GeneratedImage {
  if (typeof value !== 'string') throw Error('IMAGE_RESULT_MISSING');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw Error('IMAGE_RESULT_FORMAT_UNSUPPORTED');
  const mimeType = match[1] as GeneratedImage['mimeType'];
  if (!MIME_TYPES.includes(mimeType)) throw Error('IMAGE_RESULT_TYPE_UNSUPPORTED');
  const encoded = match[2];
  if (encoded.length > Math.ceil(MAX_GENERATED_BYTES / 3) * 4 + 4) throw Error('IMAGE_RESULT_TOO_LARGE');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_GENERATED_BYTES) throw Error('IMAGE_RESULT_TOO_LARGE');
  if (bytes.toString('base64') !== encoded) throw Error('IMAGE_RESULT_INVALID_BASE64');
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!(mimeType === 'image/png' && png || mimeType === 'image/jpeg' && jpeg || mimeType === 'image/webp' && webp)) {
    throw Error('IMAGE_RESULT_MAGIC_MISMATCH');
  }
  return { bytes, mimeType };
}
