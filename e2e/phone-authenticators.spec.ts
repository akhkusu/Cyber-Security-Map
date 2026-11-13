import { test, expect, type Page } from '@playwright/test';
import { chooseAuthenticator } from '../src/authenticatorGuide';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from '../src/models';
import { recordControl } from '../src/controlRecords';
import { confirmPhoneStep, jumpPhoneStep, startPhoneWorkflow } from '../src/phoneEngine';
import { decryptVault } from '../src/crypto';
import { advance, passphrase, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(90000);
function fixture(product: 'bitwarden-authenticator' | 'microsoft-authenticator', oldOS: 'ios' | 'android', newOS: 'ios' | 'android') {
  let data = newDataset('ja');
  data.assets = [
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'これまでのスマホ', operatingSystem: oldOS, importance: 'critical' }), id: 'old' },
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '新しいスマホ', operatingSystem: newOS, importance: 'critical' }), id: 'fresh' },
    { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'メインのProton', importance: 'critical' }), id: 'email', provider: 'proton', purpose: 'personal' },
    { ...makeAsset({ kind: 'account', type: 'Identity provider', name: '復元用Apple', importance: 'critical' }), id: 'apple', provider: 'apple', purpose: 'personal' },
    { ...makeAsset({ kind: 'account', type: 'Identity provider', name: '復元用Microsoft', importance: 'critical' }), id: 'microsoft', provider: 'microsoft', purpose: 'personal' },
  ];
  data = chooseAuthenticator(data, 'email', product, 'old', 'do/email/email-mfa/scan');
  const sourceRef = data.guide.answers['auth:email:app'];
  data = currentDatasetSchema.parse(recordControl(data, sourceRef, 'opened', { id: 'old-app' }));
  data = currentDatasetSchema.parse(recordControl(data, 'email', 'mfa', { id: 'existing-mfa' }));
  data.securityModel.entities.push({ id: 'known-code', kind: 'credential', credentialType: 'totp', subjectRef: 'email', storageRef: sourceRef, roles: ['second-step'], label: '元の認証コード', createdAt: new Date().toISOString() });
  data.guide.cursor = 'device-select'; data.guide.accountId = 'email'; data.guide.history = ['start']; data.guide.answers.original = 'keep the main guide';
  data = startPhoneWorkflow(data, '/guide', 'old', 'move');
  Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'fresh', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none' } });
  data = confirmPhoneStep(jumpPhoneStep(data, 'move', 'prepare-recovery'), 'move') as CurrentDataset;
  data = jumpPhoneStep(data, 'move', `auth:${sourceRef}:old-open`) as CurrentDataset;
  return { data, sourceRef };
}
async function open(page: Page, data: CurrentDataset) {
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja');
  await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await page.getByRole('link', { name: /^機種変更を再開する/ }).first().click();
}
for (const [product, oldOS, newOS] of [
  ['bitwarden-authenticator', 'ios', 'ios'], ['bitwarden-authenticator', 'android', 'android'],
  ['bitwarden-authenticator', 'ios', 'android'], ['bitwarden-authenticator', 'android', 'ios'],
  ['microsoft-authenticator', 'ios', 'ios'], ['microsoft-authenticator', 'android', 'android'],
] as const) {
  test(`${product} phone move ${oldOS} → ${newOS}: inline transfer, exact resume, code acceptance, shared map`, async ({ page, context }) => {
    const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
    const f = fixture(product, oldOS, newOS); await open(page, f.data);
    let resumed = false;
    for (let i = 0; i < 65; i++) {
      const title = await page.getByRole('heading', { level: 1 }).innerText();
      if (title.endsWith('を新しいスマホで使いますか？')) break;
      const choices = page.locator('.phone-guide .choices .choice');
      if (await choices.count()) {
        if (title === '新端末のどのアプリ・保存先へ移しますか？') await advance(page, '新しいアプリ・保存先として準備する');
        else if (title === '旧Authenticatorには、どのグループがありますか？') await advance(page, 'Local Codes・端末内のコードだけ');
        else if (title === 'どの種類の認証を引き継ぎますか？') await advance(page, '個人用・外部サービスのコードだけ');
        else if (title === '新しいAuthenticatorは、どの状態ですか？') await advance(page, product === 'bitwarden-authenticator' ? '今回のコードを、これから移す' : 'コード・ログインがまだない新しいアプリ');
        else if (title.includes('どのAppleアカウント')) await advance(page, '復元用Apple');
        else if (title.includes('どのMicrosoftアカウント')) await advance(page, '復元用Microsoft');
        else if (title === '旧Authenticatorは6.8.33以降ですか？') await advance(page, 'はい・6.8.33以降');
        else if (title === '旧アプリには、どのバックアップ設定が表示されますか？') await advance(page, '個人Microsoftアカウントを使うCloud Backup');
        else if (title === '直接転送に使うAndroidの種類は？') await advance(page, 'Pixel 9以降（Pixel 9aを除く）');
        else if (title === 'このアプリに、ほかのアカウントのコードはありますか？') await advance(page, 'すべてのコードを、上のサービスで確認できた');
        else throw new Error(`Unexpected question: ${title}`);
      } else {
        if (title === '引き継いだコードの項目を照合する' && !resumed) {
          const before = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
          expect(before.assets.find(a => a.id === 'email')?.controls.mfa).toBe('verified');
          expect(before.securityModel.routes.some(r => r.purpose === 'second-step')).toBe(false);
          const route = new URL(page.url()).hash;
          await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
          expect(new URL(page.url()).hash).toBe(route); await expect(page.getByRole('heading', { level: 1 })).toHaveText(title); resumed = true;
        }
        const button = page.locator('.phone-guide .guide-actions .button.primary'); await expect(button).toBeEnabled(); await button.click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
      }
    }
    expect(resumed).toBe(true);
    const saved = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
    expect(saved.guide).toEqual(f.data.guide);
    const destination = saved.deviceWorkflows[0].answers[`auth-destination:${f.sourceRef}`];
    expect(destination).not.toBe(f.sourceRef); expect(saved.securityModel.routes.some(r => r.purpose === 'second-step')).toBe(true);
    const fact = saved.securityModel.facts.find(fact => fact.label === 'New-phone authenticator code accepted')!; expect(fact.requiredRefs).not.toContain('old');
    await page.getByRole('link', { name: 'Security Map', exact: true }).first().click();
    const app = saved.securityModel.entities.find(e => e.id === destination)!;
    await page.locator('.map-node').filter({ has: page.getByText(app.label, { exact: true }) }).click();
    await expect(page.locator('.map-details')).toContainText('新端末でコード利用の記録あり'); await expect(page.locator('.map-details')).toContainText('新端末のコードを利用');
    await page.getByRole('link', { name: 'この機種変更を続ける', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toContainText('を新しいスマホで使いますか？');
    expect(external).toEqual([]);
  });
}

test('existing new-phone data stays intact; mobile Japanese/English and keyboard exception path remain usable', async ({ page }) => {
  const f = fixture('microsoft-authenticator', 'android', 'android');
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, f.data);
  await advance(page, '確認しました');
  const button = page.getByRole('button', { name: '新しいアプリ・保存先として準備する', exact: true }); await button.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  await advance(page, '個人用・外部サービスのコードだけ');
  for (let i = 0; i < 5 && !(await page.getByRole('heading', { level: 1, name: '新しいAuthenticatorは、どの状態ですか？', exact: true }).isVisible()); i++) { await page.locator('.phone-guide .guide-actions .button.primary').click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-authenticator-move-ja.png`, fullPage: true });
  await page.locator('.language-picker select').selectOption('en'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('What is shown in the new Authenticator?');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-authenticator-move-en.png`, fullPage: true });
  await page.locator('.language-picker select').selectOption('ja'); await advance(page, '別のコードがある・ログイン済み・分からない');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新端末にあるコードを残す');
  await expect(page.locator('.guide-card')).toContainText('リセットせず');
  const saved = currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data);
  expect(saved.securityModel.routes).toEqual([]); expect(saved.guide).toEqual(f.data.guide);
  expect(Object.values(saved.deviceWorkflows[0].records).some(r => r.physicalEffect)).toBe(false);
});
