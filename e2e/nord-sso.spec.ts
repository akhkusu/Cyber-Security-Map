import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from '../src/models';
import { recordControl } from '../src/controlRecords';
import { chooseCloudDevice, cloudAnswer, configureCloudRoot, cloudSetupRoute, makeCloudVault, selectedCloudInstallation, setCloudAnswer } from '../src/cloudManagers';
import { nordSsoBinding, nordSsoReady, nordSsoStore } from '../src/nordSsoSchemas';
import { answerPhoneQuestion, jumpPhoneStep, startPhoneWorkflow } from '../src/phoneEngine';
import {startKeyGuide,answerKeyGuide,currentKeyStep} from '../src/hardwareKeys';
import {keyTasks} from '../src/hardwareKeySchemas';
import {driveTwofasUI} from './twofas-driver';
import {chooseAuthenticator,authenticatorSetupRoute} from '../src/authenticatorGuide';
import {twofasStore} from '../src/twofasSchemas';
import {driveNestedKey} from './nested-key-driver';
import {startNordSsoSession,saveNordSsoSession,selectNordSsoAccount,selectNordSsoProvider} from '../src/nordSso';
import {guideSchema} from '../src/models';
import {beginRecipe,completeStep} from '../src/guideEngine';
import { nordRecoveryTasks } from '../src/nordRecoverySchemas';
import { decryptVault } from '../src/crypto';
import { advance, passphrase, readSavedVault, sealRawVault, writeSavedVault } from './helpers';

