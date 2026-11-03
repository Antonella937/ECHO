/**
 * End-to-end test for a new ECHO Creator account.
 * Uses a disposable Clerk development user and removes only that user's rows.
 */
import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const serverRequire = createRequire(new URL('../../artifacts/api-server/package.json', import.meta.url));
const { clerkClient } = serverRequire('@clerk/express');
const {
  db,
  pool,
  echoUniversesTable,
  echoMediaTable,
  echoAutonomyRunsTable,
  echoAutonomyCharactersTable,
  echoAutonomyOwnersTable,
} = serverRequire('@workspace/db');
const { eq } = serverRequire('drizzle-orm');
const base = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:80';

if (
  process.env.NODE_ENV === 'production'
  || !process.env.CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')
  || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')
  || (process.env.REPLIT_DEV_DOMAIN && !process.env.REPLIT_DEV_DOMAIN.endsWith('.replit.dev'))
) {
  throw Error('ECHO_CREATOR_TEST_REQUIRES_CLERK_DEVELOPMENT_ENVIRONMENT');
}

const chromiumPath = (await readdir('/nix/store')).find((path) => path.includes('playwright-chromium-cjk'));
if (!chromiumPath) throw Error('Chromium is required for this browser test.');

const browser = await chromium.launch({
  executablePath: `/nix/store/${chromiumPath}/chrome-linux/chrome`,
  args: ['--no-sandbox'],
});
const token = randomUUID().replaceAll('-', '').slice(0, 12);
let ownerId: string | null = null;

