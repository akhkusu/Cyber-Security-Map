import { DataUpgradeConflict, makeAsset, upgradeDataset, type CurrentDataset, type Dataset, type Language } from './models';
import { recordControl, undoControl } from './controlRecords';
import { securityEntitySchema, type SecurityRelation, type SecurityEntity } from './securityModel';
import { twofasSteps, type TwofasStep } from './twofasCatalog';
import { twofasStoreSchema, twofasTaskSchema, twofasStore, twofasReceiptCurrent, twofasSnapshot, type TwofasStore, type TwofasTask, type TwofasReceipt } from './twofasSchemas';
import { PHONE_SOURCES } from './phoneCatalog';

const nowString=()=>new Date().toISOString();
function writable(data:Dataset):CurrentDataset{
  const next=upgradeDataset(data),m=next.securityModel;
  if(m.revision<11&&Object.hasOwn(m,'twofasV1'))throw new DataUpgradeConflict();
  if(m.revision>=11&&Object.hasOwn(m,'twofasV1')&&!twofasStoreSchema.safeParse(m.twofasV1).success)throw new DataUpgradeConflict();
  return {...next,securityModel:{...m,revision:m.revision>=11?m.revision:11}};
}
const storeFor=(data:CurrentDataset):TwofasStore=>twofasStore(data)??twofasStoreSchema.parse({version:1});
const put=(data:CurrentDataset,store:TwofasStore):CurrentDataset=>({...data,securityModel:{...data.securityModel,revision:data.securityModel.revision>=11?data.securityModel.revision:11,twofasV1:store}});
const putTask=(data:CurrentDataset,t:TwofasTask):CurrentDataset=>{const s=storeFor(data);return put(data,{...s,tasks:[...s.tasks.filter(v=>v.id!==t.id),t]});};
export const twofasTask=(data:Dataset,id:string)=>twofasStore(data)?.tasks.find(t=>t.id===id);
export function ownTwofasApp(data:Dataset,appRef:string,now=nowString()):CurrentDataset{
  let next=writable(data);const a=next.securityModel.entities.find(e=>e.id===appRef&&e.kind==='installation'&&e.productId==='2fas-auth');
  if(a?.kind!=='installation'||!next.assets.some(d=>d.id===a.deviceRef&&d.kind==='device'&&['ios','android'].includes(d.operatingSystem??'')))throw new Error('invalid-twofas-app');
  const s=storeFor(next);if(!s.profiles.some(p=>p.appRef===appRef))next=put(next,{...s,profiles:[...s.profiles,{appRef,createdAt:now}]});return next;
}
export function createTwofasApp(data:Dataset,deviceRef:string,reuseRef?:string,now=nowString()):{data:CurrentDataset;appRef:string}{
  let next=writable(data);const d=next.assets.find(d=>d.id===deviceRef&&d.kind==='device'&&['ios','android'].includes(d.operatingSystem??''));if(!d)throw new Error('invalid-twofas-device');
  const existing=reuseRef?next.securityModel.entities.find(e=>e.id===reuseRef&&e.kind==='installation'&&e.productId==='2fas-auth'&&e.deviceRef===deviceRef):undefined;
  if(reuseRef&&!existing)throw new Error('invalid-twofas-destination');
  const item=existing??securityEntitySchema.parse({id:crypto.randomUUID(),kind:'installation',productId:'2fas-auth',deviceRef,label:`2FAS Auth · ${d.name}`.slice(0,80),createdAt:now,controls:{},controlEvidence:{}});
  if(!existing)next={...next,securityModel:{...next.securityModel,entities:[...next.securityModel.entities,item]}};
  return {data:ownTwofasApp(next,item.id,now),appRef:item.id};
}
export function startTwofasTask(data:Dataset,options:{kind:TwofasTask['kind'];appRef:string;origin:TwofasTask['origin'];accountRef?:string;returnCursor?:string;scopePath?:string;phoneRef?:string;newDeviceRef?:string;reviewCloud?:boolean},now=nowString(),force=false):{data:CurrentDataset;id:string}{
  const next=ownTwofasApp(data,options.appRef,now),s=storeFor(next);
  if(options.origin==='phone'){
    const w=next.deviceWorkflows.find(w=>w.id===options.phoneRef),a=next.securityModel.entities.find(e=>e.id===options.appRef);
    if(options.kind!=='move'||!w||a?.kind!=='installation'||w.oldDeviceRef!==a.deviceRef||w.newDeviceRef!==options.newDeviceRef||w.answers.availability!=='available')throw new Error('invalid-twofas-phone-context');
  }
  const pending=force?undefined:s.tasks.find(t=>t.kind===options.kind&&t.appRef===options.appRef&&t.origin===options.origin&&t.accountRef===options.accountRef&&t.returnCursor===options.returnCursor&&t.scopePath===options.scopePath&&t.phoneRef===options.phoneRef&&t.newDeviceRef===options.newDeviceRef&&['active','deferred'].includes(t.status));
  if(pending)return {data:putTask(next,{...pending,status:'active',updatedAt:now}),id:pending.id};
  const prior=s.syncSettings.filter(v=>v.appRef===options.appRef).at(-1),known=prior&&twofasReceiptCurrent(s,prior.receiptRef)?prior:undefined;
  const defaults=options.kind==='backup'&&!options.reviewCloud&&known?{'cloud-state':known.mode,'cloud-root':known.rootRef?`account:${known.rootRef}`:'','cloud-password':known.secretRef?'yes':'no'}:{};
  const t=twofasTaskSchema.parse({id:crypto.randomUUID(),...options,answers:defaults,...(known&&options.kind==='backup'&&!options.reviewCloud?{reusedSyncRef:known.receiptRef}:{}),...(known?.secretRef?{cloudSecretRef:known.secretRef}:{}),createdAt:now,updatedAt:now,sourceSnapshot:twofasSnapshot(next.securityModel,options.appRef)});
  return {data:put(next,{...s,tasks:[...s.tasks,t]}),id:t.id};
}
export function twofasStepRecorded(data:Dataset,t:TwofasTask,stepId:string):boolean{
 const s=twofasStore(data);if(!s||!t.records[stepId]||!twofasReceiptCurrent(s,t.records[stepId]))return false;
 if(data.version!==2)return false;const receipt=s.receipts.find(r=>r.id===t.records[stepId])!,entity=data.securityModel.entities.find(e=>e.id===receipt.refs[0]&&e.kind==='installation');
 const suffix=stepId.replace(/^new-/,'');
 if(['pin-test','local','open','old-open'].includes(suffix)&&entity?.kind==='installation'){
   if(suffix==='pin-test'){const pin=s.profiles.find(p=>p.appRef===entity.id)?.pinRef;if(!pin||receipt.pinRef!==pin||!receipt.refs.includes(entity.deviceRef)||['lost','unavailable','revoked','deleted'].includes(data.securityModel.lifecycle[pin]?.state??''))return false;}
   const control=suffix==='pin-test'?'appLock':suffix==='local'?'storageChecked':'opened';return entity.controls?.[control]==='verified'&&entity.controlEvidence?.[control]==='user-confirmed';
 }
 if(suffix==='lock')return data.assets.some(a=>receipt.refs.includes(a.id)&&['implemented','verified'].includes(a.controls.screenLock));
 return true;
}
export function currentTwofasStep(data:Dataset,t:TwofasTask):TwofasStep{
  const steps=twofasSteps(data,t);
  if(t.status==='completed'&&steps.every(s=>s.kind==='action'?twofasStepRecorded(data,t,s.id):s.kind==='question'?!!t.answers[s.id]:s.kind==='finished'))return {id:'finished',kind:'finished',title:{en:'These checks are recorded',ja:'ここまでの確認を記録しました'},refs:[],sources:[],requires:[]};
  return steps.find(s=>s.id===t.cursor)??steps.find(s=>s.kind==='blocked'||s.kind==='question'&&!t.answers[s.id]||s.kind==='action'&&!twofasStepRecorded(data,t,s.id))??steps[steps.length-1];
}
function progress(data:CurrentDataset,t:TwofasTask,previous:string,now:string):CurrentDataset{
  const steps=twofasSteps(data,t),index=steps.findIndex(s=>s.id===previous),complete=steps.length>0&&steps.every(s=>s.kind==='action'?twofasStepRecorded(data,t,s.id):s.kind==='question'?!!t.answers[s.id]:false);
  if(complete&&t.kind==='move'&&!twofasStepRecorded(data,t,'move-finished')){const store=storeFor(data),receipt={id:crypto.randomUUID(),taskRef:t.id,stepId:'move-finished',at:now,requires:steps.filter(s=>s.kind==='action').map(s=>t.records[s.id]),refs:[t.destinationRef!,t.newDeviceRef!]};data=put(data,{...store,receipts:[...store.receipts,receipt]});t={...t,records:{...t.records,'move-finished':receipt.id}};}
  const cursor=complete?'finished':steps[index+1]?.id??steps.find(s=>s.kind==='blocked'||s.kind==='question'&&!t.answers[s.id]||s.kind==='action'&&!twofasStepRecorded(data,t,s.id))?.id??previous;
  return putTask(data,{...t,status:complete?'completed':'active',cursor,history:[...t.history,previous].slice(-500),updatedAt:now});
}
export function withdrawTwofasReceipt(data:Dataset,id:string,stepId:string,now=nowString()):Dataset{
  if(data.version!==2)return data;const task=twofasTask(data,id),s=twofasStore(data),first=task?.records[stepId];if(!task||!s||!first)return data;
  const revoked=new Set([first]);let changed=true;
  while(changed){changed=false;for(const r of s.receipts)if(!r.revokedAt&&!revoked.has(r.id)&&r.requires.some(ref=>revoked.has(ref))){revoked.add(r.id);changed=true;}}
  const store={...s,receipts:s.receipts.map(r=>revoked.has(r.id)?{...r,revokedAt:now}:r),tasks:s.tasks.map(t=>Object.values(t.records).some(r=>revoked.has(r))?{...t,status:'active' as const,updatedAt:now}:t)};
  let next=put(data,store);
  for(const a of data.actions)if(typeof a.twofasReceiptRef==='string'&&revoked.has(a.twofasReceiptRef)&&a.targetId&&a.controlId)next=undoControl(next,a.id,a.targetId,a.controlId,{state:'unknown',evidence:'not-assessed'},now) as CurrentDataset;
  const factIds=new Set(store.proofs.filter(p=>p.receiptRefs.some(r=>revoked.has(r))).map(p=>p.factRef)),links=new Set(store.links.filter(p=>p.receiptRefs.some(r=>revoked.has(r))).map(p=>p.relationRef));
  return {...next,securityModel:{...next.securityModel,facts:next.securityModel.facts.map(f=>factIds.has(f.id)?{...f,state:'unknown',evidence:'unknown'}:f),relations:next.securityModel.relations.map(r=>links.has(r.id)?{...r,evidence:'unknown'}:r)}};
}
export function answerTwofas(data:Dataset,id:string,value:string,now=nowString()):Dataset{
  if(data.version!==2)return data;const original=twofasTask(data,id);if(!original)return data;const step=currentTwofasStep(data,original);if(step.kind!=='question'||!step.choices?.some(c=>c.value===value))return data;
  if(step.id==='destination'&&original.destinationRef&&original.answers.destination!==value&&Object.keys(original.records).some(s=>s.startsWith('new-')))return data;
  let next=data;const before=twofasSteps(data,original),index=before.findIndex(s=>s.id===step.id);
  if(original.answers[step.id]!==undefined&&original.answers[step.id]!==value){for(const operation of before.slice(index+1).filter(s=>s.kind==='action'))next=withdrawTwofasReceipt(next,id,operation.id,now) as CurrentDataset;}
  let t={...twofasTask(next,id)!,answers:{...original.answers,[step.id]:value},updatedAt:now,status:'active' as const};
  if(step.question==='destination'){
    const result=createTwofasApp(next,t.newDeviceRef!,value.startsWith('installation:')?value.slice(13):original.answers.destination===value?original.destinationRef:undefined,now);next=result.data;t={...t,destinationRef:result.appRef};
  }
  if(step.id==='file-secret-mode'&&value.startsWith('secret:')){const known=twofasStore(next)?.secrets.find(s=>s.entityRef===value.slice(7)&&s.purpose==='file');if(!known)return data;t={...t,secretRef:known.entityRef};}
  if(step.question==='root'&&value.startsWith('add:')){
    const provider=value.slice(4) as 'apple'|'google',a={...makeAsset({kind:'account',type:'Identity provider',name:`${provider==='apple'?'Apple Account':'Google Account'} ${next.assets.filter(a=>a.provider===provider).length+1}`,importance:'critical'}),provider,purpose:'personal' as const};
    next={...next,assets:[...next.assets,a]};t.answers[step.id]=`account:${a.id}`;
  }
  if(step.question==='location'){
    let ref=value.startsWith('location:')?value.slice(9):undefined;
    if(!ref){const a=makeAsset({kind:'backup',type:'Backup disk',name:next.settings.language==='ja'?'2FAS用の別のバックアップドライブ':'Separate 2FAS backup drive',importance:'critical'});next={...next,assets:[...next.assets,a]};ref=a.id;t.answers[step.id]=`location:${ref}`;}
    t={...t,fileStorageRef:ref};
  }
  if(step.id==='file-choice'&&value.startsWith('file:')){
    const file=twofasStore(next)?.files.find(f=>f.entityRef===value.slice(5)&&f.appRef===t.appRef);if(!file)return data;t={...t,fileRef:file.entityRef,secretRef:file.secretRef,fileStorageRef:file.storageRef};
  }
  if(step.id.startsWith('target-provider:')){
    const provider=value as NonNullable<CurrentDataset['assets'][number]['provider']>,a={...makeAsset({kind:'account',type:'Identity provider',name:`${value} ${next.assets.filter(a=>a.provider===provider).length+1}`,importance:'critical'}),provider,purpose:'personal' as const};
    next={...next,assets:[...next.assets,a]};const i=step.id.slice('target-provider:'.length);t.answers[`target-more:${i}`]=`account:${a.id}`;
  }
  next=putTask(next,t);return progress(next,t,step.id,now);
}
function receiptClosure(s:TwofasStore,ids:string[]):string[]{const found=new Set<string>(),pending=[...ids];while(pending.length){const id=pending.pop()!;if(found.has(id))continue;found.add(id);pending.push(...(s.receipts.find(r=>r.id===id)?.requires??[]));}return [...found];}
function applyEffect(data:CurrentDataset,t:TwofasTask,step:TwofasStep,r:TwofasReceipt):CurrentDataset{
  let next=data,store=storeFor(next);const appRef=step.appRef??(t.kind==='move'&&step.id.startsWith('new-')?t.destinationRef:t.appRef)!;
  const target=next.securityModel.entities.find(e=>e.id===appRef&&e.kind==='installation'),source=next.securityModel.entities.find(e=>e.id===t.appRef&&e.kind==='installation');
  const addEntity=(e:SecurityEntity)=>{next={...next,securityModel:{...next.securityModel,entities:[...next.securityModel.entities.filter(v=>v.id!==e.id),e]}};};
  const edge=(fromRef:string,toRef:string,kind:SecurityRelation['kind'],historical=false)=>{const relation:SecurityRelation={id:crypto.randomUUID(),fromRef,toRef,kind,evidence:'user-confirmed',checkedAt:r.at,sourceIds:step.sources};next={...next,securityModel:{...next.securityModel,relations:[...next.securityModel.relations,relation]}};store={...store,links:[...store.links,{relationRef:relation.id,historical,receiptRefs:[r.id]}]};};
  const control=(ref:string,controlId:string)=>{next=recordControl(next,ref,controlId,{id:`${r.id}#${controlId}`,parentId:r.id,origin:'twofas',twofasReceiptRef:r.id},r.at) as CurrentDataset;};
  const makeSecret=(label:string)=>{
    const paper=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'data-set',dataType:'other',ownerRef:t.appRef,label:`${label} · ${data.settings.language==='ja'?'紙の控え':'paper reminder'}`.slice(0,80),createdAt:r.at});addEntity(paper);
    const secret=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'credential',credentialType:'password',subjectRef:t.appRef,storageRef:paper.id,roles:['restore'],label,createdAt:r.at});addEntity(secret);edge(secret.id,paper.id,'stored-in');store={...store,secrets:[...store.secrets,{entityRef:secret.id,paperRef:paper.id,appRef:t.appRef,purpose:step.effect==='cloud-secret'?'cloud':'file',receiptRef:r.id}]};return secret.id;
  };
  if(step.effect==='open'&&target?.kind==='installation'){control(appRef,'opened');edge(appRef,target.deviceRef,'installed-on');}
  if(step.effect==='lock'&&step.subjectRef)control(step.subjectRef,'screenLock');
  if((step.effect==='pin'||step.effect==='pin-set')&&target?.kind==='installation'){
    let profile=store.profiles.find(p=>p.appRef===appRef)!;
    let pin=profile.pinRef?next.securityModel.entities.find(e=>e.id===profile.pinRef):undefined;
    if(!pin||step.effect==='pin-set'){
      if(pin)next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[pin.id]:{...next.securityModel.lifecycle[pin.id],state:'revoked',evidence:'user-confirmed',updatedAt:r.at,accessResetAt:r.at}}}};
      pin=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'credential',credentialType:'password',subjectRef:appRef,roles:['local-unlock'],label:'2FAS Auth · PIN',createdAt:r.at});addEntity(pin);profile={...profile,pinRef:pin.id};store={...store,profiles:store.profiles.map(p=>p.appRef===appRef?profile:p)};
    }
    if(step.effect==='pin-set')t={...t,assignedPinRef:pin.id};
    if(step.effect==='pin'){
      next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[pin.id]:{...next.securityModel.lifecycle[pin.id],state:'in-use',evidence:'user-confirmed',updatedAt:r.at}}}};
      store={...store,receipts:store.receipts.map(v=>v.id===r.id?{...v,pinRef:pin.id}:v)};edge(pin.id,appRef,'unlocks');control(appRef,'appLock');
    }
  }
  if(step.effect==='local'&&target?.kind==='installation'){addEntity({...target,codeStorage:'local'});control(appRef,'storageChecked');}
  if(step.effect==='file-secret'){t={...t,secretRef:makeSecret(data.settings.language==='ja'?'2FASファイル用の解除情報':'2FAS file password information')};}
  if(step.effect==='cloud-secret'){t={...t,cloudSecretRef:makeSecret(data.settings.language==='ja'?'2FAS同期用の解除情報':'2FAS cloud password information')};}
  if(step.effect==='cloud-off'){store={...store,syncSettings:[...store.syncSettings,{appRef:t.appRef,mode:'off',receiptRef:r.id}]};const links=new Set(store.links.map(l=>l.relationRef));next={...next,securityModel:{...next.securityModel,relations:next.securityModel.relations.map(v=>links.has(v.id)&&v.kind==='synced-via'&&v.fromRef===t.appRef?{...v,evidence:'unknown'}:v)}};}
  if(step.effect==='cloud'){
    const root=t.answers['cloud-root']?.slice(8);if(root&&source?.kind==='installation'){
      // The user checked the actual current account. Old history stays, while
      // a different current sync destination stops being a confirmed edge.
      const known=new Set(store.links.map(l=>l.relationRef));next={...next,securityModel:{...next.securityModel,relations:next.securityModel.relations.map(v=>known.has(v.id)&&v.kind==='synced-via'&&v.fromRef===t.appRef&&v.toRef!==root?{...v,evidence:'unknown'}:v)}};
      edge(t.appRef,root,'synced-via');
      const cloud=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'data-set',dataType:'other',ownerRef:t.appRef,label:data.settings.language==='ja'?'2FASのクラウド同期コピー':'2FAS cloud synchronization copy',createdAt:r.at});addEntity(cloud);edge(cloud.id,t.appRef,'backs-up');edge(cloud.id,root,'stored-in');if(t.cloudSecretRef)edge(t.cloudSecretRef,cloud.id,'decrypts');
      store={...store,syncSettings:[...store.syncSettings,{appRef:t.appRef,mode:'on',rootRef:root,secretRef:t.cloudSecretRef,receiptRef:r.id}],clouds:[...(store.clouds??[]),{entityRef:cloud.id,appRef:t.appRef,rootRef:root,secretRef:t.cloudSecretRef,receiptRef:r.id,snapshot:twofasSnapshot(next.securityModel,t.appRef)}]};
    }
  }
  if(step.effect==='file-save'&&t.secretRef&&source?.kind==='installation'){
    const file=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'data-set',dataType:'other',ownerRef:t.appRef,label:data.settings.language==='ja'?'2FASの暗号化.2fasファイル':'2FAS encrypted .2fas file',createdAt:r.at});addEntity(file);edge(file.id,t.appRef,'backs-up');edge(file.id,source.deviceRef,'stored-in');edge(t.secretRef,file.id,'decrypts');
    store={...store,files:[...store.files,{entityRef:file.id,appRef:t.appRef,secretRef:t.secretRef,storageRef:source.deviceRef,receiptRef:r.id,snapshot:twofasSnapshot(next.securityModel,t.appRef),external:false,permanent:true,groupRef:file.id,createdAt:r.at}]};t={...t,fileRef:file.id};
  }
  if(step.effect==='file-copy'&&t.fileRef&&t.fileStorageRef){
    const original=store.files.find(f=>f.entityRef===t.fileRef),entity=next.securityModel.entities.find(e=>e.id===t.fileRef);if(original&&entity?.kind==='data-set'){
      const copy={...entity,id:crypto.randomUUID(),label:data.settings.language==='ja'?'2FASの暗号化コピー（別の保管先）':'2FAS encrypted copy at a separate location',createdAt:r.at};addEntity(copy);
      store={...store,files:[...store.files,{...original,entityRef:copy.id,storageRef:t.fileStorageRef!,external:true,permanent:true,groupRef:original.groupRef??original.entityRef,receiptRef:r.id}]};edge(copy.id,t.fileStorageRef,'stored-in');edge(copy.id,original.entityRef,'restores-from',true);edge(original.secretRef,copy.id,'decrypts');edge(copy.id,t.appRef,'backs-up');t={...t,fileRef:copy.id};
    }
  }
  if(step.effect==='receive-file'&&t.fileRef&&t.newDeviceRef){const original=store.files.find(f=>f.entityRef===t.fileRef),entity=next.securityModel.entities.find(e=>e.id===t.fileRef);if(original&&entity?.kind==='data-set'){
    const copy={...entity,id:crypto.randomUUID(),label:data.settings.language==='ja'?'新端末へ受け取った2FASの一時コピー':'Temporary 2FAS copy received on the new phone',createdAt:r.at};addEntity(copy);store={...store,files:[...store.files,{...original,entityRef:copy.id,storageRef:t.newDeviceRef,external:true,permanent:false,groupRef:original.groupRef??original.entityRef,receiptRef:r.id}]};edge(copy.id,t.newDeviceRef,'stored-in');edge(copy.id,original.entityRef,'restores-from',true);edge(original.secretRef,copy.id,'decrypts');t={...t,transferFileRef:copy.id};
  }}
  if(step.effect==='cleanup-file'){const temporary=store.files.filter(f=>!f.permanent&&f.entityRef===t.transferFileRef).map(f=>f.entityRef);next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,...Object.fromEntries(temporary.map(ref=>[ref,{state:'deleted' as const,evidence:'user-confirmed' as const,updatedAt:r.at,accessResetAt:r.at}]))}}};}
  const fact=(label:string,requiredRefs:string[],purpose:'restore'|'second-step',targetRef:string,fileRef?:string)=>{
    const id=crypto.randomUUID(),f={id,label,state:'available' as const,evidence:'user-confirmed' as const,checkedAt:r.at,requiredRefs,contexts:['new-device' as const],dependencyCompleteness:'partial' as const,sourceIds:step.sources};
    const route={id:crypto.randomUUID(),label,targetRef,purpose,contexts:['new-device' as const],requirements:{kind:'fact' as const,factId:id},sourceIds:step.sources};
    next={...next,securityModel:{...next.securityModel,facts:[...next.securityModel.facts,f],routes:[...next.securityModel.routes,route]}};store={...store,proofs:[...store.proofs,{factRef:id,directReceiptRef:r.id,receiptRefs:receiptClosure(store,[r.id]),...(fileRef?{fileRef}:{})}]};
  };
  if(step.effect==='restore'&&t.destinationRef){
    const root=t.answers['cloud-root']?.slice(8),cloud=(store.clouds??[]).filter(v=>v.appRef===t.appRef&&v.rootRef===root).at(-1),origin=t.answers.method==='cloud'?cloud?.entityRef:t.transferFileRef??t.fileRef;
    if(origin){edge(t.destinationRef,origin,'restores-from',true);if(t.answers.method==='cloud'&&root){edge(t.destinationRef,root,'synced-via');store={...store,syncSettings:[...store.syncSettings,{appRef:t.destinationRef,mode:'on',rootRef:root,secretRef:t.cloudSecretRef,receiptRef:r.id}]};}fact('2FAS entries restored; code use is separate',[t.destinationRef,t.newDeviceRef!,origin,...(t.answers.method==='cloud'&&t.cloudSecretRef?[t.cloudSecretRef]:t.secretRef?[t.secretRef]:[])],'restore',t.destinationRef);}
  }
  if(step.effect==='code'&&t.destinationRef&&step.subjectRef){
    const originals=next.securityModel.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.subjectRef===step.subjectRef&&e.storageRef===t.appRef);
    const original=originals.length===1&&(t.answers['new-state']!=='present'||t.answers['present-origin']==='copy')?originals[0]:undefined,group=original?.kind==='credential'?original.replicaGroupId??crypto.randomUUID():undefined;
    if(original?.kind==='credential'&&group)addEntity({...original,replicaGroupId:group});
    const credential=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'credential',credentialType:'totp',subjectRef:step.subjectRef,storageRef:t.destinationRef,roles:['second-step'],...(group?{replicaGroupId:group,copiedFromRef:original!.id}:{copyOriginConfirmed:t.answers['present-origin']==='separate'}),label:`${next.assets.find(a=>a.id===step.subjectRef)?.name??'Account'} · 2FAS`.slice(0,80),createdAt:r.at});addEntity(credential);edge(credential.id,t.destinationRef,'stored-in');edge(credential.id,step.subjectRef,'authenticates-to');
    fact('New-phone 2FAS code accepted',[t.destinationRef,t.newDeviceRef!,step.subjectRef,credential.id],'second-step',step.subjectRef);control(t.destinationRef,'codeUse');
  }
  // Entity creation and control updates preserve the newest store; task fields
  // such as file references are written together with the receipt.
  next=put(next,store);return putTask(next,t);
}
export function confirmTwofas(data:Dataset,id:string,now=nowString(),repeat=false):Dataset{
  if(data.version!==2)return data;const original=twofasTask(data,id),saved=twofasStore(data);if(!original||!saved)return data;let t:TwofasTask=original,store:TwofasStore=saved;
  const step=currentTwofasStep(data,t),steps=twofasSteps(data,t),index=steps.findIndex(s=>s.id===step.id);if(step.kind!=='action'||index<0)return data;
  if(steps.slice(0,index).some(s=>s.kind==='blocked'||s.kind==='question'&&!t.answers[s.id]))return data;
  if(step.requires.some(s=>!twofasStepRecorded(data,t,s)))return data;
  const already=t.records[step.id];if(already&&!repeat&&twofasStepRecorded(data,t,step.id))return progress(data,t,step.id,now);
  if(already&&twofasReceiptCurrent(store,already)){data=withdrawTwofasReceipt(data,id,step.id,now) as CurrentDataset;t=twofasTask(data,id)!;store=twofasStore(data)!;}
  const extra=step.id==='file-available'?store.files.find(f=>f.entityRef===t.fileRef)?.receiptRef:undefined;
  const receipt:TwofasReceipt={id:crypto.randomUUID(),taskRef:id,stepId:step.id,at:now,titleEn:step.title.en,titleJa:step.title.ja,requires:[...step.requires.map(s=>t.records[s]),...(extra?[extra]:[])],refs:step.refs};
  let next=put(data,{...store,receipts:[...store.receipts,receipt]});next=putTask(next,{...t,records:{...t.records,[step.id]:receipt.id}});
  if(step.id==='file-phrase'){const task=twofasTask(next,id)!;next=putTask(next,{...task,answers:{...task.answers,'file-secret-mode':'new'}});}
  next=applyEffect(next,twofasTask(next,id)!,step,receipt);return progress(next,twofasTask(next,id)!,step.id,now);
}
export function navigateTwofas(data:Dataset,id:string,to:'back'|'defer'|string,now=nowString()):Dataset{
  if(data.version!==2)return data;const t=twofasTask(data,id);if(!t)return data;
  if(to==='defer')return putTask(data,{...t,status:'deferred',updatedAt:now});
  if(to==='back'){if(!t.history.length)return data;return putTask(data,{...t,cursor:t.history.at(-1)!,history:t.history.slice(0,-1),status:'active',updatedAt:now});}
  if(!twofasSteps(data,t).some(s=>s.id===to))return data;
  return putTask(data,{...t,cursor:to,history:[...t.history,t.cursor],status:'active',updatedAt:now});
}
export function twofasHelpPrompt(data:Dataset,t:TwofasTask,problem:number,language:Language):string{
  const step=currentTwofasStep(data,t),d=data.assets.find(a=>a.id===step.deviceRef),subject=data.assets.find(a=>a.id===step.subjectRef),cloudRoot=data.assets.find(a=>a.id===t.answers['cloud-root']?.slice(8)),provider=subject?.provider??cloudRoot?.provider;
  const issues=language==='ja'?['画面が違う','項目がない','権限・対応条件が違う','PIN・解除情報を使えない','別の方法で入れた']:['Different screen','Item missing','Permission or support differs','PIN or backup password unavailable','Another method was used'];
  const safe=(copy?:{en:string;ja:string})=>copy?.[language].replaceAll(data.assets.find(a=>a.id===step.subjectRef)?.name??'\u0000','Selected account').replaceAll(d?.name??'\u0000','Selected phone')??'';
  return [language==='ja'?'最新の公式情報を確認し、一度に一つの質問または操作だけを案内してください。確認できなければ、その旨を明示してください。':'Check current official information and guide one question or action at a time. State clearly if you cannot verify it.','Product: 2FAS Auth',...(provider?[`Service: ${provider}`]:[]),`OS: ${d?.operatingSystem??'unconfirmed'}; supported recipe: iOS/iPadOS18.6+, Android9+, Auth6.x`,`Task: ${t.kind}`,`Current step: ${step.id.split(':')[0]} / ${safe(step.title)}`,`Expected: ${safe(step.expected)}`,`Issue: ${issues[problem]??issues[0]}`,...step.sources.map(id=>PHONE_SOURCES[id]?.url).filter(Boolean),language==='ja'?'パスワード・設定キー・認証コード・復旧情報・個人情報を求めないでください。画像を添付する場合はこれらを隠します。':'Do not request passwords, setup keys, verification/recovery codes or personal information. Hide these in any image.'].join('\n');
}
export function bindTwofasPhoneRecord(data:Dataset,id:string,key:string):Dataset{
  const t=twofasTask(data,id);return data.version===2&&t?.origin==='phone'?putTask(data,{...t,phoneRecordKey:key}):data;
}
export function bindTwofasGuidePath(before:Dataset,data:Dataset,path:string):Dataset{
  if(data.version!==2||!data.guide.cursor.startsWith('twofas/'))return data;
  const t=twofasTask(data,data.guide.cursor.slice(7));if(!t||t.origin!=='guide'||t.scopePath===path)return data;
  if(twofasTask(before,t.id)){
    const started=startTwofasTask(data,{kind:t.kind,appRef:t.appRef,origin:'guide',accountRef:t.accountRef,returnCursor:t.returnCursor,scopePath:path},undefined,true);
    return {...started.data,guide:{...started.data.guide,cursor:`twofas/${started.id}`}};
  }
  return putTask(data,{...t,scopePath:path});
}
