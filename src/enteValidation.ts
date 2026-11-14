import type { CurrentDataset } from './models';
import { enteStoreSchema } from './enteSchemas';

export function enteIssues(data:Pick<CurrentDataset,'assets'|'securityModel'|'deviceWorkflows'>):string[]{
  const model=data.securityModel;
  if(Number(model.revision)<12||!Object.hasOwn(model,'enteV1'))return [];
  const parsed=enteStoreSchema.safeParse(model.enteV1);if(!parsed.success)return ['invalid-ente-store'];
  const s=parsed.data,entities=new Map(model.entities.map(e=>[e.id,e])),assets=new Map(data.assets.map(a=>[a.id,a]));
  const ids=new Set([...entities.keys(),...assets.keys()]),profiles=new Set(s.profiles.map(p=>p.appRef)),roots=new Set(s.roots.map(r=>r.rootRef));
  const unique=(v:string[])=>v.length===new Set(v).size;
  if(![s.profiles.map(p=>p.appRef),s.roots.map(r=>r.rootRef),s.tasks.map(t=>t.id),s.receipts.map(r=>r.id),s.configurations.map(c=>c.id),s.locks.map(l=>l.id),s.files.map(f=>f.entityRef),s.secrets.map(c=>c.entityRef),s.proofs.map(p=>p.factRef),s.links.map(l=>l.relationRef)].every(unique))return ['duplicate-ente-record'];
  const receipt=(id:string)=>s.receipts.some(r=>r.id===id);
  const dataset=(id:string,owner:string)=>{const d=entities.get(id);return d?.kind==='data-set'&&d.ownerRef===owner;};
  const secret=(id:string,owner:string,purpose:string)=>s.secrets.some(c=>c.entityRef===id&&c.ownerRef===owner&&c.purpose===purpose);
  for(const p of s.profiles){
    const app=entities.get(p.appRef);
    if(app?.kind!=='installation'||app.productId!=='ente-auth'||p.configRef&&!s.configurations.some(c=>c.id===p.configRef&&c.appRef===p.appRef)||p.lockRef&&!s.locks.some(l=>l.id===p.lockRef&&l.appRef===p.appRef))return ['invalid-ente-profile'];
  }
  for(const root of s.roots){
    const account=assets.get(root.rootRef);
    if(account?.kind!=='account'||account.provider!=='ente'||root.passwordRef&&!secret(root.passwordRef,root.rootRef,'account-password')||root.recoveryRef&&!secret(root.recoveryRef,root.rootRef,'recovery-key')||Object.values(root.datasets).some(id=>!dataset(id,root.rootRef)))return ['invalid-ente-account'];
  }
  for(const c of s.configurations){
    if(!profiles.has(c.appRef)||c.mode==='account'&&(!c.rootRef||!roots.has(c.rootRef))||c.mode==='offline'&&c.rootRef||!dataset(c.datasetRef,c.rootRef??c.appRef))return ['invalid-ente-configuration'];
  }
  for(const lock of s.locks){
    const c=lock.credentialRef?entities.get(lock.credentialRef):undefined;
    if(!profiles.has(lock.appRef)||lock.mode==='device'&&!!lock.credentialRef||lock.mode!=='device'&&(c?.kind!=='credential'||c.subjectRef!==lock.appRef||c.credentialType!=='password'||!c.roles.includes('local-unlock')))return ['invalid-ente-lock'];
  }
  for(const task of s.tasks){
    if(!profiles.has(task.appRef)||task.destinationRef&&!profiles.has(task.destinationRef)||task.rootRef&&!roots.has(task.rootRef)||task.accountRef&&assets.get(task.accountRef)?.kind!=='account'||task.newDeviceRef&&assets.get(task.newDeviceRef)?.kind!=='device'||task.origin==='phone'&&!data.deviceWorkflows.some(w=>w.id===task.phoneRef)||Object.values(task.resources).some(id=>!ids.has(id)))return ['invalid-ente-task'];
    if(Object.entries(task.records).some(([stepId,id])=>!s.receipts.some(r=>r.id===id&&r.stepId===stepId&&r.taskRef===task.id)))return ['invalid-ente-task-record'];
    if(task.recoveryStateV1&&(task.kind!=='recovery'||!task.rootRef||task.recoveryStateV1.password&&!secret(task.recoveryStateV1.password.candidateRef,task.rootRef,'account-password')))return ['invalid-ente-recovery-state'];
    if(task.recoveryStateV1?.factor&&(task.recoveryStateV1.factor.type!==task.answers['recovery-screen']||task.answers['recovery-extra-state']!=='lost'))return ['invalid-ente-factor-recovery-scope'];
    if(task.kind==='recovery'&&task.resources.protectionDevice&&assets.get(task.resources.protectionDevice)?.kind!=='device')return ['invalid-ente-recovery-device'];
    if(task.stepwiseSignInV1&&!['account','recovery'].includes(task.kind))return ['invalid-ente-signin-flow'];
  }
  for(const r of s.receipts){
    if(!s.tasks.some(t=>t.id===r.taskRef)||r.refs.some(id=>!ids.has(id))||r.requires.some(id=>!receipt(id))||r.configRef&&!s.configurations.some(c=>c.id===r.configRef&&r.refs.includes(c.appRef))||r.lockRef&&!s.locks.some(l=>l.id===r.lockRef&&r.refs.includes(l.appRef)))return ['invalid-ente-receipt'];
  }
  for(const c of s.secrets){
    const entity=entities.get(c.entityRef),accountSecret=['account-password','recovery-key'].includes(c.purpose);
    if(entity?.kind!=='credential'||entity.subjectRef!==c.ownerRef||entity.credentialType!==(c.purpose==='recovery-key'?'recovery-key':'password')||c.storageRef&&!ids.has(c.storageRef)||c.copies.some(copy=>!ids.has(copy.storageRef)||!receipt(copy.receiptRef))||!receipt(c.receiptRef)||(accountSecret?!roots.has(c.ownerRef):!profiles.has(c.ownerRef)))return ['invalid-ente-secret'];
  }
  for(const setting of s.automaticSettings){
    if(!profiles.has(setting.appRef)||!receipt(setting.receiptRef)||setting.folderRef&&!ids.has(setting.folderRef)||setting.enabled&&(!setting.secretRef||!setting.folderRef)||setting.secretRef&&!s.secrets.some(c=>c.entityRef===setting.secretRef&&['export','automatic'].includes(c.purpose)))return ['invalid-ente-automatic-setting'];
  }
  for(const file of s.files){
    if(!profiles.has(file.appRef)||!dataset(file.entityRef,file.appRef)||!ids.has(file.storageRef)||!receipt(file.receiptRef)||!s.secrets.some(c=>c.entityRef===file.secretRef&&['export','automatic'].includes(c.purpose)))return ['invalid-ente-file'];
  }
  for(const proof of s.proofs){
    if(!model.facts.some(f=>f.id===proof.factRef)||!receipt(proof.directReceiptRef)||proof.receiptRefs.some(id=>!receipt(id))||proof.appRef&&!profiles.has(proof.appRef)||proof.configRef&&!s.configurations.some(c=>c.id===proof.configRef&&c.appRef===proof.appRef)||proof.rootRef&&!roots.has(proof.rootRef))return ['invalid-ente-proof'];
  }
  if(s.links.some(l=>!model.relations.some(r=>r.id===l.relationRef)||l.receiptRefs.some(id=>!receipt(id))))return ['invalid-ente-link'];
  return [];
}
