import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeAsset, newDataset } from '../src/models';
import { decryptVault } from '../src/crypto';
import { createEnteApp, createEnteRoot, startEnteTask, appendEnteReceipt, recordEnteControl, recordEnteLock, recordEnteStorage, makeEnteSecret, saveEnteFile, copyEnteFile } from '../src/enteData';
import { enteStore } from '../src/enteSchemas';
import { twofasStore } from '../src/twofasSchemas';
import { advance, passphrase } from './helpers';
import { openTwofasData, phoneTwofasFixture, readTwofasData } from './twofas-driver';

// This checks the new format through existing user flows. Ente's own guided
// setup and restoration need separate UI scenarios when that guide is wired.
test('Ente format keeps existing 2FAS, phone progress and physical-copy records through normal edits and encrypted export',async({page})=>{
  const f=phoneTwofasFixture('ios','ios'),originalGuide=structuredClone(f.data.guide),originalPhone=structuredClone(f.data.deviceWorkflows),oldTwofas=twofasStore(f.data);
  const app=createEnteApp(f.data,'old'),root=createEnteRoot(app.data),task=startEnteTask(root.data,{kind:'backup',appRef:app.appRef,origin:'map'});
  let data=task.data;data.assets.push({...makeAsset({kind:'backup',type:'Backup disk',name:'本人のEnte用ドライブ',importance:'critical'}),id:'ente-disk'});
  const refs=[app.appRef,'old',root.rootRef],opened=appendEnteReceipt(data,task.id,{stepId:'opened',refs});
  data=recordEnteControl(opened.data,opened.receipt,app.appRef,'opened');data=recordEnteLock(data,opened.receipt,app.appRef,'device');
  const storage=appendEnteReceipt(data,task.id,{stepId:'storage',refs});data=recordEnteStorage(storage.data,storage.receipt,app.appRef,'account',root.rootRef);
  const note=appendEnteReceipt(data,task.id,{stepId:'file-secret',refs}),secret=makeEnteSecret(note.data,note.receipt,app.appRef,'export','paper');
  const save=appendEnteReceipt(secret.data,task.id,{stepId:'file-save',refs,requires:[note.receipt.id]}),file=saveEnteFile(save.data,save.receipt,app.appRef,secret.secretRef,'old','export');
  const external=appendEnteReceipt(file.data,task.id,{stepId:'file-copy',refs:[file.fileRef,'ente-disk'],requires:[save.receipt.id]});data=copyEnteFile(external.data,external.receipt,file.fileRef,'ente-disk','permanent').data;
  data.securityModel.enteV1={...enteStore(data)!,opaqueImportedField:{keep:['unmodified']}};
  const originalEnte=structuredClone(data.securityModel.enteV1),appName=data.securityModel.entities.find(e=>e.id===app.appRef)!.label;
  await openTwofasData(page,data);await page.getByRole('link',{name:'Security Map',exact:true}).click();
  const copyName=data.securityModel.entities.find(e=>e.id===enteStore(data)!.files.find(f=>f.role==='permanent')!.entityRef)!.label;await page.locator('.map-node').filter({has:page.getByText(copyName,{exact:true})}).click();await expect(page.locator('.map-details')).toContainText('暗号化コピーの保管記録あり');
  await expect(page.locator('.map-details')).toContainText('コピー・復元時の由来（過去）');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'/tmp/qa-ente-format/ente-format-ja.png',fullPage:true});
  await page.locator('.language-picker select').selectOption('en');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.map-details')).toContainText('Encrypted copy stored');
  await expect(page.locator('.map-details')).toContainText('Origin of this copy or restore (past)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.keyboard.press('Tab');await page.screenshot({path:'/tmp/qa-ente-format/ente-format-en.png',fullPage:true});
  await page.locator('.language-picker select').selectOption('ja');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  await page.locator('.map-node').filter({has:page.getByText(appName,{exact:true})}).click();await advance(page,'この項目を図から隠す');
  await page.locator('.language-picker select').selectOption('en');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  await page.locator('.language-picker select').selectOption('ja');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  await page.reload();await page.getByLabel('アプリの保存用パスフレーズ',{exact:true}).fill(passphrase);await advance(page,'開いて再開する');
  const resumed=await readTwofasData(page);expect(resumed.securityModel.revision).toBe(12);expect(resumed.securityModel.enteV1).toEqual(originalEnte);expect(twofasStore(resumed)).toEqual(oldTwofas);expect(resumed.guide).toEqual(originalGuide);expect(resumed.deviceWorkflows).toEqual(originalPhone);
  await page.getByRole('link',{name:'設定',exact:true}).click();const pending=page.waitForEvent('download');await advance(page,'暗号化バックアップを保存する');const path=await (await pending).path();if(!path)throw new Error('Encrypted download missing');
  const exported=JSON.parse(await readFile(path,'utf8')),openedExport=(await decryptVault(exported,passphrase)).data;
  expect(openedExport.version).toBe(2);if(openedExport.version!==2)throw new Error('Current data missing');expect(openedExport.securityModel.enteV1).toEqual(originalEnte);expect(twofasStore(openedExport)).toEqual(oldTwofas);expect(openedExport.guide).toEqual(originalGuide);
});

