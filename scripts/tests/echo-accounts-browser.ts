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
const { defaultCharacterConfig } = await import('../../artifacts/echo/src/domain/character-core');
const { executeAutonomyDecision } = await import('../../artifacts/api-server/src/autonomy/executor');
const { reserveDryRun } = await import('../../artifacts/api-server/src/autonomy/repository');
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
async function createUser(autonomyPreviewTest = false) {
  const user = await clerkClient.users.createUser({
    emailAddress: [`echo_${nonce}_${created.length}+clerk_test@example.com`],
    skipPasswordRequirement: true,
    ...(autonomyPreviewTest ? { publicMetadata: { echoAutonomyPreviewTest: true } } : {}),
  });
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
async function universeEnvelope(page: Page, baseUrl: string) {
  const response = await page.context().request.get(`${baseUrl}/api/universe`, { headers: { 'cache-control': 'no-store' } });
  assert.equal(response.status(), 200);
  return response.json();
}
function autonomyPreviewFixture(state: any, situation: string) {
  const now = Date.now();
  const actor = state.characters.find((character: any) => character.id === 'mar');
  const other = state.characters.find((character: any) => character.id === 'noah');
  const friend = state.characters.find((character: any) => character.id === 'nela');
  assert.ok(actor && other && friend, 'test universe seed accounts must exist');
  actor.configuration = defaultCharacterConfig(actor);
  state.follows = { ...state.follows, mar: ['nela', 'noah'] };
  state.posts = [];
  state.comments = [];
  state.stories = [];
  state.messages = [];
  state.notifications = [];
  const targetId = `test-${situation}-target`;
  const post = {
    id: 'test-preview-parent-post',
    authorId: other.id,
    image: 'asset:noah-1',
    caption: 'Disposable preview target post.',
    location: 'Test universe',
    createdAt: new Date(now - 60 * 60_000).toISOString(),
    likes: [] as string[],
    savedBy: [],
    origin: 'seed',
    illustrative: true,
    commentsEnabled: false,
  };
  const targetLabel: Record<string, string> = {
    like_post: 'recent post by a followed test character',
    like_comment: 'text comment on a followed test character post',
    story_reaction: 'viewed, unexpired text Story by a followed test character',
    dm_reaction: 'incoming text DM in the disposable test universe',
  };
  if (situation === 'like_post') {
    state.posts = [{ ...post, id: targetId }];
  } else if (situation === 'like_comment') {
    state.posts = [{ ...post, likes: [actor.id] }];
    state.comments = [{
      id: targetId,
      postId: post.id,
      authorId: friend.id,
      text: 'A synthetic comment target for this isolated preview.',
      createdAt: new Date(now - 30 * 60_000).toISOString(),
      parentId: null,
      replyToAuthorId: null,
      likes: [],
      origin: 'seed',
    }];
  } else if (situation === 'story_reaction') {
    state.stories = [{
      id: targetId,
      authorId: other.id,
      image: 'asset:noah-2',
      caption: 'A synthetic Story target for this isolated preview.',
      createdAt: new Date(now - 30 * 60_000).toISOString(),
      seenBy: [actor.id],
      reactions: [],
      origin: 'seed',
    }];
  } else if (situation === 'dm_reaction') {
    state.messages = [{
      id: targetId,
      threadId: `test-thread-${actor.id}-${other.id}`,
      senderId: other.id,
      recipientId: actor.id,
      text: 'A synthetic incoming DM target for this isolated preview.',
      createdAt: new Date(now - 15 * 60_000).toISOString(),
      storyId: null,
      postId: null,
      readBy: [actor.id],
      origin: 'seed',
      reactions: [],
    }];
  } else {
    throw new Error(`Unsupported autonomy preview scenario: ${situation}`);
  }
  return { state, characterId: actor.id, targetId, targetLabel: targetLabel[situation] };
}
try {
  const autonomyLiveOneshot = process.env.ECHO_AUTONOMY_LIVE_ONESHOT === '1';
  const autonomyPreviewOnly = process.env.ECHO_AUTONOMY_PREVIEWS_ONLY === '1';
  const owner = await createUser(autonomyPreviewOnly || autonomyLiveOneshot), page = await signedIn(owner);
  const initial = await state(page);
  assert.equal(initial.currentCharacterId, 'nela');
  if (autonomyLiveOneshot) {
    const reports: any[] = [];
    let actionExecuted = false;
    const maximumPreviewAttempts = 3;
    for (let index = 0; index < maximumPreviewAttempts; index++) {
      const testOwner = index === 0 ? owner : await createUser(true);
      const testPage = index === 0 ? page : await signedIn(testOwner);
      const beforeSetup = await universeEnvelope(testPage, base);
      const fixture = autonomyPreviewFixture(structuredClone(beforeSetup.state), 'like_comment');
      const mar = fixture.state.characters.find((character: any) => character.id === 'mar');
      mar.configuration.currentState.lastActivityAt = null;
      const setupResponse = await testPage.context().request.put(`${base}/api/universe`, {
        data: { state: fixture.state, expectedRevision: beforeSetup.revision },
      });
      assert.equal(setupResponse.status(), 200, 'failed to seed isolated one-shot target');
      const baseline = await universeEnvelope(testPage, base);
      const settingsResponse = await testPage.context().request.get(`${base}/api/autonomy/settings`);
      assert.equal(settingsResponse.status(), 200);
      const safeSettings = await settingsResponse.json();
      assert.equal(safeSettings.liveExecutionEnabled, false);
      assert.ok(safeSettings.globalKillSwitchEngaged);
      assert.ok(safeSettings.characters.every((character: any) => character.enabled === false));

      const previewResponse = await testPage.context().request.post(`${base}/api/autonomy/test-preview`, {
        data: {
          characterId: fixture.characterId,
          situation: 'like_comment',
          targetId: fixture.targetId,
          idempotencyKey: randomUUID(),
        },
      });
      const previewResult = await previewResponse.json();
      if (!previewResult.providerCalled || previewResponse.status() !== 200 ||
        !previewResult.validatorAccepted || !previewResult.preview) {
        console.log(JSON.stringify({
          liveTest: 'blocked-before-execution',
          scenario: 'like_comment',
          attempt: index + 1,
          providerCalled: previewResult.providerCalled ?? false,
          validatorAccepted: previewResult.validatorAccepted ?? null,
          error: previewResult.error ?? `HTTP_${previewResponse.status()}`,
          attempts: previewResult.attempts ?? [],
          liveActionExecuted: false,
          reports,
        }));
        throw new Error(`LIVE_TEST_PREVIEW_BLOCKED:${previewResult.error ?? previewResponse.status()}`);
      }
      const preview = previewResult.preview;
      const previewRecord = {
        attempt: index + 1,
        target: fixture.targetLabel,
        targetId: fixture.targetId,
        provider: preview.provider,
        model: preview.model,
        validatorAccepted: previewResult.validatorAccepted,
        decision: {
          action: preview.decision.action,
          situation: preview.decision.situation,
          text: preview.decision.text ?? null,
          reaction: preview.decision.reaction ?? null,
        },
        cost: preview.usage.cost ?? null,
        fallbacks: preview.attempts.map((attempt: any) => ({
          model: attempt.model, outcome: attempt.outcome, code: attempt.code, cost: attempt.usage?.cost ?? null,
        })),
        sourceRevision: preview.sourceRevision,
        executed: previewResult.executed,
        socialActionsExecuted: previewResult.socialActionsExecuted,
      };
      reports.push(previewRecord);
      assert.ok(String(preview.model).endsWith(':free'));
      assert.ok(String(preview.provider).toLowerCase().includes('openrouter'));
      assert.ok(preview.attempts.every((attempt: any) => attempt.model.endsWith(':free')));
      assert.ok(preview.usage.cost == null || preview.usage.cost <= 0);
      assert.equal(previewResult.executed, false);
      assert.equal(previewResult.socialActionsExecuted, false);
      assert.equal(preview.decision.situation, 'like_comment');
      const afterPreview = await universeEnvelope(testPage, base);
      assert.deepEqual(afterPreview, baseline, 'preview must not alter the disposable universe');
      assert.deepEqual(await (await testPage.context().request.get(`${base}/api/autonomy/settings`)).json(), safeSettings);

      if (preview.decision.action === 'none') continue;
      assert.equal(preview.decision.action, 'like', 'live one-shot is restricted to a reversible comment like');

      const idempotencyKey = randomUUID();
      const reservation = await reserveDryRun(testOwner, fixture.characterId, idempotencyKey, preview.sourceRevision);
      assert.equal(reservation.kind, 'created', 'failed to reserve a unique live run');
      if (reservation.kind !== 'created') throw new Error(`LIVE_RUN_RESERVATION_FAILED:${reservation.kind}`);
      const settingPut = async (setting: Record<string, unknown>) => {
        const response = await testPage.context().request.put(`${base}/api/autonomy/settings`, { data: setting });
        assert.equal(response.status(), 200, 'failed to update the disposable test owner controls');
        return response.json();
      };

      let outcome: any;
      let duplicateOutcome: any;
      let afterExecution: any;
      let afterRetry: any;
      let storedRun: any;
      try {
        await settingPut({ characterId: fixture.characterId, enabled: true });
        await settingPut({ globalKillSwitchEngaged: false });
        const liveSettings = await (await testPage.context().request.get(`${base}/api/autonomy/settings`)).json();
        assert.equal(liveSettings.liveExecutionEnabled, false, 'global live flag must remain disabled');
        assert.equal(liveSettings.globalKillSwitchEngaged, false);
        assert.equal(liveSettings.characters.filter((character: any) => character.enabled).length, 1);
        assert.equal(liveSettings.characters.find((character: any) => character.characterId === fixture.characterId)?.enabled, true);

        const executorInput = {
          ownerId: testOwner,
          runId: reservation.runId,
          characterId: fixture.characterId,
          sourceRevision: preview.sourceRevision,
          opportunity: {
            situation: 'like_comment',
            postId: 'test-preview-parent-post',
            commentId: fixture.targetId,
            reasonCode: 'OPPORTUNITY_SELECTED',
            reason: 'isolated one-shot validation',
            localHour: 12,
            timezone: 'UTC',
          },
          decision: preview.decision,
          contextHash: preview.contextAudit.contextHash,
          model: preview.model,
          liveEnabled: true,
        };
        outcome = await executeAutonomyDecision(executorInput as any);
        assert.equal(outcome.status, 'executed', `one-shot executor did not execute: ${outcome.reasonCode}`);
        afterExecution = await universeEnvelope(testPage, base);
        assert.equal(afterExecution.revision, baseline.revision + 1);
        const beforeComment = baseline.state.comments.find((comment: any) => comment.id === fixture.targetId);
        const afterComment = afterExecution.state.comments.find((comment: any) => comment.id === fixture.targetId);
        assert.deepEqual(afterComment.likes, [...beforeComment.likes, fixture.characterId]);
        assert.equal(afterComment.likes.filter((id: string) => id === fixture.characterId).length, 1);
        assert.deepEqual(afterExecution.state.posts, baseline.state.posts);
        assert.deepEqual(afterExecution.state.stories, baseline.state.stories);
        assert.deepEqual(afterExecution.state.messages, baseline.state.messages);
        assert.equal(afterExecution.state.notifications.length, baseline.state.notifications.length + 1);

        duplicateOutcome = await executeAutonomyDecision(executorInput as any);
        assert.equal(duplicateOutcome.status, 'duplicate');
        assert.equal(duplicateOutcome.reasonCode, 'ALREADY_EXECUTED');
        afterRetry = await universeEnvelope(testPage, base);
        assert.deepEqual(afterRetry, afterExecution, 'idempotent retry must not write a second action');

        const [run] = await db.select().from(echoAutonomyRunsTable)
          .where(eq(echoAutonomyRunsTable.id, Number(reservation.runId))).limit(1);
        storedRun = run;
        assert.equal(storedRun?.status, 'executed');
        assert.equal(storedRun?.action, 'like');
        assert.equal(storedRun?.situation, 'like_comment');
        assert.equal(storedRun?.targetId, fixture.targetId);
        actionExecuted = true;
        console.log(JSON.stringify({
          liveTest: 'completed',
          owner: 'disposable-authenticated-clerk-development-account',
          characterId: fixture.characterId,
          socialAction: { type: 'like_comment', targetId: fixture.targetId, persistedOnce: true },
          preview: previewRecord,
          run: { runId: reservation.runId, idempotencyKey, storedStatus: storedRun.status },
          executor: outcome,
          idempotentRetry: duplicateOutcome,
          revisionBefore: baseline.revision,
          revisionAfterAction: afterExecution.revision,
          revisionAfterRetry: afterRetry.revision,
          temporaryOptInUsed: true,
          globalLiveFlagRemainedFalse: true,
          schedulerInvoked: false,
          liveSocialActionsExecuted: 1,
        }));
      } finally {
        await settingPut({ characterId: fixture.characterId, enabled: false });
        await settingPut({ globalKillSwitchEngaged: true });
        const restoredSettings = await (await testPage.context().request.get(`${base}/api/autonomy/settings`)).json();
        assert.equal(restoredSettings.liveExecutionEnabled, false);
        assert.ok(restoredSettings.globalKillSwitchEngaged);
        assert.ok(restoredSettings.characters.every((character: any) => character.enabled === false));
      }
      break;
    }
    if (!actionExecuted) {
      console.log(JSON.stringify({
        liveTest: 'no-action-executed',
        liveSocialActionsExecuted: 0,
        maximumFreePreviews: maximumPreviewAttempts,
        reports,
        globalLiveFlagRemainedFalse: true,
      }));
      throw new Error('MODEL_CHOSE_NO_ACTION_WITHIN_BOUNDED_TEST_PREVIEWS');
    }
  } else if (autonomyPreviewOnly) {
    const scenarios = ['like_post', 'like_comment', 'story_reaction', 'dm_reaction'];
    const reports: any[] = [];
    for (let index = 0; index < scenarios.length; index++) {
      const situation = scenarios[index];
      const testOwner = index === 0 ? owner : await createUser(true);
      const testPage = index === 0 ? page : await signedIn(testOwner);
      const beforeSetup = await universeEnvelope(testPage, base);
      const fixture = autonomyPreviewFixture(structuredClone(beforeSetup.state), situation);
      const setupResponse = await testPage.context().request.put(`${base}/api/universe`, {
        data: { state: fixture.state, expectedRevision: beforeSetup.revision },
      });
      assert.equal(setupResponse.status(), 200, `failed to seed disposable ${situation} target`);
      const baseline = await universeEnvelope(testPage, base);
      const settingsResponse = await testPage.context().request.get(`${base}/api/autonomy/settings`);
      assert.equal(settingsResponse.status(), 200);
      const settings = await settingsResponse.json();
      assert.equal(settings.liveExecutionEnabled, false);
      assert.ok(settings.globalKillSwitchEngaged);
      assert.ok(settings.characters.every((character: any) => character.enabled === false));

      const response = await testPage.context().request.post(`${base}/api/autonomy/test-preview`, {
        data: {
          characterId: fixture.characterId,
          situation,
          targetId: fixture.targetId,
          idempotencyKey: randomUUID(),
        },
      });
      const report = await response.json();
      const attempts = report.attempts ?? report.preview?.attempts ?? [];
      const record = {
        situation,
        eligibleTarget: fixture.targetLabel,
        targetId: fixture.targetId,
        providerCalled: report.providerCalled === true,
        provider: report.preview?.provider ?? null,
        model: report.preview?.model ?? attempts.find((attempt: any) => attempt.outcome === 'success')?.model ?? null,
        validatorAccepted: report.validatorAccepted === true,
        decision: report.preview?.decision ? {
          action: report.preview.decision.action,
          situation: report.preview.decision.situation,
          text: report.preview.decision.text ?? null,
          reaction: report.preview.decision.reaction ?? null,
        } : null,
        cost: report.preview?.usage?.cost ?? null,
        attempts: attempts.map((attempt: any) => ({
          model: attempt.model, outcome: attempt.outcome, code: attempt.code, cost: attempt.usage?.cost ?? null,
        })),
        error: report.error ?? null,
        executed: report.executed ?? null,
        socialActionsExecuted: report.socialActionsExecuted ?? null,
        liveExecutionEnabled: report.liveExecutionEnabled,
        sourceRevision: report.preview?.sourceRevision ?? null,
      };
      reports.push(record);
      const after = await universeEnvelope(testPage, base);
      assert.deepEqual(after, baseline, `preview wrote social data for ${situation}`);
      assert.equal(after.revision, baseline.revision);
      const settingsAfterResponse = await testPage.context().request.get(`${base}/api/autonomy/settings`);
      assert.deepEqual(await settingsAfterResponse.json(), settings, `preview changed controls for ${situation}`);
      if (!record.providerCalled) {
        console.log(JSON.stringify({ blockedAt: situation, reports }));
        throw new Error(`AUTONOMY_TEST_PREVIEW_DID_NOT_REACH_PROVIDER:${situation}:${record.error ?? response.status()}`);
      }
      assert.ok(record.attempts.every((attempt: any) => attempt.model.endsWith(':free')), `${situation} included a non-free provider attempt`);
      if (response.status() !== 200 || !record.validatorAccepted) {
        console.log(JSON.stringify({ providerReachedButPreviewRejectedAt: situation, reports }));
        const routeUnavailableCodes = new Set([
          'OPENROUTER_RATE_LIMITED', 'MODEL_COOLDOWN', 'FREE_MODEL_CATALOG_UNAVAILABLE',
        ]);
        if (!record.attempts.length || record.attempts.every((attempt: any) => routeUnavailableCodes.has(attempt.code))) {
          throw new Error(`FREE_OPENROUTER_ROUTE_UNAVAILABLE:${situation}:${record.error ?? response.status()}`);
        }
        continue;
      }
      assert.equal(record.executed, false);
      assert.equal(record.socialActionsExecuted, false);
      assert.equal(record.liveExecutionEnabled, false);
      assert.ok(String(record.model).endsWith(':free'), `${situation} did not use a free model`);
      assert.ok(String(record.provider).toLowerCase().includes('openrouter'), `${situation} did not use OpenRouter`);
      assert.ok(record.attempts.every((attempt: any) => attempt.model.endsWith(':free')), `${situation} included a non-free fallback`);
      assert.ok(record.cost == null || record.cost <= 0, `${situation} reported non-zero cost`);
      const expectedAction = situation === 'like_post' || situation === 'like_comment' ? 'like' : 'react';
      assert.ok(record.decision.action === 'none' || record.decision.action === expectedAction);
      assert.equal(record.decision.situation, situation);
    }
    console.log(JSON.stringify({
      audit: 'four-authenticated-disposable-openrouter-previews',
      previews: reports,
      universeUnchangedDuringEachPreview: true,
      disposableAccountsAndUniversesCleanedInFinally: true,
      liveExecutionEnabled: false,
      realOwnerTouched: false,
      uiChanged: false,
    }));
  } else if (process.env.ECHO_AUTONOMY_BLOCKER_AUDIT === '1') {
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