try {
  const user = await clerkClient.users.createUser({
    emailAddress: [`echo_creator_${token}+clerk_test@example.com`],
    skipPasswordRequirement: true,
  });
  ownerId = user.id;

  const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await context.newPage();
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId: ownerId, expiresInSeconds: 120 });
  await page.goto(base);
  await expect(page.getByTestId('link-create-account')).toBeVisible();
  await page.getByTestId('link-create-account').click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.waitForFunction(() => (window as any).Clerk?.loaded, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Crea tu espacio privado' })).toBeVisible();
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.waitForFunction(() => (window as any).Clerk?.loaded, { timeout: 30000 });
  await page.evaluate(async (signInTicket) => {
    const clerk = (window as any).Clerk;
    const attempt = await clerk.client.signIn.create({ strategy: 'ticket', ticket: signInTicket });
    if (attempt.status !== 'complete') throw Error(`Test sign-in status: ${attempt.status}`);
    await clerk.setActive({ session: attempt.createdSessionId });
  }, ticket.token);
  await page.goto(base);

  await expect(page.getByRole('heading', { name: 'Hagamos espacio para tu mundo.' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[aria-label="Paso 1 de 3"]')).toBeVisible();
  await expect(page.getByText(/Voz, video y música están fuera de beta/)).toBeVisible();
  const freePlan = page.getByTestId('button-plan-free');
  const creatorPlan = page.getByTestId('button-plan-creator');
  await expect(freePlan).toHaveAttribute('aria-checked', 'true');
  await creatorPlan.click();
  await expect(creatorPlan).toHaveAttribute('aria-checked', 'true');
  await freePlan.click();
  await expect(freePlan).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('button-onboarding-continue').click();

  const universeName = `Universo ECHO ${token}`;
  const displayName = `Personaje ${token}`;
  const username = `creator.${token}`;
  await expect(page.getByRole('heading', { name: 'Ponle nombre a tu universo' })).toBeVisible();
  await page.getByTestId('input-universe-name').fill(universeName);
  await page.getByTestId('button-onboarding-continue').click();

  await expect(page.getByRole('heading', { name: 'Crea tu primer personaje' })).toBeVisible();
  await page.getByTestId('input-display-name').fill(displayName);
  await page.getByTestId('input-username').fill(username);
  await page.getByTestId('input-bio').fill('Perfil de prueba aislado.');
  await page.getByTestId('button-onboarding-continue').click();
  await expect(page.getByTestId('status-onboarding-complete')).toContainText(universeName);
  await expect(page.getByTestId('status-onboarding-complete')).toContainText(displayName);

  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/universe', { cache: 'no-store' });
    return { status: response.status, envelope: await response.json() };
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.envelope.state.creatorSetup.plan, 'free');
  assert.equal(saved.envelope.state.creatorSetup.universeName, universeName);
  assert.equal(saved.envelope.state.characters.length, 1);
  assert.equal(saved.envelope.state.characters[0].id, 'nela');
  assert.equal(saved.envelope.state.characters[0].name, displayName);
  assert.equal(saved.envelope.state.characters[0].handle, username);
  for (const key of ['posts', 'comments', 'stories', 'messages', 'notifications', 'highlights']) {
    assert.deepEqual(saved.envelope.state[key], [], `new universe should start with no ${key}`);
  }

  await page.getByTestId('button-enter-echo').click();
  await expect(page.getByTestId('text-wordmark')).toHaveText('ECHO', { timeout: 30000 });
  await expect(page.getByTestId('nav-mobile')).toBeVisible();
  await expect(page.getByText('No hay publicaciones todavía. Comparte la primera foto de este pequeño universo.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('nav-mobile')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Hagamos espacio para tu mundo.' })).toHaveCount(0);

  const reloaded = await page.evaluate(async () => (await (await fetch('/api/universe', { cache: 'no-store' })).json()).state);
  assert.equal(reloaded.characters.length, 1, 'commercial starter should not receive demo accounts on reload');
  assert.deepEqual(reloaded.posts, []);
  assert.equal(reloaded.creatorSetup.plan, 'free');

  // A separate authenticated session for the same owner must return directly
  // to the saved universe rather than showing first-run onboarding again.
  const returningContext = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const returningPage = await returningContext.newPage();
  const returningTicket = await clerkClient.signInTokens.createSignInToken({
    userId: ownerId,
    expiresInSeconds: 120,
  });
  await returningPage.goto(`${base}/sign-in`);
  await returningPage.waitForFunction(() => (window as any).Clerk?.loaded, { timeout: 30000 });
  await returningPage.evaluate(async (signInTicket) => {
    const clerk = (window as any).Clerk;
    const attempt = await clerk.client.signIn.create({ strategy: 'ticket', ticket: signInTicket });
    if (attempt.status !== 'complete') throw Error(`Returning test sign-in status: ${attempt.status}`);
    await clerk.setActive({ session: attempt.createdSessionId });
  }, returningTicket.token);
  await returningPage.goto(base);
  await expect(returningPage.getByTestId('nav-mobile')).toBeVisible({ timeout: 30000 });
  await expect(returningPage.getByRole('heading', { name: 'Hagamos espacio para tu mundo.' })).toHaveCount(0);
  const returnedState = await returningPage.evaluate(async () => (
    await (await fetch('/api/universe', { cache: 'no-store' })).json()
  ).state);
  assert.equal(returnedState.creatorSetup.universeName, universeName);
  assert.equal(returnedState.characters[0].name, displayName);
  await returningContext.close();

  console.log('PASS: disposable Clerk owner completed onboarding, saved/reloaded one private empty universe and entered the existing mobile shell.');
} finally {
  await browser.close();
  if (ownerId) {
    // Scope cleanup strictly to this run's random Clerk owner.
    await db.delete(echoAutonomyRunsTable).where(eq(echoAutonomyRunsTable.ownerId, ownerId));
    await db.delete(echoAutonomyCharactersTable).where(eq(echoAutonomyCharactersTable.ownerId, ownerId));
    await db.delete(echoAutonomyOwnersTable).where(eq(echoAutonomyOwnersTable.ownerId, ownerId));
    await db.delete(echoMediaTable).where(eq(echoMediaTable.ownerId, ownerId));
    await db.delete(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId));
    await clerkClient.users.deleteUser(ownerId);
    console.log('CLEANUP: disposable Clerk user and owner-scoped development rows removed.');
  }
  await pool.end();
}
