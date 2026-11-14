import { test,expect,type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { currentDatasetSchema,makeAsset,newDataset,type CurrentDataset } from '../src/models';
import { MAP_KIND_NAMES,recordFields } from '../src/mapRecordCatalog';
import { mapRecordStore,type MapRecordDraft } from '../src/mapRecordSchemas';
import { mapNode } from '../src/mapRecords';
import { decryptVault } from '../src/crypto';
import { advance,passphrase,readSavedVault,sealRawVault,writeSavedVault } from './helpers';

test.setTimeout(90_000);
function fixture(language:'ja'|'en'='ja'){
 const data=newDataset(language),time=new Date().toISOString();
 data.assets=[{...makeAsset({kind:'account',type:'Account',name:'個人Google',importance:'critical'}),id:'account',provider:'google',purpose:'personal'},{...makeAsset({kind:'device',type:'Smartphone',name:'メインのスマホ',importance:'critical',operatingSystem:'ios'}),id:'phone'}];
 data.securityModel.entities=[{id:'key',kind:'security-key',transports:['usb-c'],label:'青いキー',createdAt:time},{id:'app',kind:'installation',productId:'chrome',deviceRef:'phone',profileLabel:'個人用',label:'個人用ブラウザー',createdAt:time},{id:'vault',kind:'vault',productId:'other',storageMode:'local',label:'ローカル保管庫',createdAt:time},{id:'person',kind:'person',role:'trusted-contact',label:'家族の協力者',createdAt:time}];
 data.guide.cursor='manager-select';data.guide.accountId='account';data.guide.history=['start','provider/account'];data.guide.answers.private='PRIVATE DO NOT COPY';return data;
}
async function open(page:Page,data:CurrentDataset){const ja=data.settings.language==='ja';await page.goto('./');await page.locator('.language-picker select').selectOption(data.settings.language);await writeSavedVault(page,await sealRawVault(data));await page.reload();await page.getByLabel(ja?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,ja?'開いて再開する':'Unlock and continue');await page.getByRole('link',{name:'Security Map',exact:true}).click();}
async function saved(page:Page){return currentDatasetSchema.parse((await decryptVault(await readSavedVault(page),passphrase)).data);}
async function drive(page:Page,answers:Record<string,string|string[]>={},confirmed=true){
 for(let n=0;n<60&&/\/map\/record\//.test(page.url());n++){
  const data=await saved(page),d=mapRecordStore(data)!.drafts.find(d=>page.url().endsWith(d.id))!,language=data.settings.language,ja=language==='ja';
  if(d.cursor==='review'){await advance(page,ja?d.editRef?'変更を保存する':'この項目を記録する':d.editRef?'Save changes':'Record this item');return d.nodeId;}
  if(d.cursor==='reuse'){await advance(page,ja?'別の項目を登録する':'Register a different item');continue;}
  if(d.cursor.startsWith('link:')){await advance(page,ja?confirmed?'この関係を確認しました':'まだ確認できていません':confirmed?'I checked this connection':'Keep it unconfirmed');continue;}
  const field=recordFields(data,d).find(f=>f.id===d.cursor)!;let value=answers[field.id]??(field.id==='label'?ja?'新しく記録した項目':'New recorded item':field.kind==='multi'?field.optional?[]:[field.choices![0].value]:field.optional?'':field.choices?.[0].value??'');
  if(field.kind==='multi'){for(const choice of field.choices??[])await page.getByRole('checkbox',{name:choice.label[language],exact:true}).setChecked(Array.isArray(value)&&value.includes(choice.value));}
  else if(field.kind==='select')await page.getByLabel(field.title[language],{exact:true}).selectOption(String(value));
  else await page.getByLabel(field.title[language],{exact:true}).fill(field.kind==='date'?String(value).slice(0,16):String(value));
  await advance(page,ja?'次へ':'Next');
 }
 throw new Error('wizard did not finish');
}
async function begin(page:Page,kind:MapRecordDraft['kind'],language:'ja'|'en'='ja'){await advance(page,language==='ja'?'端末・手段などを追加する':'Add a device or method');await advance(page,MAP_KIND_NAMES[kind!][language]);}
const scenarios:[MapRecordDraft['kind'],Record<string,string|string[]>,Record<string,unknown>][]=[
 ['phone-line',{label:'予備の回線',deviceRef:'phone',carrierAccountRef:'account',simType:'esim'},{kind:'phone-line',deviceRef:'phone',carrierAccountRef:'account',simType:'esim'}],
 ['credential',{label:'キーのGoogle登録',credentialType:'security-key-registration',subjectRef:'account',storageRef:'key',roles:['second-step']},{kind:'credential',credentialType:'security-key-registration',subjectRef:'account',storageRef:'key',roles:['second-step']}],
 ['session',{label:'スマホのログイン状態',accountRef:'account',installationRef:'app',deviceRef:'phone',expiresAt:'2050-01-01T00:00:00.000Z'},{kind:'session',accountRef:'account',installationRef:'app',deviceRef:'phone',expiresAt:'2050-01-01T00:00:00.000Z'}],
 ['grant',{label:'外部アプリの閲覧権限',grantType:'oauth',grantorRef:'account',granteeRef:'app',targetRefs:['vault'],permissions:['read']},{kind:'grant',grantType:'oauth',grantorRef:'account',granteeRef:'app',permissions:['read']}],
 ['recovery-arrangement',{label:'緊急時の引き継ぎ',mode:'takeover',subjectRef:'vault',helperRef:'person',stage:'waiting',availableAt:'2050-01-01T00:00:00.000Z'},{kind:'recovery-arrangement',mode:'takeover',subjectRef:'vault',helperRef:'person',stage:'waiting'}],
 ['device',{label:'予備のAndroid',type:'Smartphone',operatingSystem:'android'},{kind:'device',type:'Smartphone',operatingSystem:'android'}],
];
for(const [kind,answers,expected] of scenarios)test(`${kind}: answer one question at a time, preserve main progress and show the actual record in Map`,async({page,context})=>{
 const f=fixture(),original=structuredClone(f.guide),requests:string[]=[];context.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4174'))requests.push(r.url());});await open(page,f);await begin(page,kind);const ref=await drive(page,answers);
 const data=await saved(page);expect(mapNode(data,ref)).toMatchObject(expected);expect(data.guide).toEqual(original);expect(data.securityModel.facts).toHaveLength(0);expect(data.securityModel.routes).toHaveLength(0);expect(data.actions).toHaveLength(0);await expect(page.locator('.map-node.selected-node')).toContainText(answers.label as string);await expect(page.locator('.record-tools')).toContainText(answers.label as string);expect(requests).toEqual([]);
});
test('unconfirmed storage stays off the graph, can be checked later, edited, withdrawn and hidden without deleting its risk links',async({page})=>{
 await open(page,fixture());await begin(page,'credential');const ref=await drive(page,{label:'予備のログイン手段',credentialType:'passkey',subjectRef:'account',storageRef:'key',roles:['sign-in']},false);let data=await saved(page);expect(data.securityModel.relations.filter(r=>r.fromRef===ref).every(r=>r.evidence==='unknown')).toBe(true);
 await page.getByText('確認済み・未確認のつながりを見直す',{exact:true}).click();await page.locator('.record-tools .connection-row').filter({hasText:'青いキー'}).getByRole('button',{name:'見直す',exact:true}).click();for(let n=0;n<3;n++)await advance(page,'次へ');await page.getByLabel('実際のつながりを確認できましたか？',{exact:true}).selectOption('user-confirmed');await advance(page,'次へ');await advance(page,'このつながりを記録する');
 data=await saved(page);expect(data.securityModel.relations.find(r=>r.fromRef===ref&&r.toRef==='key')?.evidence).toBe('user-confirmed');await advance(page,'この項目を図から隠す');await expect(page.locator('.map-node').filter({hasText:'青いキー'})).toHaveCount(0);await page.getByLabel('使えない項目を選ぶ').selectOption('key');await expect(page.locator('.affected-node').filter({hasText:'予備のログイン手段'})).toBeVisible();expect((await saved(page)).securityModel.lifecycle.key).toBeUndefined();await advance(page,'この項目を図へ戻す');
});
test('reuse keeps the existing account identity; encrypted draft resume and back corrections do not reset the main guide',async({page})=>{
 const f=fixture(),original=f.guide;await open(page,f);await begin(page,'account');await advance(page,'個人Google');expect((await saved(page)).assets.filter(a=>a.kind==='account')).toHaveLength(1);await begin(page,'phone-line');await advance(page,'別の項目を登録する');await page.getByLabel('この項目を何と呼びますか？',{exact:true}).fill('追加の回線');await advance(page,'次へ');
 await page.reload();await page.getByLabel('アプリの保存用パスフレーズ',{exact:true}).fill(passphrase);await advance(page,'開いて再開する');await expect(page.getByRole('heading',{level:1})).toHaveText('現在、回線を使う端末は？');await page.getByRole('button',{name:'戻る',exact:true}).click();await expect(page.getByLabel('この項目を何と呼びますか？',{exact:true})).toHaveValue('追加の回線');await drive(page,{label:'訂正した回線',deviceRef:'phone',simType:'physical'});expect((await saved(page)).guide).toEqual(original);
});
test('physical state is recorded separately from hiding and does not sign out or delete anything',async({page,context})=>{
 const requests:string[]=[];context.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4174'))requests.push(r.url());});const input=fixture(),ref='legacy/key?and&space';input.securityModel.entities=input.securityModel.entities.map(e=>e.id==='key'?{...e,id:ref}:e);await open(page,input);await page.locator('.map-node').filter({hasText:'青いキー'}).click();await page.getByRole('link',{name:'現在の状態を記録する',exact:true}).click();await page.getByLabel('現在の状態',{exact:true}).selectOption('lost');await page.getByRole('checkbox',{name:'確認した現在の状態として記録する',exact:true}).check();await advance(page,'この状態を記録する');
 await expect(page.locator('.selected-node')).toHaveClass(/needs-work/);let data=await saved(page);expect(data.securityModel.lifecycle[ref].state).toBe('lost');const reset=data.securityModel.lifecycle[ref].accessResetAt;await page.getByRole('link',{name:'現在の状態を記録する',exact:true}).click();await page.getByLabel('現在の状態',{exact:true}).selectOption('in-use');await page.getByRole('checkbox',{name:'確認した現在の状態として記録する',exact:true}).check();await advance(page,'この状態を記録する');data=await saved(page);expect(data.securityModel.lifecycle[ref].accessResetAt).toBe(reset);expect(mapNode(data,ref)).toBeDefined();expect(data.securityModel.facts).toHaveLength(0);expect(requests).toEqual([]);
});
for(const language of ['ja','en'] as const)test(`${language}: mobile keyboard, private-input rejection and preserved guide-owned references`,async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=fixture(language);await open(page,f);await begin(page,'identifier',language);await advance(page,language==='ja'?'別の項目を登録する':'Register a different item');const input=page.locator('.record-guide input[type=text]');await input.fill('private@example.com');await advance(page,language==='ja'?'次へ':'Next');await expect(page.getByRole('alert')).toBeVisible();expect(JSON.stringify(mapRecordStore(await saved(page)))).not.toContain('private@example.com');await input.fill(language==='ja'?'買い物用の別名':'Shopping alias');await page.getByRole('button',{name:language==='ja'?'次へ':'Next',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');await drive(page,{identifierType:'email-alias',subjectRef:'account',roles:['sign-in','contact']});
 await page.locator('.map-node').filter({hasText:'個人Google'}).click();await advance(page,language==='ja'?'この記録を編集する':'Edit this record');await expect(page.locator('.record-guide')).toContainText(language==='ja'?'本人情報や参照先は保ち':'Its identity stays intact');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await mkdir('test-results/map-records',{recursive:true});await page.screenshot({path:`test-results/map-records/map-record-${language}.png`,fullPage:true});
});
