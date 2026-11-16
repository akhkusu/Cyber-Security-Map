import {currentDatasetSchema,guideSchema,upgradeDataset,type Dataset,type CurrentDataset} from './models';
import {isStandardManager} from './standardManagerAccounts';
import {standardAccountScope,standardEpoch,standardObservationValid,standardStore,standardSupported,selectedStandardContext,standardContextScope} from './standardContexts';
import type {StandardStore} from './standardManagerSchemas';
import {DataUpgradeConflict} from './models';
import {onePasswordAccount} from './onePasswordAccount';
import {onePasswordRecordCurrent} from './onePasswordRecipes';

export type StandardPhoneSession=StandardStore['sessions'][number];
export const standardPhoneSession=(data:Dataset,id:string)=>standardStore(data)?.sessions.find(s=>s.id===id);
export function startStandardPhone(data:Dataset,phoneRef:string,accountRef:string):{data:CurrentDataset;sessionId:string}{
 if(!standardSupported(data))throw new DataUpgradeConflict();const next=upgradeDataset(data),workflow=next.deviceWorkflows.find(w=>w.id===phoneRef),account=next.assets.find(a=>a.id===accountRef);if(!workflow?.newDeviceRef||!isStandardManager(account))throw Error('invalid-standard-phone');
 const store=standardStore(next)??{version:1 as const,selections:{},observations:[],sessions:[]};
 const existing=store.sessions.find(s=>s.phoneRef===phoneRef&&s.accountRef===accountRef&&s.deviceRef===workflow.newDeviceRef&&s.status==='active');if(existing)return {data:next,sessionId:existing.id};
 const id=crypto.randomUUID(),guide=structuredClone(next.guide);
 guide.managerId=accountRef;guide.cursor=`do/${accountRef}/manager/${'std-phone-install'}`;guide.history=[];
 guide.answers={...guide.answers,'standard-phone:session':id,'standard-phone:workflow':phoneRef,'standard-phone:device':workflow.newDeviceRef,[`${accountRef}:platform`]:next.assets.find(a=>a.id===workflow.newDeviceRef)?.operatingSystem??'unknown'};
 const session:StandardPhoneSession={id,phoneRef,accountRef,deviceRef:workflow.newDeviceRef,status:'active',guide};
 return {data:currentDatasetSchema.parse({...next,securityModel:{...next.securityModel,revision:15,standardManagersV1:{...store,sessions:[...store.sessions,session]}}}),sessionId:id};
}
export function standardPhoneData(data:Dataset,id:string):CurrentDataset|undefined{
 if(data.version!==2)return;const session=standardPhoneSession(data,id),store=standardStore(data);if(!session||!store)return;
 const selections={...store.selections};if(session.selection)selections[session.accountRef]=session.selection;else delete selections[session.accountRef];
 return {...data,guide:guideSchema.parse(session.guide),securityModel:{...data.securityModel,standardManagersV1:{...store,selections}}};
}
export function saveStandardPhone(parent:Dataset,id:string,child:Dataset):CurrentDataset{
 if(parent.version!==2||child.version!==2)throw Error('invalid-standard-phone');
 const previous=standardPhoneSession(parent,id),store=standardStore(child),original=standardStore(parent);if(!previous||!store||!original)throw Error('invalid-standard-phone');
 const selection=selectedStandardContext(child,previous.accountRef),guide=child.guide;
 const completed=guide.cursor==='standard-phone-complete';
 const session={...previous,guide,selection:selection?{vaultRef:selection.vault.id,appRef:selection.app.id}:undefined,status:completed?'completed' as const:'active' as const,scope:standardAccountScope(child,previous.accountRef),epoch:standardEpoch(child,previous.accountRef)};
 const selections={...store.selections};if(original.selections[previous.accountRef])selections[previous.accountRef]=original.selections[previous.accountRef];else delete selections[previous.accountRef];
 return currentDatasetSchema.parse({...child,guide:parent.guide,securityModel:{...child.securityModel,standardManagersV1:{...store,selections,sessions:[...store.sessions.filter(s=>s.id!==id),session]}}});
}
export function standardPhoneReady(data:Dataset,phoneRef:string,accountRef:string,sessionId?:string){
 const store=standardStore(data);return !!store?.sessions.some(session=>{
  if(sessionId&&session.id!==sessionId||data.version!==2||data.deviceWorkflows.find(w=>w.id===phoneRef)?.newDeviceRef!==session.deviceRef||session.phoneRef!==phoneRef||session.accountRef!==accountRef||session.status!=='completed'||session.scope!==standardAccountScope(data,accountRef)||session.epoch!==standardEpoch(data,accountRef)||!session.selection)return false;
  const child=standardPhoneData(data,session.id);if(!child)return false;
  const target=child.guide.answers[`std-phone-target:${accountRef}`],prefix=`standard-phone:${session.id}:`;
  const has=(kind:'opened'|'autofill'|'password-use')=>store.observations.some(o=>o.accountRef===accountRef&&o.appRef===session.selection!.appRef&&o.vaultRef===session.selection!.vaultRef&&o.kind===kind&&!!o.sourceKey&&o.sourceKey.startsWith(prefix)&&standardObservationValid(data,o.id)&&(kind!=='password-use'||o.subjectRef===target));
  const recovery=child.guide.steps[`do/${accountRef}/manager/std-phone-recovery`];
  return !!target&&has('opened')&&has('autofill')&&has('password-use')&&recovery?.status==='done'&&recovery.standardContextV1===standardContextScope(child,accountRef);
 });
}
export function standardObservationKey(data:Dataset,key:string){const id=data.guide.answers['standard-phone:session'];return id?`standard-phone:${id}:${key}`:key;}
export function standardPhoneStepCurrent(data:Dataset,accountRef:string,step:string){
 const record=data.guide.steps[`do/${accountRef}/manager/${step}`];
 return record?.status==='done'&&record.standardContextV1===standardContextScope(data,accountRef)&&record.standardEpochV1===standardEpoch(data,accountRef)&&(!['std-phone-target','std-phone-login'].includes(step)||record.standardPhoneTargetV1===data.guide.answers[`std-phone-target:${accountRef}`]);
}
export function standardPhoneRedirect(data:Dataset,ref:string,step:string){
 if(!data.guide.answers['standard-phone:session']||!step.startsWith('std-phone-')||['std-phone-install','std-phone-unverified'].includes(step))return;
 const route=(id:string)=>`do/${ref}/manager/${id}`,done=(id:string)=>standardPhoneStepCurrent(data,ref,id);
 const method=onePasswordAccount(data,ref)?.method,nonPassword=!!method&&method!=='password';
 if(step==='op-start'&&data.guide.steps[route('std-phone-install')]?.status!=='done')return route('std-phone-install');
 if(step==='std-phone-target'||step==='std-phone-login'||step==='std-phone-recovery'){
  if(nonPassword){const missing=['op-open','op-fill','op-recovery-read'].find(id=>!onePasswordRecordCurrent(data,ref,id));if(missing)return route(missing);}
  else {const missing=['std-phone-signin','std-phone-open','std-phone-fill'].find(id=>!done(id));if(missing)return route(missing);}
 }
 if(step==='std-phone-signin'&&data.guide.steps[route('std-phone-install')]?.status!=='done')return route('std-phone-install');
 if(step==='std-phone-open'&&!done('std-phone-signin'))return route('std-phone-signin');
 if(step==='std-phone-fill'&&!done('std-phone-open'))return route('std-phone-open');
 if(step==='std-phone-target'){
  const target=data.assets.find(a=>a.id===data.guide.answers[`std-phone-target:${ref}`]&&a.kind==='account'&&a.id!==ref&&a.type!=='Password manager'&&!a.services.includes('manager'));
  if(!target)return `standard-phone-target/${ref}`;
 }
 if(step==='std-phone-login'&&!done('std-phone-target'))return route('std-phone-target');
 if(step==='std-phone-recovery'&&!done('std-phone-login'))return route('std-phone-login');
}
