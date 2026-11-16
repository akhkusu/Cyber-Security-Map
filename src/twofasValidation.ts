import type { CurrentDataset } from './models';
import { twofasStoreSchema } from './twofasSchemas';
export function twofasIssues(data: Pick<CurrentDataset,'assets'|'securityModel'|'deviceWorkflows'>): string[] {
  if (data.securityModel.revision < 11 || !Object.hasOwn(data.securityModel,'twofasV1')) return [];
  const parsed = twofasStoreSchema.safeParse(data.securityModel.twofasV1);
  if (!parsed.success) return ['invalid-twofas-store'];
  const store=parsed.data, model=data.securityModel, ids=new Set([...data.assets,...model.entities].map(e=>e.id));
  const apps = new Set(store.profiles.map(p=>p.appRef));
  const unique=(values:string[])=>new Set(values).size===values.length;
  if (!unique([...store.profiles.map(p=>p.appRef)]) || !unique(store.tasks.map(t=>t.id)) || !unique(store.receipts.map(r=>r.id))) return ['duplicate-twofas-record'];
  if (store.profiles.some(p=>!model.entities.some(e=>e.id===p.appRef&&e.kind==='installation'&&e.productId==='2fas-auth') || p.pinRef&&!model.entities.some(e=>e.id===p.pinRef&&e.kind==='credential'&&e.subjectRef===p.appRef&&e.roles.includes('local-unlock')))) return ['invalid-twofas-profile'];
  if (store.tasks.some(t=>!apps.has(t.appRef)||t.destinationRef&&!apps.has(t.destinationRef)||t.newDeviceRef&&!data.assets.some(a=>a.id===t.newDeviceRef&&a.kind==='device')||t.origin==='phone'&&!data.deviceWorkflows.some(w=>w.id===t.phoneRef)||t.accountRef&&!data.assets.some(a=>a.id===t.accountRef&&a.kind==='account')||Object.values(t.records).some(ref=>!store.receipts.some(r=>r.id===ref&&r.taskRef===t.id))||t.fileRef&&!store.files.some(f=>f.entityRef===t.fileRef))) return ['invalid-twofas-task'];
  if(store.tasks.some(t=>t.transferFileRef&&!store.files.some(f=>f.entityRef===t.transferFileRef)||t.assignedPinRef&&!model.entities.some(e=>e.id===t.assignedPinRef&&e.kind==='credential'&&e.roles.includes('local-unlock')&&[t.appRef,t.destinationRef].includes(e.subjectRef))||t.reusedSyncRef&&!store.syncSettings.some(s=>s.appRef===t.appRef&&s.receiptRef===t.reusedSyncRef)))return ['invalid-twofas-task-reference'];
  if(store.secrets.some(s=>!apps.has(s.appRef)||![s.entityRef,s.paperRef].every(id=>ids.has(id))||!store.receipts.some(r=>r.id===s.receiptRef)))return ['invalid-twofas-secret-reference'];
  if(store.syncSettings.some(s=>!apps.has(s.appRef)||s.rootRef&&!data.assets.some(a=>a.id===s.rootRef&&a.kind==='account')||s.secretRef&&!store.secrets.some(c=>c.entityRef===s.secretRef)||!store.receipts.some(r=>r.id===s.receiptRef)))return ['invalid-twofas-sync-setting'];
  if (store.receipts.some(r=>!store.tasks.some(t=>t.id===r.taskRef)||r.refs.some(id=>!ids.has(id))||r.requires.some(id=>!store.receipts.some(p=>p.id===id)))) return ['invalid-twofas-receipt'];
  if(store.receipts.some(r=>r.pinRef&&!model.entities.some(e=>e.id===r.pinRef&&e.kind==='credential'&&e.roles.includes('local-unlock')&&r.refs.includes(e.subjectRef))))return ['invalid-twofas-pin-reference'];
  if(store.clouds.some(c=>![c.entityRef,c.appRef,c.rootRef,...(c.secretRef?[c.secretRef]:[])].every(id=>ids.has(id))||!apps.has(c.appRef)||!store.receipts.some(r=>r.id===c.receiptRef)))return ['invalid-twofas-cloud'];
  if (store.files.some(f=>!apps.has(f.appRef)||![f.entityRef,f.secretRef,f.storageRef].every(id=>ids.has(id))||!store.receipts.some(r=>r.id===f.receiptRef))) return ['invalid-twofas-file'];
  if (store.proofs.some(p=>!model.facts.some(f=>f.id===p.factRef)||p.receiptRefs.some(id=>!store.receipts.some(r=>r.id===id)))||store.links.some(p=>!model.relations.some(r=>r.id===p.relationRef)||p.receiptRefs.some(id=>!store.receipts.some(r=>r.id===id)))) return ['invalid-twofas-proof'];
  return [];
}
