import { expect, test, type Page } from '@playwright/test';
import { advance, createWorkspace, passphrase, readSavedVault } from './helpers';
import { readTwofasData } from './twofas-driver';
import { mailboxAddresses, mailPlan } from '../src/mailAccounts';

test.setTimeout(120_000);
type Lang = 'ja' | 'en';
const word = (l: Lang, ja: string, en: string) => l === 'ja' ? ja : en;
async function details(page: Page, address: string, label: string, l: Lang = 'ja') {
  await page.getByLabel(word(l, 'メールアドレス（任意）', 'Email address (optional)'), { exact: true }).fill(address);
  await page.getByLabel(word(l, 'このメールの呼び名（任意）', 'Name for this email (optional)'), { exact: true }).fill(label);
  await advance(page, word(l, '次へ', 'Next'));
}
async function purpose(page: Page, use: 'personal' | 'work', l: Lang = 'ja') {
  await advance(page, use === 'work' ? word(l, '仕事・学校用', 'Work / school') : word(l, '個人用', 'Personal'));
}
async function addServices(page: Page, providers: string[], l: Lang = 'ja') {
  await advance(page, word(l, 'ほかのメールも追加する', 'Add other emails'));
  for (const provider of providers) await page.getByRole('checkbox', { name: provider, exact: true }).check();
  await advance(page, word(l, '選んだメールを追加する', 'Add the selected emails'));
}

for (const language of ['ja', 'en'] as const) test(`emails ${language}: personal/work, multiple providers, main choice, encrypted resume and the right deferred account`, async ({ page, context, baseURL }) => {
  const unexpected: string[] = [], origin = new URL(baseURL!).origin;
  context.on('request', r => { if (new URL(r.url()).origin !== origin || r.method() !== 'GET') unexpected.push(r.url()); });
  await page.setViewportSize({ width: 390, height: 844 }); await createWorkspace(page, language);
  await expect(page.getByRole('button', { name: /Try a sample|サンプルを試す/ })).toHaveCount(0);
  await expect(page.getByText(/ONE STEP AT A TIME|一つずつ、設定まで|まず、メールから|進むたびに途中保存|スマホを買い替えるときに/)).toHaveCount(0);
  await advance(page, 'Gmail / Google'); await details(page, 'personal@example.com', 'Personal Gmail', language); await purpose(page, 'personal', language);
  await addServices(page, ['Gmail / Google', 'Proton Mail'], language);
  await details(page, 'work@example.com', 'Work Gmail', language); await purpose(page, 'work', language);
  await details(page, 'proton@example.com', 'Proton mail', language); await purpose(page, 'personal', language);
  await expect(page.locator('.mailbox-card')).toHaveCount(3);
  const personal = page.locator('.mailbox-card').filter({ hasText: 'personal@example.com' }), work = page.locator('.mailbox-card').filter({ hasText: 'work@example.com' });
  await expect(personal.getByRole('radio')).toBeChecked(); await work.getByRole('radio').focus(); await page.keyboard.press('Space'); await expect(work.getByRole('radio')).toBeChecked(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false'); await expect(work.getByRole('radio')).toBeFocused();
  let d = await readTwofasData(page), p = mailPlan(d)!; expect(d.assets.find(a => a.id === p.primaryRef)!.name).toBe('Work Gmail');
  await personal.getByRole('radio').check(); await advance(page, word(language, 'メインのメールから対策する', 'Start with my main email'));
  const progress = page.getByRole('progressbar', { name: word(language, 'この設定の進み具合', 'Progress for this setting') });
  await expect(progress).toHaveAttribute('value', '0'); await advance(page, word(language, '次へ', 'Next')); await expect(progress).toHaveAttribute('value', '1');
  const resumeTitle = await page.locator('.guide-card h1').textContent();
  await advance(page, word(language, 'この作業を後回しにする', 'Do this later'));
  await page.locator('.mailbox-choice').filter({ hasText: 'work@example.com' }).click();
  const workTitle = await page.locator('.guide-card h1').textContent();
  await page.reload(); await page.getByLabel(word(language, 'アプリの保存用パスフレーズ', 'App passphrase'), { exact: true }).fill(passphrase); await advance(page, word(language, '開いて再開する', 'Unlock and continue'));
  await expect(page.locator('.guide-card h1')).toHaveText(workTitle!);
  const deferred = page.locator('.guide-main>.records'); await deferred.locator('summary').click();
  await expect(deferred).toContainText('Personal Gmail'); await deferred.getByRole('button').filter({ hasText: 'Personal Gmail' }).click();
  await expect(page.locator('.guide-card h1')).toHaveText(resumeTitle!); await expect(page.locator('.task-context')).toContainText('personal@example.com');
  d = await readTwofasData(page); p = mailPlan(d)!; expect(d.guide.accountId).toBe(p.primaryRef); expect(p.activeRef).toBe(p.primaryRef);
  expect(d.assets.filter(a => a.services.includes('mail'))).toHaveLength(3); expect(d.assets.every(a => a.controls.mfa === 'unknown')).toBe(true);
  expect(JSON.stringify(await readSavedVault(page))).not.toContain('example.com'); expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:word(language,'次へ','Next'),exact:true}).focus(); await page.screenshot({ path: `/tmp/qa-mail-accounts/mail-progress-${language}.png`, fullPage: true });
  await page.keyboard.press('Enter'); await expect(progress).toHaveAttribute('value','2');
  await page.getByRole('link', { name: 'Security Map', exact: true }).first().click(); await page.locator('.map-node').filter({ has: page.getByText('Personal Gmail', { exact: true }) }).click();
  await expect(page.locator('.map-details')).toContainText(word(language, 'メインのメール', 'Main email')); await expect(page.locator('.map-details')).toContainText('personal@example.com');
  await page.locator('.map-details .entry-edit summary').click();await advance(page,word(language,'メールの登録内容を編集する','Edit email details'));await expect(page.getByLabel(word(language,'メールアドレス（任意）','Email address (optional)'),{exact:true})).toHaveValue('personal@example.com');
});

