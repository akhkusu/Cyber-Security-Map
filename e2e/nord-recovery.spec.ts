import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { makeAsset, newDataset, currentDatasetSchema, type CurrentDataset } from '../src/models';
import { recordControl } from '../src/controlRecords';
import { chooseCloudDevice, cloudInstallation, cloudVault, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer } from '../src/cloudManagers';
import { answerPhoneQuestion, jumpPhoneStep, startPhoneWorkflow } from '../src/phoneEngine';
import { nordRecoveryTasks } from '../src/nordRecoverySchemas';
import { decryptVault } from '../src/crypto';
import { advance, passphrase, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(60_000);
function fixture(os: 'ios' | 'android' | 'macos' | 'windows' = 'ios', lang: 'ja' | 'en' = 'ja') {
  let data = newDataset(lang);
  const root = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'PRIVATE ACCOUNT', importance: 'critical' }), id: 'root', provider: 'nord' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const device = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '利用する端末', importance: 'critical', operatingSystem: os }), id: 'device' };
  data.assets = [root, device]; data.guide.accountId = root.id;
  data = makeCloudVault(data, 'nordpass', lang); const vaultId = data.guide.managerId!;
  data = configureCloudRoot(data, vaultId, root.id) as CurrentDataset; data = setCloudAnswer(data, root.id, 'method', 'direct') as CurrentDataset; data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset; data = setCloudAnswer(data, vaultId, 'master', 'keep') as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, device.id) as CurrentDataset; const appId = selectedCloudInstallation(data, vaultId)!.id;
  if (['ios', 'android'].includes(os)) data = setCloudAnswer(data, appId, os === 'ios' ? 'ios' : 'android', os === 'ios' ? 'ios18plus' : 'android9plus') as CurrentDataset;
  else { data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset; data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: 'PRIVATE PROFILE' } : e); }
  for (const [ref, control] of [[root.id, 'mfa'], [root.id, 'recovery'], [device.id, 'screenLock'], [appId, 'opened'], [appId, 'storageChecked'], [appId, 'autofill'], [vaultId, 'recovery'], [vaultId, 'independentRoot']]) data = recordControl(data, ref, control, { id: `old:${ref}:${control}` }) as CurrentDataset;
  data.guide.cursor = `do/${appId}/cloud-onboard/vault-open`; data.guide.history = ['start', 'manager-select']; data.guide.answers['private-note'] = 'DO NOT COPY ME';
  return { data, vaultId, appId };
}
async function open(page: Page, data: CurrentDataset) {
  await page.goto('./'); await page.locator('.language-picker select').selectOption(data.settings.language);
  await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  const ja = data.settings.language === 'ja'; await page.getByLabel(ja ? 'アプリの保存用パスフレーズ' : 'App passphrase', { exact: true }).fill(passphrase); await advance(page, ja ? '開いて再開する' : 'Unlock and continue');
}
async function saved(page: Page) { return currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data); }
async function launch(page: Page, ja = true) {
  await page.getByText(ja ? 'NordPassのマスターパスワードを忘れた場合' : 'If you forgot the NordPass Master Password', { exact: true }).click();
  await advance(page, ja ? '既存の保管庫を復旧する' : 'Recover the existing vault');
}
async function primary(page: Page) {
  await page.locator('.guide-card > .button.primary').click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
}
async function finish(page: Page, lang = 'ja', backup = 'current') {
  for (let i = 0; i < 32 && /\/recover\/nord\//.test(page.url()); i++) {
    const heading = await page.getByRole('heading', { level: 1 }).innerText();
    if (heading === 'このアプリは、意図したNord Accountにログイン済みですか？' || heading === 'Is this app signed in to the intended Nord Account?') await advance(page, lang === 'ja' ? 'はい・そのアカウントのマスター解除画面がある' : 'Yes; it shows that account’s master-unlock prompt');
    else if (heading === '有効な現在の復旧用の控えを確認できますか？' || heading === 'Can you identify a confirmed current recovery copy?') await advance(page, lang === 'ja' ? backup === 'current' ? 'はい・有効な現在の24文字の控えを別の場所から取り出せる' : 'いいえ・分からないので、使える新マスターで再発行する' : 'Yes; the current 24-symbol copy is independently available');
    else if (/^復旧する端末のOS|^Which OS version/.test(heading)) await page.locator('.guide-card .choices button').first().click();
    else await primary(page);
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  }
}
for (const os of ['ios', 'android', 'windows'] as const) test(`${os}: recover with current NordPass code, resume, finish once, and reflect real use in the map`, async ({ page, context }) => {
  const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
  const f = fixture(os); await open(page, f.data); await launch(page);
  await advance(page, '現在の24文字の保管庫用Recovery Code'); await primary(page); await primary(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在の24文字のコードを私的に確保する');
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在の24文字のコードを私的に確保する');
  await expect(page.locator('.guide-card input')).toHaveCount(0); await finish(page, 'ja', os === 'android' ? 'replace' : 'current');
  await expect(page).toHaveURL(/(?:#)?\/guide$/); const data = await saved(page); expect(nordRecoveryTasks(data)[0].status).toBe('completed'); expect(data.assets[0]).toEqual(f.data.assets[0]);
  await page.getByRole('link', { name: 'Security Map', exact: true }).click(); await page.locator('.map-node').filter({ has: page.getByText(cloudVault(data, f.vaultId)!.label, { exact: true }) }).click();
  await expect(page.getByRole('link', { name: '保管庫の復旧記録を確認する', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '保管庫の復旧記録を確認する', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('既存の保管庫を再び開けるようになりました');
  await page.getByRole('button', { name: '取り消す master-test', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('新しいマスターで、同じ保管庫を開く');
  expect((await saved(page)).securityModel.lifecycle[f.vaultId].accessResetAt).toBe(data.securityModel.lifecycle[f.vaultId].accessResetAt); expect(external).toEqual([]);
});
for (const os of ['ios', 'macos'] as const) test(`${os}: existing biometric app issues a code before recovery without creating another vault`, async ({ page }) => {
  const f = fixture(os); await open(page, f.data); await launch(page); await advance(page, '設定済みの顔・指紋認証で開けるアプリがある'); await primary(page); await primary(page);
  await page.locator('.guide-card .choices button').first().click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('設定済みの生体認証で、既存の保管庫を開く'); await primary(page); await primary(page); await primary(page); await primary(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在の24文字のコードを私的に確保する'); await finish(page);
  const data = await saved(page); expect(nordRecoveryTasks(data)[0].mutations['bio-code']).toBeDefined(); expect(data.securityModel.entities.filter(e => e.kind === 'vault')).toHaveLength(1);
});
for (const to of ['ios', 'android'] as const) test(`phone move to ${to}: recovery does not overwrite the main guide or repeat completed migration checks`, async ({ page }) => {
  const f = fixture(to === 'ios' ? 'android' : 'ios'); let data = f.data;
  data.assets.push({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: '新しいスマホ', importance: 'critical', operatingSystem: to }), id: 'new' });
  data.guide.cursor = 'device-select'; data = startPhoneWorkflow(data, '/guide', 'device', 'replacement'); Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'new', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'old-fate': 'spare' } });
  data = answerPhoneQuestion(jumpPhoneStep(data, 'replacement', `cloud-use:${f.vaultId}`), 'replacement', 'new') as CurrentDataset;
  const originalGuide = structuredClone(data.guide); await open(page, data); await page.locator('.phone-launcher a').first().click(); await launch(page); await page.locator('.guide-card .choices button').first().click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  await advance(page, '現在の24文字の保管庫用Recovery Code'); await finish(page);
  await expect(page).toHaveURL(/(?:#)?\/phone\/replacement$/); const after = await saved(page); expect(after.guide).toEqual(originalGuide); const t = nordRecoveryTasks(after)[0]; expect(cloudInstallation(after, t.targetRef)?.deviceRef).toBe('new');
  expect(Object.values(after.deviceWorkflows[0].records).filter(r => r.nordRecoveryTaskRef === t.id)).toHaveLength(7); expect(Object.values(after.deviceWorkflows[0].records).some(r => r.stepId.endsWith(':test'))).toBe(false);
});
for (const lang of ['ja', 'en'] as const) test(`${lang}: mobile keyboard and manual exception help keep unavailable recovery unfinished`, async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await page.setViewportSize({ width: 390, height: 844 }); const f = fixture('ios', lang); await open(page, f.data); await launch(page, lang === 'ja');
  await page.getByRole('button', { name: lang === 'ja' ? 'どちらも使えない・分からない' : 'Neither is available / I am not sure', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('heading', { level: 1 })).toHaveText(lang === 'ja' ? '残っている保管庫とログインを維持する' : 'Preserve the remaining vault and sessions');
  await expect(page.locator('.guide-card > .button.primary')).toHaveCount(0); await advance(page, lang === 'ja' ? 'うまくいかない' : 'Something is different'); await advance(page, lang === 'ja' ? 'コード・生体認証を使えない' : 'The code or biometrics do not work');
  await expect(page.getByRole('button', { name: lang === 'ja' ? 'AIへの相談文をコピーする' : 'Copy a prompt for AI', exact: true })).toHaveCount(0); await advance(page, lang === 'ja' ? 'この案内では解決しない' : 'This did not solve it'); await advance(page, lang === 'ja' ? 'AIへの相談文をコピーする' : 'Copy a prompt for AI');
  const prompt = await page.evaluate(() => navigator.clipboard.readText()); expect(prompt).toContain('https://support.nordpass.com/'); expect(prompt).not.toMatch(/PRIVATE|DO NOT COPY ME/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await mkdir('test-results/nord-recovery', { recursive: true }); await page.screenshot({ path: `test-results/nord-recovery/nord-recovery-${lang}.png`, fullPage: true });
  await advance(page, lang === 'ja' ? 'この作業を後回しにする' : 'Do this later'); const after = await saved(page); expect(after.guide).toEqual(f.data.guide); expect(nordRecoveryTasks(after)[0].status).toBe('deferred');
});
