import { DataUpgradeConflict, makeAsset, upgradeDataset, type CurrentDataset, type Dataset } from './models';
import { securityEntitySchema } from './securityModel';
import { putLineEntity, lineLink, updateLineTask } from './lineData';
import { lineTask, type LineTask, type LineReceipt } from './lineSchemas';
import { lineAccessStore, lineAccessStoreSchema, lineAccessProfile, lineKeyOperation, type LineAccessStore, type LineAccessProfile } from './lineAccessSchemas';

export function writableLineAccess(data:Dataset):CurrentDataset{
  const next=upgradeDataset(data),m=next.securityModel;
  if(Object.hasOwn(m,'lineAccessV1')&&(m.revision<14||!lineAccessStoreSchema.safeParse(m.lineAccessV1).success))throw new DataUpgradeConflict();
  return {...next,securityModel:{...m,revision:14}};
}
export const putLineAccess=(data:CurrentDataset,s:LineAccessStore):CurrentDataset=>({...data,securityModel:{...data.securityModel,revision:14,lineAccessV1:s}});
export function startLineAccess(data:Dataset,taskId:string,at=new Date().toISOString()):CurrentDataset{
  let next=writableLineAccess(data);if(!lineTask(next,taskId))throw Error('missing-line-task');
  const s=lineAccessStore(next)??lineAccessStoreSchema.parse({version:1});if(s.profiles.some(p=>p.lineTaskRef===taskId))return next;
  next=putLineAccess(next,{...s,profiles:[...s.profiles,{id:crypto.randomUUID(),lineTaskRef:taskId,createdAt:at}]});return next;
}
export function updateLineAccess(data:CurrentDataset,p:LineAccessProfile):CurrentDataset{
  const s=lineAccessStore(data)!;return putLineAccess(data,{...s,profiles:s.profiles.map(v=>v.id===p.id?p:v)});
}
export function selectLineKeyStore(data:CurrentDataset,t:LineTask,value:string):CurrentDataset{
  let p=lineAccessProfile(data,t.id)!;
  if(value.startsWith('vault:')){
    const v=data.securityModel.entities.find(e=>e.id===value.slice(6)&&e.kind==='vault');
    if(v?.kind!=='vault'||!['apple-passwords','google-password-manager'].includes(v.productId)||v.storageMode!=='account'||!v.authenticationAccountRef)throw Error('unsupported-line-key-store');
    p={...p,...(p.storeRef!==v.id?{keyRef:undefined,sourceStoreAppRef:undefined,newStoreAppRef:undefined,operationRef:undefined}:{}),storeRef:v.id,rootRef:v.authenticationAccountRef};return updateLineAccess(data,p);
  }
  if(value==='apple'||value==='google')return updateLineAccess(data,{...p,storeRef:undefined,rootRef:undefined,keyRef:undefined,sourceStoreAppRef:undefined,newStoreAppRef:undefined,operationRef:undefined});
  return data;
}
export function selectLineKeyRoot(data:CurrentDataset,t:LineTask,value:string,at:string):CurrentDataset{
  let next=data,p=lineAccessProfile(next,t.id)!;const product=t.answers['access2:store']==='apple'?'apple-passwords':'google-password-manager',provider=product==='apple-passwords'?'apple':'google';
  let rootRef=value.slice(8);
  if(value==='add'){
    const account={...makeAsset({kind:'account',type:'Identity provider',name:`${provider==='apple'?'Apple Account':'Google Account'} ${next.assets.filter(a=>a.provider===provider).length+1}`,importance:'critical'}),provider:provider as 'apple'|'google',purpose:'personal' as const,createdAt:at,updatedAt:at};rootRef=account.id;next={...next,assets:[...next.assets,account]};
  }
  if(!next.assets.some(a=>a.id===rootRef&&a.kind==='account'&&a.provider===provider))throw Error('wrong-line-key-root');
  let vault=next.securityModel.entities.find(e=>e.kind==='vault'&&!e.mergedIntoRef&&e.productId===product&&e.storageMode==='account'&&e.authenticationAccountRef===rootRef);
  if(!vault){vault=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'vault',productId:product,authenticationAccountRef:rootRef,storageMode:'account',label:product==='apple-passwords'?'Apple Passwords · LINE':'Google Password Manager · LINE',createdAt:at});next=putLineEntity(next,vault);}
  p={...p,rootRef,storeRef:vault.id,keyRef:undefined,sourceStoreAppRef:undefined,newStoreAppRef:undefined,operationRef:undefined};return updateLineAccess(next,p);
}
export function recordLineKeyStore(data:CurrentDataset,t:LineTask,r:LineReceipt,deviceRef:string,newPhone:boolean):CurrentDataset{
  let next=data,p=lineAccessProfile(next,t.id)!,vault=next.securityModel.entities.find(e=>e.id===p.storeRef&&e.kind==='vault');if(vault?.kind!=='vault'||!p.rootRef)throw Error('missing-line-key-store');
  let app=next.securityModel.entities.find(e=>e.kind==='installation'&&!e.mergedIntoRef&&e.vaultRef===vault.id&&e.deviceRef===deviceRef);
  if(!app){app=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'installation',productId:vault.productId,vaultRef:vault.id,deviceRef,label:`${vault.productId==='apple-passwords'?'Apple Passwords':'Google Password Manager'} · ${next.assets.find(a=>a.id===deviceRef)?.name??'Phone'}`.slice(0,80),createdAt:r.at});next=putLineEntity(next,app);}
  p={...p,...(newPhone?{newStoreAppRef:app.id}:{sourceStoreAppRef:app.id})};next=updateLineAccess(next,p);
  next=lineLink(next,r,app.id,deviceRef,'installed-on',['linePasskey']);next=lineLink(next,r,vault.id,p.rootRef!,'synced-via',['linePasskey']);return next;
}
export function requestLineKey(data:CurrentDataset,t:LineTask,at:string,deviceRef:string):CurrentDataset{
  const s=lineAccessStore(data)!,p=lineAccessProfile(data,t.id)!,existing=lineKeyOperation(data,t.id);
  if(existing?.phase==='requested'||existing?.phase==='registered')return data;
  if(!p.storeRef||!p.rootRef||!t.accountRef)throw Error('missing-line-key-scope');
  const o={id:crypto.randomUUID(),profileRef:p.id,lineTaskRef:t.id,accountRef:t.accountRef,deviceRef,storeRef:p.storeRef,rootRef:p.rootRef,candidateRef:crypto.randomUUID(),phase:'requested' as const,requestedAt:at};
  return putLineAccess(data,{...s,profiles:s.profiles.map(v=>v.id===p.id?{...v,operationRef:o.id}:v),operations:[...s.operations,o]});
}
export function settleLineKey(data:CurrentDataset,t:LineTask,result:'registered'|'cancelled',at:string):CurrentDataset{
  const s=lineAccessStore(data)!,p=lineAccessProfile(data,t.id)!,o=lineKeyOperation(data,t.id);if(!o||o.phase!=='requested')return data;
  let next=putLineAccess(data,{...s,operations:s.operations.map(v=>v.id===o.id?{...v,phase:result,...(result==='registered'?{registeredAt:at}:{cancelledAt:at})}:v)});
  if(result==='registered'){
    const credential=securityEntitySchema.parse({id:o.candidateRef,kind:'credential',credentialType:'passkey',subjectRef:o.accountRef,storageRef:o.storeRef,roles:['sign-in'],linePasskeyV1:true,label:next.settings.language==='ja'?'LINE · パスキー':'LINE · passkey',createdAt:at});next=putLineEntity(next,credential);next=updateLineAccess(next,{...p,keyRef:credential.id});
  }
  return next;
}
export function observeLineKey(data:CurrentDataset,t:LineTask,r:LineReceipt):CurrentDataset{
  let next=data,p=lineAccessProfile(data,t.id)!;
  if(!p.keyRef){const credential=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'credential',credentialType:'passkey',subjectRef:t.accountRef!,storageRef:p.storeRef,roles:['sign-in'],linePasskeyV1:true,label:next.settings.language==='ja'?'LINE · 確認したパスキー':'LINE · observed passkey',createdAt:r.at});next=putLineEntity(next,credential);p={...p,keyRef:credential.id};next=updateLineAccess(next,p);}
  next=lineLink(next,r,p.keyRef!,t.accountRef!,'authenticates-to',['linePasskey']);next=lineLink(next,r,p.keyRef!,p.storeRef!,'stored-in',['linePasskey']);return next;
}
export function resetLineAccessSelection(data:CurrentDataset,t:LineTask):CurrentDataset{
  const p=lineAccessProfile(data,t.id);return p?updateLineAccess(data,{...p,storeRef:undefined,rootRef:undefined,keyRef:undefined,sourceStoreAppRef:undefined,newStoreAppRef:undefined,operationRef:undefined}):data;
}
export function restartLineKeyPreparation(data:Dataset,taskId:string):Dataset{
  if(data.version!==2)return data;const t=lineTask(data,taskId),o=lineKeyOperation(data,taskId);if(!t||o?.phase!=='cancelled')return data;
  const answers={...t.answers};for(const key of ['access2:key-state','access2:key-result','access2:key-already-operated'])delete answers[key];
  const records={...t.records};for(const key of ['access2:key-state','access2:key-request','access2:key-create','access2:key-native','access2:key-result','access2:key-record','access2:key-check','future-access'])delete records[key];
  return updateLineTask(data,{...t,answers,records,cursor:'access2:key-state',history:[],status:'active'});
}
export function resumeLineKeyResult(data:Dataset,taskId:string,creation:boolean):Dataset{
  if(data.version!==2)return data;const t=lineTask(data,taskId);if(!t)return data;
  if(creation?lineKeyOperation(data,taskId)?.phase!=='requested':t.cutover?.phase!=='requested'||t.answers['transfer-method']!=='passkey')return data;
  const flag=creation?'access2:key-already-operated':'key-login:already-operated',cursor=creation?'access2:key-result':'key-login:result';
  return updateLineTask(data,{...t,answers:{...t.answers,[flag]:'yes'},cursor,history:[...t.history,t.cursor]});
}
