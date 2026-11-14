import { expect, test } from '@playwright/test';
import { createWorkspace, answerRecoveryPreparation, prepareAuthenticator, chooseApple, mfaState, advance, passphrase, exportVault, readSavedVault, sealRawVault, writeSavedVault } from './helpers';
import { decryptVault } from '../src/crypto';
import { newDataset, makeAsset } from '../src/models';

test.setTimeout(60000);
for (const platform of ['ios', 'macos', 'web'] as const) test(`iCloud ${platform}: inline setup, confirmation, next task and map`, async ({ page, context }) => {
  const external: string[] = [];
  context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
  await createWorkspace(page); await chooseApple(page, platform); await mfaState(page, platform);
  await advance(page, 'まだ有効になっていない');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('認証を有効にする');
  await advance(page); await expect(page.getByRole('heading', { level: 1 })).toHaveText('本人確認の方法を登録する');
  await advance(page); await expect(page.getByRole('heading', { level: 1 })).toHaveText('有効になった状態を確認する');
  await advance(page, '確認しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('どの端末でログインを承認しますか？');
  if (platform !== 'web') await page.getByRole('button', { name: /この端末で認証することを確認した/ }).click();
  else await advance(page, '分からない・つながりを記録しない');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('予備の認証手段の設定を開く');
  await advance(page); await advance(page, '予備の手段を確保しました');
  await advance(page, '独立した予備の電話・電話番号');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('どのパスワードマネージャーを使いますか？');
  await page.getByRole('link', { name: 'Security Map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Security Map', exact: true })).toBeVisible();
  await page.locator('.map-node').filter({ hasText: 'Apple Account' }).click();
  await expect(page.locator('.control-list li').filter({ hasText: '認証' })).toContainText('記録済み');
  const count = await page.locator('.map-node').count();
  await advance(page, '同じアカウントでクラウドも使っている');
  await expect(page.locator('.map-node')).toHaveCount(count);
  if (platform !== 'web') { await page.getByLabel('使えない項目を選ぶ').selectOption({ label: platform === 'ios' ? 'iPhone / iPad 1' : 'Mac 1' }); await expect(page.locator('.affected-node')).toHaveCount(1); }
  if (platform === 'ios') await page.screenshot({ path: 'test-results/security-map-desktop-ja.png', fullPage: true });
  const envelope = await exportVault(page), data = (await decryptVault(envelope, passphrase)).data;
  expect(data.assets.find(a => a.provider === 'apple')?.controls).toMatchObject({ mfa: 'verified', recovery: 'verified' });
  expect(data.assets.filter(a => a.provider === 'apple')).toHaveLength(1); expect(external).toEqual([]);
});

