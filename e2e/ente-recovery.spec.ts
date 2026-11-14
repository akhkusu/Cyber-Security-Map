import { expect,test,type Page } from '@playwright/test';
import { enteFixture,openEnteData,readEnteData,driveEnteUI } from './ente-driver';
import { advance,passphrase } from './helpers';
import type { CurrentDataset } from '../src/models';
import { makeAsset } from '../src/models';
import { startEnteTask,enteTask,putEnteEntity } from '../src/enteData';
import { currentEnteStep,answerEnte,confirmEnte,enteAccountReady } from '../src/enteEngine';
import { enteStore,enteConfiguration,entePasswordPending,enteReceiptCurrent } from '../src/enteSchemas';
test.setTimeout(180000);

function recoveryFixture(language:'ja'|'en'='ja',method:'passkey'|'totp'='passkey'){
 const f=enteFixture('ios','android',true);if(method==='totp')f.data=putEnteEntity(f.data,{id:'root-totp',kind:'credential',credentialType:'totp',subjectRef:f.rootRef!,storageRef:f.appRef,roles:['second-step'],label:'Ente Accountの以前のTOTP',createdAt:new Date().toISOString()});const prepared=startEnteTask(f.data,{kind:'account',appRef:f.appRef,rootRef:f.rootRef,origin:'map'});let data=prepared.data;
 const choices:Record<string,string>={'file-choice':'new','backup-kind':'manual','file-secret-mode':'new','save-place':'external','file-location':'add','root-password-state':'known','root-key-copy':'new','root-email-mode':'off','root-mail':'account:mail','root-mfa':method,'root-passkey-record':'add','root-factor-store':method==='totp'?`store:${f.appRef}`:'local'};
 for(let i=0;i<100&&enteTask(data,prepared.id)!.status!=='completed';i++){
  const step=currentEnteStep(data,enteTask(data,prepared.id)!);if(step.kind==='question'){const value=choices[step.id]??(step.id.endsWith('/entry')?'password':step.id.endsWith('/after-password')?method:step.id.endsWith('/after-factor')?'data':undefined);if(!value)throw Error('Missing recovery fixture choice '+step.id);data=answerEnte(data,prepared.id,value) as CurrentDataset;}else if(step.kind==='action')data=confirmEnte(data,prepared.id) as CurrentDataset;else throw Error('Incomplete fixture '+step.id);
 }
 if(!enteAccountReady(data,f.appRef))throw Error('Recovery fixture Account incomplete');data.settings.language=language;return {...f,data};
}
async function openRecovery(page:Page,data:CurrentDataset,id:string,appRef:string){
 await openEnteData(page,data);await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText(data.securityModel.entities.find(e=>e.id===appRef)!.label,{exact:true})}).click();await page.locator(`a[href$="/ente/${id}"]`).first().click();await expect(page.locator('.ente-content')).toBeVisible();
}
for(const language of ['ja','en'] as const)test(`Ente password recovery ${language}: uncertain result, reload and one-action return preserve current data`,async({page})=>{
 const f=recoveryFixture(language),ja=language==='ja',original=structuredClone(enteStore(f.data)!.roots[0]),main=structuredClone(f.data.guide),task=startEnteTask(f.data,{kind:'recovery',appRef:f.appRef,rootRef:f.rootRef,origin:'map'});await openRecovery(page,task.data,task.id,f.appRef);
 await driveEnteUI(page,task.id,{'recovery-result':'uncertain'},'recovery-password-request');let data=await readEnteData(page);expect(enteStore(data)!.roots[0].passwordRef).toBe(original.passwordRef);expect(enteTask(data,task.id)!.recoveryStateV1!.password!.phase).toBe('prepared');
 await advance(page,ja?'変更を一度送信しました':'I submitted this change once');await advance(page,ja?'エラー・結果が不明。繰り返さず確認する':'An error / no clear result; do not repeat');data=await readEnteData(page);expect(entePasswordPending(data.securityModel,f.rootRef!)).toBe(true);
 await driveEnteUI(page,task.id,{},'recovery-password-test');
 await page.getByRole('link',{name:'Security Map',exact:true}).click();const rootNode=page.locator('.map-node').filter({has:page.getByText(data.assets.find(a=>a.id===f.rootRef)!.name,{exact:true})});await expect(rootNode).toContainText(ja?'復旧の結果を確認':'Check the recovery result');await rootNode.click();await expect(page.locator('.map-details .status-text')).toHaveText(ja?'復旧の結果を確認':'Check the recovery result');await page.locator('.map-node').filter({has:page.getByText(data.securityModel.entities.find(e=>e.id===f.appRef)!.label,{exact:true})}).click();await page.locator(`a[href$="/ente/${task.id}"]`).first().click();
 await page.reload();await page.getByLabel(ja?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,ja?'開いて再開する':'Unlock and continue');await expect(page.locator('.ente-content h1')).toHaveText(ja?'新しいAccountパスワードをEnteへ入力する':'Enter the new Account password in Ente');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);const testButton=page.getByRole('button',{name:ja?'パスワードが受け付けられました':'The password was accepted',exact:true});await testButton.focus();await expect(testButton).toBeFocused();await page.screenshot({path:`/tmp/qa-ente-recovery/ente-recovery-${language}.png`,fullPage:true});await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
 const done=await driveEnteUI(page,task.id);expect(enteTask(done,task.id)!.status).toBe('completed');expect(enteAccountReady(done,f.appRef)).toBe(true);expect(enteStore(done)!.roots[0].passwordRef).not.toBe(original.passwordRef);expect(enteStore(done)!.roots[0].recoveryRef).toBe(original.recoveryRef);expect(done.securityModel.entities.find(e=>e.id==='old-code')).toBeTruthy();expect(done.guide).toEqual(main);await expect(page).toHaveURL(/\/map\?item=/);
});

