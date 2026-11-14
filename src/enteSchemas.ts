import { z } from 'zod';
import type { CurrentDataset, Dataset } from './models';
import type { AccessFact, SecurityModel } from './securityModel';

const ref=z.string().min(1), time=z.string().datetime({offset:true});
export const enteRecoveryStateSchema=z.object({
  version:z.literal(1),
  password:z.object({candidateRef:ref,phase:z.enum(['prepared','requested','applied']),previousEpoch:ref,
    requestedAt:time.optional(),appliedAt:time.optional(),appliedEpoch:ref.optional(),
  }).passthrough().refine(v=>(v.phase==='prepared'||!!v.requestedAt)&&(v.phase!=='applied'||!!v.appliedAt&&!!v.appliedEpoch),'incomplete-ente-password-change').optional(),
  factor:z.object({type:z.enum(['totp','passkey']),phase:z.enum(['requested','recovered']),requestedAt:time,recoveredAt:time.optional()}).passthrough().refine(v=>v.phase!=='recovered'||!!v.recoveredAt,'incomplete-ente-factor-recovery').optional(),
}).passthrough();
export const enteReceiptSchema=z.object({
  id:ref, taskRef:ref, stepId:ref, at:time, requires:z.array(ref), refs:z.array(ref),
  revokedAt:time.optional(), configRef:ref.optional(), lockRef:ref.optional(), rootEpoch:ref.optional(),
  titleEn:z.string().optional(), titleJa:z.string().optional(),
}).passthrough();
export type EnteReceipt=z.infer<typeof enteReceiptSchema>;
export const enteTaskSchema=z.object({
  id:ref, kind:z.enum(['prepare','backup','move','restore','account','connect','recovery']),
  appRef:ref, destinationRef:ref.optional(), newDeviceRef:ref.optional(), phoneRef:ref.optional(), phoneRecordKey:ref.optional(),
  accountRef:ref.optional(), rootRef:ref.optional(), returnCursor:z.string().optional(),
  scopePath:z.string().regex(/^\/(guide|nord-connection\/[^?#]+|protect\/account\/[^?#]+)$/).optional(),
  origin:z.enum(['guide','map','phone']), status:z.enum(['active','deferred','completed','cancelled']).default('active'),
  cursor:z.string().default(''), history:z.array(z.string()).default([]),
  answers:z.record(z.string(),z.string()).default({}), records:z.record(z.string(),ref).default({}),
  resources:z.record(z.string(),ref).default({}), sourceSnapshot:z.string().optional(),
  recoveryStateV1:enteRecoveryStateSchema.optional(),
  createdAt:time, updatedAt:time,
}).passthrough();
export type EnteTask=z.infer<typeof enteTaskSchema>;
export const enteStoreSchema=z.object({
  version:z.literal(1),
  profiles:z.array(z.object({appRef:ref,createdAt:time,configRef:ref.optional(),lockRef:ref.optional()}).passthrough()).default([]),
  configurations:z.array(z.object({id:ref,appRef:ref,mode:z.enum(['offline','account']),rootRef:ref.optional(),datasetRef:ref,epoch:ref,createdAt:time}).passthrough()).default([]),
  locks:z.array(z.object({id:ref,appRef:ref,mode:z.enum(['device','pin','password']),credentialRef:ref.optional(),createdAt:time}).passthrough()).default([]),
  roots:z.array(z.object({rootRef:ref,createdAt:time,passwordRef:ref.optional(),recoveryRef:ref.optional(),epoch:ref,
    sharedScope:z.enum(['unknown','confirmed']).default('unknown'),products:z.array(z.enum(['auth','photos','locker'])).default([]),
    datasets:z.record(z.string(),ref).default({}),
  }).passthrough()).default([]),
  tasks:z.array(enteTaskSchema).default([]),receipts:z.array(enteReceiptSchema).default([]),
  secrets:z.array(z.object({entityRef:ref,ownerRef:ref,purpose:z.enum(['export','automatic','account-password','recovery-key']),storageRef:ref.optional(),receiptRef:ref,
    copies:z.array(z.object({storageRef:ref,receiptRef:ref}).passthrough()).default([]),
  }).passthrough()).default([]),
  automaticSettings:z.array(z.object({appRef:ref,enabled:z.boolean(),secretRef:ref.optional(),folderRef:ref.optional(),receiptRef:ref}).passthrough()).default([]),
  files:z.array(z.object({entityRef:ref,appRef:ref,secretRef:ref,storageRef:ref,receiptRef:ref,snapshot:z.string(),
    role:z.enum(['source','permanent','transfer']),origin:z.enum(['export','automatic']),groupRef:ref,createdAt:time,
  }).passthrough()).default([]),
  proofs:z.array(z.object({factRef:ref,directReceiptRef:ref,receiptRefs:z.array(ref).min(1),
    kind:z.enum(['totp-code','service-signin','restore','account-auth','account-read','account-passkey','root-mail-access']),
    appRef:ref.optional(),configRef:ref.optional(),rootRef:ref.optional(),rootEpoch:ref.optional(),
  }).passthrough()).default([]),
  links:z.array(z.object({relationRef:ref,historical:z.boolean().default(false),receiptRefs:z.array(ref).min(1)}).passthrough()).default([]),
}).passthrough();
export type EnteStore=z.infer<typeof enteStoreSchema>;

export function enteStore(data:Dataset|Pick<CurrentDataset,'securityModel'>):EnteStore|undefined{
  if('version' in data&&data.version!==2)return;
  const model=(data as Pick<CurrentDataset,'securityModel'>).securityModel;
  if(!model||Number(model.revision)<12)return;
  const parsed=enteStoreSchema.safeParse(model.enteV1);return parsed.success?parsed.data:undefined;
}
export const enteProfile=(data:Dataset,appRef?:string)=>enteStore(data)?.profiles.find(p=>p.appRef===appRef);
export const enteConfiguration=(data:Dataset,appRef:string)=>{const s=enteStore(data);return s?.configurations.find(c=>c.id===s.profiles.find(p=>p.appRef===appRef)?.configRef);};
export const enteLock=(data:Dataset,appRef:string)=>{const s=enteStore(data);return s?.locks.find(l=>l.id===s.profiles.find(p=>p.appRef===appRef)?.lockRef);};

// Bound the traversal and memoize shared prerequisites. A cycle or an old
// receipt no longer selected by its task is unknown, never an implicit pass.
export function enteReceiptCurrent(store:EnteStore,id:string):boolean{
  const receipts=new Map(store.receipts.map(r=>[r.id,r])),tasks=new Map(store.tasks.map(t=>[t.id,t]));
  const complete=new Set<string>(),visiting=new Set<string>(),stack:[string,boolean][]=[[id,false]];let visits=0;
  while(stack.length){
    if(++visits>8192)return false;
    const [ref,leaving]=stack.pop()!;
    if(leaving){visiting.delete(ref);complete.add(ref);continue;}
    if(complete.has(ref))continue;
    const receipt=receipts.get(ref),task=receipt&&tasks.get(receipt.taskRef);
    if(!receipt||receipt.revokedAt||!task||task.records[receipt.stepId]!==ref||visiting.has(ref))return false;
    visiting.add(ref);stack.push([ref,true]);
    for(const required of receipt.requires)stack.push([required,false]);
  }
  return true;
}
export function enteReceiptClosure(store:EnteStore,ids:string[]):string[]{
  const found=new Set<string>(),pending=[...ids],receipts=new Map(store.receipts.map(r=>[r.id,r]));
  while(pending.length){const id=pending.pop()!;if(found.has(id))continue;found.add(id);pending.push(...(receipts.get(id)?.requires??[]));}
  return [...found];
}
export function enteSnapshot(model:SecurityModel,appRef:string):string{
  const s=enteStore({securityModel:model}),profile=s?.profiles.find(p=>p.appRef===appRef),config=s?.configurations.find(c=>c.id===profile?.configRef);
  const tokens=model.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.storageRef===appRef)
    .map(e=>[e.id,e.enrollmentRef??'',model.lifecycle[e.id]?.accessResetAt??'']).sort(([a],[b])=>String(a).localeCompare(String(b)));
  return JSON.stringify([config?.epoch??'',tokens]);
}
const unavailable=(model:SecurityModel,ref:string)=>['lost','unavailable','revoked','deleted','transferred','retired'].includes(model.lifecycle[ref]?.state??'');
export function enteFileCurrent(model:SecurityModel,id:string):boolean{
  const s=enteStore({securityModel:model}),file=s?.files.find(f=>f.entityRef===id),secret=s?.secrets.find(c=>c.entityRef===file?.secretRef);
  const copies=secret?.copies.length?secret.copies:secret?.storageRef?[{storageRef:secret.storageRef,receiptRef:secret.receiptRef}]:[];
  const reset=model.lifecycle[file?.secretRef??'']?.accessResetAt;
  const secretAvailable=!!secret&&(!copies.length||copies.some(c=>!unavailable(model,c.storageRef)&&enteReceiptCurrent(s!,c.receiptRef)&&(!reset||Date.parse(s!.receipts.find(r=>r.id===c.receiptRef)!.at)>Date.parse(reset))));
  return !!s&&!!file&&secretAvailable&&file.role==='permanent'&&enteReceiptCurrent(s,file.receiptRef)&&file.snapshot===enteSnapshot(model,file.appRef)
    &&[file.entityRef,file.storageRef,file.secretRef].every(ref=>!unavailable(model,ref));
}
export function enteFactCurrent(model:SecurityModel,fact:AccessFact):boolean{
  const s=enteStore({securityModel:model}),proof=s?.proofs.find(p=>p.factRef===fact.id);if(!s||!proof)return true;
  if(!proof.receiptRefs.every(r=>enteReceiptCurrent(s,r)))return false;
  if(proof.appRef){
    const app=model.entities.find(e=>e.id===proof.appRef),profile=s.profiles.find(p=>p.appRef===proof.appRef);
    if(app?.kind!=='installation'||!fact.requiredRefs.includes(app.id)||!fact.requiredRefs.includes(app.deviceRef)||proof.configRef&&profile?.configRef!==proof.configRef)return false;
  }
  if(proof.rootRef&&proof.rootEpoch&&s.roots.find(r=>r.rootRef===proof.rootRef)?.epoch!==proof.rootEpoch)return false;
  if(proof.rootRef&&entePasswordPending(model,proof.rootRef)&&model.routes.some(r=>r.requirements.kind==='fact'&&r.requirements.factId===fact.id&&['sign-in','decrypt'].includes(r.purpose)))return false;
  if(proof.rootRef&&s.tasks.some(t=>t.kind==='recovery'&&t.rootRef===proof.rootRef&&t.recoveryStateV1?.factor?.type==='totp'&&t.recoveryStateV1.factor.phase==='requested')&&fact.requiredRefs.some(ref=>model.entities.some(e=>e.id===ref&&e.kind==='credential'&&e.subjectRef===proof.rootRef&&e.credentialType==='totp')))return false;
  return !fact.requiredRefs.some(id=>{const c=model.entities.find(e=>e.id===id);return c?.kind==='credential'&&!!c.replicaGroupId&&model.entities.some(e=>e.kind==='credential'&&e.replicaGroupId===c.replicaGroupId&&model.lifecycle[e.id]?.state==='revoked'&&model.lifecycle[e.id]?.evidence==='user-confirmed');});
}
export function entePasswordPending(model:SecurityModel,rootRef:string):boolean{
  const store=enteStore({securityModel:model}),root=store?.roots.find(r=>r.rootRef===rootRef);
  return !!root&&!!store?.tasks.some(t=>t.kind==='recovery'&&t.rootRef===rootRef&&t.recoveryStateV1?.password?.phase==='requested'&&t.recoveryStateV1.password.previousEpoch===root.epoch);
}
export function enteLinkCurrent(model:SecurityModel,id:string):boolean{
  const s=enteStore({securityModel:model}),link=s?.links.find(l=>l.relationRef===id);
  return !link||!!s&&link.receiptRefs.every(r=>enteReceiptCurrent(s,r));
}
export function enteDependencyCurrent(model:SecurityModel,id:string):boolean{
  const s=enteStore({securityModel:model}),link=s?.links.find(l=>l.relationRef===id);
  return !link||!link.historical&&enteLinkCurrent(model,id);
}
export function entePrepared(data:Dataset,appRef:string):boolean{
  if(data.version!==2)return false;const s=enteStore(data),profile=s?.profiles.find(p=>p.appRef===appRef),app=data.securityModel.entities.find(e=>e.id===appRef);
  if(!s||!profile||app?.kind!=='installation'||app.productId!=='ente-auth')return false;
  const device=data.assets.find(d=>d.id===app.deviceRef),config=s.configurations.find(c=>c.id===profile.configRef),lock=s.locks.find(l=>l.id===profile.lockRef);
  if(!device||!config||!lock||unavailable(data.securityModel,appRef)||unavailable(data.securityModel,device.id)||lock.credentialRef&&unavailable(data.securityModel,lock.credentialRef))return false;
  if(!['implemented','verified'].includes(device.controls.screenLock)||!['opened','appLock','storageChecked'].every(c=>app.controls?.[c]==='verified'&&app.controlEvidence?.[c]==='user-confirmed'))return false;
  const reset=Object.fromEntries([app.id,device.id,...(lock.credentialRef?[lock.credentialRef]:[])].map(id=>[id,data.securityModel.lifecycle[id]?.accessResetAt]));
  const current=(r:EnteReceipt)=>r.refs.includes(app.id)&&r.refs.includes(device.id)&&enteReceiptCurrent(s,r.id)&&Object.values(reset).every(t=>!t||Date.parse(t)<Date.parse(r.at));
  return s.receipts.some(r=>r.lockRef===lock.id&&current(r))&&s.receipts.some(r=>r.configRef===config.id&&current(r));
}
export function enteBackupCurrent(data:Dataset,appRef:string):boolean{
  if(data.version!==2)return false;const store=enteStore(data);if(!store)return false;
  if(store.files.some(f=>f.appRef===appRef&&enteFileCurrent(data.securityModel,f.entityRef)))return true;
  return store.receipts.some(r=>{const raw=r.enteBackupCoverageV1;if(!raw||typeof raw!=='object')return false;const v=raw as Record<string,unknown>;return v.appRef===appRef&&typeof v.fileRef==='string'&&v.snapshot===enteSnapshot(data.securityModel,appRef)&&r.refs.includes(appRef)&&r.refs.includes(v.fileRef)&&enteReceiptCurrent(store,r.id)&&enteFileCurrent(data.securityModel,v.fileRef);});
}
export function enteWithoutEvidence(model:SecurityModel,fact:AccessFact):string[]{
  const s=enteStore({securityModel:model}),proof=s?.proofs.find(p=>p.factRef===fact.id),receipt=s?.receipts.find(r=>r.id===proof?.directReceiptRef);
  if(!s||!proof||!receipt||!enteReceiptCurrent(s,receipt.id))return [];
  if(proof.rootRef&&['account-auth','account-passkey','account-read'].includes(proof.kind)){
    const task=s.tasks.find(t=>t.id===receipt.taskRef),raw=task?.enteReturnV1,v=raw&&typeof raw==='object'?raw as Record<string,unknown>:undefined,parent=v?s.tasks.find(t=>t.id===v.taskRef):undefined;
    const source=parent?model.entities.find(e=>e.id===parent.appRef):undefined,destination=task?model.entities.find(e=>e.id===task.appRef):undefined;
    const without=parent&&parent.createdAt===v?.createdAt&&parent.appRef===v.appRef&&parent.destinationRef===v.destinationRef&&parent.newDeviceRef===v.newDeviceRef&&parent.destinationRef===task?.appRef&&source?.kind==='installation'&&destination?.kind==='installation'&&(parent.kind==='recovery'?parent.resources.protectionDevice??parent.newDeviceRef:parent.newDeviceRef)===destination.deviceRef&&source.deviceRef!==destination.deviceRef&&Array.isArray(fact.observedWithoutRefs)&&fact.observedWithoutRefs.includes(source.deviceRef)?[source.deviceRef]:[];
    const recoverySource=task?model.entities.find(e=>e.id===task.appRef):undefined,currentConfig=s.configurations.find(c=>c.id===s.profiles.find(p=>p.appRef===task?.appRef)?.configRef);
    const recoveryWithout=task?.kind==='recovery'&&receipt.stepId==='recovery-data-read'&&task.rootRef===proof.rootRef&&currentConfig?.rootRef===proof.rootRef&&task.answers['recovery-place']==='web'&&task.newDeviceRef&&recoverySource?.kind==='installation'&&recoverySource.deviceRef!==task.newDeviceRef&&fact.requiredRefs.includes(task.newDeviceRef)&&!fact.requiredRefs.includes(recoverySource.deviceRef)&&Array.isArray(fact.observedWithoutRefs)&&fact.observedWithoutRefs.includes(recoverySource.deviceRef)?[recoverySource.deviceRef]:[];
    const unused=model.entities.filter(e=>e.kind==='credential'&&e.subjectRef===proof.rootRef&&!fact.requiredRefs.includes(e.id)).map(e=>e.id);
    const fileInputs=s.files.flatMap(f=>[f.entityRef,f.storageRef]),fileSecrets=s.secrets.filter(c=>['export','automatic'].includes(c.purpose)).flatMap(c=>[c.entityRef,...c.copies.map(p=>p.storageRef)]),locks=s.locks.flatMap(l=>l.credentialRef?[l.credentialRef]:[]);
    return [...new Set([...unused,...fileInputs,...fileSecrets,...locks,...without,...recoveryWithout])].filter(ref=>!fact.requiredRefs.includes(ref));
  }
  const task=s.tasks.find(t=>t.id===receipt.taskRef),source=model.entities.find(e=>e.id===task?.appRef),target=model.entities.find(e=>e.id===proof.appRef);
  if(!task||!['move','restore'].includes(task.kind)||source?.kind!=='installation'||target?.kind!=='installation')return [];
  const former=[source.id,...(source.deviceRef!==target.deviceRef?[source.deviceRef]:[])];
  if(proof.kind==='restore')return former;
  if(proof.kind!=='totp-code'&&proof.kind!=='service-signin')return [];
  // This is the local code operation, not a complete Account sign-in or a
  // claim about recovery with every device lost. Required live resources are
  // checked before these known former/backup inputs can be excluded.
  const apps=new Set([source.id,target.id]),roots=s.configurations.filter(c=>apps.has(c.appRef)).map(c=>c.rootRef).filter((r):r is string=>!!r);
  const targetConfig=s.configurations.find(c=>c.id===s.profiles.find(p=>p.appRef===target.id)?.configRef);
  const secrets=s.secrets.filter(c=>apps.has(c.ownerRef)||roots.includes(c.ownerRef)),files=s.files.filter(f=>apps.has(f.appRef));
  const copies=model.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&(e.storageRef===source.id&&model.lifecycle[e.id]?.state!=='revoked'||e.replicaGroupId&&fact.requiredRefs.some(ref=>model.entities.some(c=>c.id===ref&&c.kind==='credential'&&c.replicaGroupId===e.replicaGroupId))));
  const currentLock=s.profiles.find(p=>p.appRef===target.id)?.lockRef,oldLocks=s.locks.filter(l=>apps.has(l.appRef)&&l.id!==currentLock).flatMap(l=>l.credentialRef?[l.credentialRef]:[]);
  if(proof.kind==='service-signin')return [...new Set([source.id,...copies.map(c=>c.id),...oldLocks,...files.map(f=>f.entityRef),...s.secrets.filter(c=>apps.has(c.ownerRef)).map(c=>c.entityRef)])];
  return [...new Set([...former,...copies.map(c=>c.id),...oldLocks,...files.flatMap(f=>[f.entityRef,f.storageRef]),...secrets.flatMap(c=>[c.entityRef,...c.copies.map(copy=>copy.storageRef)]),...roots.filter(id=>id!==targetConfig?.rootRef),...s.configurations.filter(c=>c.appRef===source.id&&c.datasetRef!==targetConfig?.datasetRef).map(c=>c.datasetRef)])];
}
export function enteParentTask(data:Dataset,id:string):EnteTask|undefined{
 const store=enteStore(data),task=store?.tasks.find(t=>t.id===id),raw=task?.enteReturnV1;if(!raw||typeof raw!=='object')return;const v=raw as Record<string,unknown>,parent=store?.tasks.find(t=>t.id===v.taskRef);
 return parent&&parent.id!==id&&parent.createdAt===v.createdAt&&parent.appRef===v.appRef&&parent.destinationRef===v.destinationRef&&parent.newDeviceRef===v.newDeviceRef&&parent.status!=='cancelled'?parent:undefined;
}