test('same-login aliases share one real account only after an explicit choice', async ({ page }) => {
  await createWorkspace(page); await advance(page, 'iCloud / Apple Account'); await details(page, 'main@example.com', 'My iCloud'); await purpose(page, 'personal');
  await addServices(page, ['iCloud / Apple Account']);
  await page.getByLabel('メールアドレス（任意）', { exact: true }).fill('alias@example.com');
  await page.locator('.mail-add summary').filter({hasText:'記録済みのメールと同じログインで使う'}).click();
  await page.locator('.mail-add .mailbox-choice').filter({ hasText: 'main@example.com' }).click();
  await expect(page.locator('.mailbox-card')).toHaveCount(1); await expect(page.locator('.mailbox-card')).toContainText('alias@example.com');
  const d = await readTwofasData(page); expect(d.assets).toHaveLength(1); expect(mailboxAddresses(d.assets[0])).toEqual(['main@example.com', 'alias@example.com']);
  expect(d.actions).toEqual([]); expect(d.assets[0].controls.mfa).toBe('unknown'); expect(mailPlan(d)!.accountRefs).toEqual([d.assets[0].id]);
});

test('Back and editing retain the original mailbox while a different provider is waiting for details', async ({ page }) => {
  await createWorkspace(page); await advance(page, 'Gmail / Google'); await details(page, 'main@example.com', 'Main'); await purpose(page, 'personal');
  await addServices(page, ['iCloud / Apple Account', 'Proton Mail']); await details(page, 'icloud@example.com', 'iCloud'); await purpose(page, 'personal');
  await page.locator('.guide-back').getByRole('button', { name: '戻る', exact: true }).click(); await expect(page.locator('.mailbox-context')).toContainText('icloud@example.com');
  await purpose(page, 'work');
  await page.locator('.mailbox-card').filter({ hasText: 'main@example.com' }).getByRole('button', { name: '呼び名・アドレスを編集する', exact: true }).click();
  await expect(page.getByLabel('メールアドレス（任意）', { exact: true })).toHaveValue('main@example.com');
  await page.getByLabel('このメールの呼び名（任意）', { exact: true }).fill('Renamed main'); await advance(page);
  await advance(page, 'Proton Mailの入力を続ける'); await expect(page.locator('.guide-card h1')).toHaveText('Proton Mailのメール');
  await expect(page.getByLabel('メールアドレス（任意）', { exact: true })).toHaveValue('');
  await details(page, 'proton@example.com', 'Proton'); await purpose(page, 'personal'); const d = await readTwofasData(page);
  expect(d.assets).toHaveLength(3); expect(d.assets.find(a => a.name === 'Renamed main')).toBeTruthy(); expect(d.assets.find(a => a.name === 'iCloud')!.purpose).toBe('work');
});

test('an exact existing address is suggested, while an explicitly separate login keeps separate work records', async ({ page }) => {
  await createWorkspace(page); await advance(page, 'Gmail / Google'); await details(page, 'same@example.com', 'Personal'); await purpose(page, 'personal');
  await addServices(page, ['Gmail / Google']); await details(page, 'same@example.com', 'Work'); await expect(page.locator('.mail-match')).toBeVisible();
  expect((await readTwofasData(page)).assets).toHaveLength(1); await advance(page, '別のログインとして追加する'); await purpose(page, 'work');
  const d = await readTwofasData(page); expect(d.assets).toHaveLength(2); expect(new Set(d.assets.map(a => a.id)).size).toBe(2); expect(d.assets.map(a => a.purpose)).toEqual(['personal', 'work']);
});

test('a failed encrypted write restores the previous main-email choice and keeps the saved vault unchanged',async({page})=>{
  await createWorkspace(page);await advance(page,'Gmail / Google');await details(page,'main@example.com','Main');await purpose(page,'personal');
  await addServices(page,['Gmail / Google']);await details(page,'work@example.com','Work');await purpose(page,'work');
  const before=await readSavedVault(page),main=page.locator('.mailbox-card').filter({hasText:'main@example.com'}),work=page.locator('.mailbox-card').filter({hasText:'work@example.com'});
  await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('fixture write failure','QuotaExceededError');};});
  await work.getByRole('radio').click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');await expect(main.getByRole('radio')).toBeChecked();await expect(work.getByRole('radio')).not.toBeChecked();
  expect(await readSavedVault(page)).toEqual(before);const d=await readTwofasData(page);expect(d.assets.find(a=>a.id===mailPlan(d)!.primaryRef)!.name).toBe('Main');
});
