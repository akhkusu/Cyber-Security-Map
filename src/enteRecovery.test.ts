import { beforeAll, describe, expect, it } from 'vitest';
import { newDataset,makeAsset,currentDatasetSchema,guideSchema,type CurrentDataset } from './models';
import { createEnteApp,createEnteRoot,startEnteTask,enteTask,putEnteEntity,putEnteTask } from './enteData';
import { enteStore,enteConfiguration,enteBackupCurrent,entePasswordPending,enteFactCurrent,entePrepared } from './enteSchemas';
import { answerEnte,confirmEnte,currentEnteStep,beginEnteChild,navigateEnte,enteAccountReady,enteHelpPrompt } from './enteEngine';
import { createEncryptedVault,decryptVault } from './crypto';
import { makeCloudVault,addCloudRoot,chooseCloudDevice,selectedCloudInstallation } from './cloudManagers';
import { startNordSsoSession,saveNordSsoSession,selectNordSsoAccount,selectNordSsoProvider } from './nordSso';
import { nordSsoStore } from './nordSsoSchemas';
import { startProtectionGuide } from './deviceProtection';
import { protectionStore,protectionTasks } from './deviceProtectionSchemas';
import { startPhoneWorkflow } from './phoneEngine';
import { evaluateAccess } from './securityModel';
import { enteAccountWorkStatus } from './securityMapViews';
import { finishEnte,undoEnte } from './enteIntegration';
import { enteRecoveryPasswordCurrent } from './enteRecoveryData';
let tick=0;const at=()=>new Date(Date.parse('2026-11-14T13:00:00Z')+ ++tick*1000).toISOString();
const valid=(data:CurrentDataset)=>{const parsed=currentDatasetSchema.safeParse(data);if(!parsed.success)throw Error(JSON.stringify(parsed.error.issues));return data;};
function drive(data:CurrentDataset,id:string,answers:Record<string,string>={},until?:string):CurrentDataset{
 for(let i=0;i<260;i++){
  const t=enteTask(data,id)!;if(t.status==='completed')return valid(data);const s=currentEnteStep(data,t);if(s.id===until)return valid(data);
  let next;
  if(s.child){const child=beginEnteChild(data,id);next=finishEnte(drive(child.data,child.id,answers),child.id);}
  else if(s.kind==='question'){
   const defaults:Record<string,string>={version:'supported',state:'account',root:`account:${t.rootRef??enteStore(data)!.roots[0].rootRef}`,'lock-mode':'device','file-choice':'new','backup-kind':'manual','file-secret-mode':'new','save-place':'external','file-location':'add','root-password-state':'known','root-email-mode':'off','root-mail':'account:mail','root-mfa':'passkey','root-factor-store':'local','recovery-purpose':'forgot','recovery-place':'app','recovery-photos':'yes','recovery-locker':'yes','recovery-key-state':'available','recovery-mail':'account:mail','recovery-paper':'new','recovery-result':'changed','recovery-used-factor':'none','recovery-device':'device:fresh','recovery-entry':'password','recovery-screen':'key','recovery-extra-state':'usable'};
   const value=answers[s.id]??(['root-key-copy','root-passkey-record'].includes(s.id)?s.choices![0].value:defaults[s.id]);if(!value)throw Error('Missing recovery choice '+s.id);
   next=answerEnte(data,id,value,at());
  }else if(s.kind==='action')next=confirmEnte(data,id,at());else throw Error('Blocked recovery '+s.id);
  if(next===data)throw Error('No recovery progress at '+s.id);if(s.kind==='action'&&currentEnteStep(next,enteTask(next,id)!).id===s.id){const d=next as CurrentDataset,receipt=enteTask(d,id)!.records[s.id],facts=enteStore(d)!.proofs.filter(p=>p.directReceiptRef===receipt).map(p=>p.factRef),routes=d.securityModel.routes.filter(r=>r.requirements.kind==='fact'&&facts.includes(r.requirements.factId));throw Error('The recorded action is still unconfirmed: '+s.id+' '+JSON.stringify(routes.map(r=>evaluateAccess(d.securityModel,r.id,{context:'no-existing-session',now:at()}))));}data=valid(next as CurrentDataset);
 }
 throw Error('Recovery did not finish at '+currentEnteStep(data,enteTask(data,id)!).id);
}
type Fixture={data:CurrentDataset;appRef:string;rootRef:string};let base:Fixture;
beforeAll(()=>{
 let data=newDataset('ja');data.assets=[{...makeAsset({kind:'device',type:'Smartphone',name:'Old phone',importance:'critical',operatingSystem:'ios'}),id:'old'},{...makeAsset({kind:'device',type:'Smartphone',name:'Fresh Android',importance:'critical',operatingSystem:'android'}),id:'fresh'},{...makeAsset({kind:'account',type:'Primary email',name:'PRIVATE MAIL LABEL',importance:'critical'}),provider:'proton',purpose:'personal',id:'mail'}];data.guide={...data.guide,cursor:'manager-select',answers:{private:'never copied'},history:['start']};
 const app=createEnteApp(data,'old',undefined,at()),root=createEnteRoot(app.data,undefined,at()),prepare=startEnteTask(root.data,{kind:'prepare',appRef:app.appRef,rootRef:root.rootRef,origin:'map'},at());data=drive(prepare.data,prepare.id);
 data=putEnteEntity(data,{id:'mail-code',kind:'credential',credentialType:'totp',subjectRef:'mail',storageRef:app.appRef,roles:['second-step'],label:'Existing other website code',createdAt:at()});
 const account=startEnteTask(data,{kind:'account',appRef:app.appRef,rootRef:root.rootRef,origin:'map'},at());data=drive(account.data,account.id);expect(enteAccountReady(data,app.appRef)).toBe(true);base={data,appRef:app.appRef,rootRef:root.rootRef};
},20000);
const fixture=()=>structuredClone(base);
const start=(f:Fixture)=>startEnteTask(f.data,{kind:'recovery',appRef:f.appRef,rootRef:f.rootRef,origin:'map'},at());
describe('Ente Account password recovery',()=>{
 it('prepares a candidate without changing the current password, then treats an uncertain request as pending',()=>{
  const f=fixture(),oldRoot=structuredClone(enteStore(f.data)!.roots[0]),t=start(f),before=drive(t.data,t.id,{},'recovery-password-request');
  expect(enteStore(before)!.roots[0]).toMatchObject({passwordRef:oldRoot.passwordRef,epoch:oldRoot.epoch,recoveryRef:oldRoot.recoveryRef});expect(enteTask(before,t.id)!.recoveryStateV1!.password!.candidateRef).not.toBe(oldRoot.passwordRef);
  const requested=confirmEnte(before,t.id,at()) as CurrentDataset;expect(entePasswordPending(requested.securityModel,f.rootRef)).toBe(true);expect(enteAccountReady(requested,f.appRef)).toBe(false);expect(enteStore(requested)!.roots[0].epoch).toBe(oldRoot.epoch);
  expect(enteAccountWorkStatus(requested,f.rootRef,'ja')?.label).toBe('復旧の結果を確認');expect(enteAccountWorkStatus(navigateEnte(requested,t.id,'cancel',at()),f.rootRef,'en')?.label).toBe('Check the recovery result');
  const originalRead=enteStore(f.data)!.proofs.find(p=>p.kind==='account-read')!;expect(enteFactCurrent(requested.securityModel,requested.securityModel.facts.find(x=>x.id===originalRead.factRef)!)).toBe(false);
  const undone=undoEnte(requested,t.id,'recovery-password-request') as CurrentDataset;expect(entePasswordPending(undone.securityModel,f.rootRef)).toBe(true);expect(currentEnteStep(navigateEnte(undone,t.id,'back',at()),enteTask(navigateEnte(undone,t.id,'back',at()),t.id)!).id).not.toBe('recovery-password-request');
 });
 it('confirms the actual change once, preserves the key, exports and other-service codes, and verifies readable data',()=>{
  const f=fixture(),oldRoot=structuredClone(enteStore(f.data)!.roots[0]),oldFiles=structuredClone(enteStore(f.data)!.files),oldKey=structuredClone(enteStore(f.data)!.secrets.find(s=>s.entityRef===oldRoot.recoveryRef)),main=structuredClone(f.data.guide),t=start(f);
  let data=drive(t.data,t.id,{},'recovery-password-test');const changed=enteStore(data)!.roots[0];expect(changed.epoch).not.toBe(oldRoot.epoch);expect(changed.passwordRef).not.toBe(oldRoot.passwordRef);const epoch=changed.epoch;
  const passwordTest=currentEnteStep(data,enteTask(data,t.id)!);expect(passwordTest.action!.ja).toContain('まだ認証せずに開いたまま');expect(passwordTest.action!.en).toContain('leave it open without completing it');
  data=confirmEnte(data,t.id,at()) as CurrentDataset;expect(enteStore(data)!.roots[0].epoch).toBe(epoch);data=drive(data,t.id);
  expect(enteRecoveryPasswordCurrent(data,enteTask(data,t.id)!)).toBe(true);expect(enteAccountReady(data,f.appRef)).toBe(true);expect(data.guide).toEqual(main);expect(enteStore(data)!.roots[0].recoveryRef).toBe(oldRoot.recoveryRef);expect(enteStore(data)!.files).toEqual(oldFiles);expect(enteBackupCurrent(data,f.appRef)).toBe(true);expect(data.securityModel.entities.find(e=>e.id==='mail-code')).toEqual(f.data.securityModel.entities.find(e=>e.id==='mail-code'));expect(data.securityModel.lifecycle['mail-code']).toBeUndefined();expect(enteStore(data)!.secrets.find(s=>s.entityRef===oldKey!.entityRef)?.entityRef).toBe(oldKey!.entityRef);
  expect(enteAccountWorkStatus(data,f.rootRef,'ja')).toBeUndefined();
  const undone=undoEnte(data,t.id,'recovery-change-confirmed') as CurrentDataset;expect(enteStore(undone)!.roots[0].passwordRef).toBe(changed.passwordRef);expect(enteStore(undone)!.roots[0].epoch).toBe(epoch);
 },20000);
 it('uses a confirmed new password to resolve an error without submitting a second change',()=>{
  const f=fixture(),t=start(f);let data=drive(t.data,t.id,{'recovery-result':'uncertain'},'recovery-password-test');expect(enteTask(data,t.id)!.recoveryStateV1!.password!.phase).toBe('requested');const original=enteStore(data)!.roots[0].epoch;
  data=confirmEnte(data,t.id,at()) as CurrentDataset;expect(enteStore(data)!.roots[0].epoch).not.toBe(original);const epoch=enteStore(data)!.roots[0].epoch;data=drive(data,t.id,{'recovery-result':'uncertain'});expect(enteStore(data)!.roots[0].epoch).toBe(epoch);expect(enteTask(data,t.id)!.history.filter(x=>x==='recovery-password-request')).toHaveLength(1);
 },20000);
 it('keeps an unavailable recovery key unfinished before changing any password',()=>{
  const f=fixture(),root=structuredClone(enteStore(f.data)!.roots[0]),t=start(f),data=drive(t.data,t.id,{},'recovery-key-state'),missing=answerEnte(data,t.id,'missing',at()) as CurrentDataset;
  expect(currentEnteStep(missing,enteTask(missing,t.id)!).kind).toBe('blocked');expect(enteStore(missing)!.roots[0]).toMatchObject({passwordRef:root.passwordRef,epoch:root.epoch,recoveryRef:root.recoveryRef});expect(enteTask(missing,t.id)!.recoveryStateV1?.password).toBeUndefined();expect(missing.guide).toEqual(f.data.guide);
 });
 it('restores the password from an independent key and mailbox with the old phone unavailable',()=>{
  const f=fixture();f.data.securityModel.lifecycle.old={state:'lost',evidence:'user-confirmed',updatedAt:at()};const keyId='independent-key';f.data=putEnteEntity(f.data,{id:keyId,kind:'security-key',label:'Independent physical key',transports:['usb-c'],createdAt:at()});const credential=f.data.securityModel.entities.find(e=>e.kind==='credential'&&e.credentialType==='passkey'&&e.subjectRef===f.rootRef)!;if(credential.kind!=='credential')throw Error('No passkey');f.data=putEnteEntity(f.data,{...credential,storageRef:keyId});
  const t=start(f),done=drive(t.data,t.id,{'recovery-place':'web','recovery-screen':'passkey','recovery-extra-state':'usable','recovery-used-factor':`credential:${credential.id}`});expect(enteTask(done,t.id)!.status).toBe('completed');expect(enteRecoveryPasswordCurrent(done,enteTask(done,t.id)!)).toBe(true);expect(enteConfiguration(done,f.appRef)!.rootRef).toBe(f.rootRef);expect(done.securityModel.lifecycle.old.state).toBe('lost');expect(done.guide).toEqual(f.data.guide);
 },20000);
 it('does not infer Recovery key or MFA use when the actual additional method is unrecorded',()=>{
  const f=fixture(),t=start(f),done=drive(t.data,t.id,{'recovery-place':'web','recovery-used-factor':'other'}),task=enteTask(done,t.id)!,root=enteStore(done)!.roots[0],proofs=enteStore(done)!.proofs.filter(p=>p.directReceiptRef===task.records['recovery-data-read']);expect(task.status).toBe('completed');expect(proofs.map(p=>done.securityModel.routes.find(r=>r.requirements.kind==='fact'&&r.requirements.factId===p.factRef)!.purpose).sort()).toEqual(['decrypt','sign-in']);for(const proof of proofs)expect(done.securityModel.facts.find(f=>f.id===proof.factRef)!.requiredRefs).not.toContain(root.recoveryRef);
 },20000);
});

