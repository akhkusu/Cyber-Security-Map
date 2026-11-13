import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

test('guided assessment records manual evidence and shows the matching official OS guide', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a fictional sample' }).click();
  await page.getByRole('link', { name: 'Security checkup' }).click();
  await expect(page.getByRole('heading', { name: 'Security Checkup' })).toBeVisible();
  await expect(page.locator('.checkup-domain-tab')).toHaveCount(6);

  await page.getByRole('button', { name: /Device & Software Security/ }).click();
  const updates = page.locator('.guided-question-card[data-control-id="device.auto-updates"]').filter({ hasText: 'MacBook' }).first();
  await expect(updates).toContainText('MacBook');
  await expect(updates.getByRole('link', { name: 'Open Apple Support guide' })).toHaveAttribute('href', /support\.apple\.com/);
  await updates.getByRole('button', { name: 'No', exact: true }).click();
  await updates.getByRole('button', { name: 'I checked this setting myself' }).click();
  await expect(updates.getByRole('button', { name: 'You confirmed this setting' })).toBeVisible();

  await page.getByRole('link', { name: 'Protection plan' }).click();
  await expect(page.getByRole('heading', { name: /Review update settings for this device/ })).toBeVisible();
  const updateAction = page.locator('.action-card').filter({ hasText: 'Review update settings for this device' }).first();
  const why = updateAction.getByRole('button', { name: 'Why is this important?' });
  await why.click();
  await expect(updateAction.getByText(/You personally checked this setting/)).toBeVisible();
});

test('Japanese localization and saved assessment progress work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a fictional sample' }).click();
  await page.locator('.language-small select').selectOption('ja');
  await page.getByRole('link', { name: 'セキュリティチェックアップ' }).click();
  await expect(page.getByRole('heading', { name: 'セキュリティチェックアップ' })).toBeVisible();
  await page.getByRole('button', { name: /端末・ソフトウェアの保護/ }).click();
  await expect(page.getByRole('link', { name: /Apple Supportのガイドを開く/ }).first()).toBeVisible();
  await expect(page.getByText('未評価').first()).toBeVisible();
  await page.getByRole('button', { name: 'はい', exact: true }).first().click();
  await page.getByRole('link', { name: '保護プラン' }).click();
  await expect(page.getByRole('button', { name: 'なぜ重要？' }).first()).toHaveAttribute('aria-expanded', 'false');
});

test('offline shell caches static app files but never assessment records', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Understand and improve your digital security.' })).toBeVisible();
  expect(await page.locator('html').getAttribute('lang')).toBe('en');
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('cyber-security-map-shell:/:v6');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cached.some((path) => path.endsWith('.js'))).toBe(true);
  expect(cached.some((path) => path.endsWith('.css'))).toBe(true);
  expect(cached.some((path) => /Workspace-[^/]+\.js$/.test(path))).toBe(true);
  expect(cached.some((path) => /Checkup-[^/]+\.js$/.test(path))).toBe(true);
  expect(cached).toContain('/manifest.webmanifest');
  expect(cached.some((path) => path.includes('encrypted-vault') || path.includes('assessment'))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Understand and improve your digital security.' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore a fictional sample' }).click();
  await page.getByRole('link', { name: 'Security checkup' }).click();
  await expect(page.getByRole('heading', { name: 'Security Checkup' })).toBeVisible();
});

test('the source has no native inspection code and onboarding sends no assessment data away', async ({ page }) => {
  const repository = resolve(process.cwd());
  expect(existsSync(join(repository, 'agent', 'personal_cyber_os_agent.py'))).toBe(false);
  expect(existsSync(join(repository, 'src', 'SoftwareSecurity.tsx'))).toBe(false);
  const sourceDirectory = join(repository, 'src');
  const source = readdirSync(sourceDirectory).filter((file) => /\.(tsx?|js)$/.test(file)).map((file) => readFileSync(join(sourceDirectory, file), 'utf8')).join('\n');
  expect(source).not.toMatch(/node:child_process|child_process|shell\s*:\s*true|XMLHttpRequest|sendBeacon|WebSocket/);

  const outgoing: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4174') outgoing.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Security Checkup' }).click();
  await page.getByLabel('App passphrase', { exact: true }).fill('private application phrase');
  await page.getByLabel('Confirm passphrase').fill('private application phrase');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.getByRole('link', { name: 'Security checkup' }).click();
  await page.getByRole('button', { name: 'No', exact: true }).first().click();
  expect(outgoing).toEqual([]);
});
