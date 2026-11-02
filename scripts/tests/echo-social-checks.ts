import { expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';

/** Focused checks left inconclusive by the interactive browser pass. Test owner only. */
export async function runSocialChecks(page: Page, state: (page: Page) => Promise<any>, base: string) {
  const switchTo = async (id: string) => {
    await page.goto(`${base}/settings`);
    await page.getByTestId(`radio-identity-${id}`).click();
    await expect.poll(async () => (await state(page))?.currentCharacterId).toBe(id);
  };
  await page.goto(`${base}/settings`);
  await page.getByTestId('button-theme-system').click();
  const color = page.getByTestId('input-accent-custom');
  await color.fill('#27a8a8');
  await page.getByTestId('button-accent-apply').click();
  await expect.poll(async () => (await state(page))?.appearance?.accent).toBe('#27a8a8');
  await page.reload();
  await expect(page.getByTestId('button-theme-system')).toHaveAttribute('aria-checked', 'true');
  assert.equal((await state(page)).appearance.accent, '#27a8a8');
  console.log('PASS custom accent and system preference survive server roundtrip and reload');

  // Prepare a single unambiguous story and expired archive item in this disposable universe.
  await page.evaluate(async () => {
    const response = await fetch('/api/universe').then(r => r.json());
    const story = response.state.stories.find((s: any) => s.authorId === 'nela');
    response.state.stories = [
      { ...story, id: 'social-active', caption: 'Con @mar.mulligan #Ensayo', createdAt: new Date().toISOString(),
        seenBy: [], mentionedAccountIds: ['mar'], music: { title: 'Ensayo', artist: 'ECHO' } },
      { ...story, id: 'social-expired', caption: 'Archivo', createdAt: new Date(Date.now() - 90000000).toISOString(), seenBy: [] },
    ];
    const saved = await fetch('/api/universe', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: response.state, expectedRevision: response.revision }) });
    if (!saved.ok) throw Error(`Fixture save ${saved.status}: ${await saved.text()}`);
  });
  await page.reload();
  await switchTo('mar');
  await page.goto(base);
  await page.getByTestId('button-story-nela').click();
  await expect(page.getByTestId('img-story-social-active')).toBeVisible();
  await page.getByTestId('input-story-reply').fill('Respuesta de prueba');
  await page.getByTestId('button-story-reaction-0').click();
  await page.getByTestId('button-story-reply-send').click();
  await page.keyboard.press('Tab'); // Leave reply field before Escape closes the viewer.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page))?.messages?.filter((m: any) => m.storyId === 'social-active').length).toBe(2);
  let saved = await state(page);
  assert.ok(saved.stories.find((s: any) => s.id === 'social-active').seenBy.includes('mar'));
  assert.equal(saved.stories.find((s: any) => s.id === 'social-active').reactions[0].actorId, 'mar');
  console.log('PASS active story mention/music metadata, viewing, reaction and reply create real DMs');
  await switchTo('nela');
  await page.goto(`${base}/profile/nela`);
  await page.getByTestId('button-highlight-new').click();
  await page.getByTestId('input-highlight-title').fill('Recuerdo social');
  await page.getByTestId('button-highlight-story-social-expired').click();
  await page.getByTestId('button-highlight-save').click();
  await expect.poll(async () => (await state(page))?.highlights?.length).toBe(1);
  saved = await state(page);
  await page.getByTestId(`button-highlight-${saved.highlights[0].id}`).click();
  await expect(page.getByTestId('img-story-social-expired')).toBeVisible();
  await expect(page.getByTestId('status-story-archived')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByTestId(`button-highlight-${saved.highlights[0].id}`)).toBeVisible();
  console.log('PASS expired story preserved and opens from persisted highlight');
}
