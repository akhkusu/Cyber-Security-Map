import { expect, test, type Page } from '@playwright/test';
import { makeAsset, newDataset, type CurrentDataset, type Language } from '../src/models';
import { startPhoneWorkflow, jumpPhoneStep } from '../src/phoneEngine';
import { startPhoneProducts, addPhoneProduct, reviewPhoneProducts } from '../src/lineData';
import { lineStore, lineTask, lineMoveReady, phoneProductsReady, lineRecorded } from '../src/lineSchemas';
import { currentLineStep } from '../src/lineCatalog';
import {securityEntitySchema} from '../src/securityModel';
import { openTwofasData, readTwofasData } from './twofas-driver';
import { passphrase, advance } from './helpers';

test.setTimeout(120000);
function fixture(language:Language='ja',oldOS:'ios'|'android'='ios',newOS:'ios'|'android'='android',extra=false){
 let data=newDataset(language);data.assets=['old','fresh'].map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'これまでのスマホ':'新しいスマホ',operatingSystem:id==='old'?oldOS:newOS,importance:'critical'}),id}));
 data.guide={...data.guide,cursor:'manager-select',history:['start','provider'],answers:{original:'main guide remains exactly'}};
 data=startPhoneWorkflow(data,'/guide','old','move');Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',answers:{stage:'using',availability:'available',ownership:'personal',setup:'ready',authenticator:'none','special-apps':'yes','phone-line':'no-line','old-fate':'sell','ios-generation':'18','sale-theft-menu':'older','android-maker':'pixel'}});
 const i=startPhoneProducts(data,'move');data=addPhoneProduct(i.data,i.id,'line');if(extra)data=addPhoneProduct(data,i.id,'eid');data=reviewPhoneProducts(data,i.id) as CurrentDataset;data=jumpPhoneStep(data,'move','special-app-move') as CurrentDataset;
 return {data,id:lineStore(data)!.tasks[0].id,inventoryRef:i.id,main:structuredClone(data.guide)};
}
async function open(page:Page,data:CurrentDataset,id:string){
 await openTwofasData(page,data);await page.getByRole('link',{name:data.settings.language==='ja'?'機種変更を再開する':'Resume phone-change task',exact:false}).first().click();await advance(page,data.settings.language==='ja'?'引き継ぐアプリ・サービスを確認する':'Open the apps to move');await page.locator(`a[href$="/line/${id}"]`).first().click();await expect(page.locator('.line-content')).toBeVisible();
}
async function drive(page:Page,id:string,answers:Record<string,string>={},until?:string){
 for(let count=0;count<160;count++){
  const data=await readTwofasData(page),t=lineTask(data,id)!;if(!await page.locator('.line-content').count())return data;
  const s=currentLineStep(data,t),card=page.locator('.line-content'),lang=data.settings.language;await expect(card.locator('h1')).toHaveText(s.title[lang]);if(s.id===until)return data;
  if(s.kind==='question'){
   const defaults:Record<string,string>={account:'add','destination-state':'login','new-version':'current','source-state':'usable',version:'current','recovery-email':'available','recovery-mail':'add','recovery-provider':'google','password-access':'known',history:'recent','destination-match':'yes','cutover-result':'home','number-changed':'no','premium-state':'using','pin-state':'ready'};
   const value=answers[s.id]??(s.id.startsWith('restore-screen:')?'home':['source-app','previous-app'].includes(s.id)?s.choices![0].value:s.id==='backup-account'?data.assets.find(a=>a.id===t.oldDeviceRef)?.operatingSystem==='ios'?'add:apple':'add:google':defaults[s.id]);const option=s.choices?.find(c=>c.value===value);if(!option)throw Error(`Missing choice ${value} at ${s.id}`);await card.getByRole('button',{name:option.label[lang],exact:true}).click();
  }else if(s.kind==='action')await card.getByRole('button',{name:lineRecorded(data,t,s.id)?lang==='ja'?'この確認で続ける':'Continue with this confirmation':s.button?.[lang]??(lang==='ja'?'確認しました':'I checked this'),exact:true}).click();
  else if(s.kind==='finished'){await card.getByRole('button',{name:lang==='ja'?'機種変更の続きを進める':'Continue phone change',exact:true}).click();return await readTwofasData(page);}
  else throw Error('Unexpected '+s.id);
  await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
 }throw Error('LINE UI did not finish');
}
for(const language of ['ja','en'] as const)test(`LINE QR ${language}: saved cutover, mobile keyboard and same-parent return update Map`,async({page})=>{
 const f=fixture(language,language==='ja'?'ios':'android',language==='ja'?'android':'ios');await open(page,f.data,f.id);await drive(page,f.id,{},'transfer-ready');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);const button=page.locator('.line-content').getByRole('button',{name:language==='ja'?'引き継ぎを進める':'Continue the transfer',exact:true});await button.focus();await expect(button).toBeFocused();await page.screenshot({path:`/tmp/qa-line/line-${language}.png`,fullPage:true});await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
 let d=await readTwofasData(page);expect(lineTask(d,f.id)!.cutover?.phase).toBe('requested');expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);
 await page.reload();await page.getByLabel(language==='ja'?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,language==='ja'?'開いて再開する':'Unlock and continue');await expect(page.locator('.line-content h1')).toHaveText(language==='ja'?'新端末のLINEで「ログイン」を確定する':'Confirm Log in in the new LINE');
 d=await drive(page,f.id);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(phoneProductsReady(d,'move')).toBe(true);expect(d.guide).toEqual(f.main);expect(d.securityModel.lifecycle.old).toBeUndefined();await expect(page).toHaveURL(/\/phone\/move$/);expect(d.deviceWorkflows[0].cursor).toBe(`use:${lineTask(d,f.id)!.recoveryMailRef}`);
 const account=lineTask(d,f.id)!.accountRef!;await page.getByRole('link',{name:'Security Map',exact:true}).first().click();const node=page.locator('.map-node').filter({has:page.getByText(d.assets.find(a=>a.id===account)!.name,{exact:true})});await expect(node).toContainText(language==='ja'?'新端末で選んだ範囲を確認':'Selected new-phone use confirmed');await node.click();await expect(page.locator('.line-map-details a')).toHaveCount(1);await expect(page.locator('.map-details .control-list')).toHaveCount(0);
});
test('LINE Android Standard Backup: PIN preparation and actual restore screens keep Account and history separate',async({page})=>{
 const f=fixture('ja','android','android');await open(page,f.data,f.id);const answers={history:'text','pin-state':'create','cutover-result':'restore','restore-screen:0':'cloud','restore-screen:1':'restore','restore-screen:2':'pin','restore-screen:3':'progress','restore-screen:4':'home'};
 await drive(page,f.id,answers,'restore-operation:3');let d=await readTwofasData(page);expect(lineRecorded(d,lineTask(d,f.id)!,'pin-create')).toBe(true);expect(lineTask(d,f.id)!.backupRef).toBeTruthy();expect(lineRecorded(d,lineTask(d,f.id)!,'data-read')).toBe(false);expect(phoneProductsReady(d,'move')).toBe(false);
 d=await drive(page,f.id,answers);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(d.guide).toEqual(f.main);
});
test('LINE already on the new phone: no old-login, backup or repeat-transfer confirmations are invented',async({page})=>{
 const f=fixture('en');f.data.securityModel.entities.push(securityEntitySchema.parse({id:'recorded-old-line',kind:'installation',productId:'line',deviceRef:'old',label:'Recorded old LINE',createdAt:new Date().toISOString()}));await open(page,f.data,f.id);const done=await drive(page,f.id,{'destination-state':'same',history:'none'}),t=lineTask(done,f.id)!;
 expect(lineMoveReady(done,t)).toBe(true);expect(t.sourceAppRef).toBe('recorded-old-line');expect(t.records['source-account']).toBeUndefined();expect(t.records['native-login']).toBeUndefined();expect(t.backupRef).toBeUndefined();expect(t.dataRef).toBeUndefined();expect(done.guide).toEqual(f.main);
});
test('LINE exceptions: wrong-account stop, manual AI help and unrelated electronic-ID work stay unfinished',async({page})=>{
 const f=fixture('ja','ios','android',true);f.data.assets[0].name='PRIVATE PHONE';await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));await open(page,f.data,f.id);await drive(page,f.id,{'destination-match':'no'},'wrong-account');let d=await readTwofasData(page);expect(lineTask(d,f.id)!.cutover).toBeUndefined();
 await advance(page,'うまくいかない');await advance(page,'画面が違う');await expect(page.getByRole('button',{name:'AIへの相談文をコピーする',exact:true})).toHaveCount(0);await advance(page,'これでは解決しなかった');await advance(page,'AIへの相談文をコピーする');const prompt=page.getByLabel('AIへの相談文',{exact:true});expect(await prompt.inputValue()).not.toMatch(/PRIVATE|main guide remains exactly/);expect(await prompt.inputValue()).toContain('Service: LINE');await prompt.focus();expect(await prompt.evaluate(e=>(e as HTMLTextAreaElement).selectionEnd-(e as HTMLTextAreaElement).selectionStart)).toBe((await prompt.inputValue()).length);
 await page.locator('.guide-back').getByRole('button',{name:'戻る',exact:true}).click();await advance(page,'はい・同じ既存アカウントです');d=await drive(page,f.id);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(phoneProductsReady(d,'move')).toBe(false);await expect(page).toHaveURL(/\/phone-products\/move$/);await expect(page.getByText('電子ID・電子証明書',{exact:true})).toBeVisible();await advance(page,'未完了で残し、ほかの確認を進める');d=await readTwofasData(page);expect(d.deviceWorkflows[0].cursor).toBe(`use:${lineTask(d,f.id)!.recoveryMailRef}`);expect(d.securityModel.lifecycle.old).toBeUndefined();expect(d.guide).toEqual(f.main);
});