test('Ente lost-phone TOTP recovery: re-protect the same Account on a new mobile app while preserving the web device and old records',async({page})=>{
 const f=recoveryFixture('ja','totp');f.data.securityModel.lifecycle.old={state:'lost',evidence:'user-confirmed',updatedAt:new Date().toISOString()};f.data.assets.push({...makeAsset({kind:'device',type:'Computer',name:'本人のMac',operatingSystem:'macos',importance:'critical'}),id:'web'});f.data=putEnteEntity(f.data,{id:'root-totp',kind:'credential',credentialType:'totp',subjectRef:f.rootRef!,storageRef:f.appRef,roles:['second-step'],label:'Ente Accountの以前のTOTP',createdAt:new Date().toISOString()});
 const main=structuredClone(f.data.guide),task=startEnteTask(f.data,{kind:'recovery',appRef:f.appRef,rootRef:f.rootRef,origin:'map'});await openRecovery(page,task.data,task.id,f.appRef);
 const done=await driveEnteUI(page,task.id,{'recovery-purpose':'factor','recovery-place':'web','recovery-device':'device:web','recovery-screen':'totp','recovery-extra-state':'lost','recovery-used-factor':'none','recovery-protection-device':'device:fresh','recovery-protection-app':'new',state:'fresh','root-mfa':'new-passkey'}),saved=enteTask(done,task.id)!;
 expect(saved.status).toBe('completed');expect(saved.newDeviceRef).toBe('web');expect(saved.resources.protectionDevice).toBe('fresh');expect(enteConfiguration(done,saved.destinationRef!)!.rootRef).toBe(f.rootRef);expect(enteAccountReady(done,saved.destinationRef!,['old'])).toBe(true);expect(done.securityModel.lifecycle.old.state).toBe('lost');expect(done.securityModel.lifecycle['root-totp'].state).toBe('revoked');expect(done.securityModel.lifecycle['old-code']).toBeUndefined();expect(done.guide).toEqual(main);
});

