import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {currentDatasetSchema,makeAsset,newDataset,type CurrentDataset} from '../src/models';
import {decryptVault} from '../src/crypto';
import {KEY_MODES,keyTasks,type KeyMode} from '../src/hardwareKeySchemas';
import {currentKeyStep} from '../src/hardwareKeys';
import {advance,passphrase,readSavedVault,sealRawVault,writeSavedVault} from './helpers';

test.setTimeout(120_000);
function fixture(mode:KeyMode,language:'ja'|'en'='ja'){
  const data=newDataset(language),provider=mode.startsWith('google')?'google':mode.startsWith('apple')?'apple':'bitwarden',time=new Date().toISOString();
  data.assets=[{...makeAsset({kind:'account',type:provider==='bitwarden'?'Password manager':'Account',name:'確認する個人用アカウント',importance:'critical'}),id:'account',provider,purpose:'personal'}, {...makeAsset({kind:'device',type:'Computer',name:'確認するパソコン',operatingSystem:provider==='apple'?'macos':'windows',importance:'critical'}),id:'device'}];
  data.securityModel.entities=[{id:'key1',kind:'security-key',label:'青いキー',transports:['usb-c'],createdAt:time},{id:'key2',kind:'security-key',label:'予備のキー',transports:['usb-c'],createdAt:time},{id:'browser',kind:'installation',productId:'chrome',deviceRef:'device',profileLabel:'本人用',label:'本人用ブラウザー',createdAt:time}];
  data.guide.cursor='manager-select';data.guide.accountId='account';data.guide.answers.private='PRIVATE ANSWER NEVER COPY';data.guide.history=['start','provider'];
  return data;
}
async function saved(page:Page){return currentDatasetSchema.parse((await decryptVault(await readSavedVault(page),passphrase)).data);}
async function open(page:Page,data:CurrentDataset){
  await page.goto('./');await page.locator('.language-picker select').selectOption(data.settings.language);await writeSavedVault(page,await sealRawVault(data));await page.reload();await page.getByLabel(data.settings.language==='ja'?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,data.settings.language==='ja'?'開いて再開する':'Unlock and continue');
}
async function startMap(page:Page){await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({hasText:'確認する個人用アカウント'}).click();await page.locator('.key-launcher summary').click();await page.locator('.key-launcher .button.secondary').click();await expect(page.locator('.key-guide')).toBeVisible();}
async function drive(page:Page,mode:KeyMode,until='finished',answers:Record<string,string>={},existing=false){
  await expect(page.locator('.key-guide')).toBeVisible();
  for(let n=0;n<90&&/\/keys\//.test(page.url());n++){
    const data=await saved(page),task=keyTasks(data).find(t=>page.url().endsWith(t.id))!,step=currentKeyStep(data,task);
    if(step.id===until)return {data,task};
    if(step.kind==='blocked')throw new Error(`Blocked at ${step.id}`);
    if(step.kind==='finished')return {data,task};
    const card=page.locator('.guide-card');await expect(card.getByRole('heading',{level:1})).toHaveText(step.title[data.settings.language]);
    if(step.kind==='operation'){
      if(step.url){await expect(card.getByRole('link',{name:/公式のアカウント画面を開く|Open the official account screen/})).toHaveAttribute('href',step.url);await expect(card.getByRole('link',{name:/公式のアカウント画面を開く|Open the official account screen/})).toHaveAttribute('target','_blank');}
      await card.locator('button.button.primary').click();
    }else if(step.kind==='text'){
      await card.getByRole('textbox').fill(answers[step.id]??(data.settings.language==='ja'?'本人の確認用プロファイル':'My test profile'));await card.locator('button.button.primary').click();
    }else{
      const defaults:Record<string,string>={mode,scope:'personal',protection:'standard',server:'us',vault:'new',device:'device','key-1':'key1','key-2':'key2','registration-1':existing?'existing':'new','registration-2':existing?'existing':'new','old-factor':'yes',encryption:'unsupported','enable-encryption':'no',browser:'browser','unlock-method':'master'};
      const value=answers[step.id]??defaults[step.id]??step.choices![0].value,choice=step.choices!.find(c=>c.value===value);if(!choice)throw new Error(`Choice ${value} missing at ${step.id}`);
      await card.getByRole('button',{name:choice.label[data.settings.language],exact:true}).click();
    }
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  }
  const data=await saved(page);return {data,task:keyTasks(data).at(-1)!};
}
for(const mode of KEY_MODES)for(const existing of [false,true])test(`${mode} ${existing?'existing':'new'}: one-action progress, real-use separation and map records`,async({page,context})=>{
  const input=fixture(mode),original=structuredClone(input.guide),requests:string[]=[];context.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4174'))requests.push(r.url());});
  await open(page,input);await startMap(page);const before=await drive(page,mode,'test-open',{},existing);
  expect(before.data.assets[0].controls.mfa).toBe('unknown');expect(before.data.securityModel.facts).toHaveLength(0);expect(!!before.task.records['start-registration']).toBe(!existing);
  const after=await drive(page,mode,undefined,{},existing);await expect(page).toHaveURL(/\/map\?item=account$/);expect(after.task.status).toBe('completed');expect(after.data.guide).toEqual(original);expect(after.data.assets[0].controls.mfa).toBe(mode==='bitwarden-login'?'unknown':'verified');
  await expect(page.locator('.key-records')).toContainText('新しいログインで利用を確認');if(mode==='bitwarden-login')await expect(page.locator('.key-records')).toContainText('マスターで開いた保管庫を確認');
  await page.locator('.map-node').filter({has:page.getByText('青いキー',{exact:true})}).click();await expect(page.locator('.key-records')).toContainText('登録を確認済み');await page.locator('.key-records .record-link').last().click();await page.getByRole('button',{name:'取り消す verify-1',exact:true}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('1本目のアカウント内の登録を確認する');
  const withdrawn=await saved(page);expect(withdrawn.securityModel.facts.every(f=>f.state==='unknown')).toBe(true);expect(withdrawn.securityModel.entities.some(e=>e.kind==='credential')).toBe(true);expect(withdrawn.guide).toEqual(original);expect(requests).toEqual([]);
});
test('encrypted resume, waiting, built-in help before AI, and privacy preserve the main guide',async({page})=>{
  const input=fixture('google-passkey');await open(page,input);await startMap(page);const {task}=await drive(page,'google-passkey','test-use-1');await page.getByRole('button',{name:'うまくいかない',exact:true}).click();await page.getByRole('button',{name:'新しいキーがまだ利用できません',exact:true}).click();await expect(page.locator('.help-panel')).toContainText('約7日');await expect(page.getByRole('button',{name:'AIへの相談文をコピーする',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'この案内では解決しない',exact:true}).click();await page.getByText('相談文を表示する',{exact:true}).click();const prompt=await page.locator('.prompt-preview').textContent();expect(prompt).toContain('最新');expect(prompt).toContain('https://support.google.com/');expect(prompt).not.toContain('PRIVATE ANSWER');expect(prompt).not.toContain('青いキー');
  await page.getByRole('button',{name:'この作業を後回しにする',exact:true}).click();await page.getByRole('link',{name:'対策を進める',exact:true}).click();await page.getByRole('link',{name:'セキュリティキーの作業を再開する',exact:true}).click();await page.reload();await page.getByLabel('アプリの保存用パスフレーズ',{exact:true}).fill(passphrase);await advance(page,'開いて再開する');await expect(page.getByRole('heading',{level:1})).toHaveText('1本目のキーで認証する');expect(keyTasks(await saved(page)).find(t=>t.id===task.id)?.records['test-use-1']).toBeUndefined();expect((await saved(page)).guide).toEqual(input.guide);
  await drive(page,'google-passkey');await expect(page).toHaveURL(/\/map\?item=account$/);
});
test('unsupported account stays unfinished and an Apple second key cannot be the first physical reference',async({page})=>{
  await open(page,fixture('apple-keys'));await startMap(page);await drive(page,'apple-keys','key-2');await expect(page.locator('.guide-card').getByRole('button',{name:'青いキー',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'予備のキー',exact:true}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('物理的に別の2本であることを確認する');
  await open(page,fixture('google-second-step'));await startMap(page);await drive(page,'google-second-step','scope');await page.getByRole('button',{name:'仕事・学校・子供用・管理対象です',exact:true}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('先に、このアカウントの管理方針を確認します');expect((await saved(page)).actions).toHaveLength(0);await expect(page.locator('.guide-card button.button.primary')).toHaveCount(0);
});
for(const language of ['ja','en'] as const)test(`${language}: mobile, keyboard and private-input rejection`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page,fixture('bitwarden-login',language));await startMap(page);await drive(page,'bitwarden-login','browser-label',{browser:'new','browser-product':'chrome'});
  const card=page.locator('.guide-card'),input=card.getByRole('textbox');await input.fill('private@example.com');await card.locator('button.button.primary').click();await expect(page.getByRole('alert')).toBeVisible();expect(JSON.stringify(keyTasks(await saved(page)))).not.toContain('private@example.com');
  await input.fill(language==='ja'?'本人用の別プロファイル':'My separate browser profile');await card.locator('button.button.primary').focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{level:1})).toHaveText(language==='ja'?'別の未ログインの画面を用意する':'Open a separate signed-out browser environment');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:language==='ja'?'うまくいかない':'Something is different',exact:true}).click();await page.getByRole('button',{name:language==='ja'?'キー・PINを使えない':'The key or PIN does not work',exact:true}).click();await mkdir('test-results/hardware-keys',{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`test-results/hardware-keys/security-key-${language}.png`,fullPage:false});
});
test('Bitwarden PRF activation records passkey decryption without marking two-step setup done',async({page})=>{
  await open(page,fixture('bitwarden-login'));await startMap(page);const {data,task}=await drive(page,'bitwarden-login',undefined,{encryption:'available','enable-encryption':'yes','encryption-after':'used','unlock-method':'key'});expect(task.records['set-encryption']).toBeDefined();expect(data.assets[0].controls.mfa).toBe('unknown');expect(data.securityModel.relations.some(r=>r.kind==='decrypts'&&r.evidence==='user-confirmed')).toBe(true);await expect(page.locator('.key-records')).toContainText('パスキーで開いた保管庫を確認');
});
test('a manually recorded Bitwarden second-step passkey is explicitly reused rather than duplicated',async({page})=>{
  const input=fixture('bitwarden-second-step');input.securityModel.entities.push({id:'manual',kind:'credential',label:'既存の2段階用登録',credentialType:'passkey',subjectRef:'account',storageRef:'key1',roles:['second-step'],createdAt:new Date().toISOString(),opaque:'keep'});
  await open(page,input);await startMap(page);const {data,task}=await drive(page,'bitwarden-second-step',undefined,{'registration-1':'ref:manual'});expect(task.registrationRefs).toEqual(['manual']);expect(data.securityModel.entities.filter(e=>e.kind==='credential')).toHaveLength(1);expect(data.securityModel.entities.find(e=>e.id==='manual')?.opaque).toBe('keep');expect(task.records['start-registration']).toBeUndefined();await expect(page.locator('.key-records')).toContainText('新しいログインで利用を確認');
});
for(const mode of ['google-second-step','apple-keys'] as const)test(`${mode}: main MFA records and advances once, then uses the appropriate recovery recipe`,async({page})=>{
  const input=fixture(mode);input.guide.cursor='do/account/email-mfa/state';await open(page,input);await page.locator('.key-launcher summary').click();await page.locator('.key-launcher .button.secondary').click();await drive(page,mode);await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole('heading',{level:1})).toHaveText(mode==='apple-keys'?'登録済みのキーと信頼できる端末を確認する':'予備の認証手段の設定を開く');expect((await saved(page)).assets[0].controls.mfa).toBe('verified');await expect(page.getByText('どの端末でログインを承認しますか？',{exact:true})).toHaveCount(0);
  if(mode==='apple-keys'){await advance(page,'使えるキーを確認しました');await advance(page,'予備を別の場所へ保管しました');await expect(page.getByRole('heading',{level:1})).toHaveText('どのパスワードマネージャーを使いますか？');}
});
test('Bitwarden main manager MFA can use the hardware guide without requiring a duplicate authenticator setup',async({page})=>{
  const input=fixture('bitwarden-second-step');input.guide.cursor='do/account/manager/auth-ready';input.guide.managerId='account';input.guide.accountId=undefined;await open(page,input);await page.locator('.key-launcher summary').click();await page.locator('.key-launcher .button.secondary').click();await drive(page,'bitwarden-second-step',undefined,{'old-factor':'no'});await expect(page).toHaveURL(/\/guide$/);await expect(page.getByRole('heading',{level:1})).toHaveText('次に、どの端末を対策しますか？');expect((await saved(page)).assets[0].controls.mfa).toBe('verified');
});
