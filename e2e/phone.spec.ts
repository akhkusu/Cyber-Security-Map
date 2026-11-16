import { expect, test, type Page } from '@playwright/test';
import { decryptVault } from '../src/crypto';
import { currentDatasetSchema, makeAsset, newDataset, type Dataset } from '../src/models';
import { confirmPhoneStep, jumpPhoneStep, startPhoneWorkflow } from '../src/phoneEngine';
import { phoneSteps } from '../src/phoneCatalog';
import { advance, passphrase, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(60000);
function dataFixture() {
  const data = newDataset('ja');
  data.assets = [
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '旧iPhone', importance: 'critical', operatingSystem: 'ios' }), id: 'old' },
    { ...makeAsset({ kind: 'account', type: 'Primary email', name: '個人用Apple', importance: 'critical' }), provider: 'apple', services: ['mail'], id: 'apple' },
  ];
  data.guide.cursor = 'device-select'; data.guide.accountId = 'apple';
  return data;
}
async function openSaved(page: Page, data: Dataset) {
  await page.goto('./'); await page.locator('.language-picker select').selectOption('ja');
  await writeSavedVault(page, await sealRawVault(data)); await page.reload();
  await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
}
async function confirmUntil(page: Page, title: string, limit = 15) {
  for (let i = 0; i < limit; i++) {
    if (await page.getByRole('heading', { level: 1, name: title, exact: true }).isVisible()) return;
    const button = page.locator('.phone-guide .guide-actions .button.primary');
    await expect(button).toHaveCount(1); await button.click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  }
  throw new Error(`Did not reach ${title}`);
}
async function savedData(page: Page) { return (await decryptVault(await readSavedVault(page), passphrase)).data; }

test('optional phone change: inline checks, resume, keep as spare, shared map and unchanged main guide', async ({ page, context }) => {
  const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
  const original = dataFixture(); await openSaved(page, original);
  await expect(page.getByRole('button',{name:'スマホの買い替えを進める',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText('旧iPhone',{exact:true})}).click();
  await advance(page, 'スマホの買い替えを進める'); await advance(page, 'すでに新しいスマホを使っている');
  await advance(page, '旧iPhone'); await advance(page, '手元にあり、ロックを解除して使える'); await advance(page, 'はい、個人用の端末です');
  await confirmUntil(page, 'これから使うスマホは？'); await advance(page, '新しいiPhoneを追加する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新端末のデータを残して続ける');
  await expect(page.locator('.instruction')).toContainText('消す必要はありません');
  await confirmUntil(page, '認証コードは、どのアプリにありますか？');
  const route = new URL(page.url()).hash;
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('認証コードは、どのアプリにありますか？'); expect(new URL(page.url()).hash).toBe(route);
  await advance(page, '認証アプリは使っていない'); await advance(page, 'はい・新端末で確認する'); await advance(page, 'ログインできました');
  await advance(page, '決済・電子ID・トーク履歴・仕事用認証などは使っていない'); await advance(page, 'これらの端末では電話回線を使わない');
  await confirmUntil(page, '消去する端末の外で、このガイドを続けられるようにする');
  await advance(page, '確認しました'); await advance(page, '予備として残す');
  await confirmUntil(page, '機種変更の作業を保存しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('機種変更の作業を保存しました');
  const final = currentDatasetSchema.parse(await savedData(page));
  expect(final.guide).toEqual(original.guide); expect(final.securityModel.lifecycle.old.state).toBe('backup');
  const fresh = final.assets.find(a => a.id !== 'old' && a.kind === 'device')!;
  expect(fresh.controls.screenLock).toBe('verified'); expect(fresh.controls.backup).toBe('verified'); expect(fresh.controls.updates).toBe('verified');
  expect(final.assets.find(a => a.id === 'apple')?.controls.mfa).toBe('unknown');
  await page.getByRole('link', { name: 'Security Map', exact: true }).first().click();
  await page.locator('.map-node').filter({ hasText: '旧iPhone' }).click(); await expect(page.locator('.map-details')).toContainText('予備として保管');
  await page.locator('.map-node').filter({ hasText: '個人用Apple' }).click(); await expect(page.locator('.access-records')).toContainText('この条件での利用記録あり');
  await page.getByLabel('使えない項目を選ぶ').selectOption(fresh.id); await expect(page.locator('.access-records')).toContainText('必要な手段が使えない条件');
  await page.getByRole('link', { name: '対策を進める', exact: true }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('次に、どの端末を対策しますか？');
  expect(external).toEqual([]);
});

test('handover gate blocks missing app transfer, keeps work saved, and supports keeping the old phone instead', async ({ page }) => {
  let data = dataFixture(); data.assets.push({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: '新Android', importance: 'critical', operatingSystem: 'android' }), id: 'fresh' });
  data = startPhoneWorkflow(data, '/map', 'old', 'test-workflow');
  const workflow = data.deviceWorkflows[0]; workflow.newDeviceRef = 'fresh'; workflow.cursor = 'handoff-gate';
  workflow.answers = { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'other', 'use:apple': 'yes', 'special-apps': 'none', 'phone-line': 'working', imessage: 'no', 'old-fate': 'sell', 'ios-generation': '18' };
  const backup = phoneSteps(data, workflow).find(s => s.id === 'old-backup-check')!;
  workflow.records[JSON.stringify([workflow.id, backup.id, backup.refs, ''])] = { stepId: backup.id, titleEn: backup.title.en, titleJa: backup.title.ja, status: 'confirmed', updatedAt: '2026-11-13T12:00:00Z', factIds: [], sourceIds: backup.sources, physicalEffect: false };
  await openSaved(page, data); await page.locator('.phone-launcher a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('消去前に、残っている作業を確認する');
  await expect(page.getByRole('button', { name: '手放す準備へ進む', exact: true })).toBeDisabled();
  await expect(page.locator('.handoff-gate')).toContainText('認証アプリごとの移行手順が必要です');
  await advance(page, '今は旧端末を残す'); await advance(page, '自分で使い続ける');
  await confirmUntil(page, '機種変更の作業を保存しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('機種変更の作業を保存しました');
  await expect(page.locator('.phone-guide')).toContainText('未完了です');
  const final = currentDatasetSchema.parse(await savedData(page)); expect(final.securityModel.lifecycle.old.state).toBe('in-use');
  expect(Object.values(final.deviceWorkflows[0].records).some(r => r.stepId === 'erase-old')).toBe(false);
});

test('phone guide supports keyboard and 390px English layout without additional menu items', async ({ page }) => {
  const data = startPhoneWorkflow(dataFixture(), '/guide', 'old', 'mobile-task'); data.settings.language = 'en';
  await openSaved(page, data); await page.locator('.phone-launcher a').first().click(); await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you with your new phone?');
  await expect(page.locator('.app-header nav a')).toHaveCount(3);
  const choice = page.getByRole('button', { name: 'I have a new phone to set up', exact: true }); await choice.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Which phone are you moving from?');
  const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, focus: document.activeElement?.getAttribute('aria-label') }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width); expect(metrics.focus).toBe('Current phone-change step');
  const buttons = page.locator('.phone-guide .choice');
  for (const box of await buttons.all()) { const bounds = await box.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44); }
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-phone-mobile-en.png`, fullPage: true });
  await page.locator('.language-picker select').selectOption('ja');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('これまで使っていたスマホは？');
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-phone-mobile-ja.png`, fullPage: true });
});

