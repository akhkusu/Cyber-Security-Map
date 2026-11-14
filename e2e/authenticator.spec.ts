import { chooseAuthenticator, configureAuthenticator, selectedAuthenticator } from '../src/authenticatorGuide';
import { recordControl } from '../src/controlRecords';
import { expect, test } from '@playwright/test';
import { makeAsset, newDataset, currentDatasetSchema } from '../src/models';
import { decryptVault } from '../src/crypto';
import { evaluateAccess } from '../src/securityModel';
import { advance, mfaState, passphrase, prepareAuthenticator, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(60000);
for (const [product, os, manual, sync] of [
  ['Google 認証システム', 'ios', true, false], ['Google 認証システム', 'android', false, true],
  ['Microsoft Authenticator', 'ios', true, false], ['Microsoft Authenticator', 'android', false, false],
  ['Bitwarden Authenticator（単独アプリ）', 'ios', true, false], ['Bitwarden Authenticator（単独アプリ）', 'android', false, false],
] as const) {
  test(`${product} ${os}: inline preparation, ${manual ? 'same-phone key' : 'camera'}, service acceptance, map and resume`, async ({ page, context }) => {
    const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
    const data = newDataset('ja');
    data.assets = [{ ...makeAsset({ kind: 'account', type: 'Primary email', name: '確認するProtonアカウント', importance: 'critical' }), id: 'email', provider: 'proton', purpose: 'personal', services: ['mail'] }, { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'コードを使うスマホ', importance: 'critical', operatingSystem: os }), id: 'phone' }, { ...makeAsset({ kind: 'account', type: 'Identity provider', name: '同期用の個人Google', importance: 'critical' }), id: 'google', provider: 'google', purpose: 'personal' }];
    data.guide.accountId = 'email'; data.guide.cursor = 'do/email/email-mfa/scan';
    await page.goto('./'); await page.locator('.language-picker select').selectOption('ja');
    await writeSavedVault(page, await sealRawVault(data)); await page.reload();
    await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
    await prepareAuthenticator(page, product, sync ? 'account' : 'local', '同期用の個人Google', manual);
    if (manual) await expect(page.locator('.guide-card .instruction')).toContainText('キー');
    if (product.startsWith('Bitwarden')) await expect(page.locator('.guide-card .instruction')).toContainText('Save here');
    expect((await decryptVault(await readSavedVault(page), passphrase)).data.assets[0].controls.mfa).toBe('unknown');
    const cursor = new URL(page.url()).hash;
    await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('選んだアプリへ今回のアカウントを追加する'); expect(new URL(page.url()).hash).toBe(cursor);
    await advance(page); await expect(page.getByRole('heading', { level: 1 })).toHaveText('公式画面で認証アプリを確認する');
    await advance(page); await expect(page.getByRole('heading', { level: 1 })).toHaveText('画面を閉じる前に復旧コードを保管する');
    await advance(page, '安全な場所へ保管しました'); await advance(page, '確認しました');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在のログインを残して動作を確認する');
    const final = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
    expect(final.assets[0].controls.mfa).toBe('verified'); expect(final.assets[2].controls.mfa).toBe('unknown');
    const app = final.securityModel.entities.find(e => e.kind === 'installation')!;
    const credential = final.securityModel.entities.find(e => e.kind === 'credential')!;
    expect(credential).toMatchObject({ credentialType: 'totp', subjectRef: 'email', storageRef: app.id });
    const route = final.securityModel.routes[0];
    expect(evaluateAccess(final.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('not-applicable');
    await page.getByRole('link', { name: 'Security Map', exact: true }).click();
    await page.locator('.map-node').filter({ has: page.getByText('確認するProtonアカウント', { exact: true }) }).click();
    await expect(page.locator('.access-records')).toContainText('登録時にコードを受け付けた記録');
    await page.getByLabel('使えない項目を選ぶ').selectOption('phone'); await expect(page.locator('.access-records')).toContainText('必要な手段が使えない条件');
    await page.locator('.map-node').filter({ has: page.getByText(app.label, { exact: true }) }).click();
    await expect(page.locator('.map-details')).toContainText('コード登録の記録あり');
    await advance(page, 'このアプリの設定を確認する');
    for (let i = 0; i < 6 && !(await page.getByRole('heading', { level: 1, name: '認証アプリの設定を記録しました', exact: true }).isVisible()); i++) {
      await page.locator('.guide-card .primary-actions button').first().click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
    }
    await advance(page, '元のガイドへ戻る'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在のログインを残して動作を確認する');
    expect(external).toEqual([]);
  });
}

test('legacy phone OS and account purpose are classified without duplicating either original identity', async ({ page }) => {
  const data = newDataset('ja');
  data.assets = [{ ...makeAsset({ kind: 'account', type: 'Primary email', name: 'メール', importance: 'critical' }), id: 'email', provider: 'proton', purpose: 'personal' }, { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '以前からのスマホ', importance: 'critical' }), id: 'legacy-phone' }, { ...makeAsset({ kind: 'account', type: 'Identity provider', name: '以前からのGoogle', importance: 'critical' }), id: 'legacy-google', provider: 'google' }];
  data.guide.accountId = 'email'; data.guide.cursor = 'do/email/email-mfa/scan';
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja'); await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await advance(page, 'Google 認証システム'); await advance(page, '以前からのスマホ');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('このスマホのOSは？'); await advance(page, 'Android');
  await advance(page, 'Google アカウントと同期する'); await advance(page, '以前からのGoogle');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('このGoogle アカウントは、誰が管理していますか？'); await advance(page, '自分の個人用アカウント');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('選んだ認証アプリを開く');
  const restored = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
  expect(restored.assets.map(a => a.id)).toEqual(['email', 'legacy-phone', 'legacy-google']);
  expect(restored.assets[1].operatingSystem).toBe('android'); expect(restored.assets[2].purpose).toBe('personal');
  expect(restored.securityModel.entities.find(e => e.kind === 'installation')).toMatchObject({ deviceRef: 'legacy-phone', syncAccountRef: 'legacy-google' });
});

