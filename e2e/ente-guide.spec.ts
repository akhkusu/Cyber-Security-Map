import { expect, test } from '@playwright/test';
import { enteFixture,phoneEnteFixture,openEnteData,readEnteData,driveEnteUI } from './ente-driver';
import { initialTwofas } from './twofas-driver';
import { advance,passphrase } from './helpers';
import { enteStore,entePrepared,enteBackupCurrent } from '../src/enteSchemas';
import { enteTask } from '../src/enteData';
import { enteMoveReady,enteAccountReady } from '../src/enteEngine';
import { currentTask } from '../src/guideEngine';
import { evaluateAccess } from '../src/securityModel';
import { startEnteTask } from '../src/enteData';
import { currentEnteStep } from '../src/enteEngine';
import { phoneSteps } from '../src/phoneCatalog';
test.setTimeout(120000);
for(const [os,language] of [['ios','ja'],['android','en']] as const)test(`Ente ${os} ${language}: normal guide preparation, service enrollment, encrypted backup and exact return`,async({page})=>{
 const data=initialTwofas(os,language),ja=language==='ja';await openEnteData(page,data);await advance(page,'Ente Auth');await page.locator('.guide-card .choices .choice').first().click();await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
 const selected=await readEnteData(page),task=enteStore(selected)!.tasks.at(-1)!;expect(selected.assets.find(a=>a.id==='mail')!.controls.mfa).toBe('unknown');await driveEnteUI(page,task.id);
 let saved=await readEnteData(page);expect(entePrepared(saved,task.appRef)).toBe(true);expect(saved.assets.find(a=>a.id==='mail')!.controls.mfa).toBe('unknown');
 await advance(page,ja?'別の画面にあり、このスマホで読み取れる':'On another screen; I can scan it');
 for(let i=0;i<20;i++){
  saved=await readEnteData(page);if(saved.guide.cursor.startsWith('recovery-location/'))break;const t=currentTask(saved);if(!t)throw Error(`Missing service or recovery operation at ${saved.guide.cursor}`);await page.locator('.guide-card .primary-actions button').first().click();await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
 }
 expect((await readEnteData(page)).assets.find(a=>a.id==='mail')!.controls).toMatchObject({mfa:'verified',recovery:'verified'});
 await advance(page,ja?'紙で保管した復旧コード':'Printed recovery codes');
 saved=await readEnteData(page);const backup=enteStore(saved)!.tasks.find(t=>t.kind==='backup'&&t.origin==='guide')!;expect(backup).toBeTruthy();await driveEnteUI(page,backup.id,{},'file-note');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);const note=page.getByRole('button',{name:ja?'控えを保管しました':'I stored the reminder',exact:true});await note.focus();await expect(note).toBeFocused();await page.screenshot({path:`/tmp/qa-ente-guide/ente-guide-${language}.png`,fullPage:true});await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');expect(enteTask(await readEnteData(page),backup.id)!.records['file-note']).toBeTruthy();
 await page.reload();await page.getByLabel(ja?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,ja?'開いて再開する':'Unlock and continue');
 const done=await driveEnteUI(page,backup.id);expect(enteBackupCurrent(done,task.appRef)).toBe(true);expect(done.guide.cursor).toBe('manager-select');expect(done.guide.accountId).toBe('mail');
 await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText(done.securityModel.entities.find(e=>e.id===task.appRef)!.label,{exact:true})}).click();await expect(page.locator('.map-details')).toContainText(ja?'コード登録の記録あり':'Code registration recorded');
});
for(const [old,fresh] of [['ios','ios'],['ios','android'],['android','ios'],['android','android']] as const)test(`Ente file move ${old} → ${fresh}: complete the actual phone task and preserve the whole main guide`,async({page})=>{
 const f=phoneEnteFixture(old,fresh);await openEnteData(page,f.data);await page.getByRole('link',{name:/^機種変更を再開する/}).first().click();await advance(page,'新端末でEnteを移し、利用を確認する');const started=await readEnteData(page),task=enteStore(started)!.tasks.at(-1)!;
 await driveEnteUI(page,task.id,{},'import-open');const midway=await readEnteData(page);expect(midway.guide).toEqual(f.main);expect(enteMoveReady(midway,'move',f.appRef,'fresh')).toBe(false);
 await page.reload();await page.getByLabel('アプリの保存用パスフレーズ',{exact:true}).fill(passphrase);await advance(page,'開いて再開する');
 const done=await driveEnteUI(page,task.id);expect(done.guide).toEqual(f.main);expect(enteMoveReady(done,'move',f.appRef,'fresh')).toBe(true);expect(done.deviceWorkflows[0].cursor).not.toBe(`auth:${f.appRef}:ente`);expect(done.deviceWorkflows[0].records[enteTask(done,task.id)!.phoneRecordKey!]?.status).toBe('confirmed');
 const route=done.securityModel.routes.find(r=>r.purpose==='second-step'&&r.contexts.includes('new-device'))!;expect(evaluateAccess(done.securityModel,route.id,{context:'new-device',now:new Date().toISOString(),unavailableRefs:['old']}).state).toBe('available');
});
test('Ente Account: independent backup, recovery key, existing passkey and readable data are separate checks',async({page})=>{
 const f=enteFixture('ios','ios',true),main=structuredClone(f.data.guide);await openEnteData(page,f.data);await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText(f.data.assets.find(a=>a.id===f.rootRef)!.name,{exact:true})}).click();await advance(page,'次の端末で進める： これまでのスマホ');const task=enteStore(await readEnteData(page))!.tasks.at(-1)!;
 const done=await driveEnteUI(page,task.id);expect(enteAccountReady(done,f.appRef)).toBe(true);expect(done.guide).toEqual(main);expect(enteStore(done)!.roots).toHaveLength(1);expect(done.assets.find(a=>a.id===f.rootRef)!.controls).toMatchObject({mfa:'verified',recovery:'verified'});
});
test('Ente automatic backup: keep the managed folder and permanent copy separate, without claiming a restore',async({page})=>{
 const f=enteFixture('ios'),started=startEnteTask(f.data,{kind:'backup',appRef:f.appRef,origin:'map'});await openEnteData(page,started.data);await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText(f.data.securityModel.entities.find(e=>e.id===f.appRef)!.label,{exact:true})}).click();await page.locator(`a[href$="/ente/${started.id}"]`).click();
 const done=await driveEnteUI(page,started.id,{'backup-kind':'automatic'}),store=enteStore(done)!;
 expect(enteBackupCurrent(done,f.appRef)).toBe(true);expect(store.automaticSettings).toHaveLength(1);expect(store.files.map(f=>f.role).sort()).toEqual(['permanent','source']);expect(new Set(store.files.map(f=>f.storageRef)).size).toBe(2);expect(store.proofs.some(p=>p.kind==='restore')).toBe(false);
});
test('Ente restore: an unrecorded encrypted file can be restored into the selected app, with a fresh backup child and exact return',async({page})=>{
 const f=enteFixture('android'),main=structuredClone(f.data.guide);await openEnteData(page,f.data);await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText(f.data.securityModel.entities.find(e=>e.id===f.appRef)!.label,{exact:true})}).click();await advance(page,'旧端末なしで別のスマホへ復元する');await advance(page,'いま選んでいるこのアプリへ復元する');
 const task=enteStore(await readEnteData(page))!.tasks.at(-1)!,done=await driveEnteUI(page,task.id,{'move-file':'unrecorded','target-more:0':'account:mail'});
 expect(done.guide).toEqual(main);expect(enteTask(done,task.id)?.destinationRef).toBe(f.appRef);expect(done.assets.filter(a=>a.kind==='device')).toHaveLength(2);expect(enteStore(done)!.files[0].snapshot).toBe('unverified-export-coverage');expect(enteBackupCurrent(done,f.appRef)).toBe(true);expect(done.securityModel.entities.find(e=>e.id==='old-code')).toBeTruthy();
});
test('Ente own Account TOTP: complete backup and Account child guides on the new phone, then avoid duplicate service sign-in',async({page})=>{
 test.setTimeout(180000);const f=phoneEnteFixture('ios','android',true);await openEnteData(page,f.data);await page.getByRole('link',{name:/^機種変更を再開する/}).first().click();await advance(page,'新端末でEnteを移し、利用を確認する');const started=await readEnteData(page),task=enteStore(started)!.tasks.at(-1)!;
 const done=await driveEnteUI(page,task.id,{'new-state':'account','new-root':`account:${f.rootRef}`,'root-mfa':'totp','root-factor-store':'current-app'}),target=enteTask(done,task.id)!.destinationRef!;
 expect(done.guide).toEqual(f.main);expect(enteAccountReady(done,target,['old'])).toBe(true);expect(enteMoveReady(done,'move',f.appRef,'fresh')).toBe(true);expect(done.deviceWorkflows[0].records[enteTask(done,task.id)!.phoneRecordKey!]?.status).toBe('confirmed');
 expect(phoneSteps(done,done.deviceWorkflows[0]).some(s=>s.id==='signin:mail')).toBe(false);expect(done.securityModel.entities.find(e=>e.id==='root-code')).toBeTruthy();
});
test('Ente troubleshooting: unsupported codes stay unfinished; AI copy appears only after local help and omits private labels',async({page,context})=>{
 const f=phoneEnteFixture('ios','android');f.data.assets.find(a=>a.id==='mail')!.name='PRIVATE-MAIL-NICKNAME';await openEnteData(page,f.data);await page.getByRole('link',{name:/^機種変更を再開する/}).first().click();await advance(page,'新端末でEnteを移し、利用を確認する');const task=enteStore(await readEnteData(page))!.tasks.at(-1)!;await driveEnteUI(page,task.id,{},'source-code-types');
 await advance(page,'HOTP・Steam・別方式・分からない');const blocked=await readEnteData(page);expect(currentEnteStep(blocked,enteTask(blocked,task.id)!).kind).toBe('blocked');expect(enteMoveReady(blocked,'move',f.appRef,'fresh')).toBe(false);
 await advance(page,'うまくいかない');await advance(page,'対応していない・権限がない');await expect(page.getByRole('button',{name:'AIへの相談文をコピーする'})).toHaveCount(0);await advance(page,'これでは解決しなかった');await context.grantPermissions(['clipboard-read','clipboard-write']);await advance(page,'AIへの相談文をコピーする');await expect(page.locator('.ente-content').getByRole('status')).toContainText('コピーしました');const prompt=await page.evaluate(()=>navigator.clipboard.readText());expect(prompt).toContain('最新の公式情報');expect(prompt).not.toContain('PRIVATE-MAIL-NICKNAME');
 await advance(page,'未完了で保存し、後で進める');expect((await readEnteData(page)).guide).toEqual(f.main);
});
