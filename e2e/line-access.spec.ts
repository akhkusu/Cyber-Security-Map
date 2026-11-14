import {expect,test} from '@playwright/test';
import {fixture,open,drive} from './line-driver';
import {readTwofasData} from './twofas-driver';
import {advance,passphrase} from './helpers';
import {lineTask,lineMoveReady,lineRecorded,phoneProductsReady} from '../src/lineSchemas';
import {lineAccessProfile,lineAccessStore,lineKeyOperation} from '../src/lineAccessSchemas';

test.setTimeout(180000);
for(const language of ['ja','en'] as const)test(`LINE ${language}: register email and native passkey, resume both physical operations, then return to the same phone task`,async({page})=>{
  const os=language==='ja'?'ios':'android',f=fixture(language,os,os),answers={'access2:method':'passkey','access2:mail-state':'new','access2:mail-verification':language==='ja'?'code':'link','access2:key-state':'create','key-move:pin-state':'create'};
  await open(page,f.data,f.id);await drive(page,f.id,answers,'access2:key-list');await expect(page.locator('.line-content a.button')).toHaveAttribute('href','https://line.me/R/nv/settings/account/passkey?ref=guide');
  await drive(page,f.id,answers,'access2:key-create');let data=await readTwofasData(page),operation=lineKeyOperation(data,f.id)!;
  expect(operation.phase).toBe('requested');expect(lineAccessProfile(data,f.id)!.keyRef).toBeUndefined();expect(data.guide).toEqual(f.main);
  await advance(page,language==='ja'?'既にLINEで操作した・結果を確認する':'Already operated in LINE: check the result');await page.reload();await page.getByLabel(language==='ja'?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,language==='ja'?'開いて再開する':'Unlock and continue');
  await expect(page.locator('.line-content h1')).toHaveText(language==='ja'?'パスキー作成の現在の結果は？':'What is the current passkey creation result?');await drive(page,f.id,answers,'transfer-ready');data=await readTwofasData(page);
  expect(lineKeyOperation(data,f.id)!.id).toBe(operation.id);expect(lineKeyOperation(data,f.id)!.phase).toBe('registered');expect(lineAccessProfile(data,f.id)!.keyRef).toBe(operation.candidateRef);expect(lineTask(data,f.id)!.records['access2:key-create']).toBeUndefined();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);const button=page.locator('.line-content').getByRole('button',{name:language==='ja'?'引き継ぎを進める':'Continue the transfer',exact:true});await button.focus();await expect(button).toBeFocused();await page.screenshot({path:`/tmp/qa-line-access/access-${language}.png`,fullPage:true});await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  data=await readTwofasData(page);expect(lineTask(data,f.id)!.cutover?.phase).toBe('requested');expect(lineTask(data,f.id)!.cutover?.passkeyBinding?.keyRef).toBe(operation.candidateRef);expect(data.securityModel.facts.some(f=>f.linePasskeyUseV1)).toBe(false);
  await advance(page,language==='ja'?'既にLINEで操作した・結果から再開する':'Already operated in LINE: resume from the result');data=await drive(page,f.id,answers);const task=lineTask(data,f.id)!;
  expect(lineMoveReady(data,task)).toBe(true);expect(phoneProductsReady(data,'move')).toBe(true);expect(data.guide).toEqual(f.main);expect(data.securityModel.facts.some(f=>f.linePasskeyUseV1===operation.candidateRef)).toBe(true);expect(data.securityModel.lifecycle.old).toBeUndefined();expect(task.records['key-login:open']).toBeUndefined();expect(task.records['key-move:pin-create']).toBeTruthy();expect(task.records['password-access']).toBeUndefined();await expect(page).toHaveURL(/\/phone\/move$/);
  await page.getByRole('link',{name:'Security Map',exact:true}).first().click();await expect(page.locator('.map-node').filter({has:page.getByText(data.assets.find(a=>a.id===task.accountRef)!.name,{exact:true})})).toContainText(language==='ja'?'新端末で選んだ範囲を確認':'Selected new-phone use confirmed');
});
test('LINE existing passkey: QR completion records no passkey authentication and no new key creation',async({page})=>{
  const f=fixture('en','ios','ios');await open(page,f.data,f.id);const d=await drive(page,f.id,{'access2:method':'passkey','transfer-method':'qr'}),t=lineTask(d,f.id)!;
  expect(lineMoveReady(d,t)).toBe(true);expect(t.records['qr-scan']).toBeTruthy();expect(lineAccessStore(d)!.operations).toHaveLength(0);expect(d.securityModel.facts.some(f=>f.linePasskeyUseV1)).toBe(false);expect(t.records['password-access']).toBeUndefined();expect(d.guide).toEqual(f.main);
});
test('LINE uncertain key creation: method changes stay gated; a confirmed cancellation can retry without wiping other work',async({page})=>{
  const f=fixture('ja','android','android'),answers={'access2:method':'passkey','access2:key-state':'create','access2:key-result':'unknown'};await open(page,f.data,f.id);await drive(page,f.id,answers,'access2:key-uncertain');let d=await readTwofasData(page);const first=lineKeyOperation(d,f.id)!;
  expect(first.phase).toBe('requested');expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);expect(lineAccessProfile(d,f.id)!.keyRef).toBeUndefined();
  await page.locator('.guide-back').getByRole('button',{name:'戻る',exact:true}).click();await advance(page,'作成を中止し、鍵が作られていないと確認できた');await advance(page,'パスキーの準備を選び直す');d=await drive(page,f.id,{'access2:method':'passkey','access2:key-state':'create'});
  expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineAccessStore(d)!.operations).toHaveLength(2);expect(lineKeyOperation(d,f.id)!.id).not.toBe(first.id);expect(d.guide).toEqual(f.main);
});
test('LINE legacy missing password: explicitly prepare a passkey while keeping the old task and main guide',async({page})=>{
  const f=fixture('ja','ios','ios'),{lineAccessV1:ignored,...model}=f.data.securityModel;void ignored;f.data.securityModel={...model,revision:13};await open(page,f.data,f.id);await drive(page,f.id,{'password-access':'missing'},'password-needed');let d=await readTwofasData(page);const oldMail=lineTask(d,f.id)!.recoveryMailRef!,oldSource=lineTask(d,f.id)!.sourceSessionRef!;
  await advance(page,'登録メール・パスキーを準備する');d=await drive(page,f.id,{'access2:method':'passkey','access2:mail-account':`account:${oldMail}`});const t=lineTask(d,f.id)!;
  expect(lineMoveReady(d,t)).toBe(true);expect(t.recoveryMailRef).toBe(oldMail);expect(t.sourceSessionRef).toBe(oldSource);expect(d.guide).toEqual(f.main);expect(d.securityModel.revision).toBe(14);expect(lineRecorded(d,t,'future-access')).toBe(true);
});
test('LINE email restriction and unsupported key store: keep the move unfinished and offer local help before manual AI copy',async({page})=>{
  const f=fixture('en','ios','ios');await open(page,f.data,f.id);await drive(page,f.id,{'access2:mail-state':'change','access2:mail-editable':'waiting'},'access2:mail-wait');let d=await readTwofasData(page);expect(lineTask(d,f.id)!.cutover).toBeUndefined();expect(phoneProductsReady(d,'move')).toBe(false);
  await page.locator('.guide-back').getByRole('button',{name:'Back',exact:true}).click();await advance(page,'The normal registration/change screen is available');await drive(page,f.id,{'access2:method':'passkey','access2:store':'other'},'access2:key-store-unsupported');
  await advance(page,'Something is not working');await advance(page,'The item is missing');await expect(page.getByRole('button',{name:'Copy prompt for an AI',exact:true})).toHaveCount(0);await advance(page,'This did not resolve it');await expect(page.getByRole('button',{name:'Copy prompt for an AI',exact:true})).toBeVisible();d=await readTwofasData(page);expect(lineTask(d,f.id)!.cutover).toBeUndefined();expect(d.guide).toEqual(f.main);
});
