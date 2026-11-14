import { describe, expect, it } from 'vitest';
import { newDataset, makeAsset, currentDatasetSchema, type CurrentDataset } from './models';
import { createEnteApp, createEnteRoot, startEnteTask, putEnteEntity, enteTask, withdrawEnteReceipt } from './enteData';
import { enteSteps } from './enteCatalog';
import { answerEnte, confirmEnte, currentEnteStep, navigateEnte, enteHelpPrompt, enteAccountReady,beginEnteChild,enteMoveReady,entePhoneSignInRecorded } from './enteEngine';
import { bindEnteGuidePath, finishEnte, undoEnte } from './enteIntegration';
import { startPhoneWorkflow,jumpPhoneStep,confirmPhoneStep } from './phoneEngine';
import { enteStore, entePrepared, enteBackupCurrent } from './enteSchemas';
import { evaluateAccess } from './securityModel';
let tick=0;const time=()=>new Date(Date.parse('2026-11-14T12:00:00Z')+ ++tick*1000).toISOString();
const valid=(d:CurrentDataset)=>{const r=currentDatasetSchema.safeParse(d);if(!r.success)throw Error(JSON.stringify(r.error.issues));return d;};
function fixture(oldOS:'ios'|'android'='ios',freshOS:'ios'|'android'='ios'){
 const d=newDataset('ja');d.assets=[{...makeAsset({kind:'account',type:'Primary email',name:'private nickname not for prompts',importance:'critical'}),id:'mail',provider:'proton',purpose:'personal'},...(['old','fresh'] as const).map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id,importance:'critical',operatingSystem:id==='old'?oldOS:freshOS}),id}))];d.guide={...d.guide,cursor:'manager-select',answers:{original:'untouched'}};
 const a=createEnteApp(d,'old',undefined,time()),t=startEnteTask(a.data,{kind:'prepare',appRef:a.appRef,origin:'map'},time());return {data:t.data,id:t.id,appRef:a.appRef};
}
function drive(data:CurrentDataset,id:string,answers:Record<string,string>={},until?:string){
 for(let i=0;i<250;i++){
  const t=enteTask(data,id)!;if(t.status==='completed')return valid(data);const step=currentEnteStep(data,t),steps=enteSteps(data,t);expect(new Set(steps.map(s=>s.id)).size).toBe(steps.length);if(step.id===until)return valid(data);
  let next;
  if(step.kind==='question'){
   const defaults:Record<string,string>={version:'supported','source-version':'supported','source-code-types':'totp',state:'offline','lock-mode':'device','file-choice':'new','backup-kind':'manual','file-secret-mode':'new','save-place':'phone','file-location':'add',destination:'add','new-version':'supported','new-state':'offline','new-lock-mode':'device','codes-state':'missing',method:'file','cross-share':'prepared','present-origin':'copy','destination-backup':'new'};
   const signIn=step.id.endsWith('/entry')?'password':step.id.endsWith('/after-password')?(t.answers['root-mfa']==='totp'?'totp':'passkey'):step.id.endsWith('/after-factor')?'data':step.id.endsWith('/credential')?step.choices![0]?.value:undefined;
   const value=(answers[step.id]==='current-app'?`store:${t.appRef}`:answers[step.id])??signIn??(step.id.startsWith('target-more:')?'done':step.id==='move-file'?step.choices![0]?.value:defaults[step.id]);if(!value)throw Error('Missing choice '+step.id);
   next=answerEnte(data,id,value,time());
  }else if(step.kind==='action'){expect(step.expected?.ja).toBeTruthy();expect(step.expected?.en).toBeTruthy();next=confirmEnte(data,id,time());}else if(step.child){const child=beginEnteChild(data,id);data=drive(child.data,child.id,answers);continue;}else throw Error('Blocked '+step.id);
  if(next===data)throw Error('No progress at '+step.id);data=valid(next as CurrentDataset);
 }
 throw Error('Did not finish');
}
function prepared(oldOS:'ios'|'android'='ios',freshOS:'ios'|'android'='ios'){
 const f=fixture(oldOS,freshOS),data=drive(f.data,f.id);expect(entePrepared(data,f.appRef)).toBe(true);
 const code=putEnteEntity(data,{id:'old-code',kind:'credential',credentialType:'totp',subjectRef:'mail',storageRef:f.appRef,roles:['second-step'],label:'old code',createdAt:time()});return {...f,data:valid(code)};
}
describe('Ente one-operation guide',()=>{
 it.each(['ios','android'] as const)('prepares %s offline app without enabling the service MFA or inventing a backup',os=>{
  const f=prepared(os);expect(f.data.assets[0].controls.mfa).toBe('unknown');expect(enteBackupCurrent(f.data,f.appRef)).toBe(false);expect(enteStore(f.data)!.roots).toEqual([]);expect(f.data.guide).toEqual(fixture().data.guide);
 });
 it.each(['manual','automatic'] as const)('creates a current %s encrypted off-phone copy and keeps secret types separate',kind=>{
  const f=prepared(),t=startEnteTask(f.data,{kind:'backup',appRef:f.appRef,origin:'map'},time()),data=drive(t.data,t.id,{'backup-kind':kind});
  expect(enteBackupCurrent(data,f.appRef)).toBe(true);expect(enteStore(data)!.files).toHaveLength(2);expect(enteStore(data)!.secrets[0].purpose).toBe(kind==='manual'?'export':'automatic');expect(enteStore(data)!.automaticSettings.length).toBe(kind==='automatic'?1:0);expect(data.guide).toEqual(f.data.guide);
  const undone=withdrawEnteReceipt(data,t.id,'file-note',time()) as CurrentDataset;expect(enteBackupCurrent(undone,f.appRef)).toBe(false);expect(enteStore(undone)!.files).toHaveLength(2);valid(undone);
 });
 it('keeps a manual file already saved off-phone as one physical object',()=>{
  const f=prepared(),t=startEnteTask(f.data,{kind:'backup',appRef:f.appRef,origin:'map'},time()),data=drive(t.data,t.id,{'save-place':'external'});
  expect(enteStore(data)!.files).toHaveLength(1);expect(enteStore(data)!.files[0].role).toBe('permanent');expect(enteBackupCurrent(data,f.appRef)).toBe(true);
 });
 for(const old of ['ios','android'] as const)for(const fresh of ['ios','android'] as const)it(`copies and tests ${old} → ${fresh}, then keeps the new code after old-phone and temporary-copy deletion`,()=>{
  const f=prepared(old,fresh),b=startEnteTask(f.data,{kind:'backup',appRef:f.appRef,origin:'map'},time()),backed=drive(b.data,b.id),m=startEnteTask(backed,{kind:'move',appRef:f.appRef,newDeviceRef:'fresh',origin:'map'},time()),data=drive(m.data,m.id);
  expect(enteTask(data,m.id)!.status).toBe('completed');expect(data.guide).toEqual(f.data.guide);const t=enteTask(data,m.id)!,proof=enteStore(data)!.proofs.find(p=>p.directReceiptRef===t.records['code:mail'])!,route=data.securityModel.routes.find(r=>r.requirements.kind==='fact'&&r.requirements.factId===proof.factRef)!;
  const at=time(),lost={...data,securityModel:{...data.securityModel,lifecycle:{...data.securityModel.lifecycle,old:{state:'deleted' as const,evidence:'user-confirmed' as const,updatedAt:at,accessResetAt:at}}}};expect(evaluateAccess(lost.securityModel,route.id,{context:'new-device',now:time()}).state).toBe('available');expect(evaluateAccess(lost.securityModel,route.id,{context:'all-devices-lost',now:time()}).state).toBe('not-applicable');
 });
 it('can defer, resume and correct an answer while keeping real files, existing codes and the main guide',()=>{
  const f=prepared(),b=startEnteTask(f.data,{kind:'backup',appRef:f.appRef,origin:'map'},time()),stopped=drive(b.data,b.id,{},'export-open'),deferred=navigateEnte(stopped,b.id,'defer',time()) as CurrentDataset;
  const resumed=startEnteTask(deferred,{kind:'backup',appRef:f.appRef,origin:'map'},time());expect(resumed.id).toBe(b.id);expect(currentEnteStep(resumed.data,enteTask(resumed.data,b.id)!).id).toBe('export-open');
  let corrected=navigateEnte(resumed.data,b.id,'backup-kind',time()) as CurrentDataset;corrected=answerEnte(corrected,b.id,'automatic',time()) as CurrentDataset;
  expect(enteTask(corrected,b.id)!.answers['file-secret-mode']).toBeUndefined();expect(corrected.guide).toEqual(f.data.guide);expect(enteStore(corrected)!.secrets).toHaveLength(1);
  const final=drive(corrected,b.id);expect(enteBackupCurrent(final,f.appRef)).toBe(true);
 });
 it('uses the exact existing Ente Account without creating another root or enabling email verification',()=>{
  const f=fixture(),root=createEnteRoot(f.data,undefined,time()),data=drive(root.data,f.id,{state:'account',root:`account:${root.rootRef}`});
  expect(enteStore(data)!.roots).toHaveLength(1);expect(enteStore(data)!.configurations[0].rootRef).toBe(root.rootRef);expect(data.assets.find(a=>a.id===root.rootRef)!.controls.mfa).toBe('unknown');
 });
 it('creates a different Account for the explicit new-Account branch without replacing an existing Account',()=>{
  const f=fixture(),existing=createEnteRoot(f.data,undefined,time()),before=structuredClone(enteStore(existing.data)!.roots[0]);
  const ready=drive(existing.data,f.id,{state:'fresh',mode:'new'},'root'),step=currentEnteStep(ready,enteTask(ready,f.id)!);
  expect(step.choices?.some(c=>c.value===`account:${existing.rootRef}`)).toBe(false);expect(answerEnte(ready,f.id,`account:${existing.rootRef}`,time())).toBe(ready);
  const done=drive(ready,f.id,{root:'add'}),store=enteStore(done)!;expect(store.roots).toHaveLength(2);expect(store.roots.find(r=>r.rootRef===existing.rootRef)).toEqual(before);expect(store.configurations.at(-1)!.rootRef).not.toBe(existing.rootRef);expect(done.assets.find(a=>a.id===existing.rootRef)!.controls.mfa).toBe('unknown');valid(done);
 });
 it('keeps unsupported versions and unavailable app locks unfinished',()=>{
  const f=fixture(),opened=confirmEnte(f.data,f.id,time()),no=answerEnte(opened,f.id,'other',time()) as CurrentDataset;expect(currentEnteStep(no,enteTask(no,f.id)!).kind).toBe('blocked');expect(entePrepared(no,f.appRef)).toBe(false);
  const locked=drive(f.data,f.id,{},'lock-mode'),forgot=answerEnte(locked,f.id,'forgot',time()) as CurrentDataset;expect(currentEnteStep(forgot,enteTask(forgot,f.id)!).kind).toBe('blocked');expect(forgot.securityModel.entities.some(e=>e.id===f.appRef)).toBe(true);
 });
 it('copies only a controlled troubleshooting context, never nicknames, answers or temporary account URLs',()=>{
  const f=prepared(),m=startEnteTask(f.data,{kind:'move',appRef:f.appRef,newDeviceRef:'fresh',origin:'map'},time()),present=drive(m.data,m.id,{'codes-state':'present'},'code:mail'),t=enteTask(present,m.id)!;
  const prompt=enteHelpPrompt(present,t,5,'ja');expect(prompt).not.toContain('private nickname');expect(prompt).toContain('最新の公式情報');expect(prompt).toContain('別の認証方法');expect(prompt).not.toContain('token=');
  expect(prompt).toContain('OS: ios');
 });
 it('reports the actual destination OS in troubleshooting and leaves nonstandard code types unfinished',()=>{
  const f=prepared('ios','android'),m=startEnteTask(f.data,{kind:'move',appRef:f.appRef,newDeviceRef:'fresh',origin:'map'},time());
  const blocked=drive(m.data,m.id,{},'source-code-types'),other=answerEnte(blocked,m.id,'other',time()) as CurrentDataset;
  expect(currentEnteStep(other,enteTask(other,m.id)!).kind).toBe('blocked');expect(enteTask(other,m.id)!.status).not.toBe('completed');
  const next=answerEnte(navigateEnte(other,m.id,'source-code-types',time()),m.id,'totp',time()) as CurrentDataset,present=drive(next,m.id,{'codes-state':'present'},'code:mail');
  expect(enteHelpPrompt(present,enteTask(present,m.id)!,0,'en')).toContain('OS: android');
 });
 it('keeps main and nested guide progress separate when opening a saved task from another guide scope',()=>{
  const f=prepared(),started=startEnteTask(f.data,{kind:'backup',appRef:f.appRef,origin:'guide',accountRef:'mail',returnCursor:'manager-select',scopePath:'/guide'},time());
  const original=drive(started.data,started.id,{},'export-open'),before={...original,guide:{...original.guide,cursor:`ente/${started.id}`}};
  const rebound=bindEnteGuidePath(before,before,'/protect/account/mail') as CurrentDataset,newId=rebound.guide.cursor.slice(5);
  expect(newId).not.toBe(started.id);expect(enteTask(rebound,started.id)).toEqual(enteTask(before,started.id));expect(enteTask(rebound,newId)?.scopePath).toBe('/protect/account/mail');expect(enteTask(rebound,newId)?.records).toEqual({});expect(rebound.guide.answers['auth:mail:scope']).toBe('/protect/account/mail');valid(rebound);
 });
});