test('resume exact step, back, different-screen branch, safe manual AI help, deferral and undo', async ({ page }) => {
  await createWorkspace(page); await chooseApple(page); await advance(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('自分の名前を選ぶ');
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('自分の名前を選ぶ');
  await advance(page, '戻る'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('アカウントの設定を開く');
  await advance(page, 'うまくいかない'); await advance(page, '画面が違う');
  await expect(page.getByRole('button', { name: '相談文をコピーする' })).toHaveCount(0);
  await advance(page, 'この案内でも解決しない'); await expect(page.getByLabel('AIへの相談文')).toHaveValue(/最新の公式資料/);
  await advance(page, 'Webの手順へ切り替える'); await mfaState(page, 'web');
  await advance(page, 'すでに有効になっている');
  await page.getByText('作業の完了記録 · 1件', { exact: true }).click(); await advance(page, '取り消す');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('有効になった状態を確認する');
  await advance(page, 'この作業を後回しにする');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('どのパスワードマネージャーを使いますか？');
  await page.getByText('後回しの作業 · 1件', { exact: true }).click();
  await page.locator('.record-link').click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('有効になった状態を確認する');
});

test('a new user can finish Bitwarden, save a generated important password and continue', async ({ page }) => {
  await createWorkspace(page); await chooseApple(page); await mfaState(page); await advance(page, 'すでに有効になっている');
  await advance(page, '分からない・つながりを記録しない'); await advance(page); await advance(page, '予備の手段を確保しました'); await advance(page, '独立した予備の電話・電話番号');
  await page.getByRole('button', { name: /^Bitwarden/ }).click(); await advance(page, 'このマネージャーを追加する');
  await page.getByRole('button', { name: /登録済みの端末/ }).click(); await advance(page, 'EU · vault.bitwarden.eu');
  await expect(page.getByRole('link', { name: /公式の設定・アプリを開く/ })).toHaveAttribute('href', 'https://bitwarden.com/download/');
  await advance(page); await advance(page, '初めて作る');
  await expect(page.getByText(/12文字/)).toBeVisible(); await expect(page.getByText(/6語以上/)).toBeVisible();
  await advance(page, '専用の語句を用意しました'); await expect(page.getByRole('link', { name: /公式の設定・アプリを開く/ })).toHaveAttribute('href', 'https://vault.bitwarden.eu/');
  await advance(page); await advance(page, '安全な場所へ保管しました'); await advance(page, '確認しました'); await advance(page, 'これから設定する'); await prepareAuthenticator(page); await advance(page); await advance(page, 'コードが受け付けられました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2段階ログインの復旧コードを保管する');
  await advance(page, '復旧コードを保管しました'); await advance(page, 'ログインできました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('このアカウントの保存項目を探す');
  await advance(page,'まだ保存していない');await advance(page);await advance(page,'新しく生成して変更する');
  await advance(page);await advance(page);await advance(page,'候補を保存しました');await advance(page);await advance(page);await advance(page,'保存したパスワードでログインできました');await advance(page,'整理しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('次に、どの端末を対策しますか？');
  const d = (await decryptVault(await exportVault(page), passphrase)).data;
  expect(d.assets.find(a => a.provider === 'bitwarden')?.controls).toMatchObject({ mfa: 'verified', recovery: 'verified' });
  expect(d.assets.find(a => a.provider === 'apple')?.controls.uniquePassword).toBe('verified');
});

test('mobile Japanese and keyboard English guide stay readable and operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await createWorkspace(page); await chooseApple(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/guide-mobile-ja.png', fullPage: true });
  await page.getByRole('link', { name: 'Security Map', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/map-mobile-ja.png', fullPage: true });
  await page.getByRole('link', { name: '対策を進める', exact: true }).click();
  await page.locator('.language-picker select').selectOption('en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open your account settings');
  await page.getByRole('button', { name: 'Next', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Select your name');
  await expect(page.getByRole('region', { name: 'Current guide step' })).toBeFocused();
});

test('legacy encrypted backup restores existing data and completion without re-registration', async ({ page }) => {
  // Seal the original v1 JSON directly, without the new schema or migration defaults.
  const d = newDataset('ja'), old = makeAsset({ kind: 'account', type: 'Primary email', name: '<img src=x onerror=alert(1)>', importance: 'critical' });
  old.controls.mfa = 'verified'; old.controlEvidence.mfa = 'user-confirmed'; d.assets = [old]; d.workflowProgress = { legacy: ['saved-step'] };
  const raw = JSON.parse(JSON.stringify(d)); raw.version = 1; delete raw.securityModel; delete raw.deviceWorkflows; delete raw.guide; delete raw.assets[0].services;
  raw.softwareInventory = [{ appName: 'Legacy application', metadata: { kept: true } }];
  raw.assets[0].historicalRecord = { original: true }; raw.settings.legacyPreference = { original: true };
  const envelope = { ...await sealRawVault(raw), historicalMetadata: { original: true } };
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja'); await page.getByText('暗号化バックアップから復元する', { exact: true }).click();
  await page.getByLabel('暗号化バックアップファイル', { exact: true }).setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope)) });
  await page.getByLabel('バックアップのパスフレーズ', { exact: true }).fill(passphrase); await advance(page, 'バックアップを復元する');
  await expect(page.getByRole('button', { name: /<img src=x/ })).toBeVisible(); await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByRole('button', { name: /<img src=x/ }).click(); await page.getByRole('button', { name: /iCloud \/ Apple Account/ }).click(); await advance(page, 'Webの設定画面で進める');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('以前の記録を引き継いでいます');
  const exported = await exportVault(page); expect(exported.historicalMetadata).toEqual(envelope.historicalMetadata);
  const restored = (await decryptVault(exported, passphrase)).data;
  expect(restored.assets).toHaveLength(1); expect(restored.assets[0].id).toBe(old.id); expect(restored.assets[0].controls.mfa).toBe('verified'); expect(restored.workflowProgress).toEqual(d.workflowProgress);
  expect(restored.softwareInventory).toEqual(raw.softwareInventory); expect(restored.assets[0].historicalRecord).toEqual({ original: true }); expect(restored.settings.legacyPreference).toEqual({ original: true });
});

test('restoring a newer payload preserves the existing encrypted vault and its exact guide position', async ({ page }) => {
  await createWorkspace(page); await chooseApple(page);
  const original = await readSavedVault(page), heading = await page.getByRole('heading', { level: 1 }).textContent();
  const future = await sealRawVault({ ...newDataset('ja'), version: 3, futureEntities: [{ id: 'newer-data' }] });
  await page.getByRole('link', { name: '設定', exact: true }).click(); await page.getByText('バックアップから復元する', { exact: true }).click();
  await page.getByLabel('暗号化バックアップファイル', { exact: true }).setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(future)) });
  await page.getByLabel('バックアップのパスフレーズ', { exact: true }).fill(passphrase); page.once('dialog', dialog => dialog.accept());
  await advance(page, 'バックアップを復元する');
  await expect(page.getByRole('alert')).toContainText('この版のアプリでは');
  expect(await readSavedVault(page)).toEqual(original);
  await page.getByRole('link', { name: '対策を進める', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading!);
});

