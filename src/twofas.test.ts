import { describe, it, expect } from 'vitest';
import { newDataset,makeAsset,currentDatasetSchema,type CurrentDataset,type Dataset,DataUpgradeConflict } from './models';
import { chooseAuthenticator,selectedAuthenticator,authenticatorSetupRoute,requireAuthenticatorRoots } from './authenticatorGuide';
import { completeStep,move } from './guideEngine';
import { createEncryptedVault,decryptVault } from './crypto';
import { createTwofasApp,startTwofasTask,twofasTask,currentTwofasStep,answerTwofas,confirmTwofas,twofasHelpPrompt,navigateTwofas } from './twofasEngine';
import { twofasStore,twofasPrepared,twofasBackupCurrent,twofasMoveReady,twofasFileCurrent } from './twofasSchemas';
import { finishTwofas,undoTwofas } from './twofasIntegration';
import { startAccessPlan } from './accessPlans';
import { startProtectionGuide } from './deviceProtection';
import { twofasSteps } from './twofasCatalog';
import { setMapLifecycle } from './mapRecords';
import { evaluateAccess } from './securityModel';
import { mapConnections,mapItems,typedMapStatus } from './securityMapViews';
import { startPhoneWorkflow,jumpPhoneStep,confirmPhoneStep,phoneBlockingSteps } from './phoneEngine';

