import {test,expect} from '@playwright/test';
import {makeAsset,newDataset,type Language,type CurrentDataset} from '../src/models';
import {withStandardContext} from './standard-fixture';
import {checkStandardContext,checkOnePassword} from './standard-driver';
import {openTwofasData,readTwofasData} from './twofas-driver';
import {advance,passphrase,readSavedVault} from './helpers';
import {addStandardApp,selectStandardDevice,selectStandardVault,finishStandardSelection,selectedStandardContext,standardStore,standardContextReady} from '../src/standardContexts';
import {saveOnePasswordAccount,onePasswordAccount} from '../src/onePasswordAccount';
import {onePasswordMethodReady} from '../src/onePasswordRecipes';

const word=(l:Language,ja:string,en:string)=>l==='ja'?ja:en;
function fixture(product:'bitwarden'|'1password',language:Language){
 const d=newDataset(language);d.assets=[{...makeAsset({kind:'account',type:'Password manager',name:'PRIVATE MANAGER',importance:'critical'}),id:'manager',provider:product,purpose:'personal',services:['manager']},{...makeAsset({kind:'device',type:'Smartphone',name:'Existing phone',importance:'critical',operatingSystem:'ios'}),id:'old'},{...makeAsset({kind:'device',type:'Computer',name:'This computer',importance:'critical',operatingSystem:'windows'}),id:'computer'},{...makeAsset({kind:'account',type:'Primary email',name:'PRIVATE MAIL',importance:'critical'}),id:'mail',provider:'google',purpose:'personal'}];
 d.assets[0].controls.mfa='verified';d.assets[0].controls.recovery='verified';d.assets[3].controls.recovery='verified';d.guide.managerId='manager';d.guide.accountId='mail';d.guide.cursor='do/mail/password/find-current';d.guide.answers={'manager:region':'eu','manager:platform':'windows'};return d;
}
function methodFixture(method:'sso'|'passkey-beta',language:Language,linux=false){
 let d=fixture('1password',language);d.assets[0].controls.mfa='unknown';d.assets[0].controls.recovery='unknown';
 d=saveOnePasswordAccount(d,'manager',{host:method==='sso'?'PRIVATE-ORGANIZATION.1password.eu':'my.1password.com',kind:method==='sso'?'business':'individual',method}) as CurrentDataset;
 d=withStandardContext(d,'manager','app');const original=selectedStandardContext(d,'manager')!;
 d.guide.cursor='do/manager/manager/op-start';
 d=selectStandardVault(d,'manager',original.vault.id) as CurrentDataset;d=selectStandardDevice(d,'manager','computer') as CurrentDataset;d=addStandardApp(d,'manager','web','PRIVATE TARGET PROFILE') as CurrentDataset;d=finishStandardSelection(d,'manager') as CurrentDataset;
 if(linux)d.assets.find(a=>a.id==='computer')!.operatingSystem='ubuntu';
 return {data:d,source:original.app};
}
for(const language of ['ja','en'] as const){
 test(`standard context ${language}: a legacy MFA record asks for the actual vault and client, then resumes without new protection`,async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});const input=fixture('bitwarden',language),before=structuredClone(input.guide);
  await openTwofasData(page,input);await expect(page.locator('.guide-card h1')).toHaveText(word(language,'実際に使う保管庫はどれですか？','Which vault will you actually use?'));
  expect((await readTwofasData(page)).guide).toEqual(before);
  await checkStandardContext(page,language,'This computer');const saved=await readTwofasData(page),context=selectedStandardContext(saved,'manager')!;
  expect(context.app.deviceRef).toBe('computer');expect(context.vault.authenticationAccountRef).toBe('manager');expect(saved.assets[0].id).toBe('manager');expect(saved.assets[0].controls).toEqual(input.assets[0].controls);expect(saved.guide.cursor).toBe(before.cursor);expect(saved.guide.steps).toEqual(before.steps);
  await expect(page.locator('.guide-card h1')).toHaveText(word(language,'このアカウントの保存項目を探す','Find this account in your password manager'));expect(standardContextReady(saved,'manager','web',true)).toBe(true);
  expect(JSON.stringify(await readSavedVault(page))).not.toContain('PRIVATE');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath(`standard-context-${language}.png`),fullPage:true});
 });
 test(`1Password host ${language}: exact address, encrypted interrupted helper, actual contract type and no master completion`,async({page})=>{
  const input=fixture('1password',language);await page.setViewportSize({width:390,height:844});await openTwofasData(page,input);
  await expect(page.locator('.guide-card h1')).toHaveText(word(language,'このアカウントの実際のログイン先を確認する','Find this account’s real sign-in address'));
  await advance(page,word(language,'公式画面の「Find my account」で調べる','Use Find my account on the official site'));
  const before=await readTwofasData(page);await page.reload();await page.getByLabel(word(language,'アプリの保存用パスフレーズ','App passphrase'),{exact:true}).fill(passphrase);await advance(page,word(language,'開いて再開する','Unlock and continue'));
  await expect(page.locator('.guide-card h1')).toHaveText(word(language,'ログイン先を読み取る','Read the sign-in address'));expect((await readTwofasData(page)).guide).toEqual(before.guide);
  await advance(page,word(language,'今回のアカウントのログイン先が分かりました','I found this account’s address'));
  const host=page.getByLabel(word(language,'ログイン先のホスト名','Sign-in host'),{exact:true});await host.fill('https://user:DO-NOT-SAVE@my.1password.eu/?secret=DO-NOT-SAVE');await advance(page,word(language,'次へ','Next'));await expect(page.locator('.onepassword-check [role=alert]')).toBeVisible();expect(JSON.stringify((await readTwofasData(page)).guide)).not.toContain('DO-NOT-SAVE');
  await host.fill('my.1password.ca');await advance(page,word(language,'次へ','Next'));await advance(page,word(language,'家族','Families'));await advance(page,word(language,'アカウントパスワードとSecret Key','Account password and Secret Key'));
  await checkStandardContext(page,language,'This computer');const d=await readTwofasData(page);expect(onePasswordAccount(d,'manager')).toMatchObject({host:'my.1password.ca',kind:'family',method:'password'});expect(d.guide.cursor).toBe(input.guide.cursor);expect(d.guide.steps).toEqual(input.guide.steps);expect(d.assets[0].controls.mfa).toBe('verified');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 });
 test(`SSO ${language}: source, IdP, authorization, vault reading and administrator recovery stay separate`,async({page},testInfo)=>{
  test.setTimeout(60000);const f=methodFixture('sso',language);await page.setViewportSize({width:390,height:844});await openTwofasData(page,f.data);
  await advance(page,word(language,'新しい利用場所として追加する','Add this as a new location'));await advance(page,f.source.label);
  let d=await readTwofasData(page);expect(onePasswordMethodReady(d,'manager')).toBe(false);expect(standardStore(d)?.observations.some(o=>o.appRef===selectedStandardContext(d,'manager')?.app.id&&o.kind==='opened')).toBe(false);
  await page.screenshot({path:testInfo.outputPath(`standard-sso-source-${language}.png`),fullPage:true});await advance(page,word(language,'次へ','Next'));await advance(page,word(language,'次へ','Next'));await advance(page,word(language,'承認元がない・待機・拒否された','No source / waiting / rejected'));expect(onePasswordMethodReady(await readTwofasData(page),'manager')).toBe(false);
  await advance(page,word(language,'新しい利用場所のログインを再確認する','Retry the new target’s sign-in'));await advance(page,word(language,'次へ','Next'));await advance(page,word(language,'承認が受け付けられました','Authorization was accepted'));
  d=await readTwofasData(page);expect(onePasswordMethodReady(d,'manager')).toBe(false);expect(d.securityModel.routes.some(r=>r.standardObservationV1===standardStore(d)!.observations.find(o=>o.kind==='sso-link')?.id)).toBe(false);
  for(let i=0;i<4;i++)await advance(page,word(language,'次へ','Next'));await advance(page,word(language,'確認しました','I checked this'));
  d=await readTwofasData(page);expect(onePasswordMethodReady(d,'manager')).toBe(true);expect(d.assets[0].controls.mfa).toBe('unknown');expect(Object.keys(d.guide.steps).some(k=>/\/(master|paper|auth-secret)$/.test(k))).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath(`standard-sso-${language}.png`),fullPage:true});
 });
 test(`passkey beta ${language}: existing account on unsupported Linux remains unfinished`,async({page})=>{
  const f=methodFixture('passkey-beta',language,true);await openTwofasData(page,f.data);await advance(page,word(language,'この利用場所は、すでに利用できている','This location is already linked'));
  await expect(page.locator('.guide-card h1')).toHaveText(word(language,'このログインは未完了で残す','Keep this sign-in unfinished'));const d=await readTwofasData(page);expect(onePasswordMethodReady(d,'manager')).toBe(false);expect(d.guide.steps['do/manager/manager/op-existing']).toBeUndefined();expect(d.assets[0].controls.mfa).toBe('unknown');
 });
}
test('context save failure retries the same answer without creating a vault or advancing the main cursor',async({page})=>{
 const input=fixture('bitwarden','ja');await openTwofasData(page,input);
 await page.getByLabel('実際の保管庫の呼び名',{exact:true}).fill('自分専用');await page.getByRole('combobox',{name:'この保管庫を使える人',exact:true}).selectOption('private');
 await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;let fail=true;IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){const tx=original.apply(this,args);if(args[1]==='readwrite'&&fail){fail=false;tx.abort();}return tx;};});
 await advance(page,'この保管庫を記録する');await expect(page.getByRole('alert')).toContainText('保存できませんでした');let d=await readTwofasData(page);expect(d.guide).toEqual(input.guide);expect(d.securityModel.entities).toEqual([]);
 await advance(page,'この保管庫を記録する');d=await readTwofasData(page);expect(d.securityModel.entities.filter(e=>e.kind==='vault')).toHaveLength(1);await checkStandardContext(page,'ja','This computer');expect((await readTwofasData(page)).guide.cursor).toBe(input.guide.cursor);
});
test('Map rechecks the same physical app without changing main-guide position or assuming another device',async({page})=>{
 const input=withStandardContext(fixture('bitwarden','ja'),'manager'),main=structuredClone(input.guide),original=selectedStandardContext(input,'manager')!;
 await openTwofasData(page,input);await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText('PRIVATE MANAGER',{exact:true})}).click();
 await page.getByRole('button',{name:'この保管庫・アプリの利用を確認する',exact:true}).click();await advance(page,'ここで今回の保管庫を開けました');
 const d=await readTwofasData(page);expect(d.guide).toEqual(main);expect(selectedStandardContext(d,'manager')?.app.id).toBe(original.app.id);expect(d.assets.filter(a=>a.kind==='device')).toHaveLength(input.assets.filter(a=>a.kind==='device').length);await expect(page.locator('.standard-context-check')).toHaveCount(0);
});
test('unresolved 1Password identity offers manual AI help with no email, organization hostname or profile',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const input=fixture('1password','ja');await openTwofasData(page,input);await advance(page,'Emergency Kitで確認する');await advance(page,'まだ確認できない');
 await expect(page.getByRole('button',{name:'AIへの相談文をコピーする',exact:true})).toHaveCount(0);await advance(page,'この案内では解決しなかった');await advance(page,'AIへの相談文をコピーする');
 const prompt=await page.evaluate(()=>navigator.clipboard.readText());for(const privateText of ['PRIVATE','my.1password','Secret Key:'])expect(prompt).not.toContain(privateText);expect(prompt).toContain('https://support.1password.com/sign-in-troubleshooting/');expect((await readTwofasData(page)).guide.steps).toEqual({});
});
test('1Password new-user recovery preparation stays ahead of authenticator activation',async({page})=>{
 const d=fixture('1password','ja');d.guide.cursor='do/manager/manager/paper';d.assets[0].controls.mfa='unknown';d.assets[0].controls.recovery='unknown';await openTwofasData(page,d);await checkOnePassword(page);await checkStandardContext(page);
 await advance(page,'Emergency Kitを保存できる');await advance(page,'確認しました');await advance(page,'復旧の備えを準備する');await advance(page);await advance(page);await advance(page,'確認しました');
 const after=await readTwofasData(page);expect(after.assets[0].controls.recovery).toBe('verified');expect(after.assets[0].controls.mfa).toBe('unknown');await expect(page.locator('.guide-card h1')).toHaveText('現在のログインと緊急用情報を残す');
});
