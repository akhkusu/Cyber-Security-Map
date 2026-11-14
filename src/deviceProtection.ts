import {DataUpgradeConflict,guideSchema,makeAsset,upgradeDataset,type CurrentDataset,type Dataset,type Language} from './models';
import {c} from './guideCatalog';
import {beginRecipe} from './guideEngine';
import {recordControl,undoControl} from './controlRecords';
import {safeMapNickname} from './mapRecords';
import {keyTasks} from './hardwareKeySchemas';
import {planPhysicalRefs} from './accessPlanEvidence';
import {recordedUnavailable} from './recordAvailability';
import type {AccessFact,SecurityEntity,SecurityRelation} from './securityModel';
import {protectionActorEpoch,protectionActorSignature,protectionRecordCurrent} from './deviceProtectionEvidence';
import {PROTECTION_SOURCES,protectionBrowserCandidates,protectionProvider,protectionRefFromValue,protectionSources,type ProtectionStep} from './deviceProtectionCatalog';
import {protectionSteps} from './deviceProtectionSteps';
import {protectionSettingKey,protectionStore,protectionStoreSchema,protectionTasks,protectionTaskSchema,type ProtectionRecord,type ProtectionSetting,type ProtectionStore,type ProtectionTask} from './deviceProtectionSchemas';

