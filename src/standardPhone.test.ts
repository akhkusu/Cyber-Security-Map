import {describe,it,expect} from 'vitest';
import {makeAsset,newDataset,type CurrentDataset} from './models';
import {startPhoneWorkflow,phoneBlockingSteps} from './phoneEngine';
import {startStandardPhone,saveStandardPhone,standardPhoneData,standardPhoneReady} from './standardPhone';
import {withStandardContext} from '../e2e/standard-fixture';
import {onePasswordAccount,saveOnePasswordAccount} from './onePasswordAccount';
import {addStandardApp,selectedStandardContext,selectStandardDevice,selectStandardVault,finishStandardSelection,standardStore,standardContextReady} from './standardContexts';
import {completeStep,currentTask,move,undoStep} from './guideEngine';
import {selectOnePasswordSource} from './onePasswordSource';
import {createEncryptedVault,decryptVault} from './crypto';
import {onePasswordMethodReady} from './onePasswordRecipes';

function fixture(product:'bitwarden'|'1password',method:'password'|'sso'|'passkey-beta'='password'){
 let data=newDataset('ja');data.assets=[{...makeAsset({kind:'account',type:'Password manager',name:'Manager',importance:'critical'}),id:'manager',provider:product,purpose:'personal',services:['manager']},{...makeAsset({kind:'device',type:'Smartphone',name:'Old phone',importance:'critical',operatingSystem:'ios'}),id:'old'},{...makeAsset({kind:'device',type:'Smartphone',name:'New phone',importance:'critical',operatingSystem:'android'}),id:'fresh'},{...makeAsset({kind:'account',type:'Primary email',name:'Private mail name',importance:'critical'}),id:'mail',provider:'google',purpose:'personal'}];
 data.guide={...data.guide,managerId:'manager',accountId:'mail',cursor:'do/mail/recovery/test',history:['start','private position'],answers:{'manager:region':'eu','manager:platform':'ios',opaque:'keep'}};
 data.assets[0].controls.mfa='verified';data.assets[0].controls.recovery='verified';data.assets[3].controls.recovery='verified';
 if(product==='1password')data=saveOnePasswordAccount(data,'manager',{host:method==='sso'?'example.1password.eu':'my.1password.eu',kind:method==='sso'?'business':'individual',method}) as CurrentDataset;
 data=withStandardContext(data,'manager','app');const original=selectedStandardContext(data,'manager')!;
 data=startPhoneWorkflow(data,'/guide','old','phone') as CurrentDataset;Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',cursor:'standard-account:manager',answers:{stage:'new',setup:'ready','special-apps':'none','phone-line':'no-line','old-fate':'sell','ios-generation':'18','sale-theft-menu':'older',availability:'available',ownership:'personal',authenticator:'none','use:manager':'yes','use:mail':'elsewhere'}});
 return {data,original};
}
function drive(input:CurrentDataset,id:string,sourceRef:string,stop?:string){
 let parent=input;
 for(let i=0;i<90;i++){
  let child=standardPhoneData(parent,id)!;if(child.guide.cursor==='standard-phone-complete')return parent;
  const task=currentTask(child);if(!task)throw Error(`missing task ${child.guide.cursor}`);
  if(task.step.id===stop&&!task.redirectTo)return parent;
  if(task.redirectTo?.startsWith('standard-context/')){
   child=selectStandardVault(child,'manager',standardStore(parent)!.selections.manager.vaultRef) as CurrentDataset;
   child=selectStandardDevice(child,'manager','fresh') as CurrentDataset;child=addStandardApp(child,'manager','app','New phone profile') as CurrentDataset;child=finishStandardSelection(child,'manager') as CurrentDataset;
  }else if(task.redirectTo?.startsWith('onepassword-source/'))child=completeStep(selectOnePasswordSource(child,'manager',sourceRef)) as CurrentDataset;
  else if(task.redirectTo?.startsWith('standard-phone-target/'))child=completeStep({...child,guide:{...child.guide,answers:{...child.guide.answers,'std-phone-target:manager':'mail'}}}) as CurrentDataset;
  else if(task.redirectTo?.startsWith('do/'))child=move(child,task.redirectTo) as CurrentDataset;
  else if(task.redirectTo)throw Error(`unexpected redirect ${task.redirectTo}`);
  else {
   const choice=task.step.choices?.find(c=>c.next==='op-source')??task.step.choices?.find(c=>c.record!==false);
   child=completeStep(child,choice?.next) as CurrentDataset;
  }
  parent=saveStandardPhone(parent,id,child);
 }
 throw Error('phone guide did not finish');
}
describe('standard manager phone sessions',()=>{
 for(const [product,method] of [['bitwarden','password'],['1password','password'],['1password','sso'],['1password','passkey-beta']] as const){
  it(`${product} ${method}: keeps main cursor and selection, requires actual new-device use, and blocks stale completion`,()=>{
   const f=fixture(product,method),main=structuredClone(f.data.guide),started=startStandardPhone(f.data,'phone','manager');
   expect(started.data.guide).toEqual(main);expect(standardPhoneReady(started.data,'phone','manager')).toBe(false);
   expect(standardPhoneData(started.data,started.sessionId)!.securityModel.entities).toEqual(started.data.securityModel.entities);
   const ready=drive(started.data,started.sessionId,f.original.app.id);
   expect(ready.guide).toEqual(main);expect(standardStore(ready)?.selections.manager).toEqual(standardStore(f.data)?.selections.manager);expect(standardPhoneReady(ready,'phone','manager')).toBe(true);
   const session=standardStore(ready)!.sessions[0];expect(session.selection?.appRef).not.toBe(f.original.app.id);expect(ready.assets[0].controls.mfa).toBe(f.data.assets[0].controls.mfa);
   expect(standardStore(ready)?.observations.some(o=>o.appRef===session.selection?.appRef&&o.kind==='password-use'&&o.subjectRef==='mail')).toBe(true);
   const child=standardPhoneData(ready,session.id)!;
   const undone=saveStandardPhone(ready,session.id,undoStep(child,'do/manager/manager/std-phone-login'));
   expect(standardPhoneReady(undone,'phone','manager')).toBe(false);expect(undone.guide).toEqual(main);
   expect(phoneBlockingSteps(undone,undone.deviceWorkflows[0]).some(s=>s.standardAccountRef==='manager')).toBe(true);
  });
 }
 it('keeps the source distinct from the target and never claims it works from selection',()=>{
  const f=fixture('1password','sso'),started=startStandardPhone(f.data,'phone','manager'),parent=drive(started.data,started.sessionId,f.original.app.id,'op-source-open'),child=standardPhoneData(parent,started.sessionId)!;
  expect(onePasswordMethodReady(child,'manager')).toBe(false);expect(standardContextReady(child,'manager')).toBe(false);expect(selectedStandardContext(child,'manager')?.app.id).not.toBe(f.original.app.id);
  expect(()=>selectOnePasswordSource(child,'manager',selectedStandardContext(child,'manager')!.app.id)).toThrow();
 });
 it('keeps encrypted interruption, original IDs and unknown fields and resumes the same target',async()=>{
  const f=fixture('1password','password'),started=startStandardPhone(f.data,'phone','manager'),parent=drive(started.data,started.sessionId,f.original.app.id,'std-phone-open');parent.securityModel.opaque={keep:'original'};
  const sealed=await createEncryptedVault('phone test storage phrase',parent),restored=(await decryptVault(sealed.envelope,'phone test storage phrase')).data as CurrentDataset;
  expect(restored.guide).toEqual(JSON.parse(JSON.stringify(parent.guide)));expect(restored.securityModel).toEqual(JSON.parse(JSON.stringify(parent.securityModel)));expect(restored.assets).toEqual(parent.assets);expect(standardPhoneData(restored,started.sessionId)?.guide.cursor).toBe('do/manager/manager/std-phone-open');
  expect(standardPhoneReady(drive(restored,started.sessionId,f.original.app.id),'phone','manager')).toBe(true);
 });
 it('does not reuse new-phone success after the actual login host or method changes',()=>{
  const f=fixture('1password','password'),started=startStandardPhone(f.data,'phone','manager'),ready=drive(started.data,started.sessionId,f.original.app.id);
  const changed=saveOnePasswordAccount(ready,'manager',{host:'family.1password.eu',kind:'family',method:'password'},'correct');
  expect(onePasswordAccount(changed,'manager')?.host).toBe('family.1password.eu');expect(standardPhoneReady(changed,'phone','manager')).toBe(false);expect(changed.guide).toEqual(ready.guide);
 });
 it('retains the old destination as history and refuses to use its success for a newly selected phone',()=>{
  const f=fixture('bitwarden'),started=startStandardPhone(f.data,'phone','manager'),ready=drive(started.data,started.sessionId,f.original.app.id);
  const other={...makeAsset({kind:'device',type:'Smartphone',name:'Another new phone',importance:'critical',operatingSystem:'android'}),id:'another-phone'};
  const changed={...ready,assets:[...ready.assets,other],deviceWorkflows:ready.deviceWorkflows.map(w=>({...w,newDeviceRef:other.id}))};
  expect(standardPhoneReady(changed,'phone','manager')).toBe(false);expect(standardStore(changed)?.sessions).toEqual(standardStore(ready)?.sessions);
  expect(()=>saveStandardPhone(changed,started.sessionId,standardPhoneData(changed,started.sessionId)!)).not.toThrow();
  const replacement=startStandardPhone(changed,'phone','manager');expect(replacement.sessionId).not.toBe(started.sessionId);expect(replacement.data.guide).toEqual(ready.guide);
 });
});
