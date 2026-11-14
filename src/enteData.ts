import { DataUpgradeConflict, makeAsset, upgradeDataset, type CurrentDataset, type Dataset } from './models';
import { recordControl, undoControl } from './controlRecords';
import { securityEntitySchema, type SecurityEntity, type SecurityRelation } from './securityModel';
import { enteStore, enteStoreSchema, enteTaskSchema, enteReceiptCurrent, enteReceiptClosure, enteSnapshot, type EnteReceipt, type EnteStore, type EnteTask } from './enteSchemas';

const nowString=()=>new Date().toISOString();
const label=(data:CurrentDataset,en:string,ja:string)=>data.settings.language==='ja'?ja:en;
export function writableEnte(data:Dataset):CurrentDataset{
  const next=upgradeDataset(data),model=next.securityModel;
  if(model.revision<12&&Object.hasOwn(model,'enteV1')||model.revision>=12&&Object.hasOwn(model,'enteV1')&&!enteStoreSchema.safeParse(model.enteV1).success)throw new DataUpgradeConflict();
  return {...next,securityModel:{...model,revision:model.revision>=12?model.revision:12}};
}
export const enteStoreFor=(data:CurrentDataset):EnteStore=>enteStore(data)??enteStoreSchema.parse({version:1});
export const putEnteStore=(data:CurrentDataset,store:EnteStore):CurrentDataset=>({...data,securityModel:{...data.securityModel,revision:data.securityModel.revision>=12?data.securityModel.revision:12,enteV1:store}});
export const enteTask=(data:Dataset,id:string)=>enteStore(data)?.tasks.find(t=>t.id===id);
export const putEnteTask=(data:CurrentDataset,task:EnteTask):CurrentDataset=>{const s=enteStoreFor(data);return putEnteStore(data,{...s,tasks:[...s.tasks.filter(t=>t.id!==task.id),task]});};
export const putEnteEntity=(data:CurrentDataset,value:SecurityEntity):CurrentDataset=>({...data,securityModel:{...data.securityModel,entities:[...data.securityModel.entities.filter(e=>e.id!==value.id),value]}});

