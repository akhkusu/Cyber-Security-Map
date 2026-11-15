import type { Dataset } from './models';
import {bitwardenRegion} from './bitwardenServer';
import {standardContextScope,standardObservationCurrent} from './standardContexts';
import {onePasswordScope} from './onePasswordAccount';

export function standardPasswordScope(data: Dataset): string | undefined {
  const manager = data.assets.find(a => a.id === data.guide.managerId);
  const region=manager?.provider==='bitwarden'?bitwardenRegion(data,manager.id):undefined;
  return manager?.provider === 'bitwarden' ? region?`bitwarden:${region}`:undefined : manager?.provider === '1password' ? onePasswordScope(data,manager.id) : undefined;
}
export function hasSavedPasswordCandidate(data: Dataset, accountId: string): boolean {
  const scope = standardPasswordScope(data), saved = data.guide.steps[`do/${accountId}/password/save-candidate`];
  const context=data.guide.managerId?standardContextScope(data,data.guide.managerId):undefined;
  const generated=data.guide.steps[`do/${accountId}/password/generate`];
  const sameAttempt=generated?.status!=='done'||generated.standardPasswordContextV1!==context||generated.standardPasswordAttemptV1===saved?.standardPasswordAttemptV1;
  return sameAttempt && !!scope && !!context && saved?.status === 'done' && saved.managerRef === data.guide.managerId && saved.managerScope === scope && saved.standardPasswordContextV1===context;
}
export function standardPasswordRecordCurrent(data:Dataset,subjectRef:string,step:string){
 const record=data.guide.steps[`do/${subjectRef}/password/${step}`],context=data.guide.managerId?standardContextScope(data,data.guide.managerId):undefined;
 if(!context||record?.status!=='done'||record.standardPasswordContextV1!==context)return false;
 if(['save-new','test','cleanup'].includes(step)){
  const accepted=data.guide.steps[`do/${subjectRef}/password/apply`];
  if(accepted?.status==='done'&&record.standardPasswordAttemptV1!==accepted.standardPasswordAttemptV1)return false;
 }
 return true;
}
export function standardPasswordUseCurrent(data:Dataset,subjectRef:string){const receipt=data.guide.steps[`do/${subjectRef}/password/apply`];return !!data.guide.managerId&&standardPasswordRecordCurrent(data,subjectRef,'test')&&standardObservationCurrent(data,data.guide.managerId,'password-use',subjectRef,String(receipt?.status==='done'?receipt.standardPasswordAttemptV1??'unchanged':'unchanged'));}
export function standardPasswordMetadata(data:Dataset,subjectRef:string,step:string){
 const context=data.guide.managerId?standardContextScope(data,data.guide.managerId):undefined,generated=data.guide.steps[`do/${subjectRef}/password/generate`],candidate=data.guide.steps[`do/${subjectRef}/password/save-candidate`],accepted=data.guide.steps[`do/${subjectRef}/password/apply`];
 return {managerRef:data.guide.managerId,managerScope:standardPasswordScope(data),standardPasswordContextV1:context,
  standardPasswordAttemptV1:step==='generate'?crypto.randomUUID():step==='save-candidate'&&generated?.status==='done'&&generated.standardPasswordContextV1===context?generated.standardPasswordAttemptV1:step==='save-candidate'?(candidate&&candidate.standardPasswordContextV1===context&&candidate.standardPasswordAttemptV1||crypto.randomUUID()):step==='apply'?candidate?.standardPasswordAttemptV1:accepted?.status==='done'?accepted.standardPasswordAttemptV1:undefined};
}
export function standardPasswordRedirect(data:Dataset,subjectRef:string,step:string){
 const accepted=data.guide.steps[`do/${subjectRef}/password/apply`];if(accepted?.status!=='done')return;
 const route=(id:string)=>`do/${subjectRef}/password/${id}`;
 if(!standardPasswordRecordCurrent(data,subjectRef,'apply'))return `standard-password-result/${subjectRef}`;
 if(['find-current','save-current','password-choice','open','generate','save-candidate','apply'].includes(step))return route(!standardPasswordRecordCurrent(data,subjectRef,'save-new')?'save-new':!standardPasswordUseCurrent(data,subjectRef)?'test':'cleanup');
}
export function confirmStandardPasswordResult(data:Dataset,subjectRef:string):Dataset{
 const key=`do/${subjectRef}/password/apply`,old=data.guide.steps[key];if(old?.status!=='done'||!data.guide.managerId||!standardContextScope(data,data.guide.managerId))throw Error('missing-standard-password-result');
 const record={...old,...standardPasswordMetadata(data,subjectRef,'apply'),standardPasswordAttemptV1:crypto.randomUUID(),standardPasswordPriorV1:[...(Array.isArray(old.standardPasswordPriorV1)?old.standardPasswordPriorV1:[]),{...old,standardPasswordPriorV1:undefined}].slice(-20)};
 return {...data,guide:{...data.guide,cursor:`do/${subjectRef}/password/save-new`,steps:{...data.guide.steps,[key]:record}}};
}
