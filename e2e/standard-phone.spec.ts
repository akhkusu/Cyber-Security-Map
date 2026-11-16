import {test,expect} from '@playwright/test';
import {makeAsset,newDataset,type CurrentDataset} from '../src/models';
import {withStandardContext} from './standard-fixture';
import {saveOnePasswordAccount} from '../src/onePasswordAccount';
import {startPhoneWorkflow} from '../src/phoneEngine';
import {startStandardPhone,standardPhoneData,standardPhoneReady} from '../src/standardPhone';
import {selectedStandardContext,standardStore} from '../src/standardContexts';
import {currentTask} from '../src/guideEngine';
import {openTwofasData,readTwofasData} from './twofas-driver';
import {checkStandardContext} from './standard-driver';
import {advance,passphrase} from './helpers';
for(const language of ['ja','en'] as const)for(const [product,method] of [['bitwarden','password'],['1password','password'],['1password','sso'],['1password','passkey-beta']] as const){
 test(`new phone ${language} ${product} ${method}: actual target, saved-password use and independent recovery preserve main guide`,async({page},testInfo)=>{
  test.setTimeout(150000);await page.setViewportSize({width:390,height:844});const word=(ja:string,en:string)=>language==='ja'?ja:en;
  let d=newDataset(language);d.assets=[{...makeAsset({kind:'account',type:'Password manager',name:'Manager',importance:'critical'}),id:'manager',provider:product,purpose:'personal',services:['manager']},...(['old','fresh'] as const).map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'Old phone':'New phone',importance:'critical',operatingSystem:id==='old'?'ios':'android'}),id})),{...makeAsset({kind:'account',type:'Primary email',name:'Mail',importance:'critical'}),id:'mail',provider:'google',purpose:'personal'}];
  d.guide={...d.guide,managerId:'manager',accountId:'mail',cursor:'do/mail/recovery/test',history:['start'],answers:{'manager:region':'eu','manager:platform':'ios',opaque:'retain main guide'}};d.assets[0].controls.mfa='verified';d.assets[0].controls.recovery='verified';
  if(product==='1password')d=saveOnePasswordAccount(d,'manager',{host:method==='sso'?'example.1password.eu':'my.1password.eu',kind:method==='sso'?'business':'individual',method}) as CurrentDataset;
  d=withStandardContext(d,'manager','app');const source=selectedStandardContext(d,'manager')!.app,main=structuredClone(d.guide),selection=standardStore(d)!.selections.manager;
  d=startPhoneWorkflow(d,'/guide','old','phone');Object.assign(d.deviceWorkflows[0],{newDeviceRef:'fresh',cursor:'standard-account:manager',answers:{stage:'new',setup:'ready',availability:'available',ownership:'personal',authenticator:'none','special-apps':'none','phone-line':'no-line','old-fate':'sell','ios-generation':'18','sale-theft-menu':'older','use:manager':'yes','use:mail':'elsewhere'}});
  const started=startStandardPhone(d,'phone','manager');await openTwofasData(page,started.data);
  // Navigate within the router, keeping the unlocked app and the deployed base path.
  await page.evaluate(id=>{if(location.hash.startsWith('#/'))location.hash=`#/standard-phone/${id}`;else{history.pushState(null,'',`/standard-phone/${id}`);dispatchEvent(new PopStateEvent('popstate'));}},started.sessionId);
  await expect(page.locator('.guide-card h1')).toBeVisible();
  let interrupted=false;
  for(let i=0;i<60;i++){
   const saved=await readTwofasData(page);expect(saved.guide).toEqual(main);expect(standardStore(saved)!.selections.manager).toEqual(selection);
   if(standardPhoneReady(saved,'phone','manager'))break;
   const child=standardPhoneData(saved,started.sessionId)!,task=currentTask(child)!;
   if(await page.locator('.standard-context-check').count()){await checkStandardContext(page,language,'New phone');continue;}
   if(task.redirectTo?.startsWith('onepassword-source/')){await advance(page,source.label);continue;}
   if(task.redirectTo?.startsWith('standard-phone-target/')){await advance(page,'Mail');continue;}
   if(task.redirectTo?.startsWith('do/')){await advance(page,word('手順を開く','Open this step'));continue;}
   await expect(page.locator('.guide-card h1')).toHaveText(task.step.title[language]);
   if(task.step.id==='std-phone-open'&&!interrupted&&method==='password'){
    interrupted=true;await page.reload();await page.getByLabel(word('アプリの保存用パスフレーズ','App passphrase'),{exact:true}).fill(passphrase);await advance(page,word('開いて再開する','Unlock and continue'));continue;
   }
   if(task.step.id==='std-phone-recovery'){
    expect(standardPhoneReady(saved,'phone','manager')).toBe(false);
    await page.screenshot({path:testInfo.outputPath(`standard-phone-${language}-${product}-${method}.png`),fullPage:true});
   }
   const choice=task.step.choices?.find(c=>c.next==='op-source')??task.step.choices?.find(c=>c.record!==false);
   await advance(page,choice?.label[language]??word('次へ','Next'));
  }
  const saved=await readTwofasData(page);expect(standardPhoneReady(saved,'phone','manager')).toBe(true);expect(saved.guide).toEqual(main);expect(standardStore(saved)!.selections.manager).toEqual(selection);
  const session=standardStore(saved)!.sessions[0],app=saved.securityModel.entities.find(e=>e.id===session.selection?.appRef)!;expect(app.deviceRef).toBe('fresh');expect(app.id).not.toBe(source.id);
  expect(standardStore(saved)!.observations.some(o=>o.appRef===app.id&&o.kind==='password-use'&&o.subjectRef==='mail')).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await expect(page).toHaveURL(/\/phone\/phone$/);
 });
}
