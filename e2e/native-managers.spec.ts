import { expect, test, type Page } from '@playwright/test';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from '../src/models';
import { recordControl, undoControl } from '../src/controlRecords';
import { decryptVault } from '../src/crypto';
import { advance, mfaState, passphrase, readSavedVault, sealRawVault, writeSavedVault } from './helpers';
import { beginRecipe, completeStep, currentTask } from '../src/guideEngine';
import { NATIVE_NAMES, type NativeProduct } from '../src/nativeManagers';

function fixture(product: NativeProduct, os: 'ios' | 'macos' | 'android' | 'windows') {
  let data = newDataset('ja');
  const account = { ...makeAsset({ kind: 'account', type: 'Primary email', name: '登録済みの個人用アカウント', importance: 'critical' }), provider: product === 'apple-passwords' ? 'apple' as const : 'google' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const device = makeAsset({ kind: 'device', type: 'Smartphone', name: 'いつもの端末', importance: 'critical', operatingSystem: os });
  data.assets = [account, device]; data.guide.accountId = account.id; data.guide.cursor = 'manager-select';
  data = recordControl(data, account.id, 'mfa', { id: 'existing-mfa' }) as CurrentDataset;
  data = recordControl(data, account.id, 'recovery', { id: 'existing-recovery' }) as CurrentDataset;
  return data;
}
async function open(page: Page, data: CurrentDataset) {
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja');
  await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
}
async function pick(page: Page, name: string) {
  await page.locator('.guide-card').getByRole('button', { name, exact: false }).click();
  await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
}
async function setup(page: Page, product: NativeProduct, os: string) {
  await pick(page, NATIVE_NAMES[product].ja); await pick(page, 'このアカウント・利用場所の保管庫を追加する');
  await advance(page, 'いつもの端末');
  if (product === 'apple-passwords') await advance(page, os === 'ios' ? 'iOS / iPadOS 18以降' : 'macOS Sequoia 15以降');
  else await pick(page, 'Google アカウントに保存する');
  await advance(page, '登録済みの個人用アカウント');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('パスワード管理を開く');
  for (let i = 0; i < 15; i++) {
    if (await page.getByRole('heading', { level: 1, name: '現在のログイン情報を保存する・見つける' }).isVisible()) return;
    await page.locator('.guide-card .primary-actions .button').click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  }
  throw new Error('Native setup did not reach saved-login work');
}
for (const [product, os] of [['apple-passwords', 'ios'], ['apple-passwords', 'macos'], ['google-password-manager', 'android'], ['google-password-manager', 'ios'], ['google-password-manager', 'windows']] as const) {
  test(`${product} ${os}: existing account, inline setup, keep strong password, typed map and loss check`, async ({ page, context }) => {
    const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
    const original = fixture(product, os); await open(page, original); await setup(page, product, os);
    await advance(page, '確認しました'); await advance(page, '今のパスワードを使う');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('保存した情報でログインする');
    await advance(page, '保存したパスワードでログインできました');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('次に、どの端末を対策しますか？');
    const data = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
    expect(data.assets).toHaveLength(2); expect(data.assets[0].id).toBe(original.assets[0].id); expect(data.assets[0].services).toEqual(['mail']);
    expect(data.actions.filter(a => a.targetId === original.assets[0].id && a.controlId === 'mfa')).toHaveLength(1);
    const vault = data.securityModel.entities.find(e => e.kind === 'vault')!;
    expect(data.securityModel.entities.filter(e => e.kind === 'installation')).toHaveLength(1);
    expect(data.securityModel.entities.filter(e => e.kind === 'credential')).toHaveLength(1);
    await page.getByRole('link', { name: 'Security Map', exact: true }).click();
    await expect(page.locator('.map-node')).toHaveCount(5);
    await page.locator('.map-node').filter({ has: page.getByText(vault.label, { exact: true }) }).click();
    await expect(page.locator('.map-details')).toContainText('少なくとも1台で利用を確認した記録');
    await expect(page.locator('.access-records')).toContainText('この条件での利用記録あり');
    await page.getByLabel('使えない項目を選ぶ').selectOption(original.assets[1].id);
    await expect(page.locator('.access-records')).toContainText('必要な手段が使えない条件');
    await page.getByLabel('使えない項目を選ぶ').selectOption('');
    await page.locator('.map-node').filter({ hasText: '登録済みの個人用アカウント' }).filter({ hasNotText: '保存パスワード' }).click();
    await expect(page.locator('.access-records')).toContainText('この条件での利用記録あり');
    await page.getByLabel('使えない項目を選ぶ').selectOption(original.assets[1].id);
    await expect(page.locator('.access-records')).toContainText('必要な手段が使えない条件');
    expect(external).toEqual([]);
  });
}

test('native setup returns from missing account authentication without changing the primary email or duplicating the account', async ({ page }) => {
  const source = fixture('apple-passwords', 'ios');
  const data = undoControl(source, 'existing-mfa', source.assets[0].id, 'mfa', { state: 'unknown', evidence: 'not-assessed' }) as CurrentDataset;
  const primary = { ...makeAsset({ kind: 'account', type: 'Primary email', name: '別のメインメール', importance: 'critical' }), provider: 'google' as const, services: ['mail' as const] };
  data.assets.push(primary); data.guide.accountId = primary.id;
  await open(page, data); await pick(page, NATIVE_NAMES['apple-passwords'].ja); await pick(page, 'このアカウント・利用場所の保管庫を追加する');
  await advance(page, 'いつもの端末'); await advance(page, 'iOS / iPadOS 18以降'); await advance(page, '登録済みの個人用アカウント');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('保管庫の基盤アカウントを保護する');
  await advance(page, 'アカウントの認証を設定・確認する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('アカウントの設定を開く');
  await mfaState(page, 'ios'); await advance(page, 'すでに有効になっている');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('パスワード管理を開く');
  const restored = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
  expect(restored.guide.accountId).toBe(primary.id); expect(restored.assets).toHaveLength(3);
});

import { chooseNativeDevice, configureNativeStorage, makeNativeVault, selectedNativeInstallation } from '../src/nativeManagers';
import { confirmPhoneStep, jumpPhoneStep, startPhoneWorkflow } from '../src/phoneEngine';
function phoneFixture(product: NativeProduct, newOs: 'ios' | 'android') {
  let data = fixture(product, product === 'apple-passwords' ? 'ios' : 'android');
  const old = data.assets[1], root = data.assets[0];
  data = makeNativeVault(data, product, 'ja'); const vaultId = data.guide.managerId!;
  data = chooseNativeDevice(data, vaultId, old.id) as CurrentDataset;
  data = configureNativeStorage(data, vaultId, 'account', root.id) as CurrentDataset;
  data = recordControl(data, selectedNativeInstallation(data, vaultId)!.id, 'opened', { id: 'old-store-opened' }) as CurrentDataset;
  data.guide.cursor = 'device-select'; data.guide.history = ['start', 'manager-select'];
  const fresh = makeAsset({ kind: 'device', type: 'Smartphone', name: '新しい端末', importance: 'critical', operatingSystem: newOs });
  data.assets.push(fresh);
  data = startPhoneWorkflow(data, '/guide', old.id, 'native-phone-task');
  Object.assign(data.deviceWorkflows[0], { newDeviceRef: fresh.id, cursor: `native-use:${vaultId}`, answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', [`use:${root.id}`]: 'yes' } });
  // This fixture starts after preparation, with the previous phone's backup checked.
  data = confirmPhoneStep(jumpPhoneStep(data, 'native-phone-task', 'old-backup-check'), 'native-phone-task') as CurrentDataset;
  data = jumpPhoneStep(data, 'native-phone-task', `native-use:${vaultId}`) as CurrentDataset;
  return { data, vaultId, root, fresh, old };
}
async function phoneConfirmUntil(page: Page, heading: string, limit = 20) {
  for (let i = 0; i < limit; i++) {
    if (await page.getByRole('heading', { level: 1, name: heading, exact: true }).isVisible()) return;
    const button = page.locator('.phone-guide .guide-actions .button.primary');
    await expect(button).toHaveCount(1); await button.click();
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  }
  throw new Error(`Phone guide did not reach ${heading}`);
}
for (const [product, os] of [['apple-passwords', 'ios'], ['google-password-manager', 'android'], ['google-password-manager', 'ios']] as const) {
  test(`${product} phone move to ${os}: separate app instance, resume after lock, saved-password use, map, preserve main guide`, async ({ page, context }) => {
    const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
    const f = phoneFixture(product, os), main = structuredClone(f.data.guide);
    if (product === 'apple-passwords') await page.setViewportSize({ width: 390, height: 844 });
    await open(page, f.data); await page.locator('.phone-launcher a').first().click();
    const useStore = page.getByRole('button', { name: 'はい・保管庫と保存情報を確認する', exact: true });
    await useStore.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
    if (product === 'apple-passwords') await advance(page, 'iOS 18以降');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('パスワード管理を開く');
    if (product === 'apple-passwords') {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-native-phone-ja.png`, fullPage: true });
      await page.locator('.language-picker select').selectOption('en');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open your existing password store');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-native-phone-en.png`, fullPage: true });
      await page.locator('.language-picker select').selectOption('ja');
    }
    if (product === 'google-password-manager') {
      await page.getByText('Chromeが入っていない場合', { exact: true }).click();
      await expect(page.getByRole('link', { name: '正規のダウンロード画面を開く' })).toHaveAttribute('href', os === 'ios' ? 'https://apps.apple.com/app/id535886823' : 'https://play.google.com/store/apps/details?id=com.android.chrome');
    }
    await advance(page, '確認しました');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('画面ロックを確認する');
    await page.locator('.phone-guide .guide-actions .button.primary').click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
    const afterLock = await page.getByRole('heading', { level: 1 }).innerText();
    await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(afterLock);
    const signInHelp = page.getByText(product === 'apple-passwords' ? 'この端末へまだサインインしていない場合' : 'Chromeへまだログインしていない場合', { exact: true });
    await signInHelp.click();
    await expect(page.locator('.guide-card details.technical')).toContainText(product === 'apple-passwords' ? '手動でサインイン' : '次の名前とメールアドレスで続行');
    await phoneConfirmUntil(page, 'どの保存済みログインを使ってみますか？');
    await advance(page, '登録済みの個人用アカウント');
    await expect(page.locator('.instruction')).toContainText('パスキー');
    await expect(page.getByRole('link', { name: '正規のアプリ・設定画面を開く' })).toHaveAttribute('href', product === 'apple-passwords' ? 'https://account.apple.com/' : 'https://myaccount.google.com/');
    await advance(page, '保存したパスワードで利用できました');
    await advance(page, '決済・電子ID・トーク履歴・仕事用認証などは使っていない'); await advance(page, 'これらの端末では電話回線を使わない');
    await phoneConfirmUntil(page, 'これまでのスマホを、どうしますか？'); await advance(page, '予備として残す');
    await phoneConfirmUntil(page, '機種変更の作業を保存しました');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('機種変更の作業を保存しました');
    const data = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
    expect(data.guide).toEqual(main); expect(data.assets).toHaveLength(3);
    expect(data.securityModel.entities.filter(e => e.kind === 'vault')).toHaveLength(1);
    expect(data.securityModel.entities.filter(e => e.kind === 'installation')).toHaveLength(2);
    const instance = data.securityModel.entities.find(e => e.kind === 'installation' && e.deviceRef === f.fresh.id)!;
    expect(instance.kind === 'installation' && instance.controls?.loginUse).toBe('verified');
    expect(Object.values(data.deviceWorkflows[0].records).some(r => r.stepId === 'new-lock')).toBe(false);
    expect(data.securityModel.lifecycle[f.old.id].state).toBe('backup');
    await page.getByRole('link', { name: 'Security Map', exact: true }).first().click();
    await page.locator('.map-node').filter({ hasText: instance.label }).click();
    await expect(page.locator('.map-details')).toContainText('この端末で保存情報を利用した記録');
    expect(external).toEqual([]);
  });
}

test('selecting the same Apple Account reuses its existing store and app without repeating setup', async ({ page }) => {
  let data = fixture('apple-passwords', 'ios');
  data = makeNativeVault(data, 'apple-passwords', 'ja'); const originalVault = data.guide.managerId!;
  data = chooseNativeDevice(data, originalVault, data.assets[1].id) as CurrentDataset;
  data = configureNativeStorage(data, originalVault, 'account', data.assets[0].id) as CurrentDataset;
  const app = selectedNativeInstallation(data, originalVault)!;
  data.guide.answers[`${app.id}:version`] = 'ios18plus';
  data = beginRecipe(data, app.id, 'builtin-manager') as CurrentDataset;
  for (let i = 0; i < 15 && currentTask(data)?.recipe.id === 'builtin-manager'; i++) data = completeStep(data) as CurrentDataset;
  data.guide.cursor = 'manager-select'; const originalSteps = structuredClone(data.guide.steps);
  await open(page, data); await pick(page, NATIVE_NAMES['apple-passwords'].ja); await pick(page, 'このアカウント・利用場所の保管庫を追加する');
  await advance(page, 'いつもの端末'); await advance(page, 'iOS / iPadOS 18以降'); await advance(page, '登録済みの個人用アカウント');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在のログイン情報を保存する・見つける');
  const restored = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
  expect(restored.assets).toHaveLength(2); expect(restored.guide.managerId).toBe(originalVault); expect(restored.guide.steps).toEqual(originalSteps);
  expect(restored.securityModel.entities.filter(e => e.kind === 'vault' && !e.mergedIntoRef)).toHaveLength(1);
  expect(restored.securityModel.entities.filter(e => e.kind === 'installation' && !e.mergedIntoRef)).toHaveLength(1);
  await page.getByRole('link', { name: 'Security Map', exact: true }).click(); await expect(page.locator('.map-node')).toHaveCount(4);
});
