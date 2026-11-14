import { describe, expect, it } from 'vitest';
import { currentDatasetSchema, DataUpgradeConflict, makeAsset, newDataset, type CurrentDataset } from './models';
import { createEncryptedVault, decryptVault } from './crypto';
import { mapAffectedItems,mapConnections } from './securityMapViews';
import { removeEntry } from './removeEntry';
import { setMapArchive } from './mapRecords';
import { startAccessPlan } from './accessPlans';
import { startProtectionGuide } from './deviceProtection';
import { evaluateAccess } from './securityModel';
import { createEnteApp, createEnteRoot, startEnteTask, appendEnteReceipt, recordEnteControl, recordEnteLock, recordEnteStorage, makeEnteSecret, recordEnteRootSecret, saveEnteFile, copyEnteFile, confirmEnteExternalFile, recordEnteProof, withdrawEnteReceipt, putEnteEntity } from './enteData';
import { enteStore, enteConfiguration, entePrepared, enteReceiptCurrent, enteFileCurrent, enteBackupCurrent, enteSnapshot } from './enteSchemas';

let tick=0;const stamp=()=>new Date(Date.parse('2026-11-14T09:00:00.000Z')+ ++tick*1000).toISOString();
function valid(data:CurrentDataset){const parsed=currentDatasetSchema.safeParse(data);if(!parsed.success)throw new Error(JSON.stringify(parsed.error.issues));return data;}
function fixture(os:'ios'|'android'='ios'){
  const base=newDataset('ja');base.assets=[...['old','fresh'].map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id,operatingSystem:os,importance:'critical'}),id})),{...makeAsset({kind:'account',type:'Primary email',name:'Private mail',importance:'critical'}),id:'mail',provider:'proton',purpose:'personal'},{...makeAsset({kind:'backup',type:'Backup disk',name:'Independent disk',importance:'critical'}),id:'disk'}];
  base.guide={...base.guide,cursor:'manager-select',accountId:'mail',answers:{original:'keep'},opaque:{untouched:true}};
  const a=createEnteApp(base,'old',undefined,stamp()),t=startEnteTask(a.data,{kind:'prepare',appRef:a.appRef,origin:'map'},stamp());return {data:valid(t.data),appRef:a.appRef,id:t.id};
}
function observe(data:CurrentDataset,id:string,stepId:string,refs:string[],requires:string[]=[]){return appendEnteReceipt(data,id,{stepId,refs,requires},stamp());}
function prepare(data:CurrentDataset,id:string,appRef:string,mode:'device'|'pin'|'password'='device',rootRef?:string){
  const app=data.securityModel.entities.find(e=>e.id===appRef)!;if(app.kind!=='installation')throw new Error('fixture app');const refs=[appRef,app.deviceRef,...(rootRef?[rootRef]:[])];
  const open=observe(data,id,`open:${appRef}`,refs);let next=recordEnteControl(open.data,open.receipt,appRef,'opened');next=recordEnteControl(next,open.receipt,app.deviceRef,'screenLock');
  const lock=observe(next,id,`lock:${appRef}`,refs);next=recordEnteLock(lock.data,lock.receipt,appRef,mode);
  const config=observe(next,id,`storage:${appRef}`,refs);return valid(recordEnteStorage(config.data,config.receipt,appRef,rootRef?'account':'offline',rootRef));
}
function lifecycle(data:CurrentDataset,id:string,state:'deleted'|'lost'|'revoked'){
  const at=stamp();return {...data,securityModel:{...data.securityModel,lifecycle:{...data.securityModel.lifecycle,[id]:{state,evidence:'user-confirmed' as const,updatedAt:at,accessResetAt:at}}}};
}
function backup(data:CurrentDataset,id:string,appRef:string){
  const note=observe(data,id,'file-secret',[appRef,'old']),made=makeEnteSecret(note.data,note.receipt,appRef,'export','paper');
  const saved=observe(made.data,id,'file-save',[appRef,'old',made.secretRef],[note.receipt.id]),file=saveEnteFile(saved.data,saved.receipt,appRef,made.secretRef,'old','export');
  const copied=observe(file.data,id,'file-copy',[file.fileRef,'disk'],[saved.receipt.id]),copy=copyEnteFile(copied.data,copied.receipt,file.fileRef,'disk','permanent');
  return {data:valid(copy.data),secretRef:made.secretRef,fileRef:copy.fileRef,sourceRef:file.fileRef};
}
function newCodeFixture(accountMode=false){
  const f=fixture();let data=prepare(f.data,f.id,f.appRef);let rootRef:string|undefined;
  if(accountMode){const root=createEnteRoot(data,undefined,stamp());data=root.data;rootRef=root.rootRef;}
  const app=createEnteApp(data,'fresh',undefined,stamp()),task=startEnteTask(app.data,{kind:'move',appRef:f.appRef,origin:'map',newDeviceRef:'fresh'},stamp());
  data=prepare(task.data,task.id,app.appRef,'device',rootRef);
  const group='shared-registration';for(const [id,storageRef] of [['original-code',f.appRef],['new-code',app.appRef]])data=putEnteEntity(data,{id,kind:'credential',credentialType:'totp',subjectRef:'mail',storageRef,replicaGroupId:group,roles:['second-step'],label:id,createdAt:stamp()});
  const r=observe(data,task.id,'code:mail',[app.appRef,'fresh','mail','new-code']),config=enteConfiguration(r.data,app.appRef)!;
  data=recordEnteProof(r.data,r.receipt,{kind:'totp-code',appRef:app.appRef,configRef:config.id},{label:'New code accepted',targetRef:'mail',purpose:'second-step',context:'new-device',requiredRefs:[app.appRef,'fresh','mail','new-code']});
  return {...f,data:valid(data),moveId:task.id,destinationRef:app.appRef,rootRef,route:data.securityModel.routes.at(-1)!.id};
}