test('Ente recovery help: clipboard denial reveals a manual prompt only after local help, using the actual web OS without private labels',async({page})=>{
 const f=recoveryFixture();f.data.assets.find(a=>a.id==='mail')!.name='PRIVATE MAIL';f.data.assets.push({...makeAsset({kind:'device',type:'Computer',name:'PRIVATE DEVICE',operatingSystem:'windows',importance:'critical'}),id:'web'});const task=startEnteTask(f.data,{kind:'recovery',appRef:f.appRef,rootRef:f.rootRef,origin:'map'});await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('clipboard unavailable');}}});});await openRecovery(page,task.data,task.id,f.appRef);
 await driveEnteUI(page,task.id,{'recovery-place':'web','recovery-device':'device:web'},'recovery-web-open');await advance(page,'うまくいかない');await advance(page,'画面が違う');await expect(page.getByLabel('AIへの相談文',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'AIへの相談文をコピーする',exact:true})).toHaveCount(0);await advance(page,'これでは解決しなかった');await advance(page,'AIへの相談文をコピーする');const prompt=page.getByLabel('AIへの相談文',{exact:true});await expect(prompt).toHaveAttribute('readonly','');expect(await prompt.inputValue()).toContain('OS: windows');expect(await prompt.inputValue()).not.toMatch(/PRIVATE|main remains exactly/);await expect(page.locator('.ente-content').getByRole('status')).toContainText('下の文を選択してコピー');await prompt.focus();expect(await prompt.evaluate(e=>(e as HTMLTextAreaElement).selectionEnd-(e as HTMLTextAreaElement).selectionStart)).toBe((await prompt.inputValue()).length);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for(const language of ['ja','en'] as const)test(`Ente actual screens ${language}: email then factor choice then new password uses one sign-in`,async({page})=>{
 const method=language==='ja'?'totp':'passkey',f=recoveryFixture(language,method),main=structuredClone(f.data.guide),task=startEnteTask(f.data,{kind:'recovery',appRef:f.appRef,rootRef:f.rootRef,origin:'map'});
 await openRecovery(page,task.data,task.id,f.appRef);
 const answers={'recovery-result':'uncertain','signin/recovery/entry':'email','signin/recovery/mail':'account:mail','signin/recovery/after-email':'choice','signin/recovery/method':method,'signin/recovery/after-factor':'password'};
 await driveEnteUI(page,task.id,answers,'signin/recovery/method-select');
 await expect(page.locator('.ente-content .instruction')).toContainText(method==='totp'?'Login with TOTP':'Login with passkey');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:`/tmp/qa-ente-signin/ente-signin-${language}.png`,fullPage:true});
 const done=await driveEnteUI(page,task.id,answers),saved=enteTask(done,task.id)!,history=saved.history;
 expect(saved.status).toBe('completed');expect(history.indexOf('signin/recovery/factor-use')).toBeLessThan(history.indexOf('recovery-password-test'));expect(history.filter(s=>s==='signin/recovery/open')).toHaveLength(1);expect(history.filter(s=>s==='signin/recovery/factor-use')).toHaveLength(1);
 const proof=enteStore(done)!.proofs.find(p=>p.kind==='account-read'&&p.directReceiptRef===saved.records['recovery-data-read'])!,fact=done.securityModel.facts.find(f=>f.id===proof.factRef)!;
 expect(fact.requiredRefs).toContain('mail');expect(enteStore(done)!.tasks.some(t=>t.kind==='account'&&t.createdAt>saved.createdAt)).toBe(false);expect(done.guide).toEqual(main);await expect(page).toHaveURL(/\/map\?item=/);
});

for(const language of ['ja','en'] as const)test(`Ente expired sign-in ${language}: restart only the check and keep the submitted change`,async({page})=>{
 const f=recoveryFixture(language),ja=language==='ja',task=startEnteTask(f.data,{kind:'recovery',appRef:f.appRef,rootRef:f.rootRef,origin:'map'});await openRecovery(page,task.data,task.id,f.appRef);
 await driveEnteUI(page,task.id,{'recovery-result':'uncertain'},'signin/recovery/after-factor');
 const before=await readEnteData(page),old=enteTask(before,task.id)!,factor=old.records['signin/recovery/factor-use'],request=old.records['recovery-password-request'],passwordRef=enteStore(before)!.roots[0].passwordRef;
 await advance(page,ja?'期限切れ・ログインの最初へ戻った':'The sign-in expired or returned to the beginning');await advance(page,ja?'このログインの確認を始め直す':'Restart this sign-in check');
 const restarted=await readEnteData(page),current=enteTask(restarted,task.id)!;expect(current.cursor).toBe('signin/recovery/open');expect(current.records['recovery-password-request']).toBe(request);expect(enteStore(restarted)!.roots[0].passwordRef).toBe(passwordRef);expect(enteReceiptCurrent(enteStore(restarted)!,factor)).toBe(false);
 const done=await driveEnteUI(page,task.id),saved=enteTask(done,task.id)!;expect(saved.status).toBe('completed');expect(saved.records['signin/recovery/factor-use']).not.toBe(factor);expect(saved.records['recovery-password-request']).toBe(request);expect(saved.history.filter(s=>s==='recovery-password-request')).toHaveLength(1);expect(done.guide).toEqual(f.data.guide);
});
