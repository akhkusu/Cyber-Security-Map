import type {AccessFact,SecurityModel,SecurityRelation} from './securityModel';
import {planPhysicalRefs} from './accessPlanEvidence';
import {protectionStoreSchema,protectionSettingKey,type ProtectionRecord,type ProtectionTask} from './deviceProtectionSchemas';

export function protectionActorSignature(model:SecurityModel,ref:string):string{
  const e=model.entities.find(e=>e.id===ref);if(!e)return JSON.stringify([ref,'asset']);
  if(e.kind==='installation')return JSON.stringify([e.id,e.kind,e.productId,e.deviceRef,e.vaultRef,e.syncAccountRef,e.codeStorage,e.platformVariant,e.mergedIntoRef]);
  if(e.kind==='phone-line')return JSON.stringify([e.id,e.kind,e.deviceRef,e.carrierAccountRef,e.simType]);
  if(e.kind==='session')return JSON.stringify([e.id,e.kind,e.accountRef,e.installationRef,e.deviceRef,e.expiresAt]);
  if(e.kind==='credential')return JSON.stringify([e.id,e.kind,e.subjectRef,e.storageRef,e.credentialType,e.roles,e.replicaGroupId]);
  return JSON.stringify([e.id,e.kind]);
}
export const protectionActorEpoch=(model:SecurityModel,ref:string)=>model.lifecycle[ref]?.accessResetAt??null;
export function protectionRecordCurrent(model:SecurityModel,task:ProtectionTask,id:string,visiting=new Set<string>()):boolean{
  const record=task.records[id];if(!record||record.withdrawnAt||visiting.has(id)||visiting.size>256)return false;
  const parsed=protectionStoreSchema.safeParse(model.deviceProtectionV1);if(!parsed.success)return false;
  for(const [ref,signature] of Object.entries(record.actorSignatures))if(protectionActorSignature(model,ref)!==signature)return false;
  for(const [ref,epoch] of Object.entries(record.actorEpochs))if(protectionActorEpoch(model,ref)!==epoch)return false;
  for(const [key,generation] of Object.entries(record.featureVersions)){const current=parsed.data.settings[key];if(!current||current.withdrawn||current.generation!==generation)return false;}
  return record.requires.every(ref=>protectionRecordCurrent(model,task,ref,new Set([...visiting,id])));
}
const sameRefs=(a:readonly string[],b:readonly string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(ref=>b.includes(ref));
function scopedRecord(model:SecurityModel,fact:AccessFact):ProtectionRecord|undefined{
  const parsed=protectionStoreSchema.safeParse(model.deviceProtectionV1);if(!parsed.success)return;
  const task=parsed.data.tasks.find(t=>t.id===fact.deviceProtectionTaskRef),id=fact.deviceProtectionRecordRef;
  if(!task||typeof id!=='string')return;const r=task.records[id];
  if(!r||r.kind!=='management-use'||!task.accountRef||!task.environmentRef||r.accountRef!==task.accountRef||!r.context||!protectionRecordCurrent(model,task,id))return;
  const enabled=task.records['find-enabled'];
  if(!enabled||enabled.kind!=='configuration'||enabled.feature!=='find-enabled'||enabled.value!=='on'||!['find-enabled','account-check','management-open'].every(ref=>r.requires.includes(ref))||r.withoutRefs.some(ref=>ref!==task.deviceRef))return;
  const session=model.entities.find(e=>e.id===task.sessionRef);if(!session||session.kind!=='session'||session.accountRef!==task.accountRef||session.installationRef!==task.environmentRef||!r.refs.includes(session.id))return;
  const required=[task.deviceRef,task.accountRef,task.environmentRef,...r.refs];
  if(required.some(ref=>!Object.hasOwn(r.actorEpochs,ref)||!Object.hasOwn(r.actorSignatures,ref)))return;
  if(!sameRefs(r.refs,planPhysicalRefs(model,r.refs)))return;
  const environment=model.entities.find(e=>e.id===task.environmentRef);if(!environment||environment.kind!=='installation'||environment.deviceRef===task.deviceRef)return;
  if(!r.refs.includes(task.accountRef)||!r.refs.includes(task.environmentRef)||r.withoutRefs.some(ref=>r.refs.includes(ref)))return;
  if(fact.checkedAt!==r.at||!sameRefs(fact.requiredRefs,r.refs)||!sameRefs(fact.contexts,[r.context])||!sameRefs(Array.isArray(fact.observedWithoutRefs)?fact.observedWithoutRefs:[],r.withoutRefs))return;
  return r;
}
export function protectionFactCurrent(model:SecurityModel,fact:AccessFact):boolean{
  if(model.revision<9)return true;
  if(fact.deviceProtectionConfigurationV1==='v1')return !!configurationRecord(model,fact);
  if(fact.deviceProtectionObservationV1==='v1')return !!scopedRecord(model,fact);
  return true;
}
export function protectionWithoutEvidence(model:SecurityModel,fact:AccessFact):boolean{
  return model.revision>=9&&fact.deviceProtectionObservationV1==='v1'&&!!scopedRecord(model,fact);
}

function configurationRecord(model:SecurityModel,fact:AccessFact):ProtectionRecord|undefined{
  const parsed=protectionStoreSchema.safeParse(model.deviceProtectionV1);if(!parsed.success)return;
  const task=parsed.data.tasks.find(t=>t.id===fact.deviceProtectionTaskRef),id=fact.deviceProtectionRecordRef;if(!task||typeof id!=='string')return;
  const r=task.records[id];if(!r||r.kind!=='configuration'||r.feature!=='find-enabled'||!r.value||!protectionRecordCurrent(model,task,id))return;
  const key=protectionSettingKey(task.deviceRef,r.feature),setting=parsed.data.settings[key];
  if(!setting||setting.withdrawn||setting.value!==r.value||setting.generation!==r.featureVersions[key]||setting.accountRef!==r.accountRef)return;
  if(!Object.hasOwn(r.actorEpochs,task.deviceRef)||!Object.hasOwn(r.actorSignatures,task.deviceRef))return;
  if(r.value==='on'&&(!r.accountRef||!r.refs.includes(r.accountRef)||!r.requires.includes('account-check')))return;
  const expected=r.value==='on'?'available':r.value==='off'?'unavailable':'unknown';
  if(fact.state!==expected||fact.checkedAt!==r.at||fact.requiredRefs.length||fact.dependencyCompleteness!=='complete'||(fact.observedWithoutRefs!==undefined&&(!Array.isArray(fact.observedWithoutRefs)||fact.observedWithoutRefs.length)))return;
  return r;
}
export function protectionBindingCurrent(model:SecurityModel,relation:SecurityRelation):boolean{
  if(model.revision<9||relation.deviceProtectionRelationV1!=='v1')return true;
  const parsed=protectionStoreSchema.safeParse(model.deviceProtectionV1);if(!parsed.success)return false;
  const task=parsed.data.tasks.find(t=>t.id===relation.deviceProtectionTaskRef),r=task?.records['management-check'];
  if(!task||!r||!r.context||!protectionRelationMatches(task,relation))return false;
  return !!scopedRecord(model,{id:'binding-check',label:'Management observation',state:'available',evidence:'user-confirmed',checkedAt:r.at,requiredRefs:r.refs,contexts:[r.context],sourceIds:[],dependencyCompleteness:'partial',observedWithoutRefs:r.withoutRefs,deviceProtectionTaskRef:task.id,deviceProtectionRecordRef:'management-check'});
}
export function protectionRelationMatches(task:ProtectionTask,relation:SecurityRelation):boolean{
  const pairs=[['management','administers',task.accountRef,task.deviceRef],['session-account','session-for',task.sessionRef,task.accountRef],['session-store','stored-in',task.sessionRef,task.environmentRef],['browser-device','installed-on',task.environmentRef,task.environmentDeviceRef]];
  return pairs.some(([role,kind,from,to])=>(relation.deviceProtectionRelationRoleV1??'management')===role&&relation.kind===kind&&relation.fromRef===from&&relation.toRef===to);
}
