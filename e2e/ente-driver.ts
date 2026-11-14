import { expect, type Page } from '@playwright/test';
import { newDataset, makeAsset, type CurrentDataset } from '../src/models';
import { createEnteApp, createEnteRoot, startEnteTask, putEnteEntity, enteTask } from '../src/enteData';
import { enteStore } from '../src/enteSchemas';
import { answerEnte, confirmEnte, currentEnteStep, enteStepRecorded } from '../src/enteEngine';
import { startPhoneWorkflow, jumpPhoneStep, confirmPhoneStep } from '../src/phoneEngine';
import { openTwofasData, readTwofasData } from './twofas-driver';
export { openTwofasData as openEnteData, readTwofasData as readEnteData };
export function enteFixture(oldOS:'ios'|'android'='ios',freshOS:'ios'|'android'='ios',account=false){
 let data=newDataset('ja');data.assets=[{...makeAsset({kind:'account',type:'Primary email',name:'本人のProton',importance:'critical'}),id:'mail',provider:'proton',purpose:'personal'},...(['old','fresh'] as const).map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'これまでのスマホ':'新しいスマホ',operatingSystem:id==='old'?oldOS:freshOS,importance:'critical'}),id}))];data.guide={...data.guide,accountId:'mail',cursor:'manager-select',answers:{original:'main remains exactly'}};
 const app=createEnteApp(data,'old'),root=account?createEnteRoot(app.data):undefined,task=startEnteTask(root?.data??app.data,{kind:'prepare',appRef:app.appRef,origin:'map'});data=task.data;
 for(let i=0;i<40&&enteTask(data,task.id)!.status!=='completed';i++){const s=currentEnteStep(data,enteTask(data,task.id)!);if(s.kind==='question'){const v=s.id==='version'?'supported':s.id==='state'?account?'account':'offline':s.id==='root'?`account:${root!.rootRef}`:'device';data=answerEnte(data,task.id,v) as CurrentDataset;}else data=confirmEnte(data,task.id) as CurrentDataset;}
 if(enteTask(data,task.id)!.status!=='completed')throw Error('Ente fixture preparation incomplete');
 data=putEnteEntity(data,{id:'old-code',kind:'credential',credentialType:'totp',subjectRef:'mail',storageRef:app.appRef,roles:['second-step'],label:'本人のProtonの認証コード',createdAt:new Date().toISOString()});
 return {data,appRef:app.appRef,rootRef:root?.rootRef};
}
export function phoneEnteFixture(oldOS:'ios'|'android',freshOS:'ios'|'android',account=false){
 const f=enteFixture(oldOS,freshOS,account);if(account)f.data=putEnteEntity(f.data,{id:'root-code',kind:'credential',credentialType:'totp',subjectRef:f.rootRef!,storageRef:f.appRef,roles:['second-step'],label:'Ente Accountの既存TOTP',createdAt:new Date().toISOString()});const main=structuredClone(f.data.guide);let data=startPhoneWorkflow(f.data,'/guide','old','move') as CurrentDataset;
 Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',answers:{stage:'using',availability:'available',ownership:'personal',authenticator:'none'}});
 data=confirmPhoneStep(jumpPhoneStep(data,'move','prepare-recovery'),'move') as CurrentDataset;data=jumpPhoneStep(data,'move',`auth:${f.appRef}:ente`) as CurrentDataset;return {...f,data,main};
}
export async function driveEnteUI(page:Page,rootId:string,answers:Record<string,string>={},until?:string){
 for(let i=0;i<240;i++){
  const data=await readTwofasData(page);if(!await page.locator('.ente-content').count())return data;
  const url=new URL(page.url()),path=url.hash.startsWith('#/')?url.hash.slice(1):url.pathname,match=path.match(/\/ente\/([^/]+)$/),id=match?decodeURIComponent(match[1]):data.guide.cursor.startsWith('ente/')?data.guide.cursor.slice(5):rootId,t=enteTask(data,id);
  if(!t)throw Error('Ente UI task missing');const s=currentEnteStep(data,t),card=page.locator('.ente-content'),lang=data.settings.language;
  await expect(card.locator('h1')).toHaveText(s.title[lang]);if(s.id===until)return data;
  if(s.child){const names={backup:{ja:'このバックアップを備え、元へ戻る',en:'Prepare this backup and return here'},account:{ja:'このAccountを確認し、元へ戻る',en:'Check this Account and return here'},prepare:{ja:'このアプリを準備し、元へ戻る',en:'Prepare this app and return here'},recovery:{ja:'利用手段を復旧し、元へ戻る',en:'Recover access and return here'}};await card.getByRole('button',{name:names[s.child.kind][lang],exact:true}).click();}
  else if(s.kind==='question'){
   const defaults:Record<string,string>={version:'supported','source-version':'supported','source-code-types':'totp',state:'offline','lock-mode':'device','backup-kind':'manual','file-secret-mode':'new','save-place':'phone','file-location':'add',destination:'add','new-version':'supported','new-state':'offline','new-lock-mode':'device','codes-state':'missing',method:'file','cross-share':'prepared','present-origin':'copy','restore-file-place':'external','root-password-state':'known','root-key-copy':'new','root-email-mode':'off','root-mail':'account:mail','root-mfa':'passkey','root-passkey-record':'add','root-factor-store':'local','recovery-purpose':'forgot','recovery-place':'app','recovery-photos':'no','recovery-locker':'no','recovery-key-state':'available','recovery-paper':'new','recovery-result':'changed','recovery-mail':'account:mail','recovery-device':'device:fresh','recovery-entry':'password','recovery-screen':'key','recovery-used-factor':'none'};
   const signIn=s.id.endsWith('/entry')?'password':s.id.endsWith('/after-password')?(t.answers['root-mfa']==='totp'?'totp':'passkey'):s.id.endsWith('/after-factor')?'data':s.id.endsWith('/credential')?s.choices![0]?.value:undefined;
   const value=(answers[s.id]==='current-app'?`store:${t.appRef}`:answers[s.id])??signIn??(s.id.startsWith('target-more:')?'done':['file-choice','move-file','destination-backup'].includes(s.id)?s.choices![0]?.value:defaults[s.id]);if(!value)throw Error('Missing UI choice '+s.id);const choice=s.choices?.find(c=>c.value===value);if(!choice)throw Error(`Missing choice ${value} at ${s.id}`);
   await card.getByRole('button',{name:choice.label[lang],exact:true}).click();
  }else if(s.kind==='action')await card.getByRole('button',{name:enteStepRecorded(data,t,s.id)?lang==='ja'?'この確認で続ける':'Continue with this confirmation':s.button?.[lang]??(lang==='ja'?'確認しました':'I checked this'),exact:true}).click();
  else if(s.kind==='finished')await card.getByRole('button',{name:lang==='ja'?'元の作業へ戻る':'Return to my previous task',exact:true}).click();
  else throw Error('Blocked Ente UI '+s.id);
  await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');await expect(card.locator('.error')).toHaveCount(0);
 }
 throw Error('Ente UI did not finish');
}
