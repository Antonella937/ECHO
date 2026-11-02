export const mediaLimits: Record<string, number> = {
  'image/jpeg': 15, 'image/png': 15, 'image/webp': 15,
  'video/mp4': 50, 'video/webm': 50,
  'audio/webm': 15, 'audio/ogg': 15, 'audio/mp4': 15, 'audio/mpeg': 15, 'audio/wav': 15,
};
export function validMediaHeader(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (mime.endsWith('/webm')) return bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  if (mime.endsWith('/mp4')) return bytes.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'audio/ogg') return bytes.toString('ascii', 0, 4) === 'OggS';
  if (mime === 'audio/wav') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
  if (mime === 'audio/mpeg') return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  return false;
}
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size < 1) return 'invalid';
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start ||
    (!match[1] && Number(match[2]) <= 0)) return 'invalid';
  return { start, end };
}
