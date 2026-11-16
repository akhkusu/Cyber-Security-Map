import { z } from 'zod';
import type { Dataset, CurrentDataset } from './models';
import type { AccessFact, SecurityModel } from './securityModel';

const ref = z.string().min(1), time = z.string().datetime({ offset: true });
export const twofasReceiptSchema = z.object({
  id: ref, taskRef: ref, stepId: ref, at: time, requires: z.array(ref), refs: z.array(ref),
  revokedAt: time.optional(), pinRef: ref.optional(),
}).passthrough();
export const twofasTaskSchema = z.object({
  id: ref, kind: z.enum(['prepare', 'backup', 'move']), appRef: ref,
  destinationRef: ref.optional(), newDeviceRef: ref.optional(), phoneRef: ref.optional(), phoneRecordKey: ref.optional(),
  accountRef: ref.optional(), returnCursor: z.string().optional(), scopePath: z.string().regex(/^\/(guide|nord-connection\/[^?#]+|protect\/account\/[^?#]+)$/).optional(),
  origin: z.enum(['guide', 'map', 'phone']), createdAt: time, updatedAt: time,
  sourceSnapshot: z.string().optional(),
  status: z.enum(['active', 'deferred', 'completed', 'cancelled']).default('active'),
  cursor: z.string().default(''), history: z.array(z.string()).default([]),
  answers: z.record(z.string(), z.string()).default({}), records: z.record(z.string(), ref).default({}),
  fileRef: ref.optional(), secretRef: ref.optional(), fileStorageRef: ref.optional(), cloudSecretRef: ref.optional(), transferFileRef: ref.optional(), assignedPinRef: ref.optional(), reviewCloud: z.boolean().default(false), reusedSyncRef: ref.optional(),
}).passthrough();
export type TwofasTask = z.infer<typeof twofasTaskSchema>;
export type TwofasReceipt = z.infer<typeof twofasReceiptSchema>;
export const twofasStoreSchema = z.object({
  version: z.literal(1),
  profiles: z.array(z.object({ appRef: ref, createdAt: time, pinRef: ref.optional() }).passthrough()).default([]),
  tasks: z.array(twofasTaskSchema).default([]), receipts: z.array(twofasReceiptSchema).default([]),
  secrets: z.array(z.object({entityRef:ref,paperRef:ref,appRef:ref,purpose:z.enum(['file','cloud']),receiptRef:ref}).passthrough()).default([]),
  syncSettings: z.array(z.object({appRef:ref,mode:z.enum(['on','off']),rootRef:ref.optional(),secretRef:ref.optional(),receiptRef:ref}).passthrough()).default([]),
  clouds: z.array(z.object({entityRef:ref,appRef:ref,rootRef:ref,secretRef:ref.optional(),receiptRef:ref,snapshot:z.string()}).passthrough()).default([]),
  files: z.array(z.object({ entityRef: ref, appRef: ref, secretRef: ref, storageRef: ref, receiptRef: ref, snapshot: z.string(), external: z.boolean().default(false), permanent: z.boolean().default(true), groupRef: ref.optional(), createdAt: time }).passthrough()).default([]),
  proofs: z.array(z.object({ factRef: ref, directReceiptRef: ref.optional(), receiptRefs: z.array(ref).min(1), fileRef: ref.optional() }).passthrough()).default([]),
  links: z.array(z.object({ relationRef: ref, historical: z.boolean().default(false), receiptRefs: z.array(ref).min(1) }).passthrough()).default([]),
}).passthrough();
export type TwofasStore = z.infer<typeof twofasStoreSchema>;
export function twofasStore(data: Pick<CurrentDataset, 'securityModel'> | Dataset): TwofasStore | undefined {
  if ('version' in data && data.version !== 2) return;
  const model=(data as Pick<CurrentDataset,'securityModel'>).securityModel;
  if (!model || typeof model!=='object' || model.revision < 11) return;
  const result = twofasStoreSchema.safeParse(model.twofasV1);
  return result.success ? result.data : undefined;
}
export function twofasProfile(data: Dataset, appRef?: string) { return twofasStore(data)?.profiles.find(p => p.appRef === appRef); }
export function twofasReceiptCurrent(store: TwofasStore, id: string, visited = new Set<string>()): boolean {
  if (visited.has(id) || visited.size>2048) return false;
  const receipt = store.receipts.find(r => r.id === id);
  if (!receipt || receipt.revokedAt) return false;
  const task = store.tasks.find(t => t.id === receipt.taskRef);
  if (!task || task.records[receipt.stepId] !== id) return false;
  return receipt.requires.every(ref => twofasReceiptCurrent(store, ref, new Set([...visited, id])));
}
export function twofasSnapshot(model: SecurityModel, appRef: string): string {
  return JSON.stringify(model.entities.filter(e => e.kind === 'credential' && e.credentialType === 'totp' && e.storageRef === appRef).map(e => [e.id, e.enrollmentRef ?? '', model.lifecycle[e.id]?.accessResetAt ?? '']).sort(([a],[b]) => String(a).localeCompare(String(b))));
}
export function twofasFileCurrent(model: SecurityModel, entityRef: string): boolean {
  const store = twofasStore({securityModel: model}), file = store?.files.find(f => f.entityRef === entityRef);
  const paper=store?.secrets.find(s=>s.entityRef===file?.secretRef)?.paperRef;
  return !!store && !!file && file.external && file.permanent && twofasReceiptCurrent(store, file.receiptRef) && file.snapshot === twofasSnapshot(model, file.appRef) && [file.entityRef,file.storageRef,file.secretRef,...(paper?[paper]:[])].every(ref=>!['deleted','revoked','lost','unavailable','transferred','retired'].includes(model.lifecycle[ref]?.state ?? 'unknown'));
}
export function twofasFactCurrent(model: SecurityModel, fact: AccessFact): boolean {
  const store = twofasStore({securityModel: model}); if (!store) return true;
  const proof = store.proofs.find(p => p.factRef === fact.id);
  if (!proof) return true;
  if(!proof.receiptRefs.every(r => twofasReceiptCurrent(store, r)) || proof.fileRef && !twofasFileCurrent(model, proof.fileRef))return false;
  if(fact.requiredRefs.some(ref=>{const app=model.entities.find(e=>e.id===ref);return app?.kind==='installation'&&!fact.requiredRefs.includes(app.deviceRef);}))return false;
  return !fact.requiredRefs.some(ref=>{const c=model.entities.find(e=>e.id===ref);return c?.kind==='credential'&&c.replicaGroupId&&model.entities.some(other=>other.kind==='credential'&&other.replicaGroupId===c.replicaGroupId&&model.lifecycle[other.id]?.evidence==='user-confirmed'&&model.lifecycle[other.id]?.state==='revoked');});
}
export function twofasLinkCurrent(model: SecurityModel, relationRef: string): boolean {
  const store = twofasStore({securityModel: model}), link = store?.links.find(l => l.relationRef === relationRef);
  return !link || !!store && link.receiptRefs.every(r => twofasReceiptCurrent(store, r));
}
export function twofasPrepared(data: Dataset, appRef: string): boolean {
  const store = twofasStore(data); if (!store || data.version !== 2) return false;
  const app = data.securityModel.entities.find(e => e.id === appRef && e.kind === 'installation'), device = app?.kind === 'installation' && data.assets.find(a => a.id === app.deviceRef);
  const pin=store.profiles.find(p=>p.appRef===appRef)?.pinRef;
  if(pin&&['lost','unavailable','revoked','deleted'].includes(data.securityModel.lifecycle[pin]?.state??''))return false;
  if (app?.kind!=='installation' || !device || !['implemented','verified'].includes(device.controls.screenLock) || !['opened','appLock','storageChecked'].every(c=>app.controls?.[c]==='verified'&&app.controlEvidence?.[c]==='user-confirmed')) return false;
  return store.tasks.some(t => (['prepare','backup'].includes(t.kind) && t.appRef === appRef || t.kind === 'move' && t.destinationRef === appRef) && ['pin-test','new-pin-test'].some(s => {
    const receipt = store.receipts.find(r => r.id === t.records[s]);
    return !!receipt && receipt.pinRef===pin && receipt.refs.includes(app.deviceRef) && !!t.records[s==='pin-test'?'local':'new-local'] && twofasReceiptCurrent(store,t.records[s==='pin-test'?'local':'new-local']) && twofasReceiptCurrent(store, receipt.id) && [appRef,device.id,...(pin?[pin]:[])].every(ref => !data.securityModel.lifecycle[ref]?.accessResetAt || Date.parse(data.securityModel.lifecycle[ref].accessResetAt!) < Date.parse(receipt.at));
  }));
}
export function twofasBackupCurrent(data: Dataset, appRef: string): boolean {
  const store = twofasStore(data); if (!store || data.version !== 2) return false;
  return store.files.some(f => f.appRef === appRef && twofasFileCurrent(data.securityModel,f.entityRef));
}
export function twofasMoveReady(data: Dataset, phoneRef: string, appRef: string, newDeviceRef: string): boolean {
  const store = twofasStore(data); if (!store || data.version !== 2) return false;
  const phone=data.deviceWorkflows.find(w=>w.id===phoneRef),source=data.securityModel.entities.find(e=>e.id===appRef);
  if(!phone||phone.newDeviceRef!==newDeviceRef||source?.kind!=='installation'||phone.oldDeviceRef!==source.deviceRef)return false;
  return store.tasks.some(t => {
    if(!(t.kind === 'move' && t.phoneRef === phoneRef && t.appRef === appRef && t.newDeviceRef === newDeviceRef && t.status === 'completed' && !!t.records['move-finished'] && twofasReceiptCurrent(store,t.records['move-finished']) && !!t.destinationRef && twofasPrepared(data,t.destinationRef)))return false;
    const destination=data.securityModel.entities.find(e=>e.id===t.destinationRef);
    if(destination?.kind!=='installation'||destination.deviceRef!==newDeviceRef)return false;
    const targets=data.securityModel.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.storageRef===appRef).map(e=>e.kind==='credential'?e.subjectRef:'');
    if(targets.some(ref=>!t.records[`code:${ref}`]))return false;
    const codeReceipts=Object.entries(t.records).filter(([id])=>id.startsWith('code:')).map(([,ref])=>ref);
    return codeReceipts.length>0&&codeReceipts.every(ref=>{
      const proof=store.proofs.find(p=>p.directReceiptRef===ref),f=data.securityModel.facts.find(f=>f.id===proof?.factRef);
      return !!f&&f.evidence==='user-confirmed'&&f.state==='available'&&twofasFactCurrent(data.securityModel,f)&&f.requiredRefs.every(id=>{const life=data.securityModel.lifecycle[id];return !life?.accessResetAt||Date.parse(life.accessResetAt)<Date.parse(f.checkedAt);});
    });
  });
}

export function twofasDependencyCurrent(model:SecurityModel,id:string):boolean{
 const store=twofasStore({securityModel:model}),link=store?.links.find(l=>l.relationRef===id);return !link||!link.historical&&twofasLinkCurrent(model,id);
}
export function twofasWithoutEvidence(model:SecurityModel,fact:AccessFact):string[]{
 const store=twofasStore({securityModel:model}),proof=store?.proofs.find(p=>p.factRef===fact.id),receipt=store?.receipts.find(r=>r.id===proof?.directReceiptRef);
 if(!store||!receipt||!proof||!twofasReceiptCurrent(store,receipt.id))return [];
 const task=store.tasks.find(t=>t.id===receipt.taskRef),app=model.entities.find(e=>e.id===task?.appRef);
 if(task?.kind!=='move'||app?.kind!=='installation')return [];
 if(receipt.stepId==='file-import'||receipt.stepId==='cloud-restore')return [app.deviceRef];
 if(!receipt.stepId.startsWith('code:'))return [];
 // This observation is only the local TOTP operation. The official app
 // generates that code offline; backup files and the former app are not
 // inputs to this operation. Password sign-in/recovery is not inferred.
 const copies=model.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.replicaGroupId&&fact.requiredRefs.some(ref=>model.entities.some(c=>c.id===ref&&c.kind==='credential'&&c.replicaGroupId===e.replicaGroupId)));
 const priorPins=model.entities.filter(e=>e.kind==='credential'&&e.roles.includes('local-unlock')&&(e.subjectRef===task.appRef||e.subjectRef===task.destinationRef&&e.id!==store.profiles.find(p=>p.appRef===task.destinationRef)?.pinRef));
 const files=store.files.filter(f=>f.appRef===task.appRef),secrets=store.secrets.filter(s=>s.entityRef===task.secretRef||s.entityRef===task.cloudSecretRef);
 return [...new Set([app.deviceRef,app.id,...copies.map(c=>c.id),...priorPins.map(c=>c.id),...files.flatMap(f=>[f.entityRef,f.storageRef]),...secrets.flatMap(s=>[s.entityRef,s.paperRef])])];
}