describe('Ente facts, physical copies and actual configuration identity',()=>{
  it.each(['ios','android'] as const)('selects %s without inventing an Account, lock, backup or service MFA',os=>{
    const f=fixture(os);expect(f.data.securityModel.revision).toBe(12);expect(entePrepared(f.data,f.appRef)).toBe(false);expect(enteStore(f.data)!.roots).toHaveLength(0);expect(f.data.assets.find(a=>a.id==='mail')!.controls.mfa).toBe('unknown');
    const ready=prepare(f.data,f.id,f.appRef);expect(entePrepared(ready,f.appRef)).toBe(true);expect(enteConfiguration(ready,f.appRef)?.mode).toBe('offline');expect(enteBackupCurrent(ready,f.appRef)).toBe(false);expect(ready.guide).toEqual(f.data.guide);
  });
  it('shares only the actual selected Ente Account and dataset while keeping app confirmations on their own phones',()=>{
    const f=fixture(),a=createEnteRoot(f.data,undefined,stamp()),b=createEnteRoot(a.data,undefined,stamp()),reused=createEnteRoot(b.data,a.rootRef,stamp());
    expect(enteStore(reused.data)!.roots).toHaveLength(2);expect(a.rootRef).not.toBe(b.rootRef);expect(reused.data.securityModel.relations).toHaveLength(0);
    const ready=prepare(reused.data,f.id,f.appRef,'device',a.rootRef),newApp=createEnteApp(ready,'fresh',undefined,stamp()),t=startEnteTask(newApp.data,{kind:'prepare',appRef:newApp.appRef,origin:'map'},stamp());
    expect(entePrepared(t.data,newApp.appRef)).toBe(false);const next=prepare(t.data,t.id,newApp.appRef,'device',a.rootRef);
    expect(enteConfiguration(next,f.appRef)!.datasetRef).toBe(enteConfiguration(next,newApp.appRef)!.datasetRef);expect(enteStore(next)!.roots.find(r=>r.rootRef===b.rootRef)!.products).toEqual([]);
  });
  it('preserves other valid confirmations of the same physical configuration, and does not restore old storage after a real change',()=>{
    const f=fixture(),ready=prepare(f.data,f.id,f.appRef),before=enteConfiguration(ready,f.appRef)!;
    const review=startEnteTask(ready,{kind:'prepare',appRef:f.appRef,origin:'map'},stamp(),true),r=observe(review.data,review.id,'storage-review',[f.appRef,'old']);
    let next=recordEnteStorage(r.data,r.receipt,f.appRef,'offline');expect(enteConfiguration(next,f.appRef)).toEqual(before);
    next=withdrawEnteReceipt(next,review.id,'storage-review',stamp()) as CurrentDataset;expect(entePrepared(next,f.appRef)).toBe(true);
    const root=createEnteRoot(next,undefined,stamp()),changed=observe(root.data,review.id,'storage-change',[f.appRef,'old',root.rootRef]);next=recordEnteStorage(changed.data,changed.receipt,f.appRef,'account',root.rootRef);
    const current=enteConfiguration(next,f.appRef)!;expect(current.epoch).not.toBe(before.epoch);next=withdrawEnteReceipt(next,review.id,'storage-change',stamp()) as CurrentDataset;
    expect(enteConfiguration(next,f.appRef)!.id).toBe(current.id);expect(entePrepared(next,f.appRef)).toBe(false);expect(next.securityModel.relations.filter(l=>l.kind==='synced-via'&&l.evidence==='user-confirmed')).toHaveLength(0);valid(next);
  });
  it('keeps the new physical PIN after undo instead of reviving a prior lock confirmation',()=>{
    const f=fixture(),ready=prepare(f.data,f.id,f.appRef,'pin'),oldLock=enteStore(ready)!.locks[0];
    const t=startEnteTask(ready,{kind:'prepare',appRef:f.appRef,origin:'map'},stamp(),true),r=observe(t.data,t.id,'new-pin',[f.appRef,'old']);let data=recordEnteLock(r.data,r.receipt,f.appRef,'pin',true);
    const current=enteStore(data)!.profiles[0].lockRef;expect(data.securityModel.lifecycle[oldLock.credentialRef!].state).toBe('revoked');expect(entePrepared(data,f.appRef)).toBe(true);
    data=withdrawEnteReceipt(data,t.id,'new-pin',stamp()) as CurrentDataset;expect(enteStore(data)!.profiles[0].lockRef).toBe(current);expect(entePrepared(data,f.appRef)).toBe(false);valid(data);
  });
  it('records separate physical JSON copies and keeps an external backup when the source or transfer copy is removed',()=>{
    const f=fixture(),b=backup(prepare(f.data,f.id,f.appRef),f.id,f.appRef),transfer=observe(b.data,f.id,'transfer',[b.fileRef,'fresh']),received=copyEnteFile(transfer.data,transfer.receipt,b.fileRef,'fresh','transfer');
    let data=lifecycle(received.data,b.sourceRef,'deleted');data=lifecycle(data,received.fileRef,'deleted');data=lifecycle(data,'old','deleted');valid(data);
    expect(enteStore(data)!.files).toHaveLength(3);expect(new Set(enteStore(data)!.files.map(f=>f.groupRef)).size).toBe(1);expect(enteBackupCurrent(data,f.appRef)).toBe(true);expect(enteFileCurrent(data.securityModel,received.fileRef)).toBe(false);expect(data.securityModel.routes).toHaveLength(0);expect(mapConnections(data).some(c=>c.recoveryAssetId===b.fileRef&&c.historical)).toBe(true);expect(mapAffectedItems(data,b.sourceRef,'ja').some(n=>n.id===b.fileRef)).toBe(false);
    data=lifecycle(data,'disk','lost');expect(enteBackupCurrent(data,f.appRef)).toBe(false);
  });
  it('reuses an explicitly selected file passphrase and preserves the same key across separate paper reminders',()=>{
    const f=fixture(),b=backup(prepare(f.data,f.id,f.appRef),f.id,f.appRef),first=enteStore(b.data)!.secrets[0].copies[0].storageRef;
    let data=lifecycle(b.data,first,'lost');expect(enteBackupCurrent(data,f.appRef)).toBe(false);
    const r=observe(data,f.id,'another-reminder',[f.appRef,b.secretRef]),copy=makeEnteSecret(r.data,r.receipt,f.appRef,'automatic','paper',b.secretRef);data=copy.data;
    expect(copy.secretRef).toBe(b.secretRef);expect(enteStore(data)!.secrets).toHaveLength(1);expect(enteStore(data)!.secrets[0].copies).toHaveLength(2);expect(enteBackupCurrent(data,f.appRef)).toBe(true);valid(data);
  });
  it('does not duplicate an export already stored off the phone, while automatic folders require a separate retained copy',()=>{
    const f=fixture(),ready=prepare(f.data,f.id,f.appRef),r=observe(ready,f.id,'secret',[f.appRef,'old']),secret=makeEnteSecret(r.data,r.receipt,f.appRef,'export','paper');
    const saved=observe(secret.data,f.id,'save-off-phone',[f.appRef,'disk',secret.secretRef]),file=saveEnteFile(saved.data,saved.receipt,f.appRef,secret.secretRef,'disk','export');
    const checked=observe(file.data,f.id,'access-off-phone',[file.fileRef,'disk'],[saved.receipt.id]),data=confirmEnteExternalFile(checked.data,checked.receipt,file.fileRef);expect(enteStore(data)!.files).toHaveLength(1);expect(enteBackupCurrent(data,f.appRef)).toBe(true);valid(data);
    const automatic=saveEnteFile(saved.data,saved.receipt,f.appRef,secret.secretRef,'disk','automatic');expect(()=>confirmEnteExternalFile(automatic.data,saved.receipt,automatic.fileRef)).toThrow('separate-copy');expect(()=>copyEnteFile(automatic.data,saved.receipt,automatic.fileRef,'disk','permanent')).toThrow('independent');
  });
  it('changes only Account authentication when a password changes; files and service codes keep their own meanings',()=>{
    const f=newCodeFixture(true),rootRef=f.rootRef!,first=observe(f.data,f.id,'account-password',[f.appRef,'old',rootRef]),old=makeEnteSecret(first.data,first.receipt,rootRef,'account-password','paper');
    let data=recordEnteRootSecret(old.data,first.receipt,rootRef,old.secretRef,true),root=enteStore(data)!.roots.find(r=>r.rootRef===rootRef)!;
    const auth=observe(data,f.id,'account-auth',[rootRef,old.secretRef]);data=recordEnteProof(auth.data,auth.receipt,{kind:'account-auth',rootRef,rootEpoch:root.epoch},{label:'Account auth',targetRef:rootRef,purpose:'sign-in',context:'no-existing-session',requiredRefs:[rootRef,old.secretRef]});const oldRoute=data.securityModel.routes.at(-1)!.id;
    const key=observe(data,f.id,'recovery-key',[rootRef]),recovery=makeEnteSecret(key.data,key.receipt,rootRef,'recovery-key','paper');data=recordEnteRootSecret(recovery.data,key.receipt,rootRef,recovery.secretRef);
    const fresh=observe(data,f.id,'new-account-password',[rootRef]),nextSecret=makeEnteSecret(fresh.data,fresh.receipt,rootRef,'account-password','paper');
    expect(()=>recordEnteRootSecret(nextSecret.data,fresh.receipt,rootRef,nextSecret.secretRef)).toThrow('needs-confirmation');data=recordEnteRootSecret(nextSecret.data,fresh.receipt,rootRef,nextSecret.secretRef,true);
    expect(enteStore(data)!.roots.find(r=>r.rootRef===rootRef)!.recoveryRef).toBe(recovery.secretRef);expect(evaluateAccess(data.securityModel,oldRoute,{context:'no-existing-session',now:stamp()}).state).toBe('unknown');
    expect(evaluateAccess(data.securityModel,f.route,{context:'new-device',now:stamp()}).state).toBe('available');valid(data);
  });
  it('keeps a copied service registration usable without the former phone, but rejects revocation and another destination',()=>{
    const f=newCodeFixture(),without=lifecycle(f.data,'old','deleted');expect(evaluateAccess(without.securityModel,f.route,{context:'new-device',now:stamp()}).state).toBe('available');
    expect(evaluateAccess(f.data.securityModel,f.route,{context:'all-devices-lost',now:stamp()}).state).toBe('not-applicable');
    const revoked=lifecycle(f.data,'original-code','revoked');expect(evaluateAccess(revoked.securityModel,f.route,{context:'new-device',now:stamp()}).state).toBe('unknown');
    const moved={...f.data,securityModel:{...f.data.securityModel,entities:f.data.securityModel.entities.map(e=>e.id===f.destinationRef?{...e,deviceRef:'old'}:e)}};expect(evaluateAccess(moved.securityModel,f.route,{context:'new-device',now:stamp()}).state).toBe('unknown');
    const newLost=lifecycle(f.data,'fresh','lost');expect(evaluateAccess(newLost.securityModel,f.route,{context:'new-device',now:stamp()}).state).toBe('unavailable');
  });
  it('keeps an offline restored code independent of its former Ente Account while shared live cloud loss stays uncertain',()=>{
    const f=newCodeFixture(),root=createEnteRoot(f.data,undefined,stamp()),changed=observe(root.data,f.id,'source-account',[f.appRef,'old',root.rootRef]);
    let data=recordEnteStorage(changed.data,changed.receipt,f.appRef,'account',root.rootRef);const oldDataset=enteConfiguration(data,f.appRef)!.datasetRef;
    data=lifecycle(lifecycle(data,root.rootRef,'deleted'),oldDataset,'deleted');expect(evaluateAccess(data.securityModel,f.route,{context:'new-device',now:stamp()}).state).toBe('available');
    const shared=newCodeFixture(true),source=observe(shared.data,shared.id,'shared-source-account',[shared.appRef,'old',shared.rootRef!]);let same=recordEnteStorage(source.data,source.receipt,shared.appRef,'account',shared.rootRef!);
    expect(enteConfiguration(same,shared.appRef)!.datasetRef).toBe(enteConfiguration(same,shared.destinationRef)!.datasetRef);same=lifecycle(same,enteConfiguration(same,shared.destinationRef)!.datasetRef,'deleted');
    expect(evaluateAccess(same.securityModel,shared.route,{context:'new-device',now:stamp()}).state).toBe('unknown');valid(same);
  });
  it('withdraws dependent observations without deleting actual files or the main guide',()=>{
    const f=fixture(),b=backup(prepare(f.data,f.id,f.appRef),f.id,f.appRef),before=structuredClone(b.data.guide),next=withdrawEnteReceipt(b.data,f.id,'file-save',stamp()) as CurrentDataset;
    expect(enteBackupCurrent(next,f.appRef)).toBe(false);expect(enteStore(next)!.files).toHaveLength(2);expect(next.guide).toEqual(before);expect(enteStore(next)!.receipts.filter(r=>r.revokedAt)).toHaveLength(2);valid(next);
  });
  it('rejects malformed owned references and cycles do not become confirmations',()=>{
    const f=fixture(),r=observe(f.data,f.id,'open',[f.appRef,'old']),s=enteStore(r.data)!;s.receipts[0].requires=[s.receipts[0].id];expect(enteReceiptCurrent(s,s.receipts[0].id)).toBe(false);
    const invalid={...r.data,securityModel:{...r.data.securityModel,enteV1:{...s,profiles:[{...s.profiles[0],configRef:'missing'}]}}};expect(currentDatasetSchema.safeParse(invalid).success).toBe(false);
    expect(()=>appendEnteReceipt(r.data,f.id,{stepId:'bad',refs:['missing']})).toThrow('prerequisite');expect(()=>createEnteApp(r.data,'fresh',f.appRef)).toThrow('destination');const root=createEnteRoot(r.data);expect(removeEntry(root.data,root.rootRef)).toBeUndefined();
  });
  it('preserves revisions 1–11, opaque fields, the envelope, and this store through other feature writers',async()=>{
    const f=fixture(),sealed=await createEncryptedVault('test-only Ente storage phrase',f.data),opened=(await decryptVault(sealed.envelope,'test-only Ente storage phrase')).data;expect(opened).toEqual(f.data);
    for(const revision of [1,2,3,4,5,6,7,8,9,10,11] as const){const old=newDataset();old.assets=f.data.assets;old.securityModel.revision=revision;old.securityModel.opaque={keep:true};const made=createEnteApp(old,'old');expect(made.data.securityModel.opaque).toEqual({keep:true});expect(made.data.guide).toEqual(old.guide);}
    const old=newDataset();old.assets=f.data.assets;old.securityModel.enteV1={opaque:'keep'};expect(()=>createEnteApp(old,'old')).toThrow(DataUpgradeConflict);
    const plan=startAccessPlan(startProtectionGuide(f.data,'old').data,'mail').data,next=setMapArchive(plan,f.appRef,true);expect(next.securityModel.revision).toBe(12);expect(enteStore(next)).toEqual(enteStore(f.data));expect(next.guide).toEqual(f.data.guide);
    expect(enteSnapshot(f.data.securityModel,f.appRef)).toBe(enteSnapshot({...f.data.securityModel,explanationChanged:true},f.appRef));
  });
  it('keeps pending tasks scoped to the actual main or side guide',()=>{
    const f=fixture(),a=startEnteTask(f.data,{kind:'prepare',appRef:f.appRef,origin:'guide',accountRef:'mail',scopePath:'/guide',returnCursor:'do/mail/email-mfa/scan'},stamp()),same=startEnteTask(a.data,{kind:'prepare',appRef:f.appRef,origin:'guide',accountRef:'mail',scopePath:'/guide',returnCursor:'do/mail/email-mfa/scan'},stamp());
    expect(same.id).toBe(a.id);const side=startEnteTask(same.data,{kind:'prepare',appRef:f.appRef,origin:'guide',accountRef:'mail',scopePath:'/nord-connection/side',returnCursor:'do/mail/email-mfa/scan'},stamp());expect(side.id).not.toBe(a.id);expect(side.data.guide).toEqual(f.data.guide);valid(side.data);
  });
});
