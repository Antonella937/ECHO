// Temporary, disposable-development validation helper. Removed after cleanup.
import { createClerkClient } from '@clerk/express';
import { and, eq, or, getTableName } from 'drizzle-orm';
import { deflateSync } from 'node:zlib';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import * as schema from '@workspace/db';
import { ObjectStorageService } from './src/lib/objectStorage';
import { createStarterUniverse } from '../echo/src/store/create-starter-universe';

const manifest = '../../.local/validation/media-context-compatibility/browser-auth.json';
const evidence = '../../.local/validation/media-context-compatibility/browser-fixture.json';
if (!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) throw new Error('DEVELOPMENT_CLERK_REQUIRED');
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const storage = new ObjectStorageService();
const { db, pool, echoUniversesTable, echoCreatorEntitlementsTable, echoMediaTable } = schema;

async function cleanup() {
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  const user = await clerk.users.getUser(data.ownerId);
  if (user.publicMetadata.echoDisposableMediaValidation !== data.tag) throw new Error('FIXTURE_OWNERSHIP_MISMATCH');
  // The browser must have navigated away before invoking cleanup.
  await clerk.users.deleteUser(data.ownerId);
  if (data.objectPath) {
    const file = await storage.getObjectEntityFile(data.objectPath);
    await file.delete({ ignoreNotFound: true });
  }
  const groups: Record<string, number> = {};
  await db.transaction(async tx => {
    for (const [key, value] of Object.entries(schema)) {
      if (!key.endsWith('Table') || !value || typeof value !== 'object' || key === 'echoUniversesTable') continue;
      const table = value as any;
      const where = table.ownerId ? eq(table.ownerId, data.ownerId) :
        table.sourceOwnerId && table.targetOwnerId
          ? or(eq(table.sourceOwnerId, data.ownerId), eq(table.targetOwnerId, data.ownerId)) : null;
      if (!where) continue;
      await tx.delete(table).where(where);
      groups[getTableName(table)] = (await tx.select().from(table).where(where)).length;
    }
    await tx.delete(echoUniversesTable).where(eq(echoUniversesTable.ownerId, data.ownerId));
    groups.echo_universes = (await tx.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, data.ownerId))).length;
  });
  await writeFile(evidence, JSON.stringify({ cleanup: true, clerkDeleted: true, objectDeleted: true, groups }, null, 2));
  await unlink(manifest);
  console.log(JSON.stringify({ cleanup: true, groups, credentialsRemoved: true }));
}

function png() {
  const crc = (buffer: Buffer) => {
    let value = 0xffffffff;
    for (const byte of buffer) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body));
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(8); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(8 * 33);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const offset = row * 33 + 1 + col * 4;
    pixels.set([232, 145, 186, 255], offset);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function seed() {
  const tag = crypto.randomUUID();
  const user = await clerk.users.createUser({
    emailAddress: [`echo-media-${tag}+clerk_test@example.com`],
    skipPasswordRequirement: true,
    publicMetadata: { echoDisposableMediaValidation: tag },
  });
  const data: Record<string, string> = { ownerId: user.id, tag };
  await writeFile(manifest, JSON.stringify(data), { mode: 0o600 });
  try {
    const upload = await storage.getObjectEntityUploadURL();
    data.objectPath = storage.normalizeObjectEntityPath(upload);
    await writeFile(manifest, JSON.stringify(data), { mode: 0o600 });
    const result = await fetch(upload, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png() });
    if (!result.ok) throw new Error(`FIXTURE_UPLOAD_HTTP_${result.status}`);
    data.objectPath = await storage.trySetObjectEntityAclPolicy(data.objectPath, { owner: user.id, visibility: 'private' });
    await db.insert(echoCreatorEntitlementsTable).values({ ownerId: user.id, plan: 'creator' });
    await db.insert(echoMediaTable).values({ ownerId: user.id, objectPath: data.objectPath });
    for (const universeId of ['primary', 'studio']) {
      const state = createStarterUniverse({ plan: 'creator', universeName: `Media fixture ${universeId}`,
        displayName: 'Media Fixture', username: 'media-fixture', bio: 'Disposable validation only' });
      const author = state.characters[0].id;
      state.characters[0].avatar = data.objectPath;
      state.posts = [{ id: 'shared-post', authorId: author, caption: 'Disposable media compatibility',
        image: data.objectPath, location: '', media: [{ id: 'shared-photo', type: 'image', url: data.objectPath }],
        createdAt: new Date().toISOString(), likes: [], savedBy: [], origin: 'user', illustrative: false }];
      state.stories = [{ id: 'shared-story', authorId: author, image: data.objectPath,
        caption: 'Disposable story', createdAt: new Date().toISOString(), seenBy: [], origin: 'user' }];
      state.messages = [{ id: 'shared-message', senderId: author, recipientId: author, threadId: 'fixture',
        text: '', createdAt: new Date().toISOString(), storyId: null, postId: null, readBy: [], origin: 'user',
        attachments: [{ id: 'attachment', type: 'image', url: data.objectPath }] }];
      await db.insert(echoUniversesTable).values({ ownerId: user.id, universeId, state: state as unknown as Record<string, unknown>,
        revision: 1, sharingEnabled: false, archivedAt: universeId === 'primary' ? new Date() : null });
      data.authorId = author;
    }
    const token = await clerk.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 600 });
    data.ticket = token.token;
    await writeFile(manifest, JSON.stringify(data), { mode: 0o600 });
    await writeFile(evidence, JSON.stringify({ seeded: true, disposableClerk: true, universes: ['primary', 'studio'],
      primaryArchived: true, studioActive: true, sharing: false, realPrivateObject: true }, null, 2));
    console.log('DISPOSABLE_FIXTURE_READY; credentials saved privately, not logged.');
  } catch (error) {
    console.error('FIXTURE_SEED_FAILED', error instanceof Error ? error.name : 'unknown');
    await cleanup();
    throw error;
  }
}

try { if (process.argv[2] === 'cleanup') await cleanup(); else await seed(); }
finally { await pool.end(); }
