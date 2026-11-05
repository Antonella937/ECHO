import { randomUUID } from 'node:crypto';
import { db, echoMediaTable } from '@workspace/db';
import { validMediaHeader } from './mediaSafety';

type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Private generated image storage. Called only after an authenticated, budgeted generation. */
export async function saveGeneratedImage(ownerId: string, bytes: Buffer, mimeType: ImageMime): Promise<string> {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024 || !validMediaHeader(bytes, mimeType)) {
    throw Error('INVALID_GENERATED_IMAGE');
  }
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) throw Error('STORAGE_NOT_CONFIGURED');
  const path = `uploads/${randomUUID()}`;
  const objectPath = `/objects/${path}`;
  const url = `${base}/storage/v1/object/echo-media/${path}`;
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  const response = await fetch(url, {
    method: 'POST', headers: { ...headers, 'Content-Type': mimeType, 'x-upsert': 'false' },
    body: new Uint8Array(bytes), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('GENERATED_IMAGE_STORAGE_FAILED');
  try {
    await db.insert(echoMediaTable).values({ ownerId, objectPath });
  } catch (error) {
    await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(10000) }).catch(() => {});
    throw error;
  }
  return objectPath;
}
