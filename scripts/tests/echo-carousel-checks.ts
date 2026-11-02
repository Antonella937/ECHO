import { expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';

export async function runCarouselChecks(
  page: Page, state: (page: Page) => Promise<any>, base: string, out: string,
  freshOwner: () => Promise<Page>, freshOther: () => Promise<Page>,
) {
  const before = await state(page);
  const previews = () => page.locator('[data-testid^="item-media-"]');
  const ids = () => previews().evaluateAll(nodes => nodes.map(n => n.getAttribute('data-media-id')));
  const geometry = async (control: string) => {
    const button = page.getByTestId(control);
    await expect(button).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewport: innerWidth, width: document.documentElement.scrollWidth,
      outside: [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed';
      }).slice(0, 20).map(el => ({ tag: el.tagName, id: el.getAttribute('data-testid'), cls: el.className,
        right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })),
    }));
    if (layout.width > layout.viewport) {
      console.error('Carousel overflow diagnostics', JSON.stringify(layout));
      await page.screenshot({ path: `${out}carousel-overflow.jpg` });
    }
    assert.ok(layout.width <= layout.viewport, 'No page horizontal overflow');
    await button.scrollIntoViewIfNeeded();
    const b = await button.boundingBox(), nav = await page.getByTestId('nav-mobile').boundingBox();
    assert.ok(b && nav && b.y + b.height <= nav.y, `Bottom nav obscures ${control}`);
  };
  await page.goto(`${base}/create`);
  await page.getByTestId('input-caption').fill('Un ensayo en tres momentos');
  await page.getByTestId('input-location').fill('Buenos Aires');
  await page.getByTestId('input-file').setInputFiles(
    ['nela-1', 'mar-2', 'noah-3'].map(name =>
      new URL(`../../artifacts/echo/src/assets/media/${name}.jpg`, import.meta.url).pathname),
  );
  await expect(previews()).toHaveCount(3, { timeout: 45000 });
  await expect(page.getByTestId('button-publish')).toBeEnabled();
  const initialIds = await ids();
  await page.getByTestId('button-media-left-2').click();
  assert.deepEqual(await ids(), [initialIds[0], initialIds[2], initialIds[1]]);
  await page.getByTestId('button-media-remove-0').click();
  assert.deepEqual(await ids(), [initialIds[2], initialIds[1]]);
  await page.getByTestId('tab-mode-story').click();
  await expect(page.getByTestId('text-story-too-many')).toBeVisible();
  await expect(page.getByTestId('button-publish')).toBeDisabled();
  await page.getByTestId('tab-mode-post').click();
  // A failed image in a batch must not discard the draft or the successful files.
  await page.getByTestId('input-file').setInputFiles([
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    { name: 'valid.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/lkAAAAASUVORK5CYII=', 'base64') },
  ]);
  await expect(previews()).toHaveCount(3, { timeout: 30000 });
  await expect(page.getByTestId('text-create-error')).toBeVisible();
  assert.deepEqual((await ids()).slice(0, 2), [initialIds[2], initialIds[1]]);
  await expect(page.getByTestId('input-caption')).toHaveValue('Un ensayo en tres momentos');
  const finalIds = await ids();
  const urls = await page.locator('[data-testid^="img-media-preview-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('src')!.replace('/api/storage', '')));
  // Oversized selections must be rejected without truncating or uploading.
  await page.getByTestId('input-file').setInputFiles(Array.from({ length: 8 }, (_, i) => ({
    name: `too-many-${i}.png`, mimeType: 'image/png', buffer: Buffer.from('unused'),
  })));
  await expect(page.getByTestId('text-create-error')).toContainText('Máximo');
  assert.deepEqual(await ids(), finalIds);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
    await geometry('button-publish');
  }
  await page.getByTestId('input-caption').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}carousel-composer-mobile.jpg` });
  await page.getByTestId('button-publish').click();
  await expect.poll(async () => (await state(page)).posts.length).toBe(before.posts.length + 1);
  let saved = await state(page);
  const post = saved.posts.find((p: any) => p.caption === 'Un ensayo en tres momentos');
  assert.deepEqual(post.media.map((m: any) => m.id), finalIds);
  assert.deepEqual(post.media.map((m: any) => m.url), urls);
  assert.equal(post.image, urls[0]);
  assert.equal(post.location, 'Buenos Aires');
  assert.deepEqual(saved.posts.filter((p: any) => p.id !== post.id), before.posts);
  await expect(page.getByTestId(`text-carousel-position-${post.id}`)).toHaveText('1/3');
  await page.getByTestId(`button-image-${post.id}`).evaluate(el => {
    el.scrollTo({ left: (el as HTMLElement).clientWidth * 2, behavior: 'instant' });
  });
  await expect(page.getByTestId(`text-carousel-position-${post.id}`)).toHaveText('3/3');
  assert.equal((await state(page)).posts.find((p: any) => p.id === post.id).likes.length, 0);
  // Same media remain available after reload and a fresh signed-in device.
  await page.reload();
  await expect(page.getByTestId(`img-post-${post.id}`)).toBeVisible();
  const second = await freshOwner();
  assert.deepEqual((await state(second)).posts.find((p: any) => p.id === post.id).media, post.media);
  await second.goto(`${base}/settings`);
  await second.getByTestId('radio-identity-noah').click();
  await second.goto(`${base}/p/${post.id}`);
  await page.goto(`${base}/settings`);
  await page.getByTestId('radio-identity-mar').click();
  await page.goto(`${base}/p/${post.id}`);
  await Promise.all([
    page.getByTestId(`button-like-${post.id}`).click(),
    second.getByTestId(`button-like-${post.id}`).click(),
  ]);
  await page.getByTestId(`button-save-${post.id}`).click();
  await page.getByTestId('input-comment').fill('La segunda foto es mi favorita.');
  await page.getByTestId('button-comment-submit').click();
  await expect.poll(async () => {
    const s = await state(page), p = s.posts.find((p: any) => p.id === post.id);
    return p.likes.includes('mar') && p.likes.includes('noah') && p.savedBy.includes('mar') &&
      s.comments.some((c: any) => c.postId === post.id && c.text === 'La segunda foto es mi favorita.');
  }, { timeout: 30000 }).toBe(true);
  saved = await state(page);
  assert.ok(saved.notifications.some((n: any) => n.postId === post.id && n.recipientId === 'nela'));
  assert.deepEqual(saved.posts.find((p: any) => p.id === post.id).media, post.media);
  const verified = await page.evaluate(async () => {
    const r = await fetch('/api/universe/verify'); return { status: r.status, body: await r.json() };
  });
  assert.equal(verified.status, 200);
  assert.ok(verified.body.verifiedFiles >= 3, 'Verify all carousel files, not just cover');
  const other = await freshOther();
  assert.equal((await state(other)).posts.some((p: any) => p.id === post.id), false);
  // A foreign upload hidden in item #2 must be rejected, not only cover checked.
  const denial = await other.evaluate(async foreign => {
    const remote = await fetch('/api/universe').then(r => r.json());
    const cover = remote.state.posts[0].image;
    remote.state.posts[0].media = [{ id: 'cover', type: 'image', url: cover }, { id: 'foreign', type: 'image', url: foreign }];
    return (await fetch('/api/universe', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: remote.state, expectedRevision: remote.revision }) })).status;
  }, post.media[1].url);
  assert.equal(denial, 400);
  assert.equal((await other.request.get(`${base}/api/storage${post.media[1].url}`)).status(), 404);
  await page.goto(`${base}/p/${post.id}`);
  await expect(page.getByTestId(`carousel-post-${post.id}`)).toBeVisible();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await geometry('button-comment-submit');
    await page.getByTestId(`button-image-${post.id}`).scrollIntoViewIfNeeded();
    await page.getByTestId(`button-image-${post.id}`).evaluate(el => el.scrollTo({ left: (el as HTMLElement).clientWidth, behavior: 'instant' }));
    await expect(page.getByTestId(`text-carousel-position-${post.id}`)).toHaveText('2/3');
  }
  await page.screenshot({ path: `${out}carousel-post-mobile.jpg` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId(`button-carousel-next-${post.id}`).click();
  await expect(page.getByTestId(`text-carousel-position-${post.id}`)).toHaveText('3/3');
  await page.getByTestId(`button-image-${post.id}`).press('ArrowLeft');
  await expect(page.getByTestId(`text-carousel-position-${post.id}`)).toHaveText('2/3');
  await page.goto(`${base}/profile/nela`);
  await expect(page.locator(`a[href="/p/${post.id}"] img`).first()).toHaveAttribute('src', `/api/storage${post.image}`);
  console.log('PASS: carousel upload/reorder/remove/partial failure/limit, stable per-item ids, whole-post interactions, real file verification, foreign-item rejection, reload + independent device, mobile320/390/430 and keyboard controls; legacy posts unchanged.');
}