const nowString=()=>new Date().toISOString();
const snapshot=(data:CurrentDataset,refs:string[])=>({actorEpochs:Object.fromEntries(refs.map(ref=>[ref,protectionActorEpoch(data.securityModel,ref)])),actorSignatures:Object.fromEntries(refs.map(ref=>[ref,protectionActorSignature(data.securityModel,ref)]))});
const sourceIds=(step:ProtectionStep)=>step.sources.map(s=>PROTECTION_SOURCES[s].url);
const actionId=(t:ProtectionTask,step:string)=>`device-protection:${JSON.stringify([t.id,step])}`;
function writable(data:Dataset):CurrentDataset{
  const d=upgradeDataset(data),m=d.securityModel;
  const own=(e:object)=>Object.keys(e).some(k=>k.startsWith('deviceProtection'));
  if(m.revision<9&&(Object.hasOwn(m,'deviceProtectionV1')||[...d.assets,...m.entities,...m.facts,...m.relations,...m.routes].some(own)))throw new DataUpgradeConflict();
  if(m.revision<9&&keyTasks(d).some(t=>Object.hasOwn(t,'deviceProtectionKeyReturnV1')))throw new DataUpgradeConflict();
  if(m.revision>=9&&Object.hasOwn(m,'deviceProtectionV1')&&!protectionStoreSchema.safeParse(m.deviceProtectionV1).success)throw new DataUpgradeConflict();
  return {...d,securityModel:{...m,revision:9}};
}
const storeOf=(data:Dataset)=>protectionStore(data)??protectionStoreSchema.parse({version:1});
function put(data:CurrentDataset,task:ProtectionTask,store=storeOf(data)):CurrentDataset{
  return {...data,securityModel:{...data.securityModel,revision:9,deviceProtectionV1:{...store,tasks:[...store.tasks.filter(t=>t.id!==task.id),task]}}};
}
const entity=(data:CurrentDataset,e:SecurityEntity):CurrentDataset=>({...data,securityModel:{...data.securityModel,entities:[...data.securityModel.entities.filter(x=>x.id!==e.id),e]}});
export function protectionReturnPath(task:ProtectionTask){return task.returnTo==='phone'?`/phone/${encodeURIComponent(task.phoneWorkflowRef!)}`:task.returnTo==='map'?`/map?item=${encodeURIComponent(task.deviceRef)}`:'/guide';}
export function startProtectionGuide(data:Dataset,deviceRef:string,returnTo:ProtectionTask['returnTo']='map',phoneWorkflowRef?:string,now=nowString(),forceNew=false):{data:CurrentDataset;id:string}{
  const next=writable(data),device=next.assets.find(a=>a.id===deviceRef&&a.kind==='device');if(!device)throw new Error('invalid-protection-device');
  if(returnTo==='phone'&&!next.deviceWorkflows.some(w=>w.id===phoneWorkflowRef&&[w.oldDeviceRef,w.newDeviceRef].includes(deviceRef)))throw new Error('invalid-protection-origin');
  const pending=forceNew?undefined:protectionTasks(next).find(t=>t.deviceRef===deviceRef&&['active','deferred'].includes(t.status));
  const task=pending?{...pending,status:'active' as const}:protectionTaskSchema.parse({id:crypto.randomUUID(),deviceRef,returnTo,phoneWorkflowRef,originGuideCursor:data.guide.cursor,createdAt:now,updatedAt:now});
  return {data:put(next,task),id:task.id};
}
export function protectionStepDone(data:Dataset,t:ProtectionTask,step:ProtectionStep):boolean{
  if(['question','text'].includes(step.kind))return !!t.answers[step.id]&&(step.kind==='text'||!!step.choices?.some(o=>o.value===t.answers[step.id]));
  if(step.kind==='multi')return t.answers[step.id]==='confirmed';
  if(step.kind==='check'&&step.recordValues&&!step.recordValues.includes(t.answers[step.id]))return !!step.choices?.some(o=>o.value===t.answers[step.id]);
  if(!['operation','check'].includes(step.kind)||data.version!==2)return false;
  if(!step.historical)return protectionRecordCurrent(data.securityModel,t,step.id);
  // A recorded initial OFF state remains a historical observation after setup
  // turns it ON. It is never projected as the current physical setting.
  const r=t.records[step.id];return !!r&&!r.withdrawnAt&&Object.entries(r.actorEpochs).every(([ref,at])=>protectionActorEpoch(data.securityModel,ref)===at)&&Object.entries(r.actorSignatures).every(([ref,s])=>protectionActorSignature(data.securityModel,ref)===s)&&r.requires.every(id=>protectionRecordCurrent(data.securityModel,t,id));
}
export function currentProtectionStep(data:Dataset,t:ProtectionTask):ProtectionStep{
  const steps=protectionSteps(data,t),index=steps.findIndex(s=>s.id===t.cursor),end=index<0?steps.length-1:index;
  const step=steps.slice(0,end+1).find(s=>s.kind==='blocked'||!protectionStepDone(data,t,s))??steps[end];
  if(['operation','check'].includes(step.kind)&&recordedUnavailable(data,[t.deviceRef,t.accountRef,...(step.id.startsWith('management-')?[t.environmentRef]:[])]))return {id:'unavailable',kind:'blocked',title:c('A required item is unavailable','必要な項目を利用できません'),action:c('Keep the saved work and review the actual item’s state in Security Map. Correcting a record does not restore a lost or erased device.','作業を保存したまま、Security Mapで実際の項目の状態を確認してください。記録の訂正だけでは、紛失・消去した端末は戻りません。'),sources:protectionSources(t)};
  return step;
}
function advance(data:CurrentDataset,t:ProtectionTask,id:string,now:string):CurrentDataset{
  const steps=protectionSteps(data,t),at=steps.findIndex(s=>s.id===id),cursor=at<0?(steps.find(s=>s.kind==='blocked'||!protectionStepDone(data,t,s))?.id??'finished'):(steps[at+1]?.id??'finished');
  return project(put(data,{...t,cursor,status:cursor==='finished'?'completed':'active',history:[...t.history,id].slice(-300),updatedAt:now}));
}
function withdrawRecord(data:CurrentDataset,t:ProtectionTask,id:string,now:string):{data:CurrentDataset;task:ProtectionTask}{
  const record=t.records[id];if(!record||record.withdrawnAt)return {data,task:t};
  const before=storeOf(data),store:ProtectionStore={...before,settings:{...before.settings},history:[...before.history]};
  let task={...t,records:{...t.records,[id]:{...record,withdrawnAt:now}}};
  if(record.feature){const key=protectionSettingKey(t.deviceRef,record.feature),setting=store.settings[key];
    if(setting&&!setting.withdrawn&&setting.taskRef===t.id&&setting.recordRef===id){
      const alternative=before.tasks.flatMap(other=>Object.entries((other.id===t.id?task:other).records).map(([ref,r])=>({other:other.id===t.id?task:other,ref,r}))).find(({other,ref,r})=>r.feature===record.feature&&r.value===setting.value&&r.accountRef===setting.accountRef&&r.featureVersions[key]===setting.generation&&!r.withdrawnAt&&protectionRecordCurrent(data.securityModel,other,ref));
      store.history.push({...setting});store.settings[key]=alternative?{...setting,taskRef:alternative.other.id,recordRef:alternative.ref,updatedAt:now}:{...setting,value:'unknown',withdrawn:true,generation:setting.generation+1,updatedAt:now};
    }
  }
  let next=put(data,task,store);
  if(record.protectionControlV1==='screenLock')next=undoControl(next,actionId(t,id),t.deviceRef,'screenLock',{state:'unknown',evidence:'not-assessed'},now) as CurrentDataset;
  task=protectionTasks(next).find(x=>x.id===t.id)!;return {data:next,task};
}
const identitySteps=new Set(['form','ownership','android-maker','android-profile','apple-version','android-version','account','account-label']);
export function answerProtectionGuide(data:Dataset,id:string,value:string,now=nowString()):Dataset{
  if(data.version!==2)return data;let next=data,t=protectionTasks(data).find(x=>x.id===id);if(!t||t.status==='cancelled')return data;
  const step=currentProtectionStep(data,t);if(!['question','text','check'].includes(step.kind))return data;
  if(step.kind==='text'?!safeMapNickname(value):!step.choices?.some(o=>o.value===value))return data;value=step.kind==='text'?value.trim():value;
  const previous=t.answers[step.id];
  const nicknameRef=step.id==='account-label'?t.accountRef:step.id==='management-device-label'?t.environmentDeviceRef:step.id==='management-browser-label'?t.environmentRef:step.id==='line-label'?t.lineRef:undefined;
  if(step.kind==='text'&&previous&&nicknameRef){
    // Editing a nickname does not create another physical item or invalidate
    // checks tied to its identity. Keep all unknown fields and original IDs.
    next={...next,assets:next.assets.map(a=>a.id===nicknameRef?{...a,name:value,updatedAt:now}:a),securityModel:{...next.securityModel,entities:next.securityModel.entities.map(e=>e.id===nicknameRef?{...e,label:value,...(e.kind==='installation'?{profileLabel:value}:{})}:e)}};
    return advance(next,{...t,answers:{...t.answers,[step.id]:value}},step.id,now);
  }
  if(previous&&previous!==value){
    // Do not relabel a physical configuration as another account or form.
    // Withdraw its checks explicitly, or start another task for another device.
    if(identitySteps.has(step.id)&&Object.values(t.records).some(r=>r.kind==='configuration'&&!r.withdrawnAt))return data;
    const sequence=protectionSteps(data,t),at=sequence.findIndex(s=>s.id===step.id),later=sequence.slice(at).map(s=>s.id);
    for(const key of later){const r=withdrawRecord(next,t,key,now);next=r.data;t=r.task;}
    t={...t,answers:Object.fromEntries(Object.entries(t.answers).filter(([key])=>!later.includes(key))),...(step.id.startsWith('management-')?{sessionRef:undefined}:{} )};
    if(['management-device','management-device-os','management-device-label'].includes(step.id))t={...t,environmentDeviceRef:undefined,environmentRef:undefined,managementUsedRefs:[]};
    if(['management-browser','management-browser-product','management-browser-label'].includes(step.id))t={...t,environmentRef:undefined,managementUsedRefs:[]};
  }
  t={...t,answers:{...t.answers,[step.id]:value}};
  const targetDeviceRef=t.deviceRef,selectedAccountRef=t.accountRef;
  if(step.id==='form')next={...next,assets:next.assets.map(a=>a.id===targetDeviceRef&&['unknown','other',undefined].includes(a.operatingSystem)?{...a,operatingSystem:['iphone','ipad'].includes(value)?'ios':value.startsWith('android')?'android':a.operatingSystem}:a)};
  if(step.id==='account-purpose'&&value==='personal')next={...next,assets:next.assets.map(a=>a.id===selectedAccountRef&&!a.purpose?{...a,purpose:'personal',updatedAt:now}:a)};
  if(step.id==='account'&&value!=='new')t={...t,accountRef:protectionRefFromValue(value)};
  if(step.id==='account'&&value==='new'&&previous!=='new')t={...t,accountRef:undefined};
  if(step.id==='account-label'){
    const asset={...makeAsset({kind:'account',type:'Account',name:value,importance:'critical'}),id:crypto.randomUUID(),provider:protectionProvider(t)!,purpose:'personal' as const};next={...next,assets:[...next.assets,asset]};t={...t,accountRef:asset.id};
  }
  if(step.id==='management-device'&&value!=='new')t={...t,environmentDeviceRef:protectionRefFromValue(value)};
  if(step.id==='management-device-label'){
    const os=t.answers['management-device-os'] as 'ios'|'android'|'macos'|'windows'|'ubuntu'|'chromeos'|'other',asset=makeAsset({kind:'device',type:['ios','android'].includes(os)?'Smartphone':'Computer',name:value,importance:'important',operatingSystem:os});next={...next,assets:[...next.assets,asset]};t={...t,environmentDeviceRef:asset.id};
  }
  if(step.id==='management-browser'&&value!=='new'){
    const ref=protectionRefFromValue(value);if(!ref||!t.environmentDeviceRef||!protectionBrowserCandidates(next,t.environmentDeviceRef).some(e=>e.id===ref))return data;t={...t,environmentRef:ref};
  }
  if(step.id==='management-browser-label'&&t.environmentDeviceRef){
    const ref=crypto.randomUUID();next=entity(next,{id:ref,kind:'installation',deviceRef:t.environmentDeviceRef,productId:t.answers['management-browser-product'],label:value,profileLabel:value,createdAt:now,deviceProtectionEntityV1:'v1'});t={...t,environmentRef:ref};
  }
  if(step.id==='line'&&value!=='new')t={...t,lineRef:protectionRefFromValue(value)};
  if(step.id==='line'&&value==='new'&&previous!=='new')t={...t,lineRef:undefined};
  if(step.id==='line-label'){
    const ref=crypto.randomUUID();next=entity(next,{id:ref,kind:'phone-line',deviceRef:t.deviceRef,label:value,simType:t.answers['line-kind'] as 'physical'|'esim'|'unknown',createdAt:now,deviceProtectionEntityV1:'v1'});t={...t,lineRef:ref};
  }
  next=put(next,t);
  if(step.kind==='check'&&(!step.recordValues||step.recordValues.includes(value)))return recordStep(next,t,step,step.recordValueMap?.[value]??value,now);
  return advance(next,t,step.id,now);
}
export function confirmProtectionResources(data:Dataset,id:string,refs:string[],now=nowString()):Dataset{
  if(data.version!==2)return data;let t=protectionTasks(data).find(t=>t.id===id);if(!t)return data;
  const step=currentProtectionStep(data,t);if(step.kind!=='multi'||new Set(refs).size!==refs.length||refs.some(ref=>!step.choices?.some(c=>c.value===ref)))return data;
  let next=data;if(t.answers[step.id]==='confirmed'&&JSON.stringify(refs)!==JSON.stringify(t.managementUsedRefs))for(const key of ['management-check']){const result=withdrawRecord(next,t,key,now);next=result.data;t=result.task;}
  return advance(next,{...t,managementUsedRefs:refs,answers:{...t.answers,[step.id]:'confirmed'}},step.id,now);
}
function recordStep(data:CurrentDataset,t:ProtectionTask,step:ProtectionStep,value:string|undefined,now:string,advanceAfter=true):Dataset{
  let next=data;const kind=step.recordKind??'navigation';
  if(kind==='configuration'&&(!step.feature||!value||!['on','off','unknown','recent','busy','everywhere','familiar','always','unsupported'].includes(value)))return data;
  if(step.requires?.some(ref=>!protectionRecordCurrent(next.securityModel,t,ref)))return data;
  if(kind==='management-use'){
    if(!t.accountRef||!t.environmentRef||!t.environmentDeviceRef||!t.answers['management-phone-use']||t.answers['management-resources']!=='confirmed')return data;
    const environment=next.securityModel.entities.find(e=>e.id===t.environmentRef);if(environment?.kind!=='installation'||environment.deviceRef!==t.environmentDeviceRef||environment.deviceRef===t.deviceRef)return data;
    if(!t.sessionRef){const sessionRef=crypto.randomUUID();next=entity(next,{id:sessionRef,kind:'session',accountRef:t.accountRef,installationRef:t.environmentRef,deviceRef:t.environmentDeviceRef,label:next.settings.language==='ja'?'確認した端末管理のログイン状態':'Observed device-management session',createdAt:now,deviceProtectionEntityV1:'v1'});t={...t,sessionRef};}
  }
  let refs=kind==='management-use'?planPhysicalRefs(next.securityModel,[t.accountRef!,t.environmentRef!,t.sessionRef!,...t.managementUsedRefs,...(t.answers['management-phone-use']==='used'?[t.deviceRef]:[])]):[t.deviceRef,...(t.accountRef?[t.accountRef]:[]),...(step.id.startsWith('management-')&&t.environmentRef?[t.environmentRef]:[]),...(step.id.startsWith('remote-')&&t.lineRef?[t.lineRef]:[])];
  refs=[...new Set(refs)];if(recordedUnavailable(next,refs))return data;
  const withoutRefs=kind==='management-use'&&t.answers['management-phone-use']==='without'?[t.deviceRef]:[];if(withoutRefs.some(ref=>refs.includes(ref)))return data;
  const store=storeOf(next),featureVersions={...Object.assign({},...(step.requires??[]).map(ref=>t.records[ref]?.featureVersions??{}))};
  const record:ProtectionRecord={...t.records[step.id],titleEn:step.title.en,titleJa:step.title.ja,at:now,accountRef:t.accountRef,kind,refs,requires:step.requires??[],featureVersions,withoutRefs,...snapshot(next,[...new Set([...refs,t.deviceRef])]),withdrawnAt:undefined,feature:undefined,value:undefined};
  if(kind==='configuration'&&step.feature){
    const key=protectionSettingKey(t.deviceRef,step.feature),previous=store.settings[key],same=previous&&!previous.withdrawn&&previous.value===value&&previous.accountRef===t.accountRef&&protectionRecordCurrent(next.securityModel,protectionTasks(next).find(x=>x.id===previous.taskRef)!,previous.recordRef);
    const generation=same?previous.generation:(previous?.generation??0)+1;
    record.feature=step.feature;record.value=value as ProtectionSetting['value'];record.featureVersions[key]=generation;
    if(previous)store.history=[...store.history,{...previous}];store.settings={...store.settings,[key]:{...previous,deviceRef:t.deviceRef,feature:step.feature,accountRef:t.accountRef,value:record.value,generation,updatedAt:now,taskRef:t.id,recordRef:step.id,withdrawn:false}};
  }
  if(kind==='management-use')record.context=t.answers['management-context'] as 'normal'|'no-existing-session';
  if(step.control)record.protectionControlV1=step.control;
  t={...t,records:{...t.records,[step.id]:record},recordHistory:t.records[step.id]?[...t.recordHistory,{stepRef:step.id,record:t.records[step.id]}]:t.recordHistory};
  next=put(next,t,store);
  if(step.control)next=recordControl(next,t.deviceRef,step.control,{id:actionId(t,step.id),titleEn:step.title.en,titleJa:step.title.ja,origin:'device-protection'},now) as CurrentDataset;
  return advanceAfter?advance(next,t,step.id,now):project(next);
}
export function recordProtectionDisposal(data:CurrentDataset,deviceRef:string,workflowId:string,now:string):CurrentDataset{
  const t=protectionTasks(data).filter(t=>t.deviceRef===deviceRef&&t.answers.form==='iphone').at(-1);if(!t)return data;
  const step:ProtectionStep={id:`phone-sale-off:${workflowId}`,kind:'operation',title:c('Stolen Device Protection off before handover','引き渡し前の盗難保護オフを確認'),action:c('Native setting checked','正規設定で確認'),sources:['appleTheft'],recordKind:'configuration',feature:'stolen-device-protection',value:'off'};
  return recordStep(data,t,step,'off',now,false) as CurrentDataset;
}
export function undoProtectionDisposal(data:CurrentDataset,deviceRef:string,workflowId:string,now:string):CurrentDataset{
  let next=data;for(const t of protectionTasks(next).filter(t=>t.deviceRef===deviceRef&&t.records[`phone-sale-off:${workflowId}`])){const result=withdrawRecord(next,t,`phone-sale-off:${workflowId}`,now);next=result.data;}return project(next);
}
export function confirmProtectionGuide(data:Dataset,id:string,now=nowString()):Dataset{
  if(data.version!==2)return data;const t=protectionTasks(data).find(t=>t.id===id);if(!t||t.status==='cancelled')return data;
  const step=currentProtectionStep(data,t);return step.kind==='operation'?recordStep(data,t,step,step.value,now):data;
}
export function undoProtectionGuide(data:Dataset,id:string,stepId:string,now=nowString()):Dataset{
  if(data.version!==2)return data;const t=protectionTasks(data).find(t=>t.id===id);if(!t?.records[stepId])return data;
  const next=withdrawRecord(data,t,stepId,now);return project(put(next.data,{...next.task,cursor:stepId,status:'active',updatedAt:now}));
}
export function navigateProtectionGuide(data:Dataset,id:string,action:'back'|'defer'|'cancel',now=nowString()):Dataset{
  if(data.version!==2)return data;const t=protectionTasks(data).find(t=>t.id===id);if(!t)return data;
  if(action!=='back')return put(data,{...t,status:action==='defer'?'deferred':'cancelled',updatedAt:now});
  const history=[...t.history],ids=new Set(protectionSteps(data,t).map(s=>s.id));let cursor=history.pop();while(cursor&&!ids.has(cursor))cursor=history.pop();return cursor?put(data,{...t,cursor,history,status:'active',updatedAt:now}):data;
}
function project(data:CurrentDataset):CurrentDataset{
  let model=data.securityModel;
  for(const t of protectionTasks(data)){
    const prefix=`device-protection:${encodeURIComponent(t.id)}`,enabled=t.records['find-enabled'],used=t.records['management-check'];
    if(!enabled)continue;
    const ids=[`${prefix}:configured`,`${prefix}:used`];
    const priorFacts=new Map(model.facts.map(f=>[f.id,f]));
    const configured:AccessFact={...priorFacts.get(ids[0]),id:ids[0],label:'Device finding configuration',state:enabled.value==='on'?'available':enabled.value==='off'?'unavailable':'unknown',evidence:'user-confirmed',checkedAt:enabled.at,requiredRefs:[],contexts:['normal','no-existing-session'],sourceIds:protectionSources(t).map(s=>PROTECTION_SOURCES[s].url),dependencyCompleteness:'complete',deviceProtectionConfigurationV1:'v1',deviceProtectionTaskRef:t.id,deviceProtectionRecordRef:'find-enabled'};
    const observation:AccessFact={...priorFacts.get(ids[1]),id:ids[1],label:'Observed device-management access',state:used?'available':'unknown',evidence:used?'user-confirmed':'unknown',checkedAt:used?.at??enabled.at,requiredRefs:used?.refs??[],contexts:[used?.context??'normal'],sourceIds:configured.sourceIds,dependencyCompleteness:'partial',observedWithoutRefs:used?.withoutRefs??[],deviceProtectionObservationV1:used?'v1':undefined,deviceProtectionTaskRef:t.id,deviceProtectionRecordRef:used?'management-check':undefined};
    const routeId=`${prefix}:management`,prior=model.routes.find(r=>r.id===routeId);
    model={...model,facts:[...model.facts.filter(f=>!ids.includes(f.id)),configured,observation],routes:[...model.routes.filter(r=>r.id!==routeId),{...prior,id:routeId,label:'Open this device’s management page',targetRef:t.deviceRef,purpose:'device-management',contexts:observation.contexts,requirements:{kind:'all',conditions:ids.map(factId=>({kind:'fact' as const,factId}))},sourceIds:configured.sourceIds,deviceProtectionRouteV1:'v1',deviceProtectionTaskRef:t.id}]};
    if(used&&t.accountRef){
      const pairs:[string,SecurityRelation['kind'],string|undefined,string|undefined][]=[['management','administers',t.accountRef,t.deviceRef],['session-account','session-for',t.sessionRef,t.accountRef],['session-store','stored-in',t.sessionRef,t.environmentRef],['browser-device','installed-on',t.environmentRef,t.environmentDeviceRef]];
      for(const [role,kind,fromRef,toRef] of pairs){if(!fromRef||!toRef)continue;const relationId=`${prefix}:relation:${role}`,old=model.relations.find(r=>r.id===relationId);
        const relation:SecurityRelation={...old,id:relationId,kind,fromRef,toRef,evidence:'user-confirmed',checkedAt:used.at,sourceIds:configured.sourceIds,deviceProtectionRelationV1:'v1',deviceProtectionRelationRoleV1:role,deviceProtectionTaskRef:t.id};
        model={...model,relations:[...model.relations.filter(r=>r.id!==relationId),relation]};
      }
    }
  }return {...data,securityModel:model};
}
export function beginProtectionAccountGuide(data:Dataset,id:string):Dataset{
  if(data.version!==2)return data;const t=protectionTasks(data).find(t=>t.id===id);if(!t?.accountRef||!currentProtectionStep(data,t).accountRecipe)return data;
  if(t.childGuide)return data;
  const child=beginRecipe({...data,guide:guideSchema.parse({accountId:t.accountRef,deviceId:t.deviceRef,answers:{[`${t.accountRef}:platform`]:protectionProvider(t)==='apple'?'ios':'web'}})},t.accountRef,'recovery');
  return put({...child,guide:data.guide} as CurrentDataset,{...t,childRecipe:'recovery',childGuide:child.guide});
}
export function saveProtectionAccountGuide(original:Dataset,child:Dataset,id:string):Dataset{
  if(original.version!==2||child.version!==2)return original;const t=protectionTasks(child).find(t=>t.id===id),previous=protectionTasks(original).find(t=>t.id===id);if(!t||!previous?.childGuide)return original;
  return put({...child,guide:original.guide},{...t,childGuide:child.guide,updatedAt:nowString()});
}
export function protectionHelpPrompt(data:Dataset,t:ProtectionTask,problem:number,language:Language):string{
  const step=currentProtectionStep(data,t),device=data.assets.find(d=>d.id===t.deviceRef),problems=['screen differs','item missing','permission or compatibility','waiting','device or account unavailable'];
  return `${language==='ja'?'最新の公式情報を確認してから、一度に一つの質問または操作を案内してください。最新情報を確認できない場合は、その旨を明示してください。秘密情報・個人情報は求めないでください。':'Verify current official information, then guide one question or action at a time. State if current information cannot be verified. Do not request secrets or personal information.'}\nService: ${protectionProvider(t)??'not selected'}\nOS: ${device?.operatingSystem??'unknown'}\nDevice type: ${t.answers.form??'unknown'}\nSettings family: ${t.answers['android-maker']??'Apple'}\nTask: finding and theft-protection preparation\nStep: ${step.title[language]}\nExpected: ${step.expected?.[language]??step.action[language]}\nProblem: ${problems[problem]??'unresolved'}\nSources:\n${sourceIds(step).join('\n')}`;
}
