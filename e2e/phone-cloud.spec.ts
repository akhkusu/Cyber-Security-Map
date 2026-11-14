import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from '../src/models';
import { recordControl } from '../src/controlRecords';
import { addCloudRoot, chooseCloudDevice, cloudInstallation, cloudVault, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer, type CloudProduct } from '../src/cloudManagers';
import { confirmPhoneStep, jumpPhoneStep, startPhoneWorkflow } from '../src/phoneEngine';
import { decryptVault } from '../src/crypto';
import { advance, passphrase, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(60_000);
function fixture(product: CloudProduct, from: 'ios' | 'android', to: 'ios' | 'android') {
  let data = newDataset('ja');
  const mail = { ...makeAsset({ kind: 'account', type: 'Primary email', name: '登録済みのメインメール', importance: 'critical' }), id: 'mail', provider: product === 'proton-pass' ? 'proton' as const : 'google' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const old = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'これまでのスマホ', importance: 'critical', operatingSystem: from }), id: 'old' };
  const fresh = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '新しいスマホ', importance: 'critical', operatingSystem: to }), id: 'fresh' };
  data.assets = [mail, old, fresh]; data.guide.accountId = mail.id; data.guide.cursor = 'device-select'; data.guide.history = ['start', 'manager-select']; data.guide.answers = { 'private-answer': '個人用の非公開メモ' };
  data = makeCloudVault(data, product, 'ja'); const vaultId = data.guide.managerId!;
  data = (product === 'proton-pass' ? configureCloudRoot(data, vaultId, mail.id) : addCloudRoot(data, vaultId, 'personal', true)) as CurrentDataset;
  const rootId = cloudVault(data, vaultId)!.authenticationAccountRef!;
  if (product === 'nordpass') data = setCloudAnswer(data, rootId, 'method', 'direct') as CurrentDataset;
  data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset; data = chooseCloudDevice(data, vaultId, old.id) as CurrentDataset;
  const oldAppId = selectedCloudInstallation(data, vaultId)!.id;
  const controls = [[mail.id, 'mfa'], [mail.id, 'recovery'], [rootId, 'mfa'], [rootId, 'recovery'], [oldAppId, 'opened'], [oldAppId, 'storageChecked']];
  if (product === 'nordpass') { data = setCloudAnswer(data, vaultId, 'master', 'keep') as CurrentDataset; controls.push([vaultId, 'recovery'], [vaultId, 'independentRoot']); }
  else controls.push([rootId, 'dataRecovery'], [rootId, 'passwordResetRecovery'], [rootId, 'recoveryFile']);
  for (const [ref, control] of controls) data = recordControl(data, ref, control, { id: `existing:${ref}:${control}` }) as CurrentDataset;
  data = startPhoneWorkflow(data, '/guide', old.id, 'cloud-phone');
  Object.assign(data.deviceWorkflows[0], { newDeviceRef: fresh.id, cursor: `cloud-use:${vaultId}`, answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'use:mail': 'yes', [`use:${rootId}`]: 'yes', 'special-apps': 'none', 'phone-line': 'no-line', 'old-fate': 'spare' } });
  data = confirmPhoneStep(jumpPhoneStep(data, 'cloud-phone', 'old-backup-check'), 'cloud-phone') as CurrentDataset;
  data = jumpPhoneStep(data, 'cloud-phone', `cloud-use:${vaultId}`) as CurrentDataset;
  return { data, vaultId, oldAppId };
}
async function open(page: Page, data: CurrentDataset) {
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja');
  await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await page.locator('.phone-launcher a').first().click();
}
async function pick(page: Page, name: string) { await page.locator('.phone-guide .guide-card').getByRole('button', { name, exact: false }).click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
async function confirm(page: Page) { const button = page.locator('.phone-guide .guide-actions .button.primary'); await expect(button, await page.getByRole('heading', { level: 1 }).innerText()).toHaveCount(1); await expect(button).toBeEnabled(); await button.click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
async function saved(page: Page) { return currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data); }
for (const product of ['proton-pass', 'nordpass'] as const) for (const from of ['ios', 'android'] as const) for (const to of ['ios', 'android'] as const) {
  test(`${product} ${from} → ${to}: inline migration, resume, real password use, map and preserved main guide`, async ({ page, context }) => {
    const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
    const f = fixture(product, from, to); await open(page, f.data); await pick(page, '新しいスマホで使う');
    for (let n = 0; n < 4; n++) await confirm(page);
    await pick(page, 'この新端末のアプリを別に登録する');
    if (to === 'ios') await pick(page, 'iOS / iPadOS 18以降'); else if (product === 'nordpass') await pick(page, 'Android 9以降');
    const planned = await saved(page), appId = planned.deviceWorkflows[0].answers[`cloud-destination:${f.vaultId}`];
    expect(cloudInstallation(planned, appId)?.controls).toEqual({});
    await confirm(page);
    const signedIn = from === to;
    await pick(page, signedIn ? '使いたい保管庫を、すでに開ける' : 'アカウントへのログインが必要');
    for (let n = 0; n < 20; n++) {
      const heading = await page.getByRole('heading', { level: 1 }).innerText();
      if (heading === 'どの保存済みログインを使ってみますか？') break;
      if (heading === 'このログインで、追加の認証を求められていますか？') await pick(page, 'はい・登録済みの方法で確認する'); else await confirm(page);
    }
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('どの保存済みログインを使ってみますか？');
    await pick(page, '登録済みのメインメール');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('保存したパスワードで正規サービスへログインする');
    await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('保存したパスワードで正規サービスへログインする');
    if (from === 'ios' && to === 'android') {
      await page.setViewportSize({ width: 390, height: 844 });
      if (process.env.ARTIFACT_DIR) { await mkdir(process.env.ARTIFACT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/${product}-phone-ja.png`, fullPage: true }); }
      await page.locator('.language-picker select').selectOption('en');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use the saved password at the real service');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/${product}-phone-en.png`, fullPage: true });
      await page.locator('.language-picker select').selectOption('ja');
    }
    await advance(page, '保存したパスワードでログインできました');
    const data = await saved(page); expect(data.guide).toEqual(f.data.guide); expect(data.assets.length).toBe(f.data.assets.length);
    expect(cloudInstallation(data, f.oldAppId)).toEqual(cloudInstallation(f.data, f.oldAppId));
    expect(cloudInstallation(data, appId)?.controls?.loginUse).toBe('verified');
    await page.getByRole('link', { name: 'Security Map', exact: true }).first().click();
    const app = cloudInstallation(data, appId)!; await page.locator('.map-node').filter({ has: page.getByText(app.label, { exact: true }) }).click();
    await expect(page.locator('.map-details')).toContainText('保存パスワードの利用記録あり');
    await page.getByLabel('使えない項目を選ぶ').selectOption('old'); await expect(page.locator('.access-records')).toContainText('この条件での利用記録あり');
    await page.getByRole('link', { name: 'この機種変更を続ける', exact: true }).click();
    await expect(page).toHaveURL(/(?:#)?\/phone\/cloud-phone$/);
    await expect(page.locator('.phone-guide')).toBeVisible();
    if (product === 'proton-pass' && from !== to) {
      for (let n = 0; n < 25; n++) {
        if (await page.getByRole('heading', { level: 1, name: '機種変更の作業を保存しました', exact: true }).isVisible()) break;
        const title = await page.getByRole('heading', { level: 1 }).innerText();
        if (title === '個別の引き継ぎが必要なものはありますか？') await pick(page, '決済・電子ID・トーク履歴・仕事用認証などは使っていない');
        else if (title === '電話回線は、新端末で使えますか？') await pick(page, 'これらの端末では電話回線を使わない');
        else if (title === 'これまでのスマホを、どうしますか？') await pick(page, '予備として残す');
        else await confirm(page);
      }
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('機種変更の作業を保存しました');
      expect((await saved(page)).guide).toEqual(f.data.guide);
    }
    expect(external).toEqual([]);
  });
}

test('old-only vault use can keep the phone as a spare; choosing sale keeps the cloud move unfinished', async ({ page }) => {
  const f = fixture('nordpass', 'ios', 'ios'); await open(page, f.data); await pick(page, '今は旧端末だけで使う');
  await page.locator('.phone-guide .guide-sidebar .records').first().locator('summary').click();
  await expect(page.getByRole('button', { name: '唯一の利用端末を手放す前に、保管庫を引き継ぐ' })).toHaveCount(0);
  // The existing phone workflow offers the old-phone decision without replacing the main guide.
  const before = await saved(page); before.deviceWorkflows[0].cursor = 'old-fate';
  await writeSavedVault(page, await sealRawVault(before)); await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await pick(page, '売る・下取りに出す');
  await expect(page.locator('.handoff-gate')).toContainText('唯一の利用端末を手放す前に、保管庫を引き継ぐ');
  expect((await saved(page)).guide).toEqual(f.data.guide);
});
