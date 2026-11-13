import { expect, test } from '@playwright/test';

test.setTimeout(60_000);
import { createWorkspace, chooseApple, advance, passphrase } from './helpers';

test('project URLs resume and all guide data stays local and encrypted', async ({ page, context, baseURL }) => {
  const site = new URL(baseURL!); const unexpected: string[] = [];
  context.on('request', request => { const u = new URL(request.url()); if (u.origin !== site.origin || !u.pathname.startsWith(site.pathname) || request.method() !== 'GET') unexpected.push(request.url()); });
  await createWorkspace(page); await chooseApple(page); await advance(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('自分の名前を選ぶ');
  await expect(page).toHaveURL(/\/#\/guide$/); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('自分の名前を選ぶ');
  const stored = await page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('personal-cyber-os', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const request = open.result.transaction('encrypted-vault', 'readonly').objectStore('encrypted-vault').get('primary'); request.onsuccess = () => { open.result.close(); resolve(request.result); }; };
  }));
  expect(stored).toMatchObject({ algorithm: 'AES-256-GCM', iterations: 600000 }); expect(JSON.stringify(stored)).not.toContain('Apple'); expect(unexpected).toEqual([]);
});

test('the scoped PWA works offline and preserves other applications caches', async ({ page, context, baseURL }) => {
  const site = new URL(baseURL!);
  const prefix = `cyber-security-map-shell:${site.pathname}:`;
  let releaseWorker!: () => void;
  const workerAllowed = new Promise<void>((resolve) => { releaseWorker = resolve; });
  await context.route('**/sw.js', async (route) => { await workerAllowed; await route.continue(); });
  await page.goto('./');
  await page.evaluate(async ({ prefix }) => {
    await (await caches.open('unrelated-project-cache')).put('/another-project/example.txt', new Response('keep'));
    await (await caches.open(`${prefix}v0`)).put(location.href, new Response('old'));
  }, { prefix });
  releaseWorker();
  const registration = await page.evaluate(async () => {
    const registered = await navigator.serviceWorker.ready;
    return { scope: registered.scope, script: registered.active?.scriptURL };
  });
  expect(registration).toEqual({ scope: site.href, script: new URL('sw.js', site).href });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async ({ prefix }) => {
    const cache = await caches.open(`${prefix}v7`);
    return { names: await caches.keys(), urls: (await cache.keys()).map((request) => request.url) };
  }, { prefix });
  expect(cached.names).toContain('unrelated-project-cache');
  expect(cached.names).not.toContain(`${prefix}v0`);
  expect(cached.urls.every((url) => url.startsWith(site.href))).toBe(true);
  expect(cached.urls.some((url) => /Workspace-[^/]+\.js$/.test(url))).toBe(true);
  expect(cached.urls.some((url) => /encrypted-vault|assessment/.test(url))).toBe(false);
  const manifest = await (await page.request.get(new URL('manifest.webmanifest', site).href)).json();
  expect(new URL(manifest.start_url, new URL('manifest.webmanifest', site)).href).toBe(site.href);
  expect(new URL(manifest.scope, new URL('manifest.webmanifest', site)).href).toBe(site.href);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.language-picker select').selectOption('en');
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await page.getByRole('link', { name: 'Security Map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Security Map', exact: true })).toBeVisible();
});

test('the public artifact has no repository files or server-side history fallback', async ({ request, baseURL }) => {
  for (const path of ['.git/config', '.env', 'package.json', 'src/crypto.ts', 'assets/missing.js', 'checkup']) {
    expect((await request.get(new URL(path, baseURL!).href)).status()).toBe(404);
  }
});

test('the vault interface does not run inside an embedding page', async ({ page, baseURL }) => {
  const parent = new URL('/', baseURL!);
  parent.hostname = 'localhost';
  await page.goto(parent.href);
  await page.setContent(`<iframe src="${baseURL}"></iframe>`);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#root')).toContainText('埋め込み表示では利用できません');
  await expect(frame.locator('.brand')).toHaveCount(0);
});