describe('Ente Account and independent restoration',()=>{
 // This case completes several guides and validates every saved transition;
 // the default five seconds is not a per-operation performance requirement.
 it.each(['passkey','new-passkey','totp'] as const)('keeps the existing Account and separately verifies %s, password and readable data',method=>{
  const f=fixture(),root=createEnteRoot(f.data,undefined,time()),prep=drive(root.data,f.id,{state:'account',root:`account:${root.rootRef}`}),task=startEnteTask(prep,{kind:'account',appRef:f.appRef,rootRef:root.rootRef,origin:'map'},time());
  const answers={'root-password-state':'known','root-key-copy':'new','root-email-mode':'off','root-mail':'account:mail','root-mfa':method,'root-passkey-record':'add','root-factor-store':method==='totp'?`store:${f.appRef}`:'local'};
  const data=drive(task.data,task.id,answers);expect(enteStore(data)!.roots).toHaveLength(1);expect(data.assets.find(a=>a.id===root.rootRef)!.controls).toMatchObject({mfa:'verified',recovery:'verified'});expect(data.guide).toEqual(f.data.guide);
  expect(enteAccountReady(data,f.appRef)).toBe(true);const proofs=enteStore(data)!.proofs;expect(proofs.some(p=>p.kind==='account-read')).toBe(true);expect(proofs.some(p=>p.kind==='account-passkey')).toBe(method!=='totp');expect(enteStore(data)!.secrets.filter(s=>s.ownerRef===root.rootRef).map(s=>s.purpose).sort()).toEqual(['account-password','recovery-key']);
 },30000);
 it('restores an independent recorded file with the old phone unavailable and does not need its Ente Account',()=>{
  const f=prepared('ios','android'),b=startEnteTask(f.data,{kind:'backup',appRef:f.appRef,origin:'map'},time());let data=drive(b.data,b.id);data={...data,securityModel:{...data.securityModel,lifecycle:{...data.securityModel.lifecycle,old:{state:'lost',evidence:'user-confirmed',updatedAt:time()}}}};
  const task=startEnteTask(data,{kind:'restore',appRef:f.appRef,newDeviceRef:'fresh',origin:'map'},time()),restored=drive(task.data,task.id,{'restore-file-place':'external','destination-backup':`file:${enteStore(data)!.files.find(f=>f.role==='permanent')!.entityRef}`});expect(enteTask(restored,task.id)!.status).toBe('completed');expect(enteStore(restored)!.roots).toEqual([]);expect(enteStore(restored)!.files).toHaveLength(2);
 });
 it('can restore a previously unrecorded encrypted export into this app without inventing an old device or current backup coverage',()=>{
  const f=prepared(),task=startEnteTask(f.data,{kind:'restore',appRef:f.appRef,newDeviceRef:'old',origin:'map'},time());task.data.securityModel.enteV1={...enteStore(task.data)!,tasks:enteStore(task.data)!.tasks.map(t=>t.id===task.id?{...t,destinationRef:f.appRef}:t)};
  const data=drive(task.data,task.id,{'move-file':'unrecorded','restore-file-place':'external','target-more:0':'account:mail'});expect(enteTask(data,task.id)!.status).toBe('completed');expect(enteBackupCurrent(data,f.appRef)).toBe(true);expect(enteStore(data)!.files[0].snapshot).toBe('unverified-export-coverage');expect(data.assets.filter(a=>a.kind==='device')).toHaveLength(2);expect(data.securityModel.entities.find(e=>e.id==='old-code')).toBeTruthy();
 });
});

