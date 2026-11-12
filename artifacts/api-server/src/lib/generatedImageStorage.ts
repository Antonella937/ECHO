import { randomUUID } from 'node:crypto';
import { db, echoMediaTable } from '@workspace/db';
import { validMediaHeader } from './mediaSafety';
import { configuredR2, signR2Request } from './cloudflareR2';

type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Private generated image storage. Called only after an authenticated, budgeted generation. */
export async function saveGeneratedImage(ownerId: string, bytes: Buffer, mimeType: ImageMime): Promise<string> {
  validateGeneratedImage(bytes, mimeType);
  if (process.env.ECHO_STORAGE_PROVIDER === 'r2') {
    const r2 = configuredR2();
    if (!r2) throw Error('R2_NOT_CONFIGURED');
    const objectPath = `/objects/r2/${randomUUID()}`;
    const response = await fetch(signR2Request(r2, 'PUT', objectPath.slice('/objects/'.length)), {
      method: 'PUT', headers: { 'Content-Type': mimeType }, body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('GENERATED_IMAGE_STORAGE_FAILED');
    await db.insert(echoMediaTable).values({ ownerId, objectPath });
    return objectPath;
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
    // Supabase Storage removes an object through the authenticated object path.
    await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(10000) }).catch(() => {});
    throw error;
  }
  return objectPath;
}

/** Offline validation before any Supabase write or database mutation. */
export function validateGeneratedImage(bytes: Buffer, mimeType: ImageMime): void {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024 || !validMediaHeader(bytes, mimeType)) {
    throw Error('INVALID_GENERATED_IMAGE');
  }
}