for (const format of ['newer-payload', 'newer-model', 'unsupported-envelope']) test(`${format}: original stored data can be exported without opening or replacing it`, async ({ page }) => {
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja');
  const original = format === 'newer-payload'
    ? await sealRawVault({ ...newDataset('ja'), version: 3, futureEntities: [{ id: 'keep-original' }] })
    : format === 'newer-model' ? await sealRawVault({ ...newDataset('ja'), securityModel: { ...newDataset('ja').securityModel, revision: 15 } })
    : { format: 'future-envelope-format', ciphertext: 'opaque-original-data', metadata: { keep: true } };
  await writeSavedVault(page, original); await page.reload();
  if (format !== 'unsupported-envelope') {
    await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await page.getByRole('button', { name: '開いて再開する', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('この版のアプリでは');
  } else await expect(page.getByRole('heading', { name: '保管庫を読み取れませんでした', exact: true })).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '元の保存ファイルを書き出す', exact: true }).click();
  const file = await (await download).path(); if (!file) throw new Error('missing original export');
  const { readFile } = await import('node:fs/promises'); expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(original);
  expect(await readSavedVault(page)).toEqual(original);
});

for (const provider of ['Gmail / Google', 'Outlook / Microsoft', 'Proton Mail', 'Fastmail', 'Tuta / Tutanota', 'Zoho Mail', 'Yahoo.com', 'StartMail', 'mail.com', 'GMX.com']) test(`${provider}: service-specific MFA, recovery, and map records`, async ({ page }) => {
  await createWorkspace(page);
  await page.getByRole('button', { name: provider, exact: true }).click(); await advance(page); await advance(page, '個人用'); await advance(page, 'メインのメールから対策する');
  let count = 0;
  while (true) {
    if (++count > 30) throw new Error('MFA route did not finish');
    const heading = page.getByRole('heading', { level: 1 }), before = await heading.textContent();
    const notEnabled = page.getByRole('button', { name: 'まだ有効になっていない', exact: true });
    if (before === 'どの認証アプリを使いますか？') await prepareAuthenticator(page);
    else if (await notEnabled.count()) await notEnabled.click();
    else if(!await answerRecoveryPreparation(page)) await page.locator('.primary-actions button').first().click();
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); await expect(heading).not.toHaveText(before!);
    if (before === '有効になった状態を確認する' || before === '有効な状態を確認する') break;
  }
  if (await page.getByRole('heading', { level: 1, name: 'どの端末でログインを承認しますか？', exact: true }).isVisible()) await advance(page, '分からない・つながりを記録しない');
  count = 0;
  // A previously secured recovery method may be carried forward without resetting it.
  if (await page.getByRole('heading', { name: '以前の記録を引き継いでいます', exact: true }).count()) await advance(page, '続きへ進む');
  while ((await page.getByRole('heading', { level: 1 }).textContent()) !== '予備の手段の場所を記録する') {
    if (++count > 8) throw new Error('Recovery route did not finish');
    const heading = page.getByRole('heading', { level: 1 }), before = await heading.textContent();
    if(!await answerRecoveryPreparation(page))await page.locator('.primary-actions button').first().click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); await expect(heading).not.toHaveText(before!);
  }
  await advance(page, 'つながりは記録しない');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('どのパスワードマネージャーを使いますか？');
  await page.getByRole('link', { name: 'Security Map', exact: true }).click();
  await expect(page.locator('.control-list li').filter({ hasText: /^認証/ })).toContainText('記録済み');
  await expect(page.locator('.control-list li').filter({ hasText: /^復旧手段/ })).toContainText('記録済み');
});