test('legacy payload starts the optional workflow without re-registering accounts or resetting progress', async ({ page }) => {
  const current = dataFixture(), raw = JSON.parse(JSON.stringify(current)); raw.version = 1; delete raw.securityModel; delete raw.deviceWorkflows;
  delete raw.assets[0].operatingSystem; raw.legacyInventory = { retained: ['opaque'] }; raw.guide.steps = { 'do/apple/email-mfa/check': { status: 'done', updatedAt: '2026-11-13T12:00:00Z' } };
  await openSaved(page, raw);await expect(page.getByRole('button',{name:'スマホの買い替えを進める',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText('旧iPhone',{exact:true})}).click();await advance(page, 'スマホの買い替えを進める');
  const after = currentDatasetSchema.parse(await savedData(page)); expect(after.version).toBe(2); expect(after.guide).toEqual(raw.guide);
  expect(after.assets).toEqual(raw.assets); expect(after.legacyInventory).toEqual(raw.legacyInventory);
  expect(phoneSteps(after, after.deviceWorkflows[0])[0].id).toBe('stage');
  await advance(page, 'すでに新しいスマホを使っている'); await advance(page, '旧iPhone');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('これまでのスマホの種類は？');
  await advance(page, 'iPhone'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('旧iPhoneは、今も操作できますか？');
  const classified = currentDatasetSchema.parse(await savedData(page));
  expect(classified.assets).toHaveLength(raw.assets.length); expect(classified.assets[0].id).toBe('old'); expect(classified.assets[0].operatingSystem).toBe('ios');
  expect(classified.assets[0].controls).toEqual(raw.assets[0].controls); expect(classified.guide).toEqual(raw.guide);
});

test('retained spare checks resume in place, support English keyboard use and withdraw an undone role', async ({ page }) => {
  const original = dataFixture();
  original.assets.push({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: '新iPhone', importance: 'critical', operatingSystem: 'ios' }), id: 'fresh' });
  let data: Dataset = startPhoneWorkflow(original, '/guide', 'old', 'retained-spare');
  const workflow = data.deviceWorkflows[0];
  Object.assign(workflow, { newDeviceRef: 'fresh', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'use:apple': 'yes', 'special-apps': 'none', 'phone-line': 'no-line', 'old-fate': 'spare' } });
  data = confirmPhoneStep(jumpPhoneStep(data, workflow.id, 'old-backup-check'), workflow.id);
  data = jumpPhoneStep(data, workflow.id, 'keep-lock');
  await openSaved(page, data); await page.locator('.phone-launcher a').first().click();
  await confirmUntil(page, '旧端末だけで使えるか確認する');
  expect(currentDatasetSchema.parse(await savedData(page)).securityModel.lifecycle.old).toBeUndefined();
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('旧端末だけで使えるか確認する');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-retained-spare-ja.png`, fullPage: true });
  await page.locator('.language-picker select').selectOption('en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Try the old phone on its own');
  const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
  await page.screenshot({ path: `${process.env.ARTIFACT_DIR ?? '/tmp'}/security-map-retained-spare-en.png`, fullPage: true });
  await page.getByRole('button', { name: 'It worked', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Store the spare where you can retrieve it');
  await advance(page, 'I stored the spare');
  let final = currentDatasetSchema.parse(await savedData(page)); expect(final.securityModel.lifecycle.old.state).toBe('backup');
  expect({ ...final.guide }).toEqual(original.guide); expect(final.securityModel.routes).toEqual([]);
  await page.getByText('Saved confirmations', { exact: true }).click();
  await page.locator('.records div').filter({ hasText: 'Store the spare where you can retrieve it' }).getByRole('button', { name: 'Undo', exact: true }).click();
  final = currentDatasetSchema.parse(await savedData(page)); expect(final.securityModel.lifecycle.old).toBeUndefined();
  expect(final.guide).toEqual(original.guide);
});