it('moves an Ente Account’s own existing TOTP, completes the actual phone task and withdraws it when its child check is undone',()=>{
 const f=fixture('ios','android'),root=createEnteRoot(f.data,undefined,time());let data=drive(root.data,f.id,{state:'account',root:`account:${root.rootRef}`});
 for(const [id,subjectRef] of [['mail-code','mail'],['root-code',root.rootRef]])data=putEnteEntity(data,{id,kind:'credential',credentialType:'totp',subjectRef,storageRef:f.appRef,roles:['second-step'],label:id,createdAt:time()});
 const main=structuredClone(data.guide);data=startPhoneWorkflow(data,'/guide','old','move') as CurrentDataset;Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',answers:{stage:'using',availability:'available',ownership:'personal',authenticator:'none'}});data=confirmPhoneStep(jumpPhoneStep(data,'move','prepare-recovery'),'move') as CurrentDataset;data=jumpPhoneStep(data,'move',`auth:${f.appRef}:ente`) as CurrentDataset;
 const m=startEnteTask(data,{kind:'move',appRef:f.appRef,newDeviceRef:'fresh',origin:'phone',phoneRef:'move'},time()),done=finishEnte(drive(m.data,m.id,{'new-state':'account','new-root':`account:${root.rootRef}`,'root-password-state':'known','root-key-copy':'new','root-email-mode':'off','root-mail':'account:mail','root-mfa':'totp','root-factor-store':'current-app'}),m.id) as CurrentDataset,target=enteTask(done,m.id)!.destinationRef!;
 expect(enteAccountReady(done,target,['old'])).toBe(true);expect(enteBackupCurrent(done,target)).toBe(true);expect(enteTask(done,m.id)!.status).toBe('completed');
 expect(done.guide).toEqual(main);expect(enteMoveReady(done,'move',f.appRef,'fresh')).toBe(true);expect(entePhoneSignInRecorded(done,'move','mail','fresh')).toBe(true);const phoneKey=enteTask(done,m.id)!.phoneRecordKey!;expect(done.deviceWorkflows[0].records[phoneKey]?.status).toBe('confirmed');
 const child=enteStore(done)!.tasks.find(t=>t.kind==='account')!,undone=undoEnte(done,child.id,'root-data-read') as CurrentDataset;expect(enteMoveReady(undone,'move',f.appRef,'fresh')).toBe(false);expect(undone.deviceWorkflows[0].records[phoneKey]?.status).not.toBe('confirmed');expect(undone.securityModel.entities.find(e=>e.id==='root-code')).toBeTruthy();valid(undone);
},20000);
