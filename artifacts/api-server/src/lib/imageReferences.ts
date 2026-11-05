import { and, eq, inArray } from 'drizzle-orm';
import { db, echoMediaTable } from '@workspace/db';
import { validMediaHeader } from './mediaSafety';

export type ImageReference = { path: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Buffer };
const valid = (path: string) => /^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(path);

/** Reads private, owner-verified references on the server; never returns credentials to the browser. */
export async function loadImageReferences(ownerId: string, paths: string[]): Promise<ImageReference[]> {
  const unique = [...new Set(paths)];
  if (unique.length > 4 || unique.some(path => !valid(path))) throw Error('INVALID_IMAGE_REFERENCES');
  if (!unique.length) return [];
  const owned = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable)
    .where(and(eq(echoMediaTable.ownerId, ownerId), inArray(echoMediaTable.objectPath, unique)));
  if (owned.length !== unique.length) throw Error('IMAGE_REFERENCE_NOT_OWNED');
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base)) throw Error('STORAGE_NOT_CONFIGURED');
  const result: ImageReference[] = [];
  let total = 0;
  for (const path of unique) {
    const url = `${base.replace(/\/$/, '')}/storage/v1/object/echo-media/${path.slice('/objects/'.length)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, apikey: key }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('IMAGE_REFERENCE_UNAVAILABLE');
    const mimeType = response.headers.get('content-type')?.split(';')[0].toLowerCase();
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') throw Error('INVALID_IMAGE_REFERENCE_MIME');
    if (Number(response.headers.get('content-length') || 0) > 15_000_000) throw Error('IMAGE_REFERENCE_TOO_LARGE');
    const chunks: Buffer[] = [];
    let size = 0;
    if (!response.body) throw Error('IMAGE_REFERENCE_EMPTY');
    for await (const part of response.body) {
      const chunk = Buffer.from(part);
      size += chunk.length;
      if (size > 15_000_000 || total + size > 40_000_000) throw Error('IMAGE_REFERENCE_TOO_LARGE');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length || !validMediaHeader(bytes, mimeType)) throw Error('INVALID_IMAGE_REFERENCE_BYTES');
    total += size;
    result.push({ path, mimeType, bytes });
  }
  return result;
}
