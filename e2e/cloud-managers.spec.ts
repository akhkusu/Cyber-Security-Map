import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from '../src/models';
import { recordControl } from '../src/controlRecords';
import { decryptVault } from '../src/crypto';
import { CLOUD_NAMES, type CloudProduct } from '../src/cloudManagers';
import { advance, passphrase, prepareAuthenticator, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(60_000);
function fixture(product: CloudProduct, os: 'ios' | 'android' | 'windows', rootMfa = true) {
  let data = newDataset('ja');
  const primary = { ...makeAsset({ kind: 'account', type: 'Primary email', name: '非公開のメール名', importance: 'critical' }), id: 'mail', provider: product === 'proton-pass' ? 'proton' as const : 'google' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const device = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '非公開の端末名', importance: 'critical', operatingSystem: os }), id: 'device' };
  data.assets = [primary, device]; data.guide.accountId = primary.id; data.guide.cursor = 'manager-select';
  if (product === 'nordpass') data.assets.push({ ...makeAsset({ kind: 'account', type: 'Account', name: '非公開のNord Account名', importance: 'critical' }), id: 'nord', provider: 'nord', purpose: 'personal' });
  for (const a of data.assets.filter(a => a.kind === 'account')) for (const control of ['mfa', 'recovery']) {
    if (a.id !== 'nord' || rootMfa) data = recordControl(data, a.id, control, { id: `existing:${a.id}:${control}` }) as CurrentDataset;
  }
  return data;
}
async function open(page: Page, data: CurrentDataset) {
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja');
  await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
}
async function pick(page: Page, name: string) { await page.locator('.guide-card').getByRole('button', { name, exact: false }).click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
async function confirm(page: Page) { await page.locator('.guide-card .primary-actions button').click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
async function start(page: Page, product: CloudProduct, os: string, usage: 'new' | 'existing' = 'existing', newAccount = false) {
  await pick(page, CLOUD_NAMES[product].ja);
  await pick(page, '別の個人用の保管庫を設定・登録する');
  await pick(page, newAccount ? '新しい個人用アカウントを作成する' : product === 'proton-pass' ? '非公開のメール名' : '非公開のNord Account名');
  if (product === 'nordpass' && !newAccount) await pick(page, 'Nord Accountのパスワード・メールの確認コード');
  await pick(page, usage === 'existing' ? 'はい・既存の保管庫と設定を使う' : 'いいえ・このアカウントで初めて作る');
  await pick(page, '非公開の端末名 · 別の設定を追加する');
  if (os === 'ios') await pick(page, 'iOS / iPadOS 18+');
  if (os === 'android' && product === 'nordpass') await pick(page, 'Android 9+');
  if (os === 'windows') {
    await pick(page, 'Chrome'); await page.getByLabel('プロファイルの呼び名', { exact: true }).fill('非公開のプロファイル名'); await advance(page, 'この呼び名で進める');
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`正規の${CLOUD_NAMES[product].ja}を開く`);
}
async function finishSetup(page: Page) {
  for (let n = 0; n < 40; n++) {
    const heading = await page.getByRole('heading', { level: 1 }).innerText();
    if (heading === '重要なログイン情報を一つ、保存して使う' || heading === 'このマネージャーの基盤アカウントを保護する' || heading === '基盤アカウントの復旧手段を確保する') return;
    if (heading.includes('現在のマスターが')) await pick(page, '専用でランダムな、十分に長いものだと確認できました');
    else if (heading.includes('控えていますか？') || heading.includes('保管していますか？')) await pick(page, 'はい・置き換えずに現在の控えを確認する');
    else if (heading === '追加のパスワード再設定方法は？') await pick(page, '設定済みの復旧用メールを確認する');
    else await confirm(page);
  }
  throw Error('Cloud setup did not finish');
}
async function saved(page: Page) { return currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data); }

for (const product of ['proton-pass', 'nordpass'] as const) for (const os of ['ios', 'android', 'windows'] as const) {
  test(`${product} ${os}: inline setup, existing recovery, saved use, reload, map and independent phone-loss context`, async ({ page, context }) => {
    const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
    if (os === 'ios') await page.setViewportSize({ width: 390, height: 844 });
    const original = fixture(product, os); await open(page, original); await start(page, product, os);
    expect((await saved(page)).assets.filter(a => a.kind === 'account')).toHaveLength(original.assets.filter(a => a.kind === 'account').length);
    expect((await saved(page)).securityModel.entities.find(e => e.kind === 'installation')?.controls).toEqual({});
    await confirm(page); const heading = await page.getByRole('heading', { level: 1 }).innerText();
    await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await finishSetup(page); await pick(page, '非公開のメール名'); await pick(page, 'はい・変更せずに保存して使う');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('現在使えるログイン情報を先に保存する'); await confirm(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('保存したパスワードで正規サービスへログインする');
    if (os === 'ios') {
      await page.locator('.language-picker select').selectOption('en');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use the saved password at the real service');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.ARTIFACT_DIR) { await mkdir(process.env.ARTIFACT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/${product}-mobile-en.png`, fullPage: true }); }
      await page.locator('.language-picker select').selectOption('ja');
      if (process.env.ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/${product}-mobile-ja.png`, fullPage: true });
    }
    await advance(page, '保存したパスワードでログインできました');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('次に、どの端末を対策しますか？');
    const data = await saved(page); expect(data.guide.accountId).toBe('mail'); expect(data.securityModel.revision).toBe(2);
    expect(data.actions.filter(a => a.targetId === 'mail' && a.controlId === 'mfa')).toHaveLength(1);
    expect(data.securityModel.entities.filter(e => e.kind === 'credential' && e.credentialType === 'password')).toHaveLength(1);
    const vault = data.securityModel.entities.find(e => e.kind === 'vault')!;
    await page.getByRole('link', { name: 'Security Map', exact: true }).click();
    await page.locator('.map-node').filter({ has: page.getByText(vault.label, { exact: true }) }).click();
    await expect(page.locator('.access-records')).toContainText('この条件での利用記録あり');
    await page.getByLabel('失った端末を選ぶ').selectOption('device');
    await expect(page.locator('.access-records')).toContainText('必要な手段が使えない条件');
    if (os === 'ios') {
      await page.getByLabel('失った端末を選ぶ').selectOption('');
      const recovery = data.securityModel.entities.find(e => e.kind === 'credential' && typeof e.cloudRecoveryPhase === 'string')!;
      await page.locator('.map-node').filter({ has: page.getByText(recovery.label, { exact: true }) }).click();
      await advance(page, 'この復旧手段を確認する');
      await pick(page, 'はい・置き換えずに現在の控えを確認する'); await confirm(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(product === 'proton-pass' ? 'Protonの復旧フレーズをProtonの外へ保管する' : '24文字の保管庫用Recovery Codeを保管する');
    }
    expect(external).toEqual([]);
  });
}

test('new NordPass vault: local dice list, distinct account/master, independent recovery and existing root-MFA branch', async ({ page, context, baseURL }) => {
  const external: string[] = []; context.on('request', r => { if (!r.url().startsWith(new URL(baseURL!).origin)) external.push(r.url()); });
  await open(page, fixture('nordpass', 'ios')); await start(page, 'nordpass', 'ios', 'new', true);
  await confirm(page); await expect(page.getByRole('heading', { level: 1 })).toHaveText('新しい専用のパスフレーズを作る');
  await expect(page.locator('.guide-card')).toContainText('6語');
  const download = page.waitForEvent('download'); await page.locator('.guide-card a[download]').click();
  const path = await (await download).path(); expect(path).toBeTruthy(); const bytes = await readFile(path!);
  expect(bytes.toString().trim().split('\n')).toHaveLength(7776); expect(createHash('sha256').update(bytes).digest('hex')).toBe('addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e');
  for (let n = 0; n < 10; n++) { if (await page.getByRole('heading', { level: 1, name: '現在の保管庫用Recovery Codeを控えていますか？', exact: true }).isVisible()) break; await confirm(page); }
  await pick(page, 'いいえ・新しいコードを作成して保管する');
  for (let n = 0; n < 10; n++) { if (await page.getByRole('heading', { level: 1, name: 'このマネージャーの基盤アカウントを保護する', exact: true }).isVisible()) break; await confirm(page); }
  const before = await saved(page), root = before.assets.find(a => a.provider === 'nord' && a.id !== 'nord')!;
  expect(root.controls.mfa ?? 'unknown').toBe('unknown');
  await pick(page, '必要なアカウント設定を進める');
  for (let n = 0; n < 10; n++) { if (await page.getByRole('heading', { level: 1, name: 'MFAがすでに有効か確認する', exact: true }).isVisible()) break; await confirm(page); }
  await pick(page, 'MFAはすでに有効です');
  // Even the existing-MFA branch still needs its independent MFA recovery codes.
  await finishSetup(page);
  if (await page.getByRole('heading', { level: 1, name: '基盤アカウントの復旧手段を確保する', exact: true }).isVisible()) await pick(page, '必要なアカウント設定を進める');
  await finishSetup(page);
  const data = await saved(page); expect(data.guide.accountId).toBe('mail');
  expect(data.assets.find(a => a.id === root.id)?.controls).toMatchObject({ mfa: 'verified', recovery: 'verified' });
  expect(data.securityModel.entities.find(e => e.kind === 'vault')?.controls).toMatchObject({ masterStrength: 'verified', recovery: 'verified', independentRoot: 'verified' });
  expect(external).toEqual([]);
});

test('Nord Account new authenticator: exact app enrollment and MFA codes, primary email unchanged', async ({ page }) => {
  await open(page, fixture('nordpass', 'android', false)); await start(page, 'nordpass', 'android'); await finishSetup(page);
  await pick(page, '必要なアカウント設定を進める');
  for (let n = 0; n < 10; n++) { if (await page.getByRole('heading', { level: 1, name: 'MFAがすでに有効か確認する', exact: true }).isVisible()) break; await confirm(page); }
  await pick(page, '認証アプリで設定する');
  for (let n = 0; n < 8; n++) { if (await page.getByRole('heading', { level: 1, name: 'どの認証アプリを使いますか？', exact: true }).isVisible()) break; await confirm(page); }
  await prepareAuthenticator(page);
  for (let n = 0; n < 25; n++) { if (await page.getByRole('heading', { level: 1, name: '重要なログイン情報を一つ、保存して使う', exact: true }).isVisible()) break; await confirm(page); }
  const data = await saved(page); expect(data.guide.accountId).toBe('mail');
  expect(data.assets.find(a => a.id === 'nord')?.controls).toMatchObject({ mfa: 'verified', recovery: 'verified' });
  expect(data.actions.filter(a => a.targetId === 'nord' && a.controlId === 'recovery')).toHaveLength(1);
});

test('cloud exception help is manual, sanitized, keyboard accessible and leaves unsupported sign-in unfinished', async ({ page, context }) => {
  const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
  await open(page, fixture('nordpass', 'ios'));
  await pick(page, 'NordPass'); await pick(page, '別の個人用の保管庫を設定・登録する'); await pick(page, '非公開のNord Account名');
  const sso = page.getByRole('button', { name: 'Google・Appleでログインする', exact: true }); await sso.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('どの提供元でログインしますか？');
  await pick(page, '別の方法・分からない');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('既存のログイン方法を残す');
  await page.getByRole('button', { name: 'うまくいかない', exact: true }).click();
  await page.locator('.problem-options button').first().click();
  await page.getByRole('button', { name: 'この案内でも解決しない', exact: true }).click();
  const prompt = await page.getByLabel('AIへの相談文', { exact: true }).inputValue();
  expect(prompt).toContain('NordPass'); expect(prompt).toContain('公式');
  expect(prompt).not.toContain('非公開'); expect(prompt).not.toContain('nord/');
  const data = await saved(page); expect(data.securityModel.entities.find(e => e.kind === 'vault')?.controls ?? {}).toEqual({});
  expect(external).toEqual([]);
});

for (const product of ['proton-pass', 'nordpass'] as const) test(`${product}: protect the manager's own Account password, resume after acceptance and save before cleanup`, async ({ page }) => {
  await open(page, fixture(product, 'windows')); await start(page, product, 'windows'); await finishSetup(page);
  await pick(page, product === 'proton-pass' ? '非公開のメール名' : '非公開のNord Account名'); await pick(page, 'いいえ・分からないので新しく生成する');
  for (let n = 0; n < 8; n++) {
    if (await page.getByRole('heading', { level: 1, name: '変更するアカウントの外にも候補を控える', exact: true }).isVisible()) break;
    await confirm(page);
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('変更するアカウントの外にも候補を控える'); await confirm(page);
  for (let n = 0; n < 6; n++) {
    if (await page.getByRole('heading', { level: 1, name: '変更後もマネージャーを開けることを確認する', exact: true }).isVisible()) break;
    await confirm(page);
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('変更後もマネージャーを開けることを確認する');
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await confirm(page); await expect(page.getByRole('heading', { level: 1 })).toHaveText('受け付けられた後に、元の保存項目を更新する'); await confirm(page);
  await advance(page, '保存したパスワードでログインできました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('不要になった一時的な候補だけを整理する'); await confirm(page);
  const data = await saved(page); expect(data.guide.accountId).toBe('mail');
  expect(data.assets.find(a => a.id === (product === 'proton-pass' ? 'mail' : 'nord'))?.controls.uniquePassword).toBe('verified');
});

test('weak NordPass master: recovery first, private replacement, resume after change and unlock without resetting', async ({ page }) => {
  await open(page, fixture('nordpass', 'ios')); await start(page, 'nordpass', 'ios');
  for (let n = 0; n < 15; n++) {
    const heading = await page.getByRole('heading', { level: 1 }).innerText();
    if (heading.includes('現在のマスターが')) break;
    if (heading.includes('Recovery Codeを控えていますか')) await pick(page, 'はい・置き換えずに現在の控えを確認する'); else await confirm(page);
  }
  await pick(page, '使い回し・弱い・確認できない');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('変更する前に、現在の利用・復旧手段を残す');
  for (let n = 0; n < 5; n++) await confirm(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新しいマスターで同じ保管庫を開く');
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  const before = await saved(page), vault = before.securityModel.entities.find(e => e.kind === 'vault')!;
  expect(vault.controls?.masterChanged ?? 'unknown').toBe('unknown');
  expect(before.securityModel.lifecycle[vault.id].accessResetAt).toBeDefined();
  await advance(page, '新しいマスターで開けました'); await finishSetup(page);
  expect((await saved(page)).securityModel.entities.find(e => e.id === vault.id)?.controls?.masterChanged).toBe('verified');
});