test.setTimeout(60_000);
function fixture(provider: 'google' | 'apple' = 'google', os: 'ios' | 'android' | 'windows' = 'ios', opened = false, protectedProvider = true, language: 'ja' | 'en' = 'ja') {
  let data = newDataset(language);
  const root = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: 'Nord個人アカウント', importance: 'critical' }), id: 'nord', provider: 'nord' as const, purpose: 'personal' as const };
  const identity = { ...makeAsset({ kind: 'account', type: 'Primary email', name: provider === 'google' ? '使っているGoogleアカウント' : '使っているApple Account', importance: 'critical' }), id: 'provider', provider, purpose: 'personal' as const, services: ['mail' as const] };
  const device = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: '利用する端末', importance: 'critical', operatingSystem: os }), id: 'device' };
  data.assets = [root, identity, device]; data.guide.accountId = identity.id;
  data = makeCloudVault(data, 'nordpass', language); const vaultId = data.guide.managerId!; data = configureCloudRoot(data, vaultId, root.id) as CurrentDataset;
  data = setCloudAnswer(data, root.id, 'method', 'sso') as CurrentDataset; data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset; data = setCloudAnswer(data, vaultId, 'master', 'keep') as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, device.id) as CurrentDataset; const appId = selectedCloudInstallation(data, vaultId)!.id;
  if (os === 'ios' || os === 'android') data = setCloudAnswer(data, appId, os === 'ios' ? 'ios' : 'android', os === 'ios' ? 'ios18plus' : 'android9plus') as CurrentDataset;
  else { data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset; data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: '利用するChrome' } : e); }
  const controls = [[root.id, 'mfa'], [root.id, 'recovery'], [device.id, 'screenLock'], [vaultId, 'recovery'], [vaultId, 'independentRoot'], [appId, 'autofill'], ...(opened ? [[appId, 'opened'], [appId, 'storageChecked']] : []), ...(protectedProvider ? [[identity.id, 'mfa'], [identity.id, 'recovery']] : [])];
  for (const [ref, control] of controls) data = recordControl(data, ref, control, { id: `existing:${ref}:${control}` }) as CurrentDataset;
  data.guide.cursor = `cloud-sso-provider/${vaultId}`; data.guide.history = ['start', 'manager-select']; data.guide.answers['private-note'] = 'PRIVATE DO NOT COPY';
  return { data, vaultId, appId, rootId: root.id, providerId: identity.id, providerName: identity.name, provider };
}
async function open(page: Page, data: CurrentDataset) {
  const ja = data.settings.language === 'ja'; await page.goto('./'); await page.locator('.language-picker select').selectOption(data.settings.language);
  await writeSavedVault(page, await sealRawVault(data)); await page.reload(); await page.getByLabel(ja ? 'アプリの保存用パスフレーズ' : 'App passphrase', { exact: true }).fill(passphrase); await advance(page, ja ? '開いて再開する' : 'Unlock and continue');
}
async function saved(page: Page) { return currentDatasetSchema.parse((await decryptVault(await readSavedVault(page), passphrase)).data); }
async function primary(page: Page) { const button = page.locator('.guide-card .primary-actions button'); await expect(button).toHaveCount(1); await button.click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
async function prepare(page: Page, f: ReturnType<typeof fixture>, lang = 'ja') {
  await advance(page, f.provider === 'google' ? 'Google' : 'Apple'); await advance(page, f.providerName);
  for (let n = 0; n < 4; n++) await primary(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(lang === 'ja' ? 'Connected accountsには、どう表示されていますか？' : 'What does Connected accounts show?');
}
async function confirmConnection(page: Page, lang = 'ja') { await advance(page, lang === 'ja' ? '意図した提供元アカウントが接続済み' : 'The intended provider account is connected'); }
async function authenticate(page: Page, already = false, lang = 'ja') {
  await primary(page);
  await advance(page, lang === 'ja' ? already ? '意図したアカウントは選択済み・保管庫を開く' : 'Nord Accountへのログインが必要' : already ? 'The intended account is selected; unlock or keep its vault' : 'Nord Account sign-in is required');
  for (let n = 0; n < (already ? 2 : 8); n++) await primary(page);
}
for (const provider of ['google', 'apple'] as const) for (const os of ['ios', 'android', 'windows'] as const) test(`${provider}/${os}: actual provider, connection, authentication, vault use, exact resume and Map`, async ({ page, context }) => {
  const external: string[] = []; context.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4174')) external.push(r.url()); });
  const f = fixture(provider, os); await open(page, f.data); await prepare(page, f); expect((await saved(page)).securityModel.entities.some(e => e.kind === 'grant')).toBe(false); await confirmConnection(page);
  let data = await saved(page); const b = nordSsoBinding(data, f.rootId)!; expect(nordSsoReady(data, f.rootId)).toBe(true); expect(data.securityModel.routes).toHaveLength(0);
  await primary(page); await advance(page, 'Nord Accountへのログインが必要'); await primary(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Sign in with ${provider === 'google' ? 'Google' : 'Apple'}を選ぶ`);
  await page.reload(); await page.getByLabel('アプリの保存用パスフレーズ', { exact: true }).fill(passphrase); await advance(page, '開いて再開する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Sign in with ${provider === 'google' ? 'Google' : 'Apple'}を選ぶ`); await expect(page.locator('.guide-card input')).toHaveCount(0);
  for (let n = 0; n < 7; n++) await primary(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('重要なログイン情報を一つ、保存して使う'); data = await saved(page);
  expect(data.guide.accountId).toBe(f.providerId); expect(data.assets.filter(a => a.provider === provider)).toHaveLength(1); expect(data.assets[0]).toMatchObject({ id: f.rootId, name: f.data.assets[0].name, provider: 'nord', purpose: 'personal', controls: { ...f.data.assets[0].controls, accountAvailable: 'verified' }, controlEvidence: { ...f.data.assets[0].controlEvidence, accountAvailable: 'user-confirmed' } });
  await page.getByRole('link', { name: 'Security Map', exact: true }).click(); await page.locator('.map-node').filter({ has: page.getByText(`${provider === 'google' ? 'Google' : 'Apple'} → Nord Account`, { exact: true }) }).click();
  await expect(page.getByText('接続先を使ったNord Accountのログイン', { exact: false })).toBeVisible(); await expect(page.getByRole('button', { name: '接続の記録を取り消す', exact: true })).toBeVisible();
  await advance(page, '接続の記録を取り消す'); expect(nordSsoReady(await saved(page), f.rootId)).toBe(false); expect((await saved(page)).securityModel.entities.some(e => e.id === b.grantRef)).toBe(true); expect(external).toEqual([]);
});
test('connect an existing Google account only after independent preparation; checking it again does not repeat a connection', async ({ page }) => {
  const f = fixture('google', 'ios', true); await open(page, f.data); await prepare(page, f); await advance(page, '未接続・この既存アカウントを接続する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('意図したGoogleアカウントを接続する');
  for (let n = 0; n < 4; n++) await primary(page);
  const data = await saved(page), b = nordSsoBinding(data, f.rootId)!; expect(b.connectionCreatedAt).toBeDefined(); expect(data.securityModel.routes).toHaveLength(0);
  await page.getByRole('link', { name: 'Security Map', exact: true }).click(); await page.locator('.map-node').filter({ has: page.getByText('Google → Nord Account', { exact: true }) }).click(); await advance(page, 'この接続を確認する');
  for (let n = 0; n < 4; n++) await primary(page); await confirmConnection(page);
  const again = await saved(page); expect(nordSsoBinding(again, f.rootId)?.grantRef).toBe(b.grantRef); expect(nordSsoBinding(again, f.rootId)?.connectionCreatedAt).toBe(b.connectionCreatedAt);
});
test('an already signed-in app keeps its session and does not claim new provider or Nord authentication', async ({ page }) => {
  const f = fixture(); await open(page, f.data); await prepare(page, f); await confirmConnection(page); await authenticate(page, true);
  const data = await saved(page); expect(data.securityModel.routes.filter(r => r.purpose === 'sign-in')).toHaveLength(0); expect(data.securityModel.routes.filter(r => r.purpose === 'decrypt')).toHaveLength(1); expect(data.guide.steps[`do/${f.appId}/cloud-onboard/master-set`]).toBeUndefined();
});
test('missing provider protection is guided within a phone side session while the entire main guide remains saved', async ({ page }) => {
  const f = fixture('google', 'ios', true, false); let data = f.data; data.guide.cursor = 'device-select'; data.assets.push({ ...data.assets[2], id: 'new', operatingSystem: 'android' });
  data = startPhoneWorkflow(data, '/guide', 'device', 'replacement'); Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'new', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'old-fate': 'spare' } });
  data = answerPhoneQuestion(jumpPhoneStep(data, 'replacement', `cloud-use:${f.vaultId}`), 'replacement', 'new') as CurrentDataset;
  const original = structuredClone(data.guide); await open(page, data); await page.locator('.phone-launcher a').first().click(); await advance(page, '先に接続先のログインを確認する');
  await advance(page, 'Google'); await advance(page, f.providerName); for (let n = 0; n < 4; n++) await primary(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('接続先のアカウントを保護する');
  for (let n = 0; n < 32; n++) {
    const heading = await page.getByRole('heading', { level: 1 }).innerText(); if (heading === 'Connected accountsには、どう表示されていますか？') break;
    if (heading === '接続先のアカウントを保護する') { await page.getByRole('button', { name: /^このアカウントの(認証を設定・確認する|復旧を確保する)$/ }).click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
    else if (await page.getByRole('button', { name: 'すでに有効になっている', exact: true }).isVisible()) await advance(page, 'すでに有効になっている');
    else await primary(page);
  }
  await confirmConnection(page); await expect(page).toHaveURL(/(?:#)?\/phone\/replacement$/);
  const after = await saved(page); expect(after.guide).toEqual(original); expect(after.assets.find(a => a.id === f.providerId)?.controls).toMatchObject({ mfa: 'verified', recovery: 'verified' }); expect(nordSsoStore(after)?.sessions[0].finished).toBe(true); expect(cloudAnswer(after, f.rootId, 'method')).toBe('sso');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('基盤アカウントの利用手段を旧端末の外に残す');
});
for(const language of ['ja','en'] as const)test(`${language}: a deferred physical-key task returns to the connected-account side session and preserves the whole main guide`,async({page})=>{
  const f=fixture('google','ios',true,false,language);let data=f.data;data.guide.cursor='device-select';
  data.assets.push({...data.assets[2],id:'new',name:'新しいスマホ'});data=startPhoneWorkflow(data,'/guide','device','replacement');Object.assign(data.deviceWorkflows[0],{newDeviceRef:'new',answers:{stage:'using',availability:'available',ownership:'personal',authenticator:'none','old-fate':'spare'}});
  data=answerPhoneQuestion(jumpPhoneStep(data,'replacement',`cloud-use:${f.vaultId}`),'replacement','new') as CurrentDataset;
  await page.setViewportSize({width:390,height:844});const original=structuredClone(data.guide);await open(page,data);await page.locator('.phone-launcher a').first().click();await advance(page,language==='ja'?'先に接続先のログインを確認する':'Check the connected sign-in first');await advance(page,'Google');await advance(page,f.providerName);for(let n=0;n<4;n++)await primary(page);await expect(page.getByRole('heading',{level:1})).toHaveText(language==='ja'?'接続先のアカウントを保護する':'Protect the connected provider account');await advance(page,language==='ja'?'このアカウントの認証を設定・確認する':'Set or check this account’s authentication');
  const childUrl=page.url();await page.locator('.key-launcher > summary').click();await page.locator('.key-launcher .button.secondary').click();await expect(page.locator('.key-guide')).toBeVisible();const keyUrl=page.url();await page.reload();await page.getByLabel(language==='ja'?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,language==='ja'?'開いて再開する':'Unlock and continue');await expect(page).toHaveURL(keyUrl);const defer=page.getByRole('button',{name:language==='ja'?'この作業を後回しにする':'Do this later',exact:true});await defer.focus();await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  await expect(page).toHaveURL(childUrl);await expect(page.getByRole('heading',{level:1})).toHaveText(language==='ja'?'アカウントの設定を開く':'Open your account settings');expect((await saved(page)).guide).toEqual(original);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await mkdir('test-results/nested-key',{recursive:true});await page.screenshot({path:`test-results/nested-key/return-${language}.png`,fullPage:true});
});
function nestedKeyFixture(provider:'google'|'apple'){
  const f=fixture(provider,'ios',true,false);let data=f.data;data.guide.cursor='device-select';
  data.assets.push({...data.assets[2],id:'new',name:'新しいスマホ'},...['pc','mac'].map(id=>({...makeAsset({kind:'device',type:'Computer',name:id,importance:'critical',operatingSystem:id==='mac'?'macos':'windows'}),id})));
  data.securityModel.entities.push({id:'key1',kind:'security-key',label:'主に使うキー',transports:['usb-c'],createdAt:new Date().toISOString()},{id:'key2',kind:'security-key',label:'別に保管するキー',transports:['usb-c'],createdAt:new Date().toISOString()},{id:'key-browser',kind:'installation',productId:'chrome',deviceRef:provider==='apple'?'mac':'pc',label:'本人の確認用プロフィール',createdAt:new Date().toISOString()});
  data=startPhoneWorkflow(data,'/guide','device','replacement');data.deviceWorkflows[0].newDeviceRef='new';data=selectNordSsoAccount(selectNordSsoProvider(data,'nord',provider),'nord','provider') as CurrentDataset;
  const main=structuredClone(data.guide),phone=structuredClone(data.deviceWorkflows),side=startNordSsoSession(data,f.appId,'/phone/replacement'),session=nordSsoStore(side.data)!.sessions[0];
  let child={...side.data,guide:guideSchema.parse(session.guide)};child={...child,guide:{...child.guide,cursor:cloudSetupRoute(child,f.vaultId)}};for(let n=0;n<4;n++)child=completeStep(child) as CurrentDataset;child={...child,guide:{...child.guide,answers:{...child.guide.answers,'provider:platform':provider==='apple'?'macos':'web',[`return/provider/email-mfa`]:`cloud-sso-resume/${f.vaultId}`}}};child=beginRecipe(child,'provider','email-mfa') as CurrentDataset;data=saveNordSsoSession(side.data,child,session.id) as CurrentDataset;
  return {data,session,main,phone,child};
}
async function openNestedKeySession(page:Page,data:CurrentDataset,sessionRef:string){
  await open(page,data);const url=new URL(page.url());if(url.hash.startsWith('#/'))url.hash='/nord-connection/'+encodeURIComponent(sessionRef);else url.pathname=url.pathname.replace(/\/guide$/,'/nord-connection/'+encodeURIComponent(sessionRef));await page.goto(url.toString());await expect(page.getByRole('heading',{level:1})).toBeVisible();const password=page.getByLabel(data.settings.language==='ja'?'アプリの保存用パスフレーズ':'App passphrase',{exact:true});if(await password.isVisible()){await password.fill(passphrase);await advance(page,data.settings.language==='ja'?'開いて再開する':'Unlock and continue');}
}
for(const provider of ['google','apple'] as const)test(`${provider}: completing a physical key returns to provider recovery inside the same phone detour`,async({page})=>{
  const {data,session,main,phone}=nestedKeyFixture(provider);
  await openNestedKeySession(page,data,session.id);await expect(page.getByRole('heading',{level:1})).toHaveText('アカウントの設定を開く');await page.locator('.key-launcher > summary').click();await page.locator('.key-launcher .button.secondary').click();
  const result=await driveNestedKey(page,provider==='apple'?'apple-keys':'google-second-step');await expect(page).toHaveURL(new RegExp('/nord-connection/'+session.id+'$'));expect(result.data.guide).toEqual(main);expect(result.data.deviceWorkflows).toEqual(phone);expect(result.data.assets.find(a=>a.id==='provider')?.controls.mfa).toBe('verified');expect(result.data.assets.find(a=>a.id==='provider')?.controls.recovery).toBe('unknown');expect(result.data.securityModel.relations.some(r=>r.nordSsoPurpose==='connection'&&r.evidence==='user-confirmed')).toBe(false);await expect(page.getByText('どの端末でログインを承認しますか？',{exact:true})).toHaveCount(0);
});
test('an earlier key task keeps its progress when explicitly assigned to this detour, and the return choice can be undone',async({page})=>{
  await page.setViewportSize({width:390,height:844});const f=nestedKeyFixture('google'),old=startKeyGuide({...f.data,guide:f.child.guide},'provider','/guide');old.data=answerKeyGuide(old.data,old.id,'google-second-step') as CurrentDataset;old.data=answerKeyGuide(old.data,old.id,'personal') as CurrentDataset;
  const before=structuredClone(keyTasks(old.data)[0]),title=currentKeyStep(old.data,before).title.ja,data=saveNordSsoSession(f.data,old.data,f.session.id) as CurrentDataset;await openNestedKeySession(page,data,f.session.id);await page.locator('.key-launcher > summary').click();await page.getByText('以前のキーの作業を、ここで続ける',{exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:/この既存の作業を使う/}).click();await expect(page.locator('.key-guide')).toBeVisible();await expect(page.getByRole('heading',{level:1})).toHaveText(title);
  let d=await saved(page);expect(keyTasks(d)).toHaveLength(1);expect(keyTasks(d)[0].id).toBe(before.id);expect(keyTasks(d)[0].history).toEqual(before.history);expect(keyTasks(d)[0].records).toEqual(before.records);expect(d.guide).toEqual(f.main);expect(d.assets.find(a=>a.id==='provider')?.controls.mfa).toBe('unknown');
  await page.reload();await page.getByLabel('アプリの保存用パスフレーズ',{exact:true}).fill(passphrase);await advance(page,'開いて再開する');await expect(page.getByRole('heading',{level:1})).toHaveText(title);await page.getByText('選んだ戻り先を元に戻す',{exact:true}).click();await advance(page,'元の戻り先へ戻す');await expect(page).toHaveURL(/(?:#)?\/guide$/);d=await saved(page);expect(d.guide).toEqual(f.main);expect(keyTasks(d)[0].returnTo).toBe(before.returnTo);expect(keyTasks(d)[0].originGuideCursor).toBe(before.originGuideCursor);expect(Object.hasOwn(keyTasks(d)[0],'nordSsoKeyReturnV1')).toBe(false);expect(keyTasks(d)[0].history).toEqual(before.history);expect(keyTasks(d)[0].records).toEqual(before.records);
});
for (const provider of ['google', 'apple'] as const) test(`${provider}: phone sign-in uses the connected provider, then Nord MFA, then the existing master`, async ({ page }) => {
  const f = fixture(provider, 'ios', true); await open(page, f.data); await prepare(page, f); await confirmConnection(page); let data = await saved(page); data.guide.cursor = 'device-select'; data.assets.push({ ...data.assets[2], id: 'new', operatingSystem: 'android', name: '新しいスマホ' });
  data = startPhoneWorkflow(data, '/guide', 'device', 'replacement'); Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'new', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'old-fate': 'spare' } });
  data = answerPhoneQuestion(jumpPhoneStep(data, 'replacement', `cloud-use:${f.vaultId}`), 'replacement', 'new') as CurrentDataset; const original = structuredClone(data.guide);
  await open(page, data); await page.locator('.phone-launcher a').first().click();
  for (let n = 0; n < 4; n++) await advance(page, '確認しました'); await advance(page, 'この新端末のアプリを別に登録する'); await advance(page, 'Android 9以降'); await advance(page, '確認しました'); await advance(page, 'アカウントへのログインが必要');
  for (let n = 0; n < 8; n++) await page.locator('.phone-guide .guide-actions .button.primary').first().click().then(() => expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'));
  const after = await saved(page); expect(after.guide).toEqual(original); expect(after.securityModel.routes.some(r => r.targetRef === f.providerId && r.contexts.includes('new-device'))).toBe(true); expect(after.securityModel.routes.some(r => r.targetRef === f.rootId && r.contexts.includes('new-device'))).toBe(true);
});
test('connected sign-in is available during forgotten-master recovery and does not overwrite main progress', async ({ page }) => {
  const f = fixture('google', 'ios', true); await open(page, f.data); await prepare(page, f); await confirmConnection(page); const original = (await saved(page)).guide;
  await page.getByText('NordPassのマスターパスワードを忘れた場合', { exact: true }).click(); await advance(page, '既存の保管庫を復旧する'); await advance(page, '現在の24文字の保管庫用Recovery Code');
  let observed = false;
  for (let n = 0; n < 35 && /\/recover\/nord\//.test(page.url()); n++) {
    const heading = await page.getByRole('heading', { level: 1 }).innerText();
    if (heading === 'このアプリは、意図したNord Accountにログイン済みですか？') await advance(page, 'いいえ・アカウントへのログインが必要');
    else if (heading === '有効な現在の復旧用の控えを確認できますか？') await advance(page, 'はい・有効な現在の24文字の控えを別の場所から取り出せる');
    else { if (heading === 'Sign in with Googleを選ぶ') observed = true; await page.locator('.guide-card > button.button.primary').click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
  }
  const after = await saved(page); expect(observed).toBe(true); expect(nordRecoveryTasks(after)[0].status).toBe('completed'); expect(after.guide.accountId).toBe(original.accountId); expect(after.securityModel.revision).toBe(5);
});
test('changing the connected Google password keeps an independent candidate and skips unnecessary manager reauthentication', async ({ page }) => {
  const f = fixture('google', 'ios', true); await open(page, f.data); await prepare(page, f); await confirmConnection(page); await advance(page, f.providerName); await advance(page, 'いいえ・分からないので新しく生成する');
  for (let n = 0; n < 12; n++) { const h = await page.getByRole('heading', { level: 1 }).innerText(); if (h === '既存のマネージャーを、引き続き開けますか？') break; await primary(page); }
  await advance(page, '開けるので、受け付けられたパスワードを保存する'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('受け付けられた後に、元の保存項目を更新する'); await primary(page); await primary(page); await primary(page);
  const data = await saved(page); expect(data.guide.steps[`do/${f.providerId}/cloud-password:${f.appId}/independent-candidate`]?.status).toBe('done'); expect(data.guide.steps[`do/${f.providerId}/cloud-password:${f.appId}/manager-sso-start`]).toBeUndefined();
});
test('an SSO-only Nord Account is not forced to create a Nord password to save a login', async ({ page }) => {
  const f = fixture('google', 'ios', true); await open(page, f.data); await prepare(page, f); await confirmConnection(page); await advance(page, 'Nord個人アカウント');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nord Account用パスワードも使っていますか？'); await advance(page, 'いいえ・分からないので、接続ログインを維持する');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('重要なログイン情報を一つ、保存して使う'); const data = await saved(page); expect(nordSsoStore(data)?.directPasswords[f.rootId]).toBe('not-used'); expect(data.guide.steps[`do/${f.rootId}/cloud-password:${f.appId}/apply`]).toBeUndefined();
});
for (const language of ['ja', 'en'] as const) test(`${language}: mobile keyboard and exception help identify only the provider brand without sending data`, async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const f = fixture('apple', 'ios', false, true, language); await open(page, f.data); await prepare(page, f, language);
  await page.getByRole('button', { name: language === 'ja' ? '別のアカウント・利用できない・分からない' : 'A different account / unavailable / not sure', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  await advance(page, language === 'ja' ? 'うまくいかない' : 'Something is different'); await page.locator('.problem-options button').first().click(); await advance(page, language === 'ja' ? 'この案内でも解決しない' : 'This still does not resolve it');
  const prompt = await page.getByLabel(language === 'ja' ? 'AIへの相談文' : 'AI consultation prompt', { exact: true }).inputValue(); expect(prompt).toContain('Apple'); expect(prompt).not.toMatch(/PRIVATE|使っているApple|Nord個人|利用する端末/); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mkdir('test-results/nord-sso', { recursive: true }); await page.screenshot({ path: `test-results/nord-sso/nord-sso-${language}.png`, fullPage: true });
});

test('2FAS setup returns to the same Nord provider detour while keeping the main guide and phone task',async({page})=>{
  const f=nestedKeyFixture('google'),path=`/nord-connection/${f.session.id}`;
  let child=chooseAuthenticator({...f.data,guide:{...f.child.guide,cursor:'do/provider/email-mfa/scan'}},'provider','2fas-auth','device','do/provider/email-mfa/scan',true,path);
  const id=twofasStore(child)!.tasks.at(-1)!.id;child={...child,guide:{...child.guide,cursor:authenticatorSetupRoute(child,'provider')}};
  const data=saveNordSsoSession(f.data,child,f.session.id) as CurrentDataset;
  await openNestedKeySession(page,data,f.session.id);await driveTwofasUI(page,id);
  await expect(page.getByRole('heading',{level:1})).toHaveText('登録用のQRコードは、どの画面にありますか？');
  const savedData=await saved(page);expect(savedData.guide).toEqual(f.main);expect(savedData.deviceWorkflows).toEqual(f.phone);expect(guideSchema.parse(nordSsoStore(savedData)!.sessions.find(s=>s.id===f.session.id)!.guide).cursor).toBe('authenticator-input/provider');
  expect(twofasStore(savedData)!.tasks.find(t=>t.id===id)!.scopePath).toBe(path);expect(savedData.assets.find(a=>a.id==='provider')!.controls.mfa).toBe('unknown');
});