describe('Ente factor recovery distinguishes a bypass from a removal',()=>{
 for(const type of ['passkey','totp'] as const)it(type==='passkey'?'preserves registered passkeys when recovering one login':'revokes only this Root’s TOTP copies after confirmed disabling',()=>{
  const f=fixture();f.data=putEnteEntity(f.data,{id:'root-totp',kind:'credential',credentialType:'totp',subjectRef:f.rootRef,storageRef:f.appRef,roles:['second-step'],label:'Ente Account TOTP',createdAt:at()});const key=f.data.securityModel.entities.find(e=>e.kind==='credential'&&e.credentialType==='passkey')!,t=start(f),data=drive(t.data,t.id,{'recovery-purpose':'factor','recovery-place':'web','recovery-screen':type,'recovery-extra-state':'lost'},'recovery-factor-confirmed'),confirmed=confirmEnte(data,t.id,at()) as CurrentDataset;
  expect(enteTask(confirmed,t.id)!.recoveryStateV1!.factor!.phase).toBe('recovered');expect(confirmed.securityModel.lifecycle[key.id]).toBeUndefined();expect(confirmed.securityModel.entities.find(e=>e.id===key.id)).toEqual(key);expect(confirmed.securityModel.lifecycle['root-totp']?.state).toBe(type==='totp'?'revoked':undefined);expect(confirmed.securityModel.lifecycle['mail-code']).toBeUndefined();expect(confirmed.guide).toEqual(f.data.guide);
 });
 it('re-protects the same Account on a new phone after web recovery without reusing the lost phone',()=>{
  const f=fixture();f.data.securityModel.lifecycle.old={state:'lost',evidence:'user-confirmed',updatedAt:at()};f.data.assets.push({...makeAsset({kind:'device',type:'Computer',name:'Usable Mac',importance:'critical',operatingSystem:'macos'}),id:'web'});
  f.data=putEnteEntity(f.data,{id:'root-totp',kind:'credential',credentialType:'totp',subjectRef:f.rootRef,storageRef:f.appRef,roles:['second-step'],label:'Lost Ente Account TOTP',createdAt:at()});
  const originalRoot=structuredClone(enteStore(f.data)!.roots[0]),t=start(f),done=drive(t.data,t.id,{'recovery-purpose':'factor','recovery-place':'web','recovery-device':'device:web','recovery-screen':'totp','recovery-extra-state':'lost','recovery-used-factor':'none','recovery-protection-device':'device:fresh','recovery-protection-app':'new',state:'fresh','root-mfa':'new-passkey'}),task=enteTask(done,t.id)!;
  expect(task.status).toBe('completed');expect(task.newDeviceRef).toBe('web');expect(task.resources.protectionDevice).toBe('fresh');expect(entePrepared(done,task.destinationRef!)).toBe(true);expect(enteConfiguration(done,task.destinationRef!)!.rootRef).toBe(f.rootRef);expect(enteAccountReady(done,task.destinationRef!,['old'])).toBe(true);expect(enteStore(done)!.roots[0]).toMatchObject({passwordRef:originalRoot.passwordRef,epoch:originalRoot.epoch,recoveryRef:originalRoot.recoveryRef});expect(done.securityModel.lifecycle.old.state).toBe('lost');expect(done.securityModel.lifecycle['mail-code']).toBeUndefined();expect(done.guide).toEqual(f.data.guide);
  const read=enteStore(done)!.proofs.filter(p=>p.kind==='account-read').at(-1)!,fact=done.securityModel.facts.find(f=>f.id===read.factRef)!;expect(fact.requiredRefs).toContain('fresh');expect(fact.requiredRefs).not.toContain('old');expect(fact.observedWithoutRefs).toContain('old');
 },20000);
 it('preserves a different Account or offline codes during replacement preparation',()=>{
  const f=fixture(),app=createEnteApp(f.data,'fresh',undefined,at()),task=startEnteTask(app.data,{kind:'prepare',appRef:app.appRef,rootRef:f.rootRef,origin:'map'},at()),atState=drive(task.data,task.id,{},'state');
  for(const choice of ['offline','different']){
   const kept=answerEnte(atState,task.id,choice,at()) as CurrentDataset;expect(currentEnteStep(kept,enteTask(kept,task.id)!).id).toBe('preserve-existing-app');expect(enteConfiguration(kept,app.appRef)).toBeUndefined();expect(enteStore(kept)!.roots).toEqual(enteStore(f.data)!.roots);expect(kept.securityModel.entities.find(e=>e.id==='mail-code')).toEqual(f.data.securityModel.entities.find(e=>e.id==='mail-code'));
  }
 });
 it('does not submit factor recovery again when its confirmation record is undone',()=>{
  const f=fixture(),t=start(f),before=drive(t.data,t.id,{'recovery-purpose':'factor','recovery-place':'web','recovery-screen':'totp','recovery-extra-state':'lost'},'recovery-factor-request'),requested=confirmEnte(before,t.id,at()) as CurrentDataset,undone=undoEnte(requested,t.id,'recovery-factor-request') as CurrentDataset;
  expect(enteTask(undone,t.id)!.recoveryStateV1!.factor!.phase).toBe('requested');expect(currentEnteStep(undone,enteTask(undone,t.id)!).id).toBe('recovery-factor-confirmed');expect(undone.guide).toEqual(f.data.guide);
  const back=navigateEnte(undone,t.id,'recovery-screen',at());expect(currentEnteStep(back,enteTask(back,t.id)!).id).not.toBe('recovery-screen');expect(answerEnte(back,t.id,'passkey',at())).toBe(back);expect(enteTask(back,t.id)!.recoveryStateV1!.factor!.type).toBe('totp');
 });
 it('does not reuse an old TOTP proof after its disabling request may have reached Ente',()=>{
  const f=fixture(),account=startEnteTask(f.data,{kind:'account',appRef:f.appRef,rootRef:f.rootRef,origin:'map'},at(),true),protectedData=drive(account.data,account.id,{'root-mfa':'totp','root-factor-store':`store:${f.appRef}`}),totpProof=enteStore(protectedData)!.proofs.filter(p=>p.kind==='account-read').at(-1)!,fact=protectedData.securityModel.facts.find(f=>f.id===totpProof.factRef)!;expect(enteFactCurrent(protectedData.securityModel,fact)).toBe(true);
  const t=start({...f,data:protectedData}),atRequest=drive(t.data,t.id,{'recovery-purpose':'factor','recovery-place':'web','recovery-screen':'totp','recovery-extra-state':'lost'},'recovery-factor-request'),requested=confirmEnte(atRequest,t.id,at()) as CurrentDataset;expect(enteFactCurrent(requested.securityModel,fact)).toBe(false);const credential=fact.requiredRefs.find(ref=>requested.securityModel.entities.some(e=>e.id===ref&&e.kind==='credential'&&e.subjectRef===f.rootRef&&e.credentialType==='totp'))!;expect(requested.securityModel.lifecycle[credential]?.state).not.toBe('revoked');expect(requested.securityModel.lifecycle['mail-code']).toBeUndefined();
 },20000);
 it('preserves recovery metadata and opaque fields in the existing encrypted backup, and rejects incomplete known states',async()=>{
  const f=fixture(),t=start(f),prepared=drive(t.data,t.id,{},'recovery-password-request'),task=enteTask(prepared,t.id)!,withOpaque=putEnteTask(prepared,{...task,recoveryStateV1:{...task.recoveryStateV1!,futureField:{keep:['opaque']}},opaqueRecovery:{keep:true}}),sealed=await createEncryptedVault('application storage fixture phrase',withOpaque),opened=(await decryptVault(sealed.envelope,'application storage fixture phrase')).data;
  expect(opened).toEqual(withOpaque);const invalid=structuredClone(withOpaque);(invalid.securityModel.enteV1 as {tasks:unknown[]}).tasks=enteStore(invalid)!.tasks.map(v=>v.id===t.id?{...v,recoveryStateV1:{...v.recoveryStateV1,password:{...v.recoveryStateV1!.password,phase:'applied'}}}:v);expect(currentDatasetSchema.safeParse(invalid).success).toBe(false);expect(()=>start({...f,data:invalid})).toThrow();expect(enteStore(withOpaque)!.tasks.find(v=>v.id===t.id)!.recoveryStateV1!.password!.phase).toBe('prepared');
 });
 it('reports the actual web recovery device without private Account labels or answers',()=>{
  const f=fixture();f.data.assets.push({...makeAsset({kind:'device',type:'Computer',name:'PRIVATE DEVICE LABEL',importance:'critical',operatingSystem:'windows'}),id:'web'});const t=start(f),data=drive(t.data,t.id,{'recovery-place':'web','recovery-device':'device:web'},'recovery-web-open'),task=enteTask(data,t.id)!;task.answers.private='PRIVATE ANSWER';
  for(const language of ['ja','en'] as const){const prompt=enteHelpPrompt(data,task,0,language);expect(prompt).toContain('OS: windows');expect(prompt).not.toMatch(/PRIVATE|never copied/);expect(prompt).toContain('https://');}
 });
 it('records a Linux browser device using the existing operating-system schema',()=>{
  const f=fixture(),t=start(f),atDevice=drive(t.data,t.id,{'recovery-place':'web'},'recovery-device'),next=answerEnte(atDevice,t.id,'add:ubuntu',at()) as CurrentDataset;valid(next);const device=next.assets.find(a=>a.id===enteTask(next,t.id)!.newDeviceRef)!;expect(device.operatingSystem).toBe('ubuntu');expect(device.name).toBe('Linux');expect(enteConfiguration(next,f.appRef)!.rootRef).toBe(f.rootRef);
 });
 it('returns from forgotten-password recovery to the exact original Account task without repeating its checks',()=>{
  const f=fixture(),parent=startEnteTask(f.data,{kind:'account',appRef:f.appRef,rootRef:f.rootRef,origin:'map'},at(),true),atQuestion=drive(parent.data,parent.id,{},'root-password-state'),forgot=answerEnte(atQuestion,parent.id,'forgot',at()),child=beginEnteChild(forgot,parent.id);
  expect(enteTask(child.data,child.id)!.answers['recovery-purpose']).toBe('forgot');const recovered=drive(child.data,child.id),returned=finishEnte(recovered,child.id) as CurrentDataset;expect(enteTask(returned,parent.id)!.status).toBe('completed');expect(enteTask(returned,parent.id)!.answers['root-password-state']).toBe('forgot');expect(returned.guide).toEqual(f.data.guide);expect(enteAccountReady(returned,f.appRef)).toBe(true);
 },20000);
 for(const scope of ['nord','protection'] as const)it(`finishes backup and Account children inside the same ${scope} guide, preserving the main guide and phone task`,()=>{
  const f=fixture();f.data.assets.find(a=>a.id==='mail')!.provider='google';let data=startPhoneWorkflow(f.data,'/guide','old','move',at()) as CurrentDataset;data.deviceWorkflows[0].newDeviceRef='fresh';const main=structuredClone(data.guide),phone=structuredClone(data.deviceWorkflows);let path:string,scopeId:string;
  if(scope==='nord'){
   data=makeCloudVault(data,'nordpass','ja');const vault=data.guide.managerId!;data=addCloudRoot(data,vault,'personal',true) as CurrentDataset;const root=data.securityModel.entities.find(e=>e.id===vault)!.authenticationAccountRef as string;data=selectNordSsoAccount(selectNordSsoProvider(data,root,'google'),root,'mail') as CurrentDataset;data=chooseCloudDevice(data,vault,'old') as CurrentDataset;const session=startNordSsoSession({...data,guide:main},selectedCloudInstallation(data,vault)!.id,'/phone/move');data=session.data;scopeId=session.id!;path=`/nord-connection/${scopeId}`;
  }else{const task=startProtectionGuide(data,'old');data=task.data;scopeId=task.id;path=`/protect/account/${scopeId}`;}
  const started=startEnteTask(data,{kind:'recovery',appRef:f.appRef,rootRef:f.rootRef,origin:'guide',accountRef:'mail',scopePath:path,returnCursor:'manager-select'},at());data=started.data;
  const childGuide=guideSchema.parse({...main,cursor:`ente/${started.id}`,answers:{...main.answers,'auth:mail:app':f.appRef,'auth:mail:scope':path}});
  if(scope==='nord')data=saveNordSsoSession(data,{...data,guide:{...childGuide,nordSsoSessionV1:scopeId}},scopeId) as CurrentDataset;
  else{const store=protectionStore(data)!;data={...data,securityModel:{...data.securityModel,deviceProtectionV1:{...store,tasks:store.tasks.map(t=>t.id===scopeId?{...t,accountRef:'mail',childRecipe:'recovery',childGuide}:t)}}};}
  const storage=enteStore(data)!.files[0].storageRef;data.securityModel.lifecycle[storage]={state:'unavailable',evidence:'user-confirmed',updatedAt:at()};valid(data);const completed=drive(data,started.id),returned=finishEnte(completed,started.id) as CurrentDataset;
  expect(returned.guide).toEqual(main);expect(returned.deviceWorkflows).toEqual(phone);const savedGuide=guideSchema.parse(scope==='nord'?nordSsoStore(returned)!.sessions.find(s=>s.id===scopeId)!.guide:protectionTasks(returned).find(t=>t.id===scopeId)!.childGuide);expect(savedGuide.cursor).toBe('manager-select');expect(enteTask(returned,started.id)!.status).toBe('completed');expect(enteStore(returned)!.tasks.some(t=>t.kind==='backup'&&t.enteReturnV1&&t.status==='completed')).toBe(true);valid(returned);
 },20000);
});
