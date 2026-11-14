import {expect,test} from '@playwright/test';
import {makeAsset,type CurrentDataset} from '../src/models';
import {twofasStore,twofasMoveReady,twofasBackupCurrent} from '../src/twofasSchemas';
import {createTwofasApp,twofasTask} from '../src/twofasEngine';
import {evaluateAccess} from '../src/securityModel';
import {advance,passphrase} from './helpers';
import {driveTwofasUI,initialTwofas,openTwofasData,phoneTwofasFixture,readTwofasData} from './twofas-driver';
test.setTimeout(90000);
for(const [os,language] of [['ios','ja'],['android','en']] as const){
  test(`2FAS ${os} ${language}: inline setup, enrollment, encrypted file, keyboard and resume`,async({page,context})=>{
    const external:string[]=[];context.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4174'))external.push(r.url());});
    await page.setViewportSize({width:390,height:844});const ja=language==='ja';await openTwofasData(page,initialTwofas(os,language));
    await advance(page,'2FAS Auth');await advance(page,'これまでのスマホ');const setupId=twofasStore(await readTwofasData(page))!.tasks.at(-1)!.id;
    await driveTwofasUI(page,setupId,{'pin-state':'off'},'local');
    const savedPin=await readTwofasData(page),receiptCount=twofasStore(savedPin)!.receipts.length;
    await page.locator('.twofas-content').getByRole('button',{name:ja?'戻る':'Back',exact:true}).click();
    await expect(page.locator('.twofas-content h1')).toHaveText(ja?'アプリのロックを確認する':'Check the app lock');
    await page.locator('.twofas-content').getByRole('button',{name:ja?'この確認で続ける':'Continue with this confirmation',exact:true}).click();
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
    expect(twofasStore(await readTwofasData(page))!.receipts).toHaveLength(receiptCount);
    await driveTwofasUI(page,setupId);await expect(page.getByRole('heading',{level:1})).toHaveText(ja?'登録用のQRコードは、どの画面にありますか？':'Where is the registration QR code?');
    const afterSetup=await readTwofasData(page);expect(afterSetup.assets[0].controls.mfa).toBe('unknown');
    await advance(page,ja?'別の画面にあり、このスマホで読み取れる':'On another screen; I can scan it');await expect(page.locator('.guide-card')).toContainText(ja?'2FAS':'2FAS');
    for(let n=0;n<14;n++){
      const heading=await page.getByRole('heading',{level:1}).innerText();if(heading===(ja?'予備の手段の場所を記録する':'Record where the backup is kept'))break;
      const buttons=page.locator('.guide-card .primary-actions button');await expect(buttons.first()).toBeVisible();await buttons.first().click();await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
    }
    await advance(page,ja?'つながりは記録しない':'Do not record a connection');const backupId=twofasStore(await readTwofasData(page))!.tasks.at(-1)!.id;
    await driveTwofasUI(page,backupId,{},'file-secret');const before=await readTwofasData(page);expect(before.assets[0].controls.mfa).toBe('verified');expect(twofasBackupCurrent(before,selectedApp(before))).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/twofas/backup-${language}.png`,fullPage:true});
    await page.reload();await page.getByLabel(ja?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,ja?'開いて再開する':'Unlock and continue');await expect(page.locator('.twofas-content h1')).toHaveText(ja?'ファイル用の語句をスマホの外へ控える':'Keep the file passphrase outside the phone');
    await page.locator('.twofas-content .button.primary').focus();await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');await driveTwofasUI(page,backupId);
    await expect(page.getByRole('heading',{level:1})).toHaveText(ja?'どのパスワードマネージャーを使いますか？':'Which password manager will you use?');
    const done=await readTwofasData(page),file=twofasStore(done)!.files.at(-1)!;expect(twofasBackupCurrent(done,selectedApp(done))).toBe(true);expect(done.securityModel.routes.some(r=>r.purpose==='restore')).toBe(false);
    await page.getByRole('link',{name:'Security Map',exact:true}).click();await page.locator('.map-node').filter({has:page.getByText(done.securityModel.entities.find(e=>e.id===file.entityRef)!.label,{exact:true})}).click();await expect(page.locator('.map-details')).toContainText(ja?'暗号化コピーの保管記録あり':'Encrypted copy stored');expect(external).toEqual([]);
  });
}
function selectedApp(data:CurrentDataset){return data.guide.answers['auth:mail:app'];}
for(const [oldOS,newOS] of [['ios','ios'],['ios','android'],['android','ios'],['android','android']] as const){
  test(`2FAS encrypted file move ${oldOS} → ${newOS} returns to the actual phone task`,async({page})=>{
    const f=phoneTwofasFixture(oldOS,newOS);await openTwofasData(page,f.data);await page.getByRole('link',{name:/^機種変更を再開する/}).first().click();await advance(page,'新端末で2FASを移し、利用を確認する');
    const started=await readTwofasData(page),id=twofasStore(started)!.tasks.at(-1)!.id;await driveTwofasUI(page,id,{},'file-import-open');const midway=await readTwofasData(page);expect(midway.guide).toEqual(f.main);expect(twofasMoveReady(midway,'move',f.appRef,'fresh')).toBe(false);
    await page.reload();await page.getByLabel('アプリの保存用パスフレーズ',{exact:true}).fill(passphrase);await advance(page,'開いて再開する');await expect(page.locator('.twofas-content h1')).toHaveText('新アプリのファイル取り込みを開く');
    const done=await driveTwofasUI(page,id);expect(done.guide).toEqual(f.main);expect(twofasMoveReady(done,'move',f.appRef,'fresh')).toBe(true);expect(done.deviceWorkflows[0].cursor).not.toBe(`auth:${f.appRef}:twofas`);
    const url=new URL(page.url()),path=url.hash.startsWith('#/')?url.hash.slice(1):url.pathname;expect(path).toContain('/phone/move');expect(done.deviceWorkflows[0].records[twofasTask(done,id)!.phoneRecordKey!]?.status).toBe('confirmed');
    const route=done.securityModel.routes.find(r=>r.purpose==='second-step'&&r.contexts.includes('new-device'))!;expect(evaluateAccess(done.securityModel,route.id,{context:'new-device',now:new Date().toISOString(),unavailableRefs:['old']}).state).toBe('available');
  });
}
for(const os of ['ios','android'] as const){
  test(`2FAS same-${os} cloud restore keeps its real root and separate file/password roles`,async({page})=>{
    const f=phoneTwofasFixture(os,os);f.data.assets.push({...makeAsset({kind:'account',type:'Identity provider',name:'実際の同期先',importance:'critical'}),id:'root',provider:os==='ios'?'apple':'google',purpose:'personal'});
    await openTwofasData(page,f.data);await page.getByRole('link',{name:/^機種変更を再開する/}).first().click();await advance(page,'新端末で2FASを移し、利用を確認する');const id=twofasStore(await readTwofasData(page))!.tasks.at(-1)!.id;
    const data=await driveTwofasUI(page,id,{method:'cloud','cloud-state':'on','cloud-root':'account:root','cloud-password':'yes','target-cloud-account':'same'});expect(data.guide).toEqual(f.main);expect(twofasStore(data)!.files).toHaveLength(0);expect(twofasMoveReady(data,'move',f.appRef,'fresh')).toBe(true);expect(data.assets.find(a=>a.id==='root')!.controls.mfa).toBe('unknown');
    expect(data.securityModel.relations.some(r=>r.kind==='synced-via'&&r.fromRef===twofasTask(data,id)!.destinationRef&&r.toRef==='root'&&r.evidence==='user-confirmed')).toBe(true);
  });
}
test('2FAS keeps an existing new-phone app and its unique code when checking an already present move',async({page})=>{
  const f=phoneTwofasFixture('ios','ios'),made=createTwofasApp(f.data,'fresh');f.data=made.data;f.data.securityModel.entities.push({id:'unique-new-token',kind:'credential',credentialType:'totp',subjectRef:'mail',storageRef:made.appRef,roles:['second-step'],label:'新端末だけの既存コード',createdAt:new Date().toISOString(),opaque:{keep:true}});
  await openTwofasData(page,f.data);await page.getByRole('link',{name:/^機種変更を再開する/}).first().click();await advance(page,'新端末で2FASを移し、利用を確認する');const id=twofasStore(await readTwofasData(page))!.tasks.at(-1)!.id;
  const data=await driveTwofasUI(page,id,{destination:`installation:${made.appRef}`,'new-state':'present','present-origin':'unknown'});expect(data.guide).toEqual(f.main);expect(twofasTask(data,id)!.destinationRef).toBe(made.appRef);expect(data.securityModel.entities.find(e=>e.id==='unique-new-token')).toMatchObject({opaque:{keep:true}});expect(twofasStore(data)!.files).toHaveLength(0);expect(data.securityModel.relations.some(r=>r.kind==='restores-from')).toBe(false);
});
test('2FAS PIN exception stays unfinished, supports safe manual help and defers without returning to the same loop',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await openTwofasData(page,initialTwofas());await advance(page,'2FAS Auth');await advance(page,'これまでのスマホ');const id=twofasStore(await readTwofasData(page))!.tasks.at(-1)!.id;
  await driveTwofasUI(page,id,{},'pin-state');await advance(page,'使えない・分からない');await expect(page.locator('.twofas-content h1')).toHaveText('アプリと今のコードを残す');await advance(page,'うまくいかない');await advance(page,'PIN・バックアップの解除情報を使えない');await advance(page,'これでは解決しなかった');await advance(page,'AIへの相談文をコピーする');
  const prompt=await page.evaluate(()=>navigator.clipboard.readText());expect(prompt).toContain('2FAS Auth');expect(prompt).toContain('https://2fas.com/');expect(prompt).not.toContain('これまでのスマホ');expect(prompt).not.toContain('本人のProton');
  await advance(page,'未完了で保存し、後で進める');await expect(page.getByRole('heading',{level:1})).toHaveText('次に、どの端末を対策しますか？');const data=await readTwofasData(page);expect(data.assets[0].controls.mfa).toBe('unknown');expect(twofasTask(data,id)!.status).toBe('deferred');
});

test('2FAS Map reuses a current encrypted backup without asking about the same synchronization setting again',async({page})=>{
  const f=phoneTwofasFixture('ios','ios');await openTwofasData(page,f.data);await page.getByRole('link',{name:'Security Map',exact:true}).click();
  const label=f.data.securityModel.entities.find(e=>e.id===f.appRef)!.label;await page.locator('.map-node').filter({has:page.getByText(label,{exact:true})}).click();
  await advance(page,'バックアップを用意・確認する');let id=twofasStore(await readTwofasData(page))!.tasks.at(-1)!.id;await driveTwofasUI(page,id);
  const first=await readTwofasData(page),files=twofasStore(first)!.files;expect(files).toHaveLength(2);
  await advance(page,'バックアップを用意・確認する');id=twofasStore(await readTwofasData(page))!.tasks.at(-1)!.id;
  await expect(page.locator('.twofas-content h1')).toHaveText('どの暗号化バックアップを使いますか？');const file=files.find(f=>f.external&&f.permanent)!;
  const done=await driveTwofasUI(page,id,{'file-choice':`file:${file.entityRef}`});expect(twofasStore(done)!.files).toHaveLength(2);expect(twofasTask(done,id)!.records['cloud-open']).toBeUndefined();expect(twofasTask(done,id)!.records['file-secret']).toBeUndefined();
});
