import {withStandardContext} from './standard-fixture';
import {test,expect} from '@playwright/test';
import {makeAsset,newDataset,type Language} from '../src/models';
import {currentTask} from '../src/guideEngine';
import {standardMasterAccepted,standardMasterResume} from '../src/standardMaster';
import {openTwofasData,readTwofasData} from './twofas-driver';
import {advance,passphrase} from './helpers';

function fixture(product:'bitwarden'|'1password',language:Language){
 const data=newDataset(language);
 data.assets=[{...makeAsset({kind:'account',type:'Password manager',name:'My manager',importance:'critical'}),id:'manager',provider:product,purpose:'personal',services:['manager']},
 {...makeAsset({kind:'device',type:'Smartphone',name:'My phone',importance:'critical',operatingSystem:'ios'}),id:'phone'}];
 data.guide.managerId='manager';data.guide.answers={'manager:region':'eu','manager:platform':'ios','manager:deviceRef':'phone'};data.guide.cursor='do/manager/manager/existing-signin';return withStandardContext(data,'manager');
}
for(const product of ['bitwarden','1password'] as const)for(const language of ['ja','en'] as const){
 test(`master change ${product} ${language}: preparation, rejection, encrypted resume, Back and actual password use`,async({page})=>{
  test.setTimeout(120_000);
  const word=(ja:string,en:string)=>language==='ja'?ja:en;
  await page.setViewportSize({width:390,height:844});
  await openTwofasData(page,fixture(product,language));
  await advance(page,word('現在のパスワードで開けました','I opened it with the current password'));
  await advance(page,word('弱い・使い回し・漏えいの心配がある','It is weak, reused or exposed'));
  for(let i=0;i<15;i++){
   const data=await readTwofasData(page),task=currentTask(data)!;
   if(task.step.id==='master-submit')break;
   await expect(page.locator('.guide-card h1')).toHaveText(task.step.title[language]);
   await page.locator('.guide-card .primary-actions button').first().focus();
   await page.keyboard.press('Enter');await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  }
  await expect(page.locator('.guide-card h1')).toHaveText(word('正規サービス側で変更を確定する','Confirm the change on the official service'));
  await advance(page,word('拒否された・結果が分からない','Rejected / I cannot confirm the result'));
  expect(standardMasterAccepted(await readTwofasData(page),'manager')).toBe(false);
  await advance(page,word('実際の結果を確認する','Review the actual result'));
  await advance(page,word('サービスが変更を受け付けました','The service accepted the change'));
  const accepted=await readTwofasData(page);expect(standardMasterAccepted(accepted,'manager')).toBe(true);
  expect(accepted.assets[0].controls.mfa).toBe('unknown');
  await page.reload();await page.getByLabel(word('アプリの保存用パスフレーズ','App passphrase'),{exact:true}).fill(passphrase);await advance(page,word('開いて再開する','Unlock and continue'));
  await expect(page.locator('.guide-card h1')).toHaveText(word('現在使用中の控えを更新する','Update the permanent password copy'));
  await page.getByRole('button',{name:word('戻る','Back'),exact:true}).click();await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.guide-card h1')).toHaveText(word('現在使用中の控えを更新する','Update the permanent password copy'));
  await advance(page,word('確認しました','I checked this'));
  if(product==='1password'){
   await expect(page.locator('.guide-card h1')).toHaveText(word('Emergency Kitを更新する','Update the Emergency Kit'));
   await advance(page,word('Emergency Kitを更新しました','I updated the Emergency Kit'));
  }
  await expect(page.locator('.guide-card h1')).toHaveText(word('新しいパスワードでログインする','Sign in with the new password'));
  await advance(page,word('別の方法を使った・開けなかった','I used another method / it did not work'));
  expect(standardMasterResume(await readTwofasData(page),'manager')).toBe('do/manager/manager/master-change-test');
  await advance(page,word('新しいパスワードの利用を再確認する','Try the new password again'));
  await advance(page,word('新しいパスワードで開けました','The new password worked'));
  await expect(page.locator('.guide-card h1')).toHaveText(product==='bitwarden'?word('現在のログインと緊急用情報を残す','Keep your session and emergency information'):word('今回の方式に合う復旧手段を準備する','Prepare this account’s recovery route'));
  const data=await readTwofasData(page);expect(standardMasterResume(data,'manager')).toBeUndefined();expect(data.assets[0].controls.mfa).toBe('unknown');expect(data.assets[0].controls.recovery).toBe('unknown');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 });
}
test('1Password SSO and passkey accounts keep their working method and remain unfinished',async({page})=>{
 await openTwofasData(page,fixture('1password','ja'));
 await advance(page,'SSO・パスキー・旧ローカル保管庫を使っている');
 await expect(page.locator('.guide-card h1')).toHaveText('現在のログイン方法を残してください');
 const data=await readTwofasData(page);expect(data.guide.steps).toEqual({});expect(data.assets[0].controls.mfa).toBe('unknown');
});
