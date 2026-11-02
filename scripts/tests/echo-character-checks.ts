import { expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';

/** Disposable authenticated owner supplied by the existing private browser harness. */
export async function runCharacterChecks(page: Page, state: (page: Page) => Promise<any>, base: string, out: string) {
  const original = await state(page);
  const nonce = Date.now();
  const open = async (key: string) => {
    await page.getByTestId(`chip-section-${key}`).click();
    await expect(page.getByTestId(`section-character-${key}`)).toBeVisible();
  };
  const save = async () => {
    await page.getByTestId('button-character-save').click();
    await expect(page.getByTestId('button-character-save')).toBeDisabled();
    await expect(page.getByTestId('text-character-error')).toHaveCount(0);
  };
  const character = async (id: string) => (await state(page)).characters.find((c: any) => c.id === id);
  await page.goto(`${base}/characters/new`);
  await expect(page.getByTestId('tab-character-quick')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('input-character-name').fill('Matías');
  await page.getByTestId('input-character-handle').fill(`matias_${nonce}`);
  await page.getByTestId('input-character-bio').fill('Fotógrafo de noches porteñas.');
  await page.getByTestId('input-character-occupation').fill('Fotógrafo');
  await page.getByTestId('input-character-location').fill('Buenos Aires');
  await page.getByTestId('input-character-quick-age').fill('28');
  await page.getByTestId('input-character-quick-description').fill('Reservado y sarcástico.');
  await page.screenshot({ path: `${out}character-quick-mobile.jpg` });
  await page.getByTestId('button-character-save').click();
  await expect(page).toHaveURL(/\/characters\/account_.+\/edit/);
  const id = page.url().split('/').at(-2)!;
  await expect.poll(async () => (await character(id))?.configuration?.basic?.age).toBe(28);
  assert.equal((await state(page)).currentCharacterId, 'nela');
  assert.equal((await character(id)).configuration.basic.name, 'Matías');

  await open('personality');
  await page.getByTestId('input-character-description').fill('Reservado, sarcástico y leal. Evita hablar de su familia en público.');
  await page.getByTestId('input-character-speaking').fill('Rioplatense, humor seco, mensajes cortos.');
  await page.getByTestId('input-character-humor').fill('Sarcástico pero nunca cruel.');
  await page.getByTestId('input-character-boundaries').fill('No divulga secretos ajenos.\nNo insulta por identidad.');
  await open('relationships');
  await page.getByTestId('button-add-relationship').click();
  const relation = page.locator('[data-testid^="select-relationship-target-"]').first();
  const rid = (await relation.getAttribute('data-testid'))!.replace('select-relationship-target-', '');
  await relation.selectOption('owner');
  await page.getByTestId(`select-relationship-preset-${rid}`).selectOption('romantic_tension');
  await page.getByTestId('section-character-relationships').locator('textarea').fill('Amigos con posibilidad de algo más.');
  await page.getByTestId(`button-enable-attraction-${rid}`).click();

  await open('routine');
  await page.getByTestId('input-character-timezone').fill('America/Argentina/Buenos_Aires');
  await page.getByTestId('button-add-routine').click();
  const title = page.locator('[data-testid^="input-routine-title-"]').first();
  const routine = (await title.getAttribute('data-testid'))!.replace('input-routine-title-', '');
  await title.fill('Ensayo');
  await page.getByTestId(`input-routine-start-${routine}`).fill('00:00');
  await page.getByTestId(`input-routine-end-${routine}`).fill('23:59');
  await page.getByTestId(`input-routine-location-${routine}`).fill('Sala de ensayo');
  for (let day = 1; day <= 7; day++) {
    const checkbox = page.getByTestId(`checkbox-routine-day-${routine}-${day}`);
    if (!(await checkbox.isChecked())) await checkbox.locator('..').click();
  }
  await open('social');
  await page.getByTestId('select-social-activity').selectOption('low');
  await page.getByTestId('select-social-reply').selectOption('slow');
  await open('memory');
  await page.getByTestId('input-new-memory-permanent').fill('Nunca publica secretos de sus amigos.');
  await page.getByTestId('button-add-memory-permanent').click();
  await page.getByTestId('input-new-memory-relationships').fill('Conoce al propietario desde un recital.');
  await page.getByTestId('button-add-memory-relationships').click();
  await open('state');
  await page.getByTestId('button-preview-routine-state').click();
  await page.getByTestId('button-apply-routine-state').click();
  await page.getByTestId('input-state-mood').fill('Concentrado');
  await page.getByTestId('checkbox-state-companion-noah').check();
  await save();
  await expect.poll(async () => (await character(id))?.configuration?.personality?.humor).toBe('Sarcástico pero nunca cruel.');
  const configured = (await character(id)).configuration;
  assert.equal(configured.relationships[0].targetId, 'owner');
  assert.equal(configured.social.replySpeed, 'slow');
  assert.equal(configured.memory.relationships.length, 1);
  assert.equal(configured.currentState.activity, 'Ensayo');
  assert.deepEqual(configured.currentState.companions, ['noah']);
  await page.reload(); await open('personality');
  await expect(page.getByTestId('input-character-description')).toHaveValue(/Reservado/);
  await page.screenshot({ path: `${out}character-advanced-mobile.jpg`, fullPage: false });

  // Fresh browser context has no IndexedDB backup: the rich ficha comes from server.
  const secondContext = await page.context().browser()!.newContext({ storageState: await page.context().storageState(), viewport: { width: 390, height: 844 } });
  try {
    const second = await secondContext.newPage();
    await second.goto(`${base}/characters/${id}/edit`);
    await second.getByTestId('chip-section-personality').click();
    await expect(second.getByTestId('input-character-description')).toHaveValue(/Reservado/);
    assert.equal((await state(second)).characters.find((c: any) => c.id === id).configuration.memory.relationships.length, 1);
    await second.getByTestId('input-character-speaking').fill('Tono afinado desde otro dispositivo.');
    await second.getByTestId('button-character-save').click();
    await expect.poll(async () => (await character(id))?.configuration?.voice?.speakingStyle).toBe('Tono afinado desde otro dispositivo.');
    // First device keeps its older open draft and edits a different field.
    await page.getByTestId('input-character-humor').fill('Humor seco, sin crueldad ni spoilers.');
    await save();
    await expect.poll(async () => (await character(id))?.configuration?.personality?.humor).toBe('Humor seco, sin crueldad ni spoilers.');
    assert.equal((await character(id)).configuration.voice.speakingStyle, 'Tono afinado desde otro dispositivo.');
  } finally { await secondContext.close(); }

  // A real DM creates bounded recent memory; promoting it does not remove the DM.
  await page.goto(`${base}/messages`);
  await page.getByTestId('button-new-conversation').click();
  await page.getByTestId('input-search-accounts').fill(`matias_${nonce}`);
  await page.getByTestId(`button-choose-account-${id}`).click();
  await page.getByTestId('input-message').fill('Nos vemos en el ensayo.');
  await page.getByTestId('button-send-message').click();
  await expect.poll(async () => (await character(id))?.configuration?.memory?.recent?.length).toBe(1);
  const memoryId = (await character(id)).configuration.memory.recent[0].id;
  await page.goto(`${base}/characters/${id}/edit`); await open('memory');
  await page.getByTestId(`button-promote-permanent-${memoryId}`).click(); await save();
  await expect.poll(async () => (await character(id))?.configuration?.memory?.permanent?.length).toBe(2);
  assert.ok((await state(page)).messages.some((m: any) => m.text === 'Nos vemos en el ensayo.'));
  await expect(page.getByTestId('text-delete-blocked')).toContainText('historial');

  // Archive an active character: keep content and return to primary Nela.
  await page.goto(`${base}/settings`); await page.getByTestId(`radio-identity-${id}`).click();
  await expect.poll(async () => (await state(page)).currentCharacterId).toBe(id);
  await page.goto(`${base}/characters/${id}/edit`);
  await page.getByTestId('button-archive-character').click();
  await expect.poll(async () => (await character(id)).archived).toBe(true);
  assert.equal((await state(page)).currentCharacterId, 'nela');
  await page.getByTestId('button-restore-character').click();
  await expect.poll(async () => (await character(id)).archived).toBe(false);

  // Duplicate preserves settings, not activity; unused copy requires typed deletion.
  await page.getByTestId('button-duplicate-character').click();
  await page.getByTestId('button-confirm-duplicate').click();
  await expect(page).not.toHaveURL(new RegExp(`/characters/${id}/edit$`));
  const copyId = page.url().split('/').at(-2)!;
  await expect.poll(async () => (await character(copyId))?.configuration?.memory?.recent?.length).toBe(0);
  const copyHandle = (await character(copyId)).handle;
  await page.getByTestId('button-delete-character').click();
  await expect(page.getByTestId('button-confirm-delete')).toBeDisabled();
  await page.getByTestId('input-confirm-delete').fill(`@${copyHandle}`);
  await page.getByTestId('button-confirm-delete').click();
  await expect.poll(async () => Boolean(await character(copyId))).toBe(false);

  // Assisted mode is explicitly unavailable and stores the owner's brief without generating.
  await page.goto(`${base}/characters/new`);
  await page.getByTestId('tab-character-assisted').click();
  await expect(page.getByTestId('status-character-assistance')).toContainText('proveedor');
  await expect(page.getByTestId('button-assist-generate')).toBeDisabled();
  await page.getByTestId('input-character-assist-description').fill('Matías, 28, fotógrafo, reservado y sarcástico, vive en Buenos Aires.');
  await page.getByTestId('button-assist-continue-manual').click();
  await page.getByTestId('input-character-name').fill('Propuesta manual');
  await page.getByTestId('input-character-handle').fill(`brief_${nonce}`);
  await page.getByTestId('button-character-save').click();
  await expect(page).toHaveURL(/\/characters\/account_.+\/edit/);
  const briefId = page.url().split('/').at(-2)!;
  await expect.poll(async () => (await character(briefId))?.configuration?.assistance?.status).toBe('unavailable');
  assert.match((await character(briefId)).configuration.assistance.description, /fotógrafo/);

  // Legacy Nela and official profile still edit through the same generic model.
  for (const legacy of ['nela', 'official-pretty-violence']) {
    await page.goto(`${base}/characters/${legacy}/edit`); await open('personality');
    await page.getByTestId('input-character-description').fill(`Ficha editable de ${legacy}`);
    await save();
    await expect.poll(async () => (await character(legacy))?.configuration?.personality?.description).toBe(`Ficha editable de ${legacy}`);
  }
  assert.equal((await character('official-pretty-violence')).verified, true);

  // Actual computed mobile geometry, including safe area and section-specific overflow.
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    await page.goto(`${base}/characters/${id}/edit`);
    await page.evaluate(() => document.documentElement.style.setProperty('--echo-safe-bottom', '34px'));
    for (const key of ['identity', 'personality', 'relationships', 'routine', 'social', 'memory', 'state']) {
      await open(key);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      if (!fits) console.log('LAYOUT', await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('body *')].filter(el => {
          if (el.getBoundingClientRect().right <= innerWidth + 1) return false;
          for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) if (['auto', 'hidden', 'scroll', 'clip'].includes(getComputedStyle(p).overflowX)) return false;
          return true;
        }).map(el => ({ tag: el.tagName, cls: el.className, test: el.getAttribute('data-testid'), width: el.getBoundingClientRect().width,
          text: el.textContent?.slice(0, 70) })).slice(0, 20) })));
      assert.ok(fits, `${key}: overflow at ${width}`);
      const nav = await page.getByTestId('nav-mobile').boundingBox();
      const button = await page.getByTestId('button-character-save').boundingBox();
      assert.ok(nav && button && button.y + button.height <= nav.y, `${key}: save overlaps nav at ${width}`);
    }
    if (width === 390) await page.screenshot({ path: `${out}character-state-mobile.jpg` });
  }
  const final = await state(page);
  assert.deepEqual(final.posts, original.posts); assert.deepEqual(final.stories, original.stories);
  assert.equal(final.currentCharacterId, 'nela');
  assert.equal(final.characters.length, original.characters.length + 2);
  console.log('PASS: rapid+advanced creation, all seven sections, real recent memory/promotion, archive/restore, safe duplicate/delete, honest assisted dependency, legacy/official edits, persist/reload and 320/390/430px safe-area layouts.');
}