test('1Password keeps emergency recovery before authenticator activation', async ({ page }) => {
  await createWorkspace(page); await advance(page, 'メールを使っていない・後で進める');
  await page.getByRole('button', { name: /^1Password/ }).click(); await advance(page, 'このマネージャーを追加する'); await advance(page, 'iPhone / iPad を追加');
  await advance(page); await advance(page, '初めて作る'); await advance(page, '専用の語句を用意しました'); await advance(page); await advance(page, '安全な場所へ保管しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('アカウントの復旧コードを保管する');
  await advance(page, '確認しました'); await advance(page, '確認しました'); await advance(page, 'これから設定する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('認証アプリの予備情報を先に保管する');
  await advance(page, '安全な場所へ保管しました'); await prepareAuthenticator(page); await advance(page); await advance(page, 'コードが受け付けられました'); await advance(page, 'ログインできました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('次に、どの端末を対策しますか？');
});

for (const platform of ['iPhone / iPad', 'Android', 'Mac', 'Windows']) test(`${platform}: lock, successful backup and updates are separate recorded operations`, async ({ page }) => {
  await createWorkspace(page); await advance(page, 'メールを使っていない・後で進める'); await advance(page, '別の製品を使う・後で決める');
  await advance(page, `${platform} を追加`);
  if (platform === 'Mac') await advance(page, 'macOS Ventura 13以降');
  if (platform === 'Windows') await advance(page, 'Windows 11');
  let count = 0;
  while ((await page.getByRole('heading', { level: 1 }).textContent()) !== 'この端末のバックアップ先は？') {
    if (++count > 12) throw new Error('Device recipe did not finish');
    const heading = page.getByRole('heading', { level: 1 }), before = await heading.textContent();
    await page.locator('.primary-actions button').first().click();
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); await expect(heading).not.toHaveText(before!);
  }
  await advance(page, 'つながりは未確認のままにする');
  const d = (await decryptVault(await exportVault(page), passphrase)).data;
  expect(d.assets.find(a => a.kind === 'device')?.controls).toMatchObject({ screenLock: 'verified', backup: 'verified', updates: 'verified' });
  expect(d.dependencies).toEqual([]);
});

test('failed encrypted writes do not advance or record success', async ({ page }) => {
  await createWorkspace(page); await chooseApple(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let fail = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const transaction = original.apply(this, args);
      if (args[1] === 'readwrite' && fail) { fail = false; transaction.abort(); }
      return transaction;
    } as typeof original;
  });
  await advance(page);
  await expect(page.getByRole('alert')).toContainText('保存できませんでした');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('アカウントの設定を開く');
  await advance(page); await expect(page.getByRole('heading', { level: 1 })).toHaveText('自分の名前を選ぶ');
});