export function ownEnteApp(data:Dataset,appRef:string,at=nowString()):CurrentDataset{
  const next=writableEnte(data),app=next.securityModel.entities.find(e=>e.id===appRef),s=enteStoreFor(next);
  if(app?.kind!=='installation'||app.productId!=='ente-auth')throw new Error('invalid-ente-app');
  return s.profiles.some(p=>p.appRef===appRef)?next:putEnteStore(next,{...s,profiles:[...s.profiles,{appRef,createdAt:at}]});
}
export function createEnteApp(data:Dataset,deviceRef:string,reuseRef?:string,at=nowString()):{data:CurrentDataset;appRef:string}{
  let next=writableEnte(data);const device=next.assets.find(a=>a.id===deviceRef&&a.kind==='device'&&['ios','android'].includes(a.operatingSystem??''));
  if(!device)throw new Error('invalid-ente-device');
  const existing=reuseRef?next.securityModel.entities.find(e=>e.id===reuseRef&&e.kind==='installation'&&e.productId==='ente-auth'&&e.deviceRef===deviceRef):undefined;
  if(reuseRef&&!existing)throw new Error('invalid-ente-destination');
  const entity=existing??securityEntitySchema.parse({id:crypto.randomUUID(),kind:'installation',productId:'ente-auth',deviceRef,label:`Ente Auth · ${device.name}`.slice(0,80),createdAt:at,controls:{},controlEvidence:{}});
  if(!existing)next=putEnteEntity(next,entity);
  return {data:ownEnteApp(next,entity.id,at),appRef:entity.id};
}
export function createEnteRoot(data:Dataset,reuseRef?:string,at=nowString()):{data:CurrentDataset;rootRef:string}{
  let next=writableEnte(data),s=enteStoreFor(next);
  const existing=reuseRef?next.assets.find(a=>a.id===reuseRef&&a.kind==='account'&&a.provider==='ente'):undefined;
  if(reuseRef&&!existing)throw new Error('invalid-ente-account');
  const account=existing??{...makeAsset({kind:'account',type:'Identity provider',name:`Ente Account ${next.assets.filter(a=>a.provider==='ente').length+1}`,importance:'critical'}),provider:'ente' as const,purpose:'personal' as const,createdAt:at,updatedAt:at};
  if(!existing)next={...next,assets:[...next.assets,account]};
  if(!s.roots.some(r=>r.rootRef===account.id)){s={...s,roots:[...s.roots,{rootRef:account.id,createdAt:at,epoch:crypto.randomUUID(),products:[],datasets:{},sharedScope:'unknown'}]};next=putEnteStore(next,s);}
  return {data:next,rootRef:account.id};
}
type StartOptions={kind:EnteTask['kind'];appRef:string;origin:EnteTask['origin'];accountRef?:string;rootRef?:string;returnCursor?:string;scopePath?:string;phoneRef?:string;newDeviceRef?:string};
export function startEnteTask(data:Dataset,options:StartOptions,at=nowString(),force=false):{data:CurrentDataset;id:string}{
  const next=ownEnteApp(data,options.appRef,at),s=enteStoreFor(next),app=next.securityModel.entities.find(e=>e.id===options.appRef);
  if(options.rootRef&&!s.roots.some(r=>r.rootRef===options.rootRef))throw new Error('invalid-ente-task-account');
  if(options.newDeviceRef&&!next.assets.some(a=>a.id===options.newDeviceRef&&a.kind==='device'&&['ios','android'].includes(a.operatingSystem??'')))throw new Error('invalid-ente-new-phone');
  if(options.origin==='phone'){
    const phone=next.deviceWorkflows.find(w=>w.id===options.phoneRef);
    if(!['move','restore'].includes(options.kind)||!phone||app?.kind!=='installation'||phone.oldDeviceRef!==app.deviceRef||phone.newDeviceRef!==options.newDeviceRef||options.kind==='move'&&phone.answers.availability!=='available')throw new Error('invalid-ente-phone-context');
  }
  const pending=force?undefined:s.tasks.find(t=>t.kind===options.kind&&t.appRef===options.appRef&&t.origin===options.origin&&t.accountRef===options.accountRef&&t.rootRef===options.rootRef&&t.returnCursor===options.returnCursor&&t.scopePath===options.scopePath&&t.phoneRef===options.phoneRef&&t.newDeviceRef===options.newDeviceRef&&['active','deferred'].includes(t.status));
  if(pending)return {data:putEnteTask(next,{...pending,status:'active',updatedAt:at}),id:pending.id};
  const task=enteTaskSchema.parse({id:crypto.randomUUID(),...options,...(['account','recovery'].includes(options.kind)?{stepwiseSignInV1:1}:{}),createdAt:at,updatedAt:at,sourceSnapshot:enteSnapshot(next.securityModel,options.appRef)});
  return {data:putEnteStore(next,{...s,tasks:[...s.tasks,task]}),id:task.id};
}
export function withdrawEnteReceipt(data:Dataset,taskId:string,stepId:string,at=nowString()):Dataset{
  if(data.version!==2)return data;const s=enteStore(data),task=enteTask(data,taskId),first=task?.records[stepId];if(!s||!task||!first)return data;
  const revoked=new Set([first]);let change=true;
  while(change){change=false;for(const receipt of s.receipts)if(!receipt.revokedAt&&!revoked.has(receipt.id)&&receipt.requires.some(id=>revoked.has(id))){revoked.add(receipt.id);change=true;}}
  let next=putEnteStore(data,{...s,receipts:s.receipts.map(r=>revoked.has(r.id)?{...r,revokedAt:at}:r),tasks:s.tasks.map(t=>Object.values(t.records).some(id=>revoked.has(id))?{...t,status:'active',updatedAt:at}:t)});
  for(const action of data.actions)if(typeof action.enteReceiptRef==='string'&&revoked.has(action.enteReceiptRef)&&action.targetId&&action.controlId)next=undoControl(next,action.id,action.targetId,action.controlId,{state:'unknown',evidence:'not-assessed'},at) as CurrentDataset;
  const facts=new Set(s.proofs.filter(p=>p.receiptRefs.some(id=>revoked.has(id))).map(p=>p.factRef)),links=new Set(s.links.filter(l=>l.receiptRefs.some(id=>revoked.has(id))).map(l=>l.relationRef));
  return {...next,securityModel:{...next.securityModel,facts:next.securityModel.facts.map(f=>facts.has(f.id)?{...f,state:'unknown',evidence:'unknown'}:f),relations:next.securityModel.relations.map(l=>links.has(l.id)?{...l,evidence:'unknown'}:l)}};
}
export function appendEnteReceipt(data:CurrentDataset,taskId:string,observation:{stepId:string;refs:string[];requires?:string[];titleEn?:string;titleJa?:string},at=nowString()):{data:CurrentDataset;receipt:EnteReceipt}{
  let next=data;const task=enteTask(next,taskId),before=enteStore(next);if(!task||!before||task.status==='cancelled')throw new Error('invalid-ente-observation');
  const ids=new Set([...next.assets,...next.securityModel.entities].map(e=>e.id));
  if(observation.refs.some(ref=>!ids.has(ref))||(observation.requires??[]).some(id=>!enteReceiptCurrent(before,id)))throw new Error('invalid-ente-prerequisite');
  if(task.records[observation.stepId])next=withdrawEnteReceipt(next,taskId,observation.stepId,at) as CurrentDataset;
  const s=enteStoreFor(next),current=enteTask(next,taskId)!;
  const receipt:EnteReceipt={id:crypto.randomUUID(),taskRef:taskId,at,...observation,requires:observation.requires??[]};
  next=putEnteStore(next,{...s,receipts:[...s.receipts,receipt]});
  next=putEnteTask(next,{...current,status:'active',updatedAt:at,records:{...current.records,[receipt.stepId]:receipt.id}});
  return {data:next,receipt};
}
export function recordEnteControl(data:CurrentDataset,r:EnteReceipt,targetId:string,controlId:string):CurrentDataset{
  return recordControl(data,targetId,controlId,{id:`${r.id}#${controlId}`,parentId:r.id,origin:'ente',enteReceiptRef:r.id},r.at) as CurrentDataset;
}
export function recordEnteLink(data:CurrentDataset,r:EnteReceipt,fromRef:string,toRef:string,kind:SecurityRelation['kind'],sources:string[],historical=false):CurrentDataset{
  const relation:SecurityRelation={id:crypto.randomUUID(),fromRef,toRef,kind,evidence:'user-confirmed',checkedAt:r.at,sourceIds:sources};
  const s=enteStoreFor(data);return putEnteStore({...data,securityModel:{...data.securityModel,relations:[...data.securityModel.relations,relation]}},{...s,links:[...s.links,{relationRef:relation.id,historical,receiptRefs:[r.id]}]});
}
function receiptClaim(data:CurrentDataset,id:string,claim:Partial<EnteReceipt>):CurrentDataset{
  const s=enteStoreFor(data);return putEnteStore(data,{...s,receipts:s.receipts.map(r=>r.id===id?{...r,...claim}:r)});
}
export function recordEnteStorage(data:CurrentDataset,r:EnteReceipt,appRef:string,mode:'offline'|'account',rootRef?:string,sources:string[]=[]):CurrentDataset{
  let next=data,s=enteStoreFor(next);const app=next.securityModel.entities.find(e=>e.id===appRef),profile=s.profiles.find(p=>p.appRef===appRef);
  if(app?.kind!=='installation'||!profile||mode==='account'&&(!rootRef||!s.roots.some(a=>a.rootRef===rootRef))||mode==='offline'&&rootRef)throw new Error('invalid-ente-storage');
  const previous=s.configurations.find(c=>c.id===profile.configRef),same=previous?.mode===mode&&previous.rootRef===rootRef;
  let config=previous;
  if(!same){
    const root=rootRef?s.roots.find(a=>a.rootRef===rootRef):undefined,existing=root?.datasets.auth;
    const datasetRef=existing??crypto.randomUUID();
    if(!existing)next=putEnteEntity(next,securityEntitySchema.parse({id:datasetRef,kind:'data-set',dataType:'other',ownerRef:rootRef??appRef,label:mode==='account'?label(data,'Ente Account · Auth codes','Ente Accountの認証コード'):label(data,'Ente Auth · local codes','この端末のEnte認証コード'),createdAt:r.at}));
    config={id:crypto.randomUUID(),appRef,mode,rootRef,datasetRef,epoch:crypto.randomUUID(),createdAt:r.at};
    s={...s,configurations:[...s.configurations,config],profiles:s.profiles.map(p=>p.appRef===appRef?{...p,configRef:config!.id}:p),roots:s.roots.map(a=>a.rootRef===rootRef?{...a,products:[...new Set([...a.products,'auth' as const])],datasets:{...a.datasets,auth:datasetRef}}:a)};
    const ownedLinks=new Set(s.links.map(l=>l.relationRef));next={...next,securityModel:{...next.securityModel,relations:next.securityModel.relations.map(l=>ownedLinks.has(l.id)&&l.fromRef===appRef&&l.kind==='synced-via'?{...l,evidence:'unknown'}:l)}};
  }
  next=putEnteStore(next,s);
  const updated={...app,codeStorage:mode==='offline'?'local' as const:'account' as const};
  delete updated.syncAccountRef;if(rootRef)updated.syncAccountRef=rootRef;
  next=putEnteEntity(next,updated);next=receiptClaim(next,r.id,{configRef:config!.id});
  next=recordEnteControl(next,r,appRef,'storageChecked');
  if(rootRef){next=recordEnteLink(next,r,appRef,rootRef,'synced-via',sources);next=recordEnteLink(next,r,config!.datasetRef,rootRef,'stored-in',sources);}
  else next=recordEnteLink(next,r,config!.datasetRef,app.deviceRef,'stored-in',sources);
  return next;
}
export function recordEnteLock(data:CurrentDataset,r:EnteReceipt,appRef:string,mode:'device'|'pin'|'password',changed=false,sources:string[]=[]):CurrentDataset{
  let next=data,s=enteStoreFor(next);const profile=s.profiles.find(p=>p.appRef===appRef),old=s.locks.find(l=>l.id===profile?.lockRef);
  if(!profile)throw new Error('invalid-ente-lock-app');
  let lock=old;
  if(changed||!old||old.mode!==mode){
    if(old?.credentialRef)next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[old.credentialRef]:{...next.securityModel.lifecycle[old.credentialRef],state:'revoked',evidence:'user-confirmed',updatedAt:r.at,accessResetAt:r.at}}}};
    let credentialRef:string|undefined;
    if(mode!=='device'){credentialRef=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id:credentialRef,kind:'credential',credentialType:'password',subjectRef:appRef,roles:['local-unlock'],label:mode==='pin'?'Ente Auth · PIN':label(data,'Ente Auth app lock password','Ente Authのアプリロック用パスワード'),createdAt:r.at}));}
    lock={id:crypto.randomUUID(),appRef,mode,credentialRef,createdAt:r.at};s={...s,locks:[...s.locks,lock],profiles:s.profiles.map(p=>p.appRef===appRef?{...p,lockRef:lock!.id}:p)};
  }
  next=putEnteStore(next,s);next=receiptClaim(next,r.id,{lockRef:lock!.id});
  if(lock!.credentialRef)next=recordEnteLink(next,r,lock!.credentialRef,appRef,'unlocks',sources);
  return recordEnteControl(next,r,appRef,'appLock');
}
type SecretPurpose=EnteStore['secrets'][number]['purpose'];
const secretLabel=(data:CurrentDataset,purpose:SecretPurpose)=>({export:['Ente export passphrase','Enteの手動書き出し用の語句'],automatic:['Ente automatic-backup passphrase','Enteの自動バックアップ用の語句'],'account-password':['Ente Account password','Ente Accountのパスワード'],'recovery-key':['Ente Account recovery key','Ente Accountの復旧キー']})[purpose][data.settings.language==='ja'?1:0];
export function makeEnteSecret(data:CurrentDataset,r:EnteReceipt,ownerRef:string,purpose:SecretPurpose,storage?:'paper'|{ref:string},reuseRef?:string,sources:string[]=[]):{data:CurrentDataset;secretRef:string}{
  let next=data,s=enteStoreFor(next);
  const rootSecret=['account-password','recovery-key'].includes(purpose);
  const currentRecovery=purpose==='recovery-key'?s.roots.find(a=>a.rootRef===ownerRef)?.recoveryRef:undefined;
  const existingRef=reuseRef??currentRecovery,known=existingRef?s.secrets.find(c=>c.entityRef===existingRef):undefined;
  const filePurpose=(value:string)=>['export','automatic'].includes(value);
  if(existingRef&&(!known||known.ownerRef!==ownerRef||known.purpose!==purpose&&!(filePurpose(known.purpose)&&filePurpose(purpose))))throw new Error('invalid-ente-secret-reuse');
  if(rootSecret?!s.roots.some(a=>a.rootRef===ownerRef):!s.profiles.some(p=>p.appRef===ownerRef))throw new Error('invalid-ente-secret-owner');
  let storageRef=storage&&typeof storage==='object'?storage.ref:undefined;
  if(storage==='paper'){
    storageRef=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id:storageRef,kind:'data-set',dataType:'other',ownerRef,label:`${secretLabel(data,purpose)} · ${label(data,'paper reminder','紙の控え')}`.slice(0,80),createdAt:r.at}));
  }
  if(storageRef&&![...next.assets,...next.securityModel.entities].some(e=>e.id===storageRef))throw new Error('invalid-ente-secret-storage');
  if(known){
    if(!storageRef)return {data:next,secretRef:known.entityRef};
    s={...s,secrets:s.secrets.map(c=>c.entityRef===known.entityRef?{...c,copies:[...c.copies,{storageRef:storageRef!,receiptRef:r.id}]}:c)};
    next=putEnteStore(next,s);next=recordEnteLink(next,r,known.entityRef,storageRef,'stored-in',sources);
    next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[known.entityRef]:{...next.securityModel.lifecycle[known.entityRef],state:'in-use',evidence:'user-confirmed',updatedAt:r.at}}}};
    return {data:next,secretRef:known.entityRef};
  }
  const secretRef=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id:secretRef,kind:'credential',credentialType:purpose==='recovery-key'?'recovery-key':'password',subjectRef:ownerRef,storageRef,roles:purpose==='account-password'?['sign-in','decrypt']:['restore'],label:secretLabel(data,purpose),createdAt:r.at}));
  s={...s,secrets:[...s.secrets,{entityRef:secretRef,ownerRef,purpose,storageRef,receiptRef:r.id,copies:storageRef?[{storageRef,receiptRef:r.id}]:[]}]};
  next=putEnteStore(next,s);if(storageRef)next=recordEnteLink(next,r,secretRef,storageRef,'stored-in',sources);
  return {data:next,secretRef};
}
export function recordEnteRootSecret(data:CurrentDataset,r:EnteReceipt,rootRef:string,secretRef:string,physicalPasswordChange=false,sources:string[]=[]):CurrentDataset{
  let next=data,s=enteStoreFor(next);const root=s.roots.find(a=>a.rootRef===rootRef),secret=s.secrets.find(c=>c.entityRef===secretRef&&c.ownerRef===rootRef&&['account-password','recovery-key'].includes(c.purpose));
  if(!root||!secret)throw new Error('invalid-ente-account-secret');
  if(secret.purpose==='recovery-key'&&root.recoveryRef&&root.recoveryRef!==secretRef)throw new Error('ente-recovery-key-not-rotated');
  if(secret.purpose==='account-password'&&root.passwordRef&&root.passwordRef!==secretRef&&!physicalPasswordChange)throw new Error('ente-password-change-needs-confirmation');
  if(physicalPasswordChange&&root.passwordRef&&root.passwordRef!==secretRef)next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[root.passwordRef]:{...next.securityModel.lifecycle[root.passwordRef],state:'revoked',evidence:'user-confirmed',updatedAt:r.at,accessResetAt:r.at}}}};
  const epoch=physicalPasswordChange?crypto.randomUUID():root.epoch;
  s={...s,roots:s.roots.map(a=>a.rootRef===rootRef?{...a,epoch,...(secret.purpose==='account-password'?{passwordRef:secretRef}:{recoveryRef:secretRef})}:a)};
  next=putEnteStore(next,s);next=receiptClaim(next,r.id,{rootEpoch:epoch});
  return recordEnteLink(next,r,secretRef,rootRef,secret.purpose==='account-password'?'authenticates-to':'recovers',sources);
}
export function saveEnteFile(data:CurrentDataset,r:EnteReceipt,appRef:string,secretRef:string,storageRef:string,origin:'export'|'automatic',sources:string[]=[]):{data:CurrentDataset;fileRef:string}{
  const s=enteStoreFor(data),app=data.securityModel.entities.find(e=>e.id===appRef),secret=s.secrets.find(c=>c.entityRef===secretRef&&['export','automatic'].includes(c.purpose));
  if(app?.kind!=='installation'||!s.profiles.some(p=>p.appRef===appRef)||!secret||![...data.assets,...data.securityModel.entities].some(e=>e.id===storageRef))throw new Error('invalid-ente-file');
  const fileRef=crypto.randomUUID(),entity=securityEntitySchema.parse({id:fileRef,kind:'data-set',dataType:'other',ownerRef:appRef,label:origin==='automatic'?label(data,'Ente Auth · encrypted local backup','Enteの暗号化ローカルバックアップ'):label(data,'Ente Auth · encrypted JSON export','Enteの暗号化JSON（手動書き出し）'),createdAt:r.at});
  let next=putEnteEntity(data,entity);next=putEnteStore(next,{...s,files:[...s.files,{entityRef:fileRef,appRef,secretRef,storageRef,origin,role:'source',groupRef:fileRef,receiptRef:r.id,snapshot:enteSnapshot(data.securityModel,appRef),createdAt:r.at}]});
  next=recordEnteLink(next,r,fileRef,storageRef,'stored-in',sources);next=recordEnteLink(next,r,secretRef,fileRef,'decrypts',sources);next=recordEnteLink(next,r,fileRef,appRef,'backs-up',sources);
  return {data:next,fileRef};
}
export function copyEnteFile(data:CurrentDataset,r:EnteReceipt,fileRef:string,storageRef:string,role:'permanent'|'transfer',sources:string[]=[]):{data:CurrentDataset;fileRef:string}{
  const s=enteStoreFor(data),file=s.files.find(f=>f.entityRef===fileRef),original=data.securityModel.entities.find(e=>e.id===fileRef);
  if(!file||original?.kind!=='data-set'||![...data.assets,...data.securityModel.entities].some(e=>e.id===storageRef))throw new Error('invalid-ente-file-copy');
  const app=data.securityModel.entities.find(e=>e.id===file.appRef);
  if(role==='permanent'&&(app?.kind==='installation'&&app.deviceRef===storageRef||file.origin==='automatic'&&file.storageRef===storageRef))throw new Error('ente-copy-is-not-independent');
  const id=crypto.randomUUID(),entity={...original,id,label:role==='permanent'?label(data,'Ente Auth · encrypted copy at a separate location','Enteの暗号化コピー（別の保管先）'):label(data,'Ente Auth · temporary transfer copy','新端末に受け取ったEnteの一時コピー'),createdAt:r.at};
  let next=putEnteEntity(data,entity);next=putEnteStore(next,{...s,files:[...s.files,{...file,entityRef:id,storageRef,role,receiptRef:r.id,createdAt:r.at}]});
  next=recordEnteLink(next,r,id,storageRef,'stored-in',sources);next=recordEnteLink(next,r,id,fileRef,'restores-from',sources,true);next=recordEnteLink(next,r,file.secretRef,id,'decrypts',sources);
  return {data:next,fileRef:id};
}
export function confirmEnteExternalFile(data:CurrentDataset,r:EnteReceipt,fileRef:string):CurrentDataset{
  const s=enteStoreFor(data),file=s.files.find(f=>f.entityRef===fileRef),app=data.securityModel.entities.find(e=>e.id===file?.appRef);
  // An ordinary export already saved off the phone needs an access check,
  // not a second physical copy. Automatic folders retain at most five files;
  // their separately retained copy must be outside that managed folder.
  if(!file||file.origin!=='export'||app?.kind!=='installation'||file.storageRef===app.deviceRef)throw new Error('ente-file-needs-separate-copy');
  return putEnteStore(data,{...s,files:s.files.map(f=>f.entityRef===fileRef?{...f,role:'permanent',receiptRef:r.id}:f)});
}
export type EnteProofInput={kind:EnteStore['proofs'][number]['kind'];appRef?:string;configRef?:string;rootRef?:string;rootEpoch?:string};
export function recordEnteProof(data:CurrentDataset,r:EnteReceipt,proof:EnteProofInput,observation:{label:string;targetRef:string;requiredRefs:string[];purpose:'sign-in'|'second-step'|'decrypt'|'restore';context:'normal'|'new-device'|'no-existing-session';withoutRefs?:string[]},sources:string[]=[]):CurrentDataset{
  const s=enteStoreFor(data),id=crypto.randomUUID(),config=s.configurations.find(c=>c.id===proof.configRef),app=data.securityModel.entities.find(e=>e.id===proof.appRef);
  if(proof.appRef&&(app?.kind!=='installation'||!observation.requiredRefs.includes(app.id)||!observation.requiredRefs.includes(app.deviceRef)||!r.refs.includes(app.id)||!r.refs.includes(app.deviceRef)))throw new Error('invalid-ente-use-scope');
  const requiredRefs=[...new Set([...observation.requiredRefs,...(config?.rootRef?[config.rootRef]:[]),...(proof.rootRef?[proof.rootRef]:[])])];
  const fact={id,label:observation.label,state:'available' as const,evidence:'user-confirmed' as const,checkedAt:r.at,requiredRefs,contexts:[observation.context],dependencyCompleteness:'partial' as const,sourceIds:sources,...(observation.withoutRefs?.length?{observedWithoutRefs:observation.withoutRefs}:{})};
  const route={id:crypto.randomUUID(),label:observation.label,targetRef:observation.targetRef,purpose:observation.purpose,contexts:[observation.context],requirements:{kind:'fact' as const,factId:id},sourceIds:sources};
  return putEnteStore({...data,securityModel:{...data.securityModel,facts:[...data.securityModel.facts,fact],routes:[...data.securityModel.routes,route]}},{...s,proofs:[...s.proofs,{...proof,factRef:id,directReceiptRef:r.id,receiptRefs:enteReceiptClosure(s,[r.id])}]});
}
