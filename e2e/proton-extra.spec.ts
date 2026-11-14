import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from '../src/models';
import { recordControl } from '../src/controlRecords';
import { chooseCloudDevice, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer } from '../src/cloudManagers';
import { decryptVault } from '../src/crypto';
import { advance, passphrase, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(60_000);
function fixture(os: 'ios' | 'android' | 'windows') {
  let data = newDataset('ja');
  const root = { ...makeAsset({ kind: 'account', type: 'Primary email', name: '登録済みのProton Account', importance: 'critical' }), id: 'root', provider: 'proton' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const device = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'いつもの端末', importance: 'critical', operatingSystem: os }), id: 'phone' };
  data.assets = [root, device]; data.guide.accountId = root.id;
  data = makeCloudVault(data, 'proton-pass', 'ja') as CurrentDataset; const vaultId = data.guide.managerId!;
  data = configureCloudRoot(data, vaultId, root.id) as CurrentDataset; data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, device.id) as CurrentDataset; const appId = selectedCloudInstallation(data, vaultId)!.id;
  if (os === 'ios') data = setCloudAnswer(data, appId, 'ios', 'ios18plus') as CurrentDataset;
  if (os === 'windows') { data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset; data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: 'いつものプロファイル' } : e); }
  for (const [ref, control] of [[root.id, 'mfa'], [root.id, 'recovery'], [root.id, 'dataRecovery'], [root.id, 'passwordResetRecovery'], [root.id, 'recoveryFile'], [root.id, 'uniquePassword'], [device.id, 'screenLock'], [appId, 'opened'], [appId, 'storageChecked'], [appId, 'autofill'], [appId, 'loginUse']]) data = recordControl(data, ref, control, { id: `before:${ref}:${control}` }) as CurrentDataset;
  data.guide.cursor = `cloud-ready/${vaultId}`;
  return { data, appId, vaultId };
}
async function open(page: Page, data: CurrentDataset) {
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja'); await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
}
async function confirm(page: Page) { const button = page.locator('.guide-card .primary-actions .button'); await expect(button).toHaveCount(1); await button.click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
async function saved(page: Page) { return currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data); }
async function start(page: Page) {
  await page.getByText('Passの追加パスワード（任意）', { exact: true }).click();
  await advance(page, '追加パスワードの設定・続きを確認する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('追加パスワードの設定を開く'); await confirm(page);
}
for (const os of ['ios', 'android', 'windows'] as const) test(`${os}: optional extra password, independent preparation, actual reauthentication, resume, saved use and map`, async ({ page, context }) => {
  const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
  const f = fixture(os); await open(page, f.data); await start(page); await advance(page, '追加パスワードは未設定');
  await advance(page, '独立した利用手段を確保し、追加パスワードを設定する');
  for (let n = 0; n < 12; n++) { if (await page.getByRole('heading', { level: 1, name: '追加パスワードを確定する', exact: true }).isVisible()) break; await confirm(page); }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('追加パスワードを確定する');
  await expect(page.locator('.instruction')).toContainText('全端末のPassからサインアウト');
  if (os === 'ios') {
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.ARTIFACT_DIR) { await mkdir(process.env.ARTIFACT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/proton-extra-ja.png`, fullPage: true }); }
    await page.locator('.language-picker select').selectOption('en'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/proton-extra-en.png`, fullPage: true });
    await page.locator('.language-picker select').selectOption('ja');
  }
  await confirm(page); const applied = await saved(page); expect(applied.securityModel.revision).toBe(3);
  expect(applied.securityModel.lifecycle[f.appId].accessResetAt).toBeTruthy();
  expect(applied.securityModel.routes.some(r => r.id.includes(':proton-extra:extra-use'))).toBe(false);
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在のProton Accountでログインする');
  for (let n = 0; n < 6; n++) { if (await page.getByRole('heading', { level: 1, name: '重要なログイン情報を一つ、保存して使う', exact: true }).isVisible()) break; await confirm(page); }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('重要なログイン情報を一つ、保存して使う');
  await advance(page, '登録済みのProton Account');
  for (let n = 0; n < 10; n++) { if (await page.getByRole('heading', { level: 1, name: '次に、どの端末を対策しますか？', exact: true }).isVisible()) break; await confirm(page); }
  await page.getByRole('link', { name: 'Security Map', exact: true }).click();
  const data = await saved(page), credential = data.securityModel.entities.find(e => e.kind === 'credential' && e.protonPassExtraAccount === 'root')!;
  await page.locator('.map-node').filter({ has: page.getByText(credential.label, { exact: true }) }).click();
  await expect(page.locator('.map-details')).toContainText('追加パスワードの利用記録あり');
  await expect(page.locator('.access-records')).toContainText('Passの追加パスワードでログイン');
  await page.getByRole('link', { name: '対策を進める', exact: true }).click();
  const records = page.locator('.guide-sidebar .records').filter({ has: page.locator('summary', { hasText: '作業の完了記録' }) }); await records.locator('summary').click();
  const paperRecord = records.locator(':scope > div').filter({ hasText: '現在の紙の控えを確認する' });
  await expect(paperRecord).toHaveCount(1); await paperRecord.getByRole('button', { name: '取り消す', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在の紙の控えを確認する');
  const undone = await saved(page); expect(undone.securityModel.lifecycle[f.appId].accessResetAt).toBe(applied.securityModel.lifecycle[f.appId].accessResetAt);
  expect(undone.securityModel.facts.filter(f => f.id.includes(':proton-extra:read')).every(f => f.state === 'unknown')).toBe(true);
  expect(data.assets.map(a => a.id)).toEqual(f.data.assets.map(a => a.id)); expect(data.assets.find(a => a.id === 'root')?.controls.mfa).toBe('verified'); expect(external).toEqual([]);
});
for (const mode of ['standard', 'existing'] as const) test(`${mode}: preserves current setup and distinguishes a setting check from fresh authentication`, async ({ page }) => {
  const f = fixture('ios'); await open(page, f.data); await start(page);
  await advance(page, mode === 'standard' ? '追加パスワードは未設定' : '追加パスワードは設定済み');
  await advance(page, mode === 'standard' ? '通常の設定を維持する' : '現在の設定と控えを確認する');
  if (mode === 'standard') await expect(page.getByRole('heading', { level: 1 })).toHaveText('重要なログイン情報を一つ、保存して使う');
  for (let n = 0; n < 8; n++) { if (await page.getByRole('heading', { level: 1, name: '重要なログイン情報を一つ、保存して使う', exact: true }).isVisible()) break; await confirm(page); }
  const data = await saved(page); expect(data.assets).toEqual(f.data.assets);
  expect(data.securityModel.routes.some(r => r.id.includes(':proton-extra:'))).toBe(false);
  expect(data.securityModel.lifecycle[f.appId]?.accessResetAt).toBeUndefined();
});
test('forgotten extra password remains unfinished, preserves sessions and provides only manual exception help', async ({ page }) => {
  const f = fixture('windows'); await open(page, f.data); await start(page); await advance(page, '現在の追加パスワードが分からない');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('未完了で保存');
  await expect(page.locator('.guide-card')).toContainText('再設定や72時間のsigned-in resetで代用できるとは案内しません');
  const data = await saved(page); expect(data.securityModel.routes.some(r => r.id.includes(':proton-extra:'))).toBe(false);
  expect(data.securityModel.lifecycle[f.appId]?.accessResetAt).toBeUndefined();
  await page.getByRole('button', { name: '画面が違う', exact: true }).click(); await page.getByRole('button', { name: 'この案内でも解決しない', exact: true }).click();
  await expect(page.getByRole('button', { name: '相談文をコピーする', exact: true })).toBeVisible();
});
