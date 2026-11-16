import {test,expect,type Page} from '@playwright/test';
import {newDataset,makeAsset,type Language} from '../src/models';
import {taskCursor} from '../src/guideEngine';
import {advance,passphrase,sealRawVault,writeSavedVault} from './helpers';
import {readTwofasData} from './twofas-driver';
const text=(l:Language,ja:string,en:string)=>l==='ja'?ja:en;
async function open(page:Page,language:Language,provider:'google'|'microsoft'){
 const d=newDataset(language);d.assets=[{...makeAsset({kind:'account',type:'Primary email',name:'Main email',importance:'critical'}),id:'main',provider,purpose:'personal',services:['mail'],controls:{mfa:'unknown',recovery:'unknown'}},{...makeAsset({kind:'account',type:'Primary email',name:'Backup email',importance:'critical'}),id:'backup',provider:'proton',purpose:'personal',services:['mail']}];d.guide={...d.guide,accountId:'main',cursor:taskCursor('main','email-mfa','ready')};
 await page.goto('./');await page.locator('.language-picker select').selectOption(language);await writeSavedVault(page,await sealRawVault(d));await page.reload();await page.getByLabel(text(language,'アプリの保存用パスフレーズ','App passphrase'),{exact:true}).fill(passphrase);await advance(page,text(language,'開いて再開する','Unlock and continue'));
}
for(const language of ['ja','en'] as const)for(const provider of ['google','microsoft'] as const)test(`${provider} ${language}: recovery contact operations, exact resume, explicit relationship and no premature MFA`,async({page,context,baseURL})=>{
 const external:string[]=[];context.on('request',r=>{if(new URL(r.url()).origin!==new URL(baseURL!).origin)external.push(r.url());});await page.setViewportSize({width:390,height:844});await open(page,language,provider);
 await advance(page,text(language,'復旧用のメールを確認する','Check a recovery email'));await advance(page,text(language,'メールの設定を開きました','I opened the email settings'));
 await page.reload();await page.getByLabel(text(language,'アプリの保存用パスフレーズ','App passphrase'),{exact:true}).fill(passphrase);await advance(page,text(language,'開いて再開する','Unlock and continue'));await expect(page.locator('.guide-card h1')).toHaveText(text(language,'使えるメールが登録されていますか？','Is a usable email already registered?'));
 if(provider==='google'){
  await advance(page,text(language,'登録済みのメールを確認する','Yes; check the existing mailbox'));await advance(page,text(language,'登録済みのメールを読めます','I can read the registered mailbox'));
 }else{
  await advance(page,text(language,'未登録。使える別のメールを追加する','No; add a different email I can use'));await advance(page,text(language,'このメールを読めます','I can read this mailbox'));await advance(page,text(language,'メールの入力欄が開きました','The email field is open'));await advance(page,text(language,'確認コードを求められた','A verification code is requested'));await advance(page,text(language,'コードを受け取りました','I received the code'));await advance(page,text(language,'コードが受け付けられました','The code was accepted'));
  expect((await readTwofasData(page)).dependencies).toEqual([]);await advance(page,text(language,'認証の設定へ進む','Continue to authentication settings'));
 }
 await expect(page.locator('.guide-card h1')).toHaveText(text(language,'復旧用メールは、どれですか？','Which email is registered for recovery?'));let d=await readTwofasData(page);expect(d.dependencies).toEqual([]);expect(d.assets[0].controls).toMatchObject({mfa:'unknown',recovery:'unknown'});
 await advance(page,'Backup email');await expect(page.locator('.guide-card h1')).toHaveText(text(language,'すでに認証は有効になっていますか？','Is two-step verification already on?'));d=await readTwofasData(page);expect(d.dependencies).toHaveLength(1);expect(d.dependencies[0]).toMatchObject({assetId:'main',recoveryAssetId:'backup',relationType:'recovery-email'});expect(d.assets[0].controls.mfa).toBe('unknown');expect(d.assets[0].controls.recovery).toBe('unknown');expect(external).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 if(provider==='microsoft'){
  await advance(page,text(language,'すでに有効になっている','It is already on'));await advance(page,text(language,'分からない・つながりを記録しない','Not sure / do not record a connection'));
  await advance(page,text(language,'登録済みの別メールを確認する','Check a registered email'));expect((await readTwofasData(page)).assets[0].controls.recovery).toBe('unknown');await advance(page,text(language,'メインのスマホなしでメールを読めました','I read the mailbox without my main phone'));d=await readTwofasData(page);expect(d.assets[0].controls.recovery).toBe('verified');expect(d.actions.filter(a=>a.controlId==='recovery')).toHaveLength(1);expect(d.guide.cursor).toBe('recovery-location/main');
 }
 await page.getByRole('link',{name:'Security Map',exact:true}).first().click();await page.locator('.map-node').filter({has:page.getByText('Main email',{exact:true})}).click();await expect(page.locator('.map-details .connection-row').filter({hasText:'Backup email'})).toBeVisible();
});
