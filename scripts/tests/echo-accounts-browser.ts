/**
 * Uses real Clerk development sessions in disposable universes, never an auth
 * bypass or the owner's account. Deletes ONLY the users/files it creates.
 */
import { chromium, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { runUxChecks } from './echo-ux-checks';
import { runCharacterChecks } from './echo-character-checks';
import { runCarouselChecks } from './echo-carousel-checks';
import { runSocialChecks } from './echo-social-checks';

const serverRequire = createRequire(new URL('../../artifacts/api-server/package.json', import.meta.url));
const { clerkClient } = serverRequire('@clerk/express');
const {
  db, pool, echoUniversesTable, echoMediaTable,
  echoAutonomyRunsTable, echoAutonomyOwnersTable, echoAutonomyCharactersTable,
} = serverRequire('@workspace/db');
const { eq, inArray } = serverRequire('drizzle-orm');
const { ObjectStorageService } = await import('../../artifacts/api-server/src/lib/objectStorage');
const base = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80';
if (process.env.NODE_ENV === 'production'
  || !process.env.CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')
  || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')
  || (process.env.REPLIT_DEV_DOMAIN && !process.env.REPLIT_DEV_DOMAIN.endsWith('.replit.dev'))) {
  throw Error('ECHO_BROWSER_TEST_REQUIRES_CLERK_DEVELOPMENT_ENVIRONMENT');
}
const chromiumPath = (await readdir('/nix/store')).find(p => p.includes('playwright-chromium-cjk'));
if (!chromiumPath) throw Error('Chromium is required for this browser test.');
const browser = await chromium.launch({ executablePath: `/nix/store/${chromiumPath}/chrome-linux/chrome`, args: ['--no-sandbox'] });
const created: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=', 'base64');
const nonce = Date.now().toString(36);
const out = new URL('../../generated-artifacts/echo-stage2/', import.meta.url).pathname;
await mkdir(out, { recursive: true });
async function createUser() {
  const user = await clerkClient.users.createUser({ emailAddress: [`echo_${nonce}_${created.length}+clerk_test@example.com`], skipPasswordRequirement: true });
  created.push(user.id); return user.id;
}
async function signedIn(userId: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds: 120 });
  await page.goto(`${base}/sign-in`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded, { timeout: 30000 });
  await page.evaluate(async token => {
    const clerk = (window as any).Clerk;
    const attempt = await clerk.client.signIn.create({ strategy: 'ticket', ticket: token });
    if (attempt.status !== 'complete') throw Error(`Test sign-in status: ${attempt.status}`);
    await clerk.setActive({ session: attempt.createdSessionId });
  }, ticket.token);
  await page.goto(base);
  await expect.poll(async () => (await state(page))?.characters?.length, { timeout: 30000 }).toBe(9);
  return page;
}
async function state(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const response = await fetch('/api/universe', { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()).state;
  });
}
try {
  const owner = await createUser(), page = await signedIn(owner);
  const initial = await state(page);
  assert.equal(initial.currentCharacterId, 'nela');
  if (process.env.ECHO_AUTONOMY_BLOCKER_AUDIT === '1') {
    const envelope = async () => {
      const response = await page.context().request.get(`${base}/api/universe`, { headers: { 'cache-control': 'no-store' } });
      assert.equal(response.status(), 200);
      return response.json();
    };
    const baseline = await envelope();
    const settingsResponse = await page.context().request.get(`${base}/api/autonomy/settings`);
    assert.equal(settingsResponse.status(), 200);
    const settings = await settingsResponse.json();
    assert.equal(settings.liveExecutionEnabled, false);
    assert.ok(settings.characters.every((character: any) => character.enabled === false));
    assert.ok(settings.globalKillSwitchEngaged);
    assert.equal(baseline.state.messages.length, 0, 'the default disposable universe has no DM reaction target');

    const now = Date.now();
    const eligible = ['nela', 'mar', 'noah'].map((characterId) => {
      const follows = new Set(baseline.state.follows[characterId] ?? []);
      const recent30d = (value: string) => {
        const time = new Date(value).getTime();
        return Number.isFinite(time) && time <= now && now - time < 30 * 24 * 60 * 60_000;
      };
      const posts = baseline.state.posts.filter((post: any) =>
        post.authorId !== characterId && follows.has(post.authorId) && !!post.caption?.trim() &&
        !post.likes.includes(characterId) && recent30d(post.createdAt),
      );
      const comments = baseline.state.comments.filter((comment: any) => {
        const parent = baseline.state.posts.find((post: any) => post.id === comment.postId);
        return !!parent && comment.authorId !== characterId && !!comment.text?.trim() &&
          (follows.has(parent.authorId) || !!parent.taggedAccountIds?.includes(characterId)) &&
          !comment.likes.includes(characterId) && recent30d(comment.createdAt);
      });
      const stories = baseline.state.stories.filter((story: any) => {
        const age = now - new Date(story.createdAt).getTime();
        return story.authorId !== characterId && story.caption.trim() && story.seenBy.includes(characterId) &&
          (follows.has(story.authorId) || !!story.mentionedAccountIds?.includes(characterId)) &&
          age >= 0 && age < 24 * 60 * 60_000;
      });
      return { characterId, postTargets: posts.length, commentTargets: comments.length, storyTargets: stories.length };
    });

    const attempts: any[] = [];
    for (const characterId of ['nela', 'mar', 'noah']) {
      const response = await page.context().request.post(`${base}/api/autonomy/dry-run`, {
        data: { characterId, idempotencyKey: randomUUID() },
      });
      assert.equal(response.status(), 200, `authenticated dry-run route failed for ${characterId}`);
      const result = await response.json();
      assert.equal(result.mode, 'dry_run');
      assert.equal(result.liveExecutionEnabled, false);
      assert.equal(result.socialActionsExecuted, false);
      const after = await envelope();
      assert.deepEqual(after, baseline, `dry-run changed the disposable social universe for ${characterId}`);
      attempts.push({
        characterId,
        status: result.status,
        reasonCode: result.reasonCode,
        providerCalled: Boolean(result.preview),
        ...(result.preview ? {
          model: result.preview.model,
          provider: result.preview.provider,
          validatorAccepted: true,
          decision: {
            action: result.preview.decision.action,
            situation: result.preview.decision.situation,
            reaction: result.preview.decision.reaction ?? null,
          },
          cost: result.preview.usage.cost,
          fallbacks: result.preview.attempts.map((attempt: any) => ({
            model: attempt.model, outcome: attempt.outcome, code: attempt.code,
          })),
        } : {}),
      });
      if (result.preview) {
        assert.ok(String(result.preview.model).endsWith(':free'), 'a non-free model response must be rejected');
        assert.ok(result.preview.usage.cost == null || result.preview.usage.cost <= 0, 'a nonzero-cost response must be rejected');
        assert.ok(result.preview.attempts.every((attempt: any) => String(attempt.model).endsWith(':free')));
      }
      if (characterId !== 'noah') await new Promise((resolve) => setTimeout(resolve, 5200));
    }
    console.log(JSON.stringify({
      audit: 'authenticated-disposable-owner-dry-run-blocker-check',
      ownerIsDisposable: true,
      targetAvailability: {
        postLikeCandidates: eligible.reduce((sum, row) => sum + row.postTargets, 0),
        commentLikeCandidates: eligible.reduce((sum, row) => sum + row.commentTargets, 0),
        storyReactionCandidates: eligible.reduce((sum, row) => sum + row.storyTargets, 0),
        dmReactionCandidates: baseline.state.messages.filter((message: any) =>
          message.recipientId === 'mar' && message.senderId !== 'mar' && message.text?.trim(),
        ).length,
      },
      attempts,
      universeUnchanged: true,
      liveExecutionEnabled: false,
      characterOptInsEnabled: false,
    }));
  } else if (process.env.ECHO_AUTH_ONLY === '1') {
    const secondOwner = await createUser();
    const secondPage = await signedIn(secondOwner);
    const firstStateBefore = await state(page);
    const secondStateBefore = await state(secondPage);
    const universeRowsBefore = await db.select({
      ownerId: echoUniversesTable.ownerId,
      revision: echoUniversesTable.revision,
      state: echoUniversesTable.state,
    }).from(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, [owner, secondOwner]));
    assert.equal(universeRowsBefore.length, 2, 'both disposable owners must have separate persisted universes');
    assert.notEqual(owner, secondOwner);
    assert.deepEqual(universeRowsBefore.find((row: any) => row.ownerId === owner)?.state, firstStateBefore);
    assert.deepEqual(universeRowsBefore.find((row: any) => row.ownerId === secondOwner)?.state, secondStateBefore);

    const getSettings = async (testPage: Page) => {
      const response = await testPage.context().request.get(`${base}/api/autonomy/settings`);
      assert.equal(response.status(), 200, 'authenticated owner settings request must succeed');
      return response.json();
    };
    const firstSettings = await getSettings(page);
    const secondSettings = await getSettings(secondPage);
    for (const [settings, universeState] of [[firstSettings, firstStateBefore], [secondSettings, secondStateBefore]] as const) {
      assert.equal(settings.liveExecutionEnabled, false);
      assert.equal(settings.characters.length, universeState.characters.length);
      assert.deepEqual(
        settings.characters.map((character: any) => character.characterId).sort(),
        universeState.characters.filter((character: any) => !character.archived).map((character: any) => character.id).sort(),
      );
      assert.ok(settings.characters.every((character: any) => character.enabled === false));
    }

    const anonymous = await browser.newContext();
    try {
      assert.equal((await anonymous.request.get(`${base}/api/autonomy/settings`)).status(), 401);
      assert.equal((await anonymous.request.get(`${base}/api/universe`)).status(), 401);
    } finally {
      await anonymous.close();
    }
    assert.deepEqual(await state(page), firstStateBefore);
    assert.deepEqual(await state(secondPage), secondStateBefore);
    const universeRowsAfter = await db.select({
      ownerId: echoUniversesTable.ownerId,
      revision: echoUniversesTable.revision,
      state: echoUniversesTable.state,
    }).from(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, [owner, secondOwner]));
    const sortRows = (rows: any[]) => rows.sort((left, right) => left.ownerId.localeCompare(right.ownerId));
    assert.deepEqual(
      sortRows(universeRowsAfter),
      sortRows(universeRowsBefore),
      'read-only authentication checks must not mutate either universe',
    );
    console.log('PASS: real Clerk development sign-in, owner-scoped universe/settings reads, anonymous 401s, isolated disposable owners, no social actions or universe changes.');
  } else if (process.env.ECHO_SOCIAL_ONLY === '1') {
    await runSocialChecks(page, state, base);
  } else if (process.env.ECHO_CAROUSEL_ONLY === '1') {
    await runCarouselChecks(page, state, base, out, () => signedIn(owner), async () => signedIn(await createUser()));
  } else if (process.env.ECHO_CHARACTERS_ONLY === '1') {
    await runCharacterChecks(page, state, base, out);
  } else if (process.env.ECHO_UX_ONLY === '1') {
    await runUxChecks(page, state, base, out);
  } else if (process.env.ECHO_VISUAL_ONLY === '1') {
    await page.goto(`${base}/profile/official-pretty-violence`);
    await expect(page.getByTestId('text-profile-name')).toContainText('Pretty Violence', { timeout: 30000 });
    await page.screenshot({ path: `${out}profile-mobile.jpg` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `${out}profile-desktop.jpg` });
    console.log('PASS: rendered signed-in mobile/desktop profiles with no horizontal overflow.');
  } else {
  await page.goto(`${base}/settings`);
  await page.getByTestId('button-create-account').click();
  await page.getByTestId('input-account-name').fill('Cuenta prueba ECHO');
  await page.getByTestId('input-account-handle').fill(`prueba_${nonce}`);
  await page.getByTestId('input-account-bio').fill('Bio de prueba, universo privado.');
  await page.getByTestId('select-account-type').selectOption('band');
  await page.getByTestId('checkbox-account-verified').check();
  await page.getByTestId('input-base-followers').fill('50000');
  await page.getByTestId('input-base-following').fill('20');
  await page.getByTestId('input-avatar-file').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('button-create-account-submit')).toBeEnabled({ timeout: 30000 });
  await page.screenshot({ path: `${out}editor-mobile.jpg` });
  await page.getByTestId('button-create-account-submit').click();
  await expect.poll(async () => (await state(page))?.characters?.length, { timeout: 30000 }).toBe(10);
  let saved = await state(page);
  const account = saved.characters.find((c: any) => c.handle === `prueba_${nonce}`);
  assert.ok(account?.avatar.startsWith('/objects/uploads/'));
  assert.equal(account.verified, true); assert.equal(account.displayMetrics.followers, 50000);
  assert.deepEqual(saved.posts, initial.posts);
  // Every official account is an operable identity, not a decorative profile.
  for (const id of ['official-pretty-violence', 'official-false-halo', 'official-saint-vulture', 'official-stray-kids', 'official-the-hollow', 'official-dead-static', account.id]) {
    await page.getByTestId(`radio-identity-${id}`).click();
    await expect.poll(async () => (await state(page))?.currentCharacterId).toBe(id);
  }
  await page.goto(`${base}/create`);
  await expect(page.getByTestId('text-posting-as')).toContainText('Cuenta prueba ECHO');
  await page.getByTestId('input-file').setInputFiles({ name: 'post.png', mimeType: 'image/png', buffer: png });
  await page.getByTestId('input-caption').fill('Post manual desde una cuenta creada dentro de ECHO');
  await page.getByTestId('button-publish').click();
  await expect.poll(async () => (await state(page))?.posts?.length, { timeout: 30000 }).toBe(initial.posts.length + 1);
  saved = await state(page);
  const post = saved.posts.find((p: any) => p.authorId === account.id);
  assert.ok(post);
  await page.goto(`${base}/p/${post.id}`);
  await page.getByTestId(`button-edit-metrics-${post.id}`).click();
  await page.getByTestId('input-metric-likes').fill('900000');
  await page.getByTestId('input-metric-comments').fill('700');
  await page.getByTestId('button-save-metrics').click();
  await expect.poll(async () => (await state(page))?.posts.find((p: any) => p.id === post.id)?.displayMetrics?.likes).toBe(900000);
  assert.equal((await state(page)).posts.find((p: any) => p.id === post.id).likes.length, 0);
  await page.goto(`${base}/profile/${account.id}`);
  await expect(page.getByTestId('text-profile-name')).toContainText('Cuenta prueba ECHO');
  await page.screenshot({ path: `${out}profile-mobile.jpg` });
  await page.getByTestId('button-profile-edit').click();
  await page.getByTestId('input-account-bio').fill('Bio editada y persistente');
  await page.getByTestId('button-save-account').click();
  await expect.poll(async () => (await state(page))?.characters.find((c: any) => c.id === account.id)?.bio).toBe('Bio editada y persistente');
  await page.getByTestId('button-profile-edit').click();
  await page.getByTestId('button-archive-account').click();
  await page.getByTestId('button-confirm-archive').click();
  await expect.poll(async () => (await state(page))?.currentCharacterId).toBe('nela');
  saved = await state(page);
  assert.equal(saved.characters.find((c: any) => c.id === account.id).archived, true);
  assert.ok(saved.posts.some((p: any) => p.id === post.id));
  await page.getByTestId('button-profile-edit').click();
  await page.getByTestId('button-restore-account').click();
  await expect.poll(async () => (await state(page))?.characters.find((c: any) => c.id === account.id)?.archived).toBe(false);
  await page.reload();
  await expect(page.getByTestId('text-profile-bio')).toHaveText('Bio editada y persistente');
  // A second independent browser session sees the saved account and content.
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const second = await context2.newPage();
  const secondTicket = await clerkClient.signInTokens.createSignInToken({ userId: owner, expiresInSeconds: 120 });
  await second.goto(`${base}/sign-in`);
  await second.waitForFunction(() => (window as any).Clerk?.loaded);
  await second.evaluate(async token => {
    const c = (window as any).Clerk;
    const s = await c.client.signIn.create({ strategy: 'ticket', ticket: token });
    await c.setActive({ session: s.createdSessionId });
  }, secondTicket.token);
  await second.goto(`${base}/settings`);
  await expect(second.getByTestId(`radio-identity-${account.id}`)).toBeVisible({ timeout: 30000 });
  assert.equal((await state(second)).posts.find((p: any) => p.id === post.id).displayMetrics.likes, 900000);
  const otherOwner = await createUser(), other = await signedIn(otherOwner);
  assert.equal((await state(other)).characters.some((c: any) => c.id === account.id), false);
  const mediaURL = `${base}/api/storage${account.avatar}`;
  const denied = await other.request.get(mediaURL);
  assert.ok([403, 404].includes(denied.status()));
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(`${base}/api/universe`)).status(), 401);
  assert.equal((await anonymous.request.get(mediaURL)).status(), 401);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${out}profile-desktop.jpg` });
  console.log('PASS: real private login, account creation/edit/upload, six official identities, manual post, visual metrics, archive/restore, reload, second session and cross-owner/anonymous isolation.');
  }
} finally {
  await browser.close();
  // Never touch any owner except the random users created in this run.
  for (const owner of created) {
    await db.delete(echoAutonomyRunsTable).where(eq(echoAutonomyRunsTable.ownerId, owner));
    await db.delete(echoAutonomyCharactersTable).where(eq(echoAutonomyCharactersTable.ownerId, owner));
    await db.delete(echoAutonomyOwnersTable).where(eq(echoAutonomyOwnersTable.ownerId, owner));
    const files = await db.select().from(echoMediaTable).where(eq(echoMediaTable.ownerId, owner));
    const storage = new ObjectStorageService();
    for (const media of files) {
      try { await (await storage.getObjectEntityFile(media.objectPath)).delete(); } catch { /* a failed upload can have no bytes */ }
    }
    await db.delete(echoMediaTable).where(eq(echoMediaTable.ownerId, owner));
    await db.delete(echoUniversesTable).where(eq(echoUniversesTable.ownerId, owner));
    await clerkClient.users.deleteUser(owner);
  }
  await pool.end();
}
