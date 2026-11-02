import { expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';

export async function runUxChecks(page: Page, state: (p: Page) => Promise<any>, base: string, out: string) {
  const initial = await state(page);
  assert.equal(initial.messages.length, 0);
  const visit = async (path: string, testId: string) => {
    await page.goto(`${base}${path}`);
    await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 30000 });
  };
  await visit('/messages', 'button-new-conversation');
  await expect(page.getByTestId('empty-messages')).toBeVisible();
  assert.equal(await page.locator('[data-testid^="link-thread-"]').count(), 0);
  const choose = async () => {
    await page.getByTestId('button-new-conversation').click();
    await page.getByTestId('input-search-accounts').fill('noah');
    await page.getByTestId('button-choose-account-noah').click();
    await expect(page.getByTestId('input-message')).toBeVisible();
  };
  await choose();
  await visit('/messages', 'button-new-conversation');
  await expect(page.getByTestId('empty-messages')).toBeVisible();
  await choose();
  await page.getByTestId('input-message').fill('Conversación real iniciada desde el buscador');
  await page.getByTestId('button-send-message').click();
  await expect.poll(async () => (await state(page))?.messages?.length).toBe(1);
  await visit('/messages', 'button-new-conversation');
  await expect(page.getByText('Conversación real iniciada desde el buscador', { exact: false })).toBeVisible();
  assert.equal(await page.locator('[data-testid^="link-thread-"]').count(), 1);
  await page.screenshot({ path: `${out}inbox-mobile.jpg` });
  // Simulate previously saved/migrated history ONLY in this disposable universe.
  const imported = await page.evaluate(async () => {
    const existing = await fetch('/api/universe').then(r => r.json());
    const message = {
      id: 'qa-legacy-dm', senderId: 'mar', recipientId: 'nela', threadId: 'mar__nela',
      text: 'Historial antiguo que debe conservarse', createdAt: '2026-01-01T00:00:00.000Z',
      readBy: ['mar'], storyId: null, postId: null, origin: 'seed',
    };
    existing.state.messages.push(message);
    const saved = await fetch('/api/universe', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: existing.state, expectedRevision: existing.revision }) });
    return saved.status;
  });
  assert.equal(imported, 200);
  await page.reload();
  await expect(page.getByText('Historial antiguo que debe conservarse')).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await state(page))?.messages?.length).toBe(2);
  const sizes = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const [path, ready, last] of [
      ['/create', 'button-pick-image', 'button-publish'],
      ['/profile/nela', 'button-profile-edit', 'link-profile-identity'],
      ['/settings', 'button-create-account', 'button-create-account'],
      ['/messages', 'button-new-conversation', 'button-new-conversation'],
    ]) {
      await visit(path, ready);
      await page.evaluate(() => document.documentElement.style.setProperty('--echo-safe-bottom', '34px'));
      const metrics = await page.evaluate(() => {
        const main = document.querySelector('main')!, nav = document.querySelector('[data-testid="nav-mobile"]')!;
        return {
          clearance: parseFloat(getComputedStyle(main).paddingBottom),
          navHeight: nav.getBoundingClientRect().height,
          width: document.documentElement.scrollWidth, viewport: innerWidth,
        };
      });
      assert.ok(metrics.width <= metrics.viewport, `No horizontal overflow: ${path} ${size.width}`);
      assert.ok(metrics.clearance >= metrics.navHeight, `Nav clearance on ${path}: ${JSON.stringify(metrics)}`);
      const control = page.getByTestId(last);
      await control.evaluate(el => el.scrollIntoView({ block: 'center' }));
      const bounds = await control.boundingBox(), nav = await page.getByTestId('nav-mobile').boundingBox();
      assert.ok(bounds && nav && bounds.y + bounds.height <= nav.y, `Button not behind nav: ${path} ${size.width}`);
      if (path === '/create') {
        const picker = await page.getByTestId('button-pick-image').boundingBox();
        assert.ok(picker && picker.height <= 240, `Compact photo selector ${size.width}`);
      }
      if (path === '/profile/nela') {
        for (const id of ['button-profile-edit', 'link-profile-create', 'link-profile-identity']) {
          const b = await page.getByTestId(id).boundingBox();
          assert.ok(b && b.height >= 44 && b.x >= 0 && b.x + b.width <= size.width, `Profile target ${id}`);
        }
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await visit('/create', 'button-pick-image');
  await page.screenshot({ path: `${out}create-compact-mobile.jpg` });
  await visit('/profile/nela', 'button-profile-edit');
  await page.screenshot({ path: `${out}profile-actions-mobile.jpg` });
  await visit('/messages/noah', 'input-message');
  await expect(page.getByTestId('nav-mobile')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 460 });
  await page.getByTestId('input-message').focus();
  const composer = await page.getByTestId('button-send-message').boundingBox();
  assert.ok(composer && composer.y + composer.height <= 460, 'Conversation composer stays visible on a shortened viewport');
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit('/messages', 'button-new-conversation');
  await page.screenshot({ path: `${out}inbox-desktop.jpg` });
  const final = await state(page);
  assert.deepEqual(final.posts, initial.posts);
  assert.deepEqual(final.stories, initial.stories);
  assert.ok(final.messages.some((m: any) => m.id === 'qa-legacy-dm'));
  assert.ok(final.messages.some((m: any) => m.text === 'Conversación real iniciada desde el buscador'));
  console.log('PASS: empty new inbox, search/select without ghost threads, send/persist real DM, preserve legacy history, 320/390/430px layouts + simulated34px safe area, profile targets, compact photo picker and shortened conversation viewport.');
}
