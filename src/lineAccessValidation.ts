import type { CurrentDataset } from './models';
import { lineAccessStoreSchema } from './lineAccessSchemas';
import { lineStore } from './lineSchemas';

export function lineAccessIssues(data:Pick<CurrentDataset,'assets'|'securityModel'|'deviceWorkflows'>):string[]{
  const model=data.securityModel;if(model.revision<14||!Object.hasOwn(model,'lineAccessV1'))return [];
  const parsed=lineAccessStoreSchema.safeParse(model.lineAccessV1);if(!parsed.success)return ['invalid-line-access-store'];
  const s=parsed.data,base=lineStore({securityModel:model}),all=[...data.assets,...model.entities],ids=new Set<string>(),tasks=new Set<string>();
  for(const record of [...s.profiles,...s.operations]){if(ids.has(record.id)||all.some(e=>e.id===record.id))return ['duplicate-line-access-record'];ids.add(record.id);}
  const device=(id?:string)=>data.assets.some(a=>a.id===id&&a.kind==='device'),key=(id?:string)=>model.entities.find(e=>e.id===id&&e.kind==='credential'&&e.credentialType==='passkey');
  for(const p of s.profiles){
    const t=base?.tasks.find(t=>t.id===p.lineTaskRef),v=model.entities.find(v=>v.id===p.storeRef&&v.kind==='vault');
    if(!t||tasks.has(t.id))return ['invalid-line-access-profile'];tasks.add(t.id);
    if(p.storeRef&&(v?.kind!=='vault'||!['apple-passwords','google-password-manager'].includes(v.productId)||v.storageMode!=='account'||v.authenticationAccountRef!==p.rootRef))return ['invalid-line-passkey-store'];
    if(p.rootRef&&!data.assets.some(a=>a.id===p.rootRef&&a.kind==='account'&&a.provider===(v?.kind==='vault'&&v.productId==='apple-passwords'?'apple':'google')))return ['invalid-line-passkey-root'];
    const k=key(p.keyRef);if(p.keyRef&&(k?.kind!=='credential'||k.subjectRef!==t.accountRef||k.storageRef!==p.storeRef||!k.roles.includes('sign-in')))return ['invalid-line-passkey'];
    for(const [id,deviceRef] of [[p.sourceStoreAppRef,t.oldDeviceRef],[p.newStoreAppRef,t.newDeviceRef]])if(id){const app=model.entities.find(e=>e.id===id);if(app?.kind!=='installation'||app.vaultRef!==p.storeRef||app.deviceRef!==deviceRef)return ['invalid-line-passkey-app'];}
    if(p.operationRef&&!s.operations.some(o=>o.id===p.operationRef&&o.profileRef===p.id&&o.lineTaskRef===t.id))return ['invalid-line-passkey-operation-owner'];
  }
  for(const o of s.operations){
    const p=s.profiles.find(p=>p.id===o.profileRef),v=model.entities.find(e=>e.id===o.storeRef),root=data.assets.find(a=>a.id===o.rootRef),account=data.assets.find(a=>a.id===o.accountRef);
    if(!p||p.lineTaskRef!==o.lineTaskRef||!device(o.deviceRef)||account?.provider!=='line'||v?.kind!=='vault'||v.authenticationAccountRef!==o.rootRef||root?.kind!=='account')return ['invalid-line-passkey-operation'];
    const k=key(o.candidateRef);if(o.phase==='registered'&&(!o.registeredAt||k?.kind!=='credential'||k.subjectRef!==o.accountRef||k.storageRef!==o.storeRef)||o.phase==='cancelled'&&!o.cancelledAt||o.phase==='requested'&&all.some(e=>e.id===o.candidateRef))return ['invalid-line-passkey-operation-result'];
  }
  return [];
}