function fixture(os:'ios'|'android'='ios'){
  let data=newDataset('ja');data.assets=[{...makeAsset({kind:'account',type:'Primary email',name:'Private email',importance:'critical'}),id:'mail',provider:'proton',purpose:'personal'},...(['old','fresh'] as const).map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'Private old phone':'Private new phone',importance:'critical',operatingSystem:os}),id}))];
  data.guide.accountId='mail';data.guide.cursor='do/mail/email-mfa/scan';
  data=chooseAuthenticator(data,'mail','2fas-auth','old',data.guide.cursor);
  return {data,appRef:selectedAuthenticator(data,'mail')!.id,taskId:twofasStore(data)!.tasks[0].id};
}
function drive(data:CurrentDataset,id:string,answers:Record<string,string>={}):CurrentDataset{
  let next=data;
  for(let i=0;i<200;i++){
    const task=twofasTask(next,id)!;if(task.status==='completed')return next;
    const step=currentTwofasStep(next,task);let change:Dataset;
    if(step.kind==='question'){
      let value=answers[step.id];
      if(!value){
        if(step.id.includes('version'))value='supported';
        else if(step.id.endsWith('pin-state'))value='off';
        else if(step.id==='cloud-state')value='off';
        else if(step.id==='file-location')value='new-offline';
        else if(step.id==='destination')value='add';
        else if(step.id==='token-types')value='totp';
        else if(step.id==='new-state')value='missing';
        else if(step.id==='method')value='file';
        else if(step.id.startsWith('target-more:'))value='done';
        else if(step.id.endsWith('cross-share'))value='pixel';
        else if(step.id==='present-origin')value='copy';
        else if(step.id==='file-secret-mode')value='new';
        else if(step.id==='file-choice')value='new';
        else throw new Error(`No answer for ${step.id}`);
      }
      change=answerTwofas(next,id,value);
    }else if(step.kind==='action')change=confirmTwofas(next,id);
    else throw new Error(`Blocked at ${step.id}: ${step.kind}`);
    expect(change,step.id).not.toBe(next);next=change as CurrentDataset;
    const parsed=currentDatasetSchema.safeParse(next);if(!parsed.success)throw new Error(`Invalid at ${step.id}: ${JSON.stringify(parsed.error.issues)}`);
  }
  throw new Error('Task did not finish');
}
function enroll(data:CurrentDataset):CurrentDataset{
  const app=selectedAuthenticator(data,'mail')!;let next:Dataset={...data,guide:{...data.guide,answers:{...data.guide.answers,[`auth:mail:input:${app.id}`]:'camera'}}};
  for(const cursor of ['do/mail/email-mfa/scan','do/mail/email-mfa/confirm','do/mail/email-mfa/verify'])next=completeStep(move(next,cursor));
  return next as CurrentDataset;
}
function moveFixture(oldOS:'ios'|'android',newOS:'ios'|'android',present=false){
  const f=fixture(oldOS);let data=enroll(drive(f.data,f.taskId));
  data={...data,assets:data.assets.map(a=>a.id==='fresh'?{...a,operatingSystem:newOS}:a),guide:{...data.guide,cursor:'manager-select',history:['start','provider'],answers:{...data.guide.answers,private:'Keep main answer'}}};
  const main=structuredClone(data.guide);data=startPhoneWorkflow(data,'/guide','old','phone');
  const w=data.deviceWorkflows[0];Object.assign(w,{newDeviceRef:'fresh',cursor:`auth:${f.appRef}:twofas`,answers:{stage:'using',availability:'available',ownership:'personal',authenticator:'none'}});
  data=confirmPhoneStep(jumpPhoneStep(data,'phone','prepare-recovery'),'phone') as CurrentDataset;
  data=jumpPhoneStep(data,'phone',`auth:${f.appRef}:twofas`) as CurrentDataset;
  const result=startTwofasTask(data,{kind:'move',appRef:f.appRef,origin:'phone',phoneRef:'phone',newDeviceRef:'fresh'});
  return {...f,data:result.data,moveId:result.id,main,present};
}
describe('2FAS preparation, encrypted backup and real new-code checks',()=>{
  it.each(['ios','android'] as const)('prepares %s without marking service MFA, then records the service’s actual enrollment',os=>{
    const f=fixture(os);expect(f.data.securityModel.revision).toBe(11);expect(f.data.assets[0].controls.mfa).toBe('unknown');
    const data=drive(f.data,f.taskId);expect(twofasPrepared(data,f.appRef)).toBe(true);expect(data.assets[0].controls.mfa).toBe('unknown');expect(twofasBackupCurrent(data,f.appRef)).toBe(false);
    const returned=finishTwofas({...data,guide:{...data.guide,cursor:`twofas/${f.taskId}`}},f.taskId);expect(returned.guide.cursor).toBe('authenticator-input/mail');
    const done=enroll(data);expect(done.assets[0].controls.mfa).toBe('verified');expect(done.securityModel.entities.some(e=>e.kind==='credential'&&e.credentialType==='totp')).toBe(true);expect(done.securityModel.routes.every(r=>r.contexts.includes('enrollment'))).toBe(true);
  });
  it('keeps an existing PIN unchanged and stops unsupported or locked apps without destructive recovery',()=>{
    const f=fixture();const kept=drive(f.data,f.taskId,{'pin-state':'on'});expect(twofasTask(kept,f.taskId)?.records['pin-enter']).toBeUndefined();
    let unavailable=answerTwofas(f.data,f.taskId,'other') as CurrentDataset;expect(currentTwofasStep(unavailable,twofasTask(unavailable,f.taskId)!).kind).toBe('blocked');
    unavailable=navigateTwofas(unavailable,f.taskId,'version') as CurrentDataset;unavailable=answerTwofas(unavailable,f.taskId,'supported') as CurrentDataset;
    for(let i=0;i<6;i++){const s=currentTwofasStep(unavailable,twofasTask(unavailable,f.taskId)!);if(s.id==='pin-state')break;unavailable=confirmTwofas(unavailable,f.taskId) as CurrentDataset;}
    unavailable=answerTwofas(unavailable,f.taskId,'forgotten') as CurrentDataset;expect(currentTwofasStep(unavailable,twofasTask(unavailable,f.taskId)!).id).toBe('pin-unavailable');expect(confirmTwofas(unavailable,f.taskId)).toBe(unavailable);expect(twofasPrepared(unavailable,f.appRef)).toBe(false);
  });
  it('stores a password-protected file and separate value-free reminder, without a restoration claim',()=>{
    const f=fixture();let data=enroll(drive(f.data,f.taskId));const main=structuredClone(data.guide);const b=startTwofasTask(data,{kind:'backup',appRef:f.appRef,origin:'map'});data=drive(b.data,b.id);
    expect(data.guide).toEqual(main);expect(twofasBackupCurrent(data,f.appRef)).toBe(true);const file=twofasStore(data)!.files.find(f=>f.external&&f.permanent)!;expect(file.external).toBe(true);expect(twofasFileCurrent(data.securityModel,file.entityRef)).toBe(true);
    expect(data.securityModel.routes.some(r=>r.purpose==='restore')).toBe(false);expect(typedMapStatus(data,mapItems(data,'ja').find(i=>i.id===file.entityRef)!,'ja').label).toBe('暗号化コピーの保管記録あり');
    expect(JSON.stringify(data)).not.toContain('actual-private-passphrase');
    const later=enroll({...data,guide:{...data.guide,cursor:'do/mail/email-mfa/scan'}});expect(twofasBackupCurrent(later,f.appRef)).toBe(false);
  });
  it.each(['ios','android'] as const)('records the actual %s sync account and a distinct cloud password while keeping a file backup',os=>{
    const f=fixture(os);let data=enroll(drive(f.data,f.taskId));data.assets.push({...makeAsset({kind:'account',type:'Identity provider',name:'Private sync root',importance:'critical'}),id:'root',provider:os==='ios'?'apple':'google',purpose:'personal'});
    const b=startTwofasTask(data,{kind:'backup',appRef:f.appRef,origin:'map'});data=drive(b.data,b.id,{'cloud-state':'on','cloud-root':'account:root','cloud-password':'yes'});
    expect(twofasStore(data)!.clouds[0].rootRef).toBe('root');expect(twofasStore(data)!.clouds[0].secretRef).not.toBe(twofasStore(data)!.files[0].secretRef);expect(data.assets.find(a=>a.id==='root')!.controls.mfa).toBe('unknown');
    expect(mapConnections(data).some(r=>r.relation==='synced-via'&&r.assetId==='root')).toBe(true);
  });
  it.each([['ios','ios'],['ios','android'],['android','ios'],['android','android']] as const)('moves encrypted codes %s → %s, preserves main progress, and returns to the same phone task',(oldOS,newOS)=>{
    const f=moveFixture(oldOS,newOS);let data=drive(f.data,f.moveId);expect(data.guide).toEqual(f.main);expect(twofasMoveReady(data,'phone',f.appRef,'fresh')).toBe(true);
    data=finishTwofas(data,f.moveId) as CurrentDataset;expect(data.guide).toEqual(f.main);expect(data.deviceWorkflows[0].cursor).not.toBe(`auth:${f.appRef}:twofas`);
    const r=data.securityModel.routes.find(r=>r.purpose==='second-step'&&r.contexts.includes('new-device'))!;expect(evaluateAccess(data.securityModel,r.id,{context:'new-device',now:new Date().toISOString(),unavailableRefs:['old']}).state).toBe('available');
    expect(evaluateAccess(data.securityModel,r.id,{context:'all-devices-lost',now:new Date().toISOString()}).state).toBe('not-applicable');
    const source=data.securityModel.entities.find(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.storageRef===f.appRef)!;const copy=data.securityModel.entities.find(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.storageRef===twofasTask(data,f.moveId)!.destinationRef)!;expect(copy).toHaveProperty('replicaGroupId',source.replicaGroupId);
  });
  it('checks already present codes without an import or a new backup, and keeps unrelated new-phone entries',()=>{
    const f=moveFixture('ios','ios');let data=drive(f.data,f.moveId,{'new-state':'present'});expect(twofasStore(data)!.files).toHaveLength(0);expect(twofasTask(data,f.moveId)!.records['file-import']).toBeUndefined();expect(data.securityModel.relations.some(r=>r.kind==='restores-from')).toBe(false);
    const undone=undoTwofas(data,f.moveId,'code:mail') as CurrentDataset;expect(twofasMoveReady(undone,'phone',f.appRef,'fresh')).toBe(false);expect(undone.guide).toEqual(f.main);
    data=finishTwofas(data,f.moveId) as CurrentDataset;const withdrew=undoTwofas(data,f.moveId,'code:mail') as CurrentDataset;expect(phoneBlockingSteps(withdrew,withdrew.deviceWorkflows[0],'use:mail').some(s=>s.twofasSourceRef===f.appRef)).toBe(true);
  });
  it('preserves old revisions and unknown fields, rejects an opaque private-store collision, and encrypts a task midway',async()=>{
    const f=fixture();const plan=startAccessPlan(startProtectionGuide(f.data,'old').data,'mail').data;expect(plan.securityModel.revision).toBe(11);expect(twofasStore(plan)).toEqual(twofasStore(f.data));expect(plan.guide).toEqual(f.data.guide);const encrypted=await createEncryptedVault('test-only-2fas-roundtrip',f.data);const restored=(await decryptVault(encrypted.envelope,'test-only-2fas-roundtrip')).data;expect(restored).toEqual(f.data);
    const old=newDataset();old.securityModel.revision=10;old.securityModel.twofasV1={opaque:'keep'};old.assets=f.data.assets;expect(()=>createTwofasApp(old,'old')).toThrow(DataUpgradeConflict);
    for(const revision of [1,2,3,4,5,6,7,8,9,10] as const){const legacy=newDataset();legacy.assets=f.data.assets;legacy.securityModel.revision=revision;legacy.securityModel.privateNote={nested:'keep'};const next=createTwofasApp(legacy,'old').data;expect(next.securityModel.privateNote).toEqual({nested:'keep'});expect(next.guide).toEqual(legacy.guide);}
  });
  it('asks for an encrypted backup after service recovery, while the main email and existing MFA stay intact',()=>{
    const f=fixture();const ready=enroll(drive(f.data,f.taskId));const next=requireAuthenticatorRoots(ready,'mail','manager-select');expect(next.guide.cursor).toMatch(/^twofas\//);expect(next.guide.accountId).toBe('mail');expect(next.assets[0].controls.mfa).toBe('verified');expect(authenticatorSetupRoute(ready,'mail','do/mail/email-mfa/scan')).toBe('do/mail/email-mfa/scan');
  });
  it('copies only controlled context for exception help, never legacy IDs or account and device nicknames',()=>{
    const f=fixture();const p=twofasHelpPrompt(f.data,twofasTask(f.data,f.taskId)!,3,'ja');for(const privateText of ['Private email','Private old phone','Private new phone'])expect(p).not.toContain(privateText);expect(p).toContain('一度に一つ');expect(p).toContain('2FAS Auth');
  });
  it('reuses the confirmed synchronization setting and file passphrase without repeating general questions',()=>{
    const f=fixture();let data=enroll(drive(f.data,f.taskId));
    const first=startTwofasTask(data,{kind:'backup',appRef:f.appRef,origin:'map'});data=drive(first.data,first.id);
    const secret=twofasStore(data)!.secrets.find(s=>s.purpose==='file')!;
    const second=startTwofasTask(data,{kind:'backup',appRef:f.appRef,origin:'map'},undefined,true);
    expect(twofasSteps(second.data,twofasTask(second.data,second.id)!).some(s=>s.id==='cloud-state')).toBe(false);
    data=drive(second.data,second.id,{'file-choice':'new','file-secret-mode':`secret:${secret.entityRef}`});
    expect(twofasTask(data,second.id)!.records['file-phrase']).toBeUndefined();
    expect(twofasTask(data,second.id)!.records['file-secret']).toBeUndefined();
    expect(twofasStore(data)!.files.filter(f=>f.external&&f.permanent).every(f=>f.secretRef===secret.entityRef)).toBe(true);
    expect(twofasStore(data)!.secrets.filter(s=>s.purpose==='file')).toHaveLength(1);
    const review=startTwofasTask(data,{kind:'backup',appRef:f.appRef,origin:'map',reviewCloud:true},undefined,true);
    expect(twofasSteps(review.data,twofasTask(review.data,review.id)!).some(s=>s.id==='cloud-state')).toBe(true);
  });
  it('keeps physical backup copies separate and does not treat a deleted transfer copy as a lost new code',()=>{
    const f=moveFixture('android','ios'),data=drive(f.data,f.moveId),store=twofasStore(data)!;
    const files=store.files;expect(files).toHaveLength(3);expect(new Set(files.map(f=>f.entityRef)).size).toBe(3);expect(new Set(files.map(f=>f.groupRef)).size).toBe(1);
    const permanent=files.find(f=>f.external&&f.permanent)!,temporary=files.find(f=>!f.permanent)!;
    expect(data.securityModel.lifecycle[temporary.entityRef].state).toBe('deleted');expect(twofasFileCurrent(data.securityModel,permanent.entityRef)).toBe(true);
    const route=data.securityModel.routes.find(r=>r.purpose==='second-step'&&r.contexts.includes('new-device'))!;
    let next=setMapLifecycle(data,'old','deleted');expect(twofasMoveReady(next,'phone',f.appRef,'fresh')).toBe(true);expect(evaluateAccess(next.securityModel,route.id,{context:'new-device',now:new Date().toISOString()}).state).toBe('available');
    next=setMapLifecycle(next,permanent.storageRef,'lost');expect(twofasBackupCurrent(next,f.appRef)).toBe(false);
    expect(evaluateAccess(next.securityModel,route.id,{context:'new-device',now:new Date().toISOString()}).state).toBe('available');
  });
  it('invalidates a copied registration when revoked, while deletion of only the old local copy leaves the new code usable',()=>{
    const f=moveFixture('ios','ios'),data=drive(f.data,f.moveId),source=data.securityModel.entities.find(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.storageRef===f.appRef)!;
    const route=data.securityModel.routes.find(r=>r.purpose==='second-step'&&r.contexts.includes('new-device'))!;
    const deleted=setMapLifecycle(data,source.id,'deleted');expect(evaluateAccess(deleted.securityModel,route.id,{context:'new-device',now:new Date().toISOString()}).state).toBe('available');
    const revoked=setMapLifecycle(data,source.id,'revoked');expect(twofasMoveReady(revoked,'phone',f.appRef,'fresh')).toBe(false);expect(evaluateAccess(revoked.securityModel,route.id,{context:'new-device',now:new Date().toISOString()}).state).toBe('unknown');
    const reenrolled=enroll(data);expect(twofasMoveReady(reenrolled,'phone',f.appRef,'fresh')).toBe(false);expect(evaluateAccess(reenrolled.securityModel,route.id,{context:'new-device',now:new Date().toISOString()}).state).toBe('unknown');
  });
  it('does not apply a move confirmation to a different phone pair or changed app placement',()=>{
    const f=moveFixture('ios','ios'),data=drive(f.data,f.moveId),destination=twofasTask(data,f.moveId)!.destinationRef!;
    const other={...data,assets:[...data.assets,{...data.assets.find(a=>a.id==='fresh')!,id:'third'}],deviceWorkflows:data.deviceWorkflows.map(w=>({...w,newDeviceRef:'third'}))};expect(twofasMoveReady(other,'phone',f.appRef,'fresh')).toBe(false);expect(currentDatasetSchema.safeParse(other).success).toBe(true);
    const moved={...data,securityModel:{...data.securityModel,entities:data.securityModel.entities.map(e=>e.id===destination?{...e,deviceRef:'old'}:e)}};
    expect(twofasMoveReady(moved,'phone',f.appRef,'fresh')).toBe(false);expect(twofasPrepared(moved,destination)).toBe(false);
    const route=moved.securityModel.routes.find(r=>r.purpose==='second-step'&&r.contexts.includes('new-device'))!;expect(evaluateAccess(moved.securityModel,route.id,{context:'new-device',now:new Date().toISOString()}).state).toBe('unknown');
  });
  it('keeps the actual new PIN identity after a record is withdrawn and never revives the previous PIN check',()=>{
    const f=fixture(),ready=drive(f.data,f.taskId),oldPin=twofasStore(ready)!.profiles[0].pinRef!;
    const r=startTwofasTask(ready,{kind:'prepare',appRef:f.appRef,origin:'map'},undefined,true),changed=drive(r.data,r.id,{'pin-state':'off'}),newPin=twofasStore(changed)!.profiles[0].pinRef!;
    expect(newPin).not.toBe(oldPin);expect(changed.securityModel.lifecycle[oldPin].state).toBe('revoked');expect(twofasPrepared(changed,f.appRef)).toBe(true);
    const undone=undoTwofas(changed,r.id,'pin-enter') as CurrentDataset;expect(twofasStore(undone)!.profiles[0].pinRef).toBe(newPin);expect(twofasPrepared(undone,f.appRef)).toBe(false);
    expect(currentDatasetSchema.safeParse(undone).success).toBe(true);
  });
  it('continues from a saved operation without creating another receipt or changing the actual PIN',()=>{
    const f=fixture(),ready=drive(f.data,f.taskId),before=twofasStore(ready)!,back=navigateTwofas(ready,f.taskId,'pin-test') as CurrentDataset;
    const next=confirmTwofas(back,f.taskId) as CurrentDataset;expect(twofasStore(next)!.receipts).toHaveLength(before.receipts.length);expect(twofasStore(next)!.profiles).toEqual(before.profiles);
    expect(twofasPrepared(next,f.appRef)).toBe(true);
  });

});