test('a shared mail and manager account remains reusable while an Ente identity is not offered as a mailbox',async({page})=>{
  const initial=newDataset('ja');
  initial.assets=[{...makeAsset({kind:'account',type:'Primary email',name:'共有するApple Account',importance:'critical'}),id:'apple-mail',provider:'apple',services:['mail','manager']}];
  const root=createEnteRoot(initial),data=root.data;
  // Even imported service metadata must not turn an authenticator identity
  // into a mailbox. No address or sign-in detail is used in this fixture.
  const ente=data.assets.find(a=>a.id===root.rootRef)!;ente.services=['mail','manager'];
  await openTwofasData(page,data);
  await expect(page.locator('.guide-card').getByRole('button',{name:/共有するApple Account/})).toBeVisible();
  await expect(page.locator('.guide-card').getByRole('button',{name:new RegExp(ente.name)})).toHaveCount(0);
  await page.locator('.mail-add>summary').click();await page.getByRole('button',{name:'iCloud / Apple Account',exact:true}).click();
  await page.locator('.mail-add>summary').filter({hasText:'記録済みのメールと同じログインで使う'}).click();
  await expect(page.locator('.guide-card').getByRole('button',{name:/共有するApple Account/})).toBeVisible();
  await page.locator('.guide-card').getByRole('button',{name:/共有するApple Account/}).click();
  await advance(page,'個人用');await advance(page,'メインのメールから対策する');
  await advance(page,'Webの設定画面で進める');
  await expect(page.locator('.guide-card h1')).toHaveText('アカウントの設定を開く');
  const selected=await readTwofasData(page);
  expect(selected.guide.accountId).toBe('apple-mail');expect(selected.assets).toHaveLength(2);
  expect(selected.guide.cursor).toBe('do/apple-mail/email-mfa/open');expect(selected.assets[0].controls.mfa).toBe('unknown');
  await page.getByRole('link',{name:'Security Map',exact:true}).click();
  await page.locator('.map-node').filter({has:page.getByText('共有するApple Account',{exact:true})}).click();
  await page.locator('.control-list li').filter({hasText:'認証'}).getByRole('button',{name:'手順へ',exact:true}).click();
  await expect(page.locator('.guide-card h1')).toHaveText('アカウントの設定を開く');
  const fromMap=await readTwofasData(page);expect(fromMap.guide.cursor).toBe('do/apple-mail/email-mfa/open');expect(fromMap.guide.managerId).toBeUndefined();expect(fromMap.assets).toHaveLength(2);
});
