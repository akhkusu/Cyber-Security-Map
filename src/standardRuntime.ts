import {standardObservationKey} from './standardPhone';
import type {Dataset} from './models';
import type {GuideStep} from './guideCatalog';
import {onePasswordScope} from './onePasswordAccount';
import {onePasswordSource} from './onePasswordSource';
import {selectedStandardContext,standardContextScope,standardEpoch,standardStore,recordStandardObservation,standardAccountScope} from './standardContexts';
import {invalidateStandardAccount} from './standardInvalidation';
export function standardStepMetadata(data:Dataset,accountRef:string){return {standardContextV1:standardContextScope(data,accountRef),standardEpochV1:standardEpoch(data,accountRef),onePasswordScopeV1:onePasswordScope(data,accountRef),onePasswordSourceV1:onePasswordSource(data,accountRef)?.id,standardPhoneTargetV1:data.guide.answers[`std-phone-target:${accountRef}`]};}
export function recordStandardStep(data:Dataset,key:string,subjectRef:string,recipe:string,step:GuideStep):Dataset{
 key=standardObservationKey(data,key);
 const accountRef=recipe==='manager'?subjectRef:recipe==='password'?data.guide.managerId:undefined;
 if(!accountRef||!selectedStandardContext(data,accountRef)||!standardAccountScope(data,accountRef))return data;
 let next=data;
 if(recipe==='manager'&&step.id==='master-submit')return invalidateStandardAccount(next,accountRef,true);
 if(recipe==='manager'&&step.id==='op-source-open'){
  const source=onePasswordSource(next,accountRef),store=standardStore(next),selected=selectedStandardContext(next,accountRef);
  if(!source||!store||!selected||next.version!==2)return next;
  const temporary={...next,securityModel:{...next.securityModel,standardManagersV1:{...store,selections:{...store.selections,[accountRef]:{vaultRef:selected.vault.id,appRef:source.id}}}}};
  const observed=recordStandardObservation(temporary,accountRef,'opened',{sourceKey:key,sourceIds:step.sources});
  return observed.version===2?{...observed,securityModel:{...observed.securityModel,standardManagersV1:{...standardStore(observed)!,selections:store.selections}}}:next;
 }
 if(recipe==='manager'&&['op-open','master-change-test','std-phone-open'].includes(step.id))next=recordStandardObservation(next,accountRef,'opened',{sourceKey:key,sourceIds:step.sources});
 if(recipe==='manager'&&step.id==='master-change-test')next=recordStandardObservation(next,accountRef,'master-use',{sourceKey:key,sourceIds:step.sources,attempt:String(data.guide.steps[`do/${accountRef}/manager/master-submit`]?.standardMasterAttemptV1??'')});
 if(recipe==='manager'&&['op-fill','std-phone-fill'].includes(step.id))next=recordStandardObservation(next,accountRef,'autofill',{sourceKey:key,sourceIds:step.sources});
 if(recipe==='manager'&&step.id==='op-authorize')next=recordStandardObservation(next,accountRef,'sso-link',{sourceKey:key,sourceIds:step.sources});
 if(recipe==='manager'&&['op-recovery-read','std-phone-recovery'].includes(step.id))next=recordStandardObservation(next,accountRef,'recovery',{sourceKey:key,sourceIds:step.sources});
 if(recipe==='manager'&&step.id==='std-phone-login'){const target=data.guide.answers[`std-phone-target:${accountRef}`];if(target)next=recordStandardObservation(next,accountRef,'password-use',{sourceKey:key,sourceIds:step.sources,subjectRef:target,attempt:'phone-current'});}
 if(recipe==='password'&&step.id==='test')next=recordStandardObservation(next,accountRef,'password-use',{sourceKey:key,sourceIds:step.sources,subjectRef,attempt:String(data.guide.steps[`do/${subjectRef}/password/apply`]?.standardPasswordAttemptV1??'unchanged')});
 return next;
}
