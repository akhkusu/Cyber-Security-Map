import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);
const passphrase = 'public hosting test phrase';

async function createWorkspace(page: Page) {
  await page.goto('./');
  await page.locator('.language-picker select').selectOption('en');
  await page.getByRole('button', { name: 'Start Security Checkup' }).click();
  await page.getByLabel('App passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel('Confirm passphrase').fill(passphrase);
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you.' })).toBeVisible();
}

test('project URLs reload correctly and user input stays encrypted and local', async ({ page, context, baseURL }) => {
  const site = new URL(baseURL!);
  const unexpected: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== site.origin || !url.pathname.startsWith(site.pathname) || request.method() !== 'GET') unexpected.push(request.url());
  });
  await createWorkspace(page);
  await expect(page).toHaveTitle('Cyber-Security-Map');
  await page.getByRole('link', { name: 'My digital life' }).click();
  await page.getByRole('button', { name: 'Add something' }).click();
  await page.getByLabel('Category').selectOption('device');
  const name = '<img src=x onerror="window.__publicHostProbe=1">';
  await page.getByLabel('Friendly nickname').fill(name);
  await page.getByRole('button', { name: 'Add to inventory' }).click();
  await expect(page.getByRole('button', { name: /__publicHostProbe/ })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => '__publicHostProbe' in window)).toBe(false);

  await page.getByRole('link', { name: 'Security checkup' }).click();
  await expect(page).toHaveURL(/\/#\/checkup$/);
  await page.reload();
  await page.getByLabel('App passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Security Checkup' })).toBeVisible();
  const stored = await page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('personal-cyber-os', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('encrypted-vault', 'readonly').objectStore('encrypted-vault').get('primary');
      request.onsuccess = () => { open.result.close(); resolve(request.result); };
      request.onerror = () => { open.result.close(); reject(request.error); };
    };
  }));
  expect(stored).toMatchObject({ algorithm: 'AES-256-GCM', iterations: 600_000 });
  expect(JSON.stringify(stored)).not.toContain('__publicHostProbe');
  expect(unexpected).toEqual([]);
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
    const cache = await caches.open(`${prefix}v6`);
    return { names: await caches.keys(), urls: (await cache.keys()).map((request) => request.url) };
  }, { prefix });
  expect(cached.names).toContain('unrelated-project-cache');
  expect(cached.names).not.toContain(`${prefix}v0`);
  expect(cached.urls.every((url) => url.startsWith(site.href))).toBe(true);
  expect(cached.urls.some((url) => /Workspace-[^/]+\.js$/.test(url))).toBe(true);
  expect(cached.urls.some((url) => /Checkup-[^/]+\.js$/.test(url))).toBe(true);
  expect(cached.urls.some((url) => /encrypted-vault|assessment/.test(url))).toBe(false);
  const manifest = await (await page.request.get(new URL('manifest.webmanifest', site).href)).json();
  expect(new URL(manifest.start_url, new URL('manifest.webmanifest', site)).href).toBe(site.href);
  expect(new URL(manifest.scope, new URL('manifest.webmanifest', site)).href).toBe(site.href);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Explore a fictional sample' }).click();
  await page.getByRole('link', { name: 'Security checkup' }).click();
  await expect(page.getByRole('heading', { name: 'Security Checkup' })).toBeVisible();
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