test('same-phone QR-only branch stays unfinished, supports keyboard and 390px Japanese/English, and copies safe help manually', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const data = newDataset('ja');
  data.assets = [{ ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Private account nickname', importance: 'critical' }), id: 'email', provider: 'proton', purpose: 'personal' }, { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Private phone nickname', importance: 'critical', operatingSystem: 'ios' }), id: 'phone' }];
  data.guide.accountId = 'email'; data.guide.cursor = 'do/email/email-mfa/scan';
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./'); await page.locator('.language-picker select').selectOption('ja'); await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await page.getByRole('button', { name: 'Microsoft Authenticator', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  await advance(page, 'Private phone nickname'); await advance(page);
  for (let i = 0; i < 8 && !(await page.getByRole('heading', { level: 1, name: '登録用のQRコードは、どの画面にありますか？', exact: true }).isVisible()); i++) { await page.locator('.guide-card .primary-actions button').click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-authenticator-mobile-ja.png`, fullPage: true });
  await page.locator('.language-picker select').selectOption('en'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where is the registration QR code?');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-authenticator-mobile-en.png`, fullPage: true });
  await page.locator('.language-picker select').selectOption('ja'); await advance(page, '同じスマホのQRだけ・設定キーが見つからない');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登録画面を残して確認する');
  await expect(page.locator('.guide-card')).toContainText('外部の読取りサービス');
  const saved = (await decryptVault(await readSavedVault(page), passphrase)).data; expect(saved.assets[0].controls.mfa).toBe('unknown');
  await advance(page, '同じ端末でQRコードを読めない'); await advance(page, 'この案内でも解決しない'); await advance(page, '相談文をコピーする');
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('Microsoft Authenticator'); expect(prompt).toContain('ios');
  for (const secret of ['Private account nickname', 'Private phone nickname']) expect(prompt).not.toContain(secret);
});

test('after service recovery, protect the actual code-sync account and return without changing the main email', async ({ page }) => {
  let data = newDataset('ja');
  data.assets = [{ ...makeAsset({ kind: 'account', type: 'Primary email', name: 'メインのProton', importance: 'critical' }), id: 'email', provider: 'proton', purpose: 'personal' }, { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '認証するスマホ', importance: 'critical', operatingSystem: 'android' }), id: 'phone' }, { ...makeAsset({ kind: 'account', type: 'Identity provider', name: '実際の同期用Google', importance: 'critical' }), id: 'sync', provider: 'google', purpose: 'personal' }];
  data.guide.accountId = 'email';
  data = chooseAuthenticator(data, 'email', 'google-authenticator', 'phone', 'do/email/email-mfa/scan');
  const app = selectedAuthenticator(data, 'email')!;
  data = currentDatasetSchema.parse(configureAuthenticator(data, 'email', app.id, 'account', 'sync'));
  data = currentDatasetSchema.parse(recordControl(data, app.id, 'storageChecked', { id: 'existing-sync-confirmation' }));
  data = currentDatasetSchema.parse(recordControl(data, 'email', 'mfa', { id: 'existing-email-mfa' }));
  data = currentDatasetSchema.parse(recordControl(data, 'email', 'recovery', { id: 'existing-email-recovery' }));
  data.guide.cursor = 'recovery-location/email';
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja'); await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await advance(page, 'つながりは記録しない'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('コードを保存するアカウントも保護する');
  await expect(page.locator('.guide-card')).toContainText('実際の同期用Google'); await advance(page, 'Googleの認証を設定・確認する');
  await mfaState(page, 'web'); await advance(page, 'すでに有効になっている'); await advance(page, '確認しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('同期先アカウントの復旧を備える'); await advance(page, 'Googleの復旧手段を備える');
  await advance(page); await advance(page, '予備の手段を確保しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('どのパスワードマネージャーを使いますか？');
  const final = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
  expect(final.guide.accountId).toBe('email'); expect(final.assets).toHaveLength(3);
  expect(final.assets.find(a => a.id === 'sync')?.controls).toMatchObject({ mfa: 'verified', recovery: 'verified' });
  expect(final.actions.filter(a => a.targetId === 'sync' && a.controlId === 'mfa')).toHaveLength(1);
});
