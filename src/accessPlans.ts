import { observationScopeCurrent, planExcludedConflict, planPhysicalRefs, planSemanticSignature } from './accessPlanEvidence';
import { DataUpgradeConflict, currentDatasetSchema, upgradeDataset, type CurrentDataset, type Dataset } from './models';
import { accessPlanSchema, accessPlanStore, accessPlanStoreSchema, chosenPlanNodes, definitionNodes, failureGroupDraftSchema, failureGroupSchema, observationDraftSchema, planDraftSchema, validPlanDefinition, type AccessPlan, type AccessPlanStore, type FailureGroupDraft, type ObservationDraft, type PlanDefinition, type PlanDraft, type PlanNode, type PlanObservation } from './accessPlanSchemas';
import { ACCESS_CONTEXTS, evaluateAccess, type AccessCondition, type AccessFact, type AccessRoute, type SecurityModel } from './securityModel';
import { safeMapNickname } from './mapRecords';

const nowString=()=>new Date().toISOString();
const empty=()=>accessPlanStoreSchema.parse({version:1});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const planItems=(data:Dataset)=>[...data.assets,...(data.version===2?data.securityModel.entities.filter(e=>!e.mergedIntoRef):[])];
export const planItemName=(data:Dataset,ref:string)=>{const item=[...data.assets,...(data.version===2?data.securityModel.entities:[])].find(e=>e.id===ref);return item?'name' in item?String(item.name):String(item.label):ref;};
export const planStructuralKey=(p:Pick<AccessPlan,'targetRef'|'purpose'|'context'|'definition'|'conditionEvidence'>)=>JSON.stringify([p.targetRef,p.purpose,p.context,p.definition,p.conditionEvidence]);
export const physicalPlanRefs=(data:Dataset,refs:readonly string[])=>planPhysicalRefs(data.version===2?data.securityModel:undefined,refs);
export const planRouteSignature=(data:Dataset,routeRef:string)=>data.version===2?planSemanticSignature(data.securityModel,routeRef):'missing';
export const planObservationCurrent=(data:Dataset,p:AccessPlan,o:PlanObservation)=>data.version===2&&observationScopeCurrent(data.securityModel,p,o);
function writable(data:Dataset):CurrentDataset{
  const next=upgradeDataset(data),m=next.securityModel;
  if(m.revision<8&&(Object.hasOwn(m,'accessPlansV1')||[...next.assets,...m.entities,...m.facts,...m.routes,...m.relations].some(e=>String(e.id).startsWith('access-plan:')||Object.keys(e).some(k=>k.startsWith('accessPlan')))))throw new DataUpgradeConflict();
  if(m.revision>=8&&Object.hasOwn(m,'accessPlansV1')&&!accessPlanStoreSchema.safeParse(m.accessPlansV1).success)throw new DataUpgradeConflict();
  return next;
}
function write(data:CurrentDataset,store:AccessPlanStore):CurrentDataset{return currentDatasetSchema.parse({...data,securityModel:{...data.securityModel,revision:8,accessPlansV1:store}});}
function putDraft(data:CurrentDataset,draft:PlanDraft){const s=accessPlanStore(data)??empty();return write(data,{...s,drafts:[...s.drafts.filter(d=>d.id!==draft.id),draft]});}
const draftOf=(data:Dataset,id:string)=>accessPlanStore(data)?.drafts.find(d=>d.id===id);
const planOf=(data:Dataset,id:string)=>accessPlanStore(data)?.plans.find(p=>p.id===id);
const newNode=(kind:PlanNode['kind']):PlanNode=>({id:crypto.randomUUID(),kind,children:[]});
function moveDraft(data:CurrentDataset,draft:PlanDraft,cursor:string){return putDraft(data,{...draft,cursor,history:[...draft.history,draft.cursor].slice(-200)});}
export function planPurposeAllowed(data:Dataset,targetRef:string,purpose:AccessPlan['purpose']){
  const item=planItems(data).find(e=>e.id===targetRef);if(!item)return false;
  if(purpose==='sign-in'||purpose==='second-step')return item.kind==='account';
  if(purpose==='decrypt')return ['vault','data-set','device','backup'].includes(item.kind);
  if(purpose==='local-unlock')return ['installation','vault','device'].includes(item.kind);
  return ['account','vault','data-set','device','backup'].includes(item.kind);
}
export function startAccessPlan(data:Dataset,targetRef?:string,editRef?:string,now=nowString()):{data:CurrentDataset;id:string}{
  const next=writable(data),p=editRef?planOf(next,editRef):undefined;if(editRef&&!p)throw new Error('missing-plan');
  const draft=planDraftSchema.parse({id:crypto.randomUUID(),planId:p?.id??crypto.randomUUID(),editRef:p?.id,baseline:p?JSON.stringify(p):undefined,targetRef:p?.targetRef??targetRef,purpose:p?.purpose,context:p?.context,label:p?.label,definition:p?.definition,conditionEvidence:p?.conditionEvidence,cursor:'target',createdAt:now});
  return {data:putDraft(next,draft),id:draft.id};
}
export function answerAccessPlan(data:Dataset,id:string,value:string):Dataset{
  if(data.version!==2)return data;let d=draftOf(data,id);if(!d||d.status!=='active')return data;
  const [step,nodeId]=d.cursor.split('/');
  if(step==='target'){if(!planItems(data).some(e=>e.id===value&&['account','vault','installation','data-set','device','backup'].includes(e.kind)))return data;const purpose=d.purpose&&planPurposeAllowed(data,value,d.purpose)?d.purpose:undefined;return moveDraft(data,{...d,targetRef:value,purpose},'purpose');}
  if(step==='purpose'){if(!d.targetRef||!planPurposeAllowed(data,d.targetRef,value as AccessPlan['purpose']))return data;return moveDraft(data,{...d,purpose:value as AccessPlan['purpose']},'context');}
  if(step==='context'){if(!ACCESS_CONTEXTS.includes(value as AccessPlan['context']))return data;return moveDraft(data,{...d,context:value as AccessPlan['context']},'label');}
  if(step==='label'){if(!safeMapNickname(value))return data;let definition=d.definition;if(!definition){const root=newNode('pending');definition={rootRef:root.id,nodes:{[root.id]:root}};}return moveDraft(data,{...d,label:value.trim(),definition},`operator/${definition.rootRef}`);}
  if(step==='evidence'){if(!['unknown','user-confirmed'].includes(value))return data;return moveDraft(data,{...d,conditionEvidence:value as AccessPlan['conditionEvidence']},'review');}
  const def=d.definition,node=def?.nodes[nodeId];if(!def||!node)return data;
  const set=(next:PlanNode)=>({...def,nodes:{...def.nodes,[nodeId]:next}});
  if(step==='operator'){
    if(!['all','any'].includes(value))return data;
    return moveDraft(data,{...d,definition:set({...node,kind:value as 'all'|'any',ref:undefined})},`add/${nodeId}`);
  }
  if(step==='item'||step==='route'){
    if(step==='item'&&!planItems(data).some(e=>e.id===value))return data;
    if(step==='route'&&!data.securityModel.routes.some(r=>r.id===value&&r.contexts.includes(d!.context!)))return data;
    const parent=Object.values(def.nodes).find(n=>n.children.includes(nodeId));if(!parent)return data;
    if(parent.children.some(child=>child!==nodeId&&def.nodes[child].kind===step&&def.nodes[child].ref===value))throw new Error('duplicate-condition');
    return moveDraft(data,{...d,definition:set({...node,kind:step,ref:value,children:[]})},`add/${parent.id}`);
  }
  if(step==='add'){
    if(value==='finish'){
      if(!node.children.length||node.children.some(id=>def.nodes[id].kind==='pending'||['item','route'].includes(def.nodes[id].kind)&&!def.nodes[id].ref))throw new Error('unfinished-condition');
      const parent=Object.values(def.nodes).find(n=>n.children.includes(nodeId));
      return moveDraft(data,d,parent?`add/${parent.id}`:'evidence');
    }
    if(!['item','route','group'].includes(value))return data;
    if(Object.keys(def.nodes).length>=4000||node.children.length>=100)throw new Error('condition-limit');
    const child=newNode('pending'),definition={...def,nodes:{...def.nodes,[nodeId]:{...node,children:[...node.children,child.id]},[child.id]:child}};
    definitionNodes(definition);
    return moveDraft(data,{...d,definition},`${value==='group'?'operator':value}/${child.id}`);
  }
  return data;
}
export function editAccessCondition(data:Dataset,id:string,nodeRef:string,remove=false):Dataset{
  if(data.version!==2)return data;const d=draftOf(data,id),def=d?.definition,node=def?.nodes[nodeRef];if(!d||!def||!node||d.status!=='active')return data;
  if(!remove)return putDraft(data,{...d,cursor:`${node.kind==='item'?'item':node.kind==='route'?'route':'operator'}/${node.id}`});
  if(node.id===def.rootRef)return data;const parent=Object.values(def.nodes).find(n=>n.children.includes(node.id));if(!parent)return data;
  const gone=new Set<string>(),pending=[node.id];while(pending.length){const id=pending.pop()!;if(gone.has(id))continue;gone.add(id);pending.push(...(def.nodes[id]?.children??[]));}
  return putDraft(data,{...d,definition:{...def,nodes:{...Object.fromEntries(Object.entries(def.nodes).filter(([key])=>!gone.has(key))),[parent.id]:{...parent,children:parent.children.filter(id=>id!==node.id)}}},cursor:`add/${parent.id}`});
}
export function navigateAccessPlan(data:Dataset,id:string,action:'back'|'cancel'):Dataset{if(data.version!==2)return data;const d=draftOf(data,id);if(!d)return data;if(action==='cancel')return putDraft(data,{...d,status:'cancelled'});const history=[...d.history],cursor=history.pop();return cursor?putDraft(data,{...d,cursor,history}):data;}
export function commitAccessPlan(data:Dataset,id:string,now=nowString()):CurrentDataset{
  let next=writable(data);const d=draftOf(next,id),s=accessPlanStore(next)??empty();if(!d||d.status!=='active'||d.cursor!=='review'||!d.targetRef||!d.purpose||!d.context||!d.label||!d.conditionEvidence||!d.definition||!validPlanDefinition(d.definition)||!planPurposeAllowed(next,d.targetRef,d.purpose))throw new Error('unfinished-plan');
  const old=d.editRef?s.plans.find(p=>p.id===d.editRef):undefined;if(d.editRef&&(!old||JSON.stringify(old)!==d.baseline))throw new Error('stale-plan');
  const fields={targetRef:d.targetRef,purpose:d.purpose,context:d.context,definition:d.definition,conditionEvidence:d.conditionEvidence};
  const changed=old&&!same(planStructuralKey(old),planStructuralKey(fields));
  const plan=accessPlanSchema.parse({...old,...fields,id:d.planId,label:d.label,definitionVersion:old?old.definitionVersion+(changed?1:0):1,history:changed?[...old.history,{targetRef:old.targetRef,purpose:old.purpose,context:old.context,definition:old.definition,conditionEvidence:old.conditionEvidence,definitionVersion:old.definitionVersion,at:old.updatedAt}]:old?.history??[],createdAt:old?.createdAt??now,updatedAt:now});
  const store={...s,plans:[...s.plans.filter(p=>p.id!==plan.id),plan],drafts:s.drafts.map(x=>x.id===id?{...x,status:'completed' as const}:x)};
  next=write(next,store);return rebuildAccessPlans(next,now);
}
const prefix=(p:AccessPlan)=>`access-plan:${p.id}:v${p.definitionVersion}`;
const fieldsFor=(p:AccessPlan)=>({accessPlanVersion:'v1',accessPlanRef:p.id,accessPlanDefinitionVersion:p.definitionVersion});
function expression(definition:PlanDefinition,nodeRef:string,leaf:(node:PlanNode)=>AccessCondition):AccessCondition{
  const n=definition.nodes[nodeRef];return n.kind==='all'||n.kind==='any'?{kind:n.kind,conditions:n.children.map(id=>expression(definition,id,leaf))}:leaf(n);
}
const any=(conditions:AccessCondition[]):AccessCondition=>conditions.length<=100?{kind:'any',conditions}:{kind:'any',conditions:Array.from({length:Math.ceil(conditions.length/100)},(_,i)=>any(conditions.slice(i*100,i*100+100)))};
function projection(definition:PlanDefinition,branches:Record<string,string>,nodeRef:string,leaf:(node:PlanNode)=>AccessCondition):AccessCondition{
  const n=definition.nodes[nodeRef];if(n.kind==='any')return projection(definition,branches,branches[n.id],leaf);if(n.kind==='all')return {kind:'all',conditions:n.children.map(id=>projection(definition,branches,id,leaf))};return leaf(n);
}
export function rebuildAccessPlans(data:CurrentDataset,_now=nowString()):CurrentDataset{
  const s=accessPlanStore(data);if(!s)return data;const facts:AccessFact[]=[],routes:AccessRoute[]=[];
  for(const p of s.plans){
    const base=prefix(p),meta=fieldsFor(p),contexts=[p.context];
    for(const n of definitionNodes(p.definition).filter(n=>n.kind==='item'))facts.push({id:`${base}:condition:${n.id}`,label:planItemName(data,n.ref!),state:'unknown',evidence:p.conditionEvidence,checkedAt:p.updatedAt,requiredRefs:physicalPlanRefs(data,[n.ref!]),contexts,sourceIds:[],...meta,accessPlanConditionRef:n.id});
    const unknownId=`${base}:not-yet-tested`;facts.push({id:unknownId,label:p.label,state:'unknown',evidence:'user-confirmed',checkedAt:p.updatedAt,requiredRefs:[p.targetRef],contexts,sourceIds:[],...meta});
    const baselineId=`${base}:baseline`,requirements=expression(p.definition,p.definition.rootRef,n=>n.kind==='route'?{kind:'route',routeId:n.ref!}:{kind:'fact',factId:`${base}:condition:${n.id}`});
    routes.push({id:baselineId,label:p.label,targetRef:p.targetRef,purpose:p.purpose,contexts,requirements:{kind:'all',conditions:[requirements,{kind:'fact',factId:unknownId}]},sourceIds:[],...meta});
    const alternatives:AccessCondition[]=[{kind:'route',routeId:baselineId}];
    for(const o of s.observations.filter(o=>o.planRef===p.id&&o.definitionVersion===p.definitionVersion)){
      const receipt=`${base}:observation:${o.id}`,active=planObservationCurrent(data,p,o),observationMeta={...meta,accessPlanObservationRef:o.id,accessPlanObservationV1:'v1'};
      for(const n of o.usedNodeRefs.map(id=>p.definition.nodes[id]).filter(n=>n?.kind==='item'))facts.push({id:`${receipt}:condition:${n.id}`,label:planItemName(data,n.ref!),state:active?'available':'unknown',evidence:active?'user-confirmed':'unknown',checkedAt:o.checkedAt,requiredRefs:o.conditionRefs[n.id],contexts,sourceIds:[],dependencyCompleteness:'partial',observedWithoutRefs:o.withoutRefs,...observationMeta,accessPlanConditionRef:n.id});
      const whole=`${receipt}:whole`;facts.push({id:whole,label:p.label,state:active?'available':'unknown',evidence:active?'user-confirmed':'unknown',checkedAt:o.checkedAt,requiredRefs:o.usedRefs,contexts,sourceIds:[],dependencyCompleteness:'partial',observedWithoutRefs:o.withoutRefs,...observationMeta});
      const projected=projection(p.definition,o.branches,p.definition.rootRef,n=>n.kind==='route'?{kind:'route',routeId:n.ref!}:{kind:'fact',factId:`${receipt}:condition:${n.id}`});
      const id=`${receipt}:route`;routes.push({id,label:p.label,targetRef:p.targetRef,purpose:p.purpose,contexts,requirements:{kind:'all',conditions:[projected,{kind:'fact',factId:whole}]},sourceIds:[],...observationMeta});alternatives.push({kind:'route',routeId:id});
    }
    routes.push({id:p.id,label:p.label,targetRef:p.targetRef,purpose:p.purpose,contexts,requirements:any(alternatives),sourceIds:[],...meta,accessPlanRoot:'v1'});
  }
  for(let i=0;i<facts.length;i++)facts[i]={...data.securityModel.facts.find(f=>f.id===facts[i].id),...facts[i]};
  for(let i=0;i<routes.length;i++)routes[i]={...data.securityModel.routes.find(r=>r.id===routes[i].id),...routes[i]};
  const factIds=new Set(facts.map(f=>f.id)),routeIds=new Set(routes.map(r=>r.id));
  const retainedFacts=data.securityModel.facts.filter(f=>!factIds.has(f.id)).map(f=>f.accessPlanVersion==='v1'?{...f,state:'unknown' as const,evidence:'unknown' as const}:f);
  // Old definitions remain addressable to preserve references and history, but
  // their proof is unknown after a structural correction.
  const model:SecurityModel={...data.securityModel,facts:[...retainedFacts,...facts],routes:[...data.securityModel.routes.filter(r=>!routeIds.has(r.id)),...routes]};
  return currentDatasetSchema.parse({...data,securityModel:model});
}
function putObservationDraft(data:CurrentDataset,draft:ObservationDraft){const s=accessPlanStore(data)??empty();return write(data,{...s,observationDrafts:[...s.observationDrafts.filter(d=>d.id!==draft.id),draft]});}
export function startPlanObservation(data:Dataset,planRef:string,now=nowString()):{data:CurrentDataset;id:string}{const next=writable(data),p=planOf(next,planRef);if(!p)throw new Error('missing-plan');const draft=observationDraftSchema.parse({id:crypto.randomUUID(),planRef,definitionVersion:p.definitionVersion,createdAt:now});return {data:putObservationDraft(next,draft),id:draft.id};}
export function observationSteps(plan:AccessPlan,d:ObservationDraft):string[]{const nodes=chosenPlanNodes(plan.definition,d.branches),branches=nodes.filter(n=>n.kind==='any').map(n=>`branch/${n.id}`);return ['scope',...branches,'used','without','time',...(d.timeMode==='earlier'?['checked-at']:[]),'review'];}
export function currentObservationStep(plan:AccessPlan,d:ObservationDraft):string{
  const steps=observationSteps(plan,d),index=steps.indexOf(d.cursor),end=index<0?steps.length-1:index;
  const done=(id:string)=>id==='scope'?d.scopeConfirmed:id.startsWith('branch/')?!!d.branches[id.slice(7)]:id==='used'?d.usedConfirmed:id==='without'?d.withoutConfirmed:id==='time'?!!d.timeMode:id==='checked-at'?!!d.checkedAt:true;
  return steps.slice(0,end+1).find(id=>!done(id))??steps[end];
}
export function observationRequiredRefs(data:Dataset,p:AccessPlan,d:ObservationDraft){return physicalPlanRefs(data,chosenPlanNodes(p.definition,d.branches).filter(n=>n.kind==='item').map(n=>n.ref!));}
export function answerPlanObservation(data:Dataset,id:string,value:string|string[],now=nowString()):Dataset{
  if(data.version!==2)return data;const s=accessPlanStore(data),draft=s?.observationDrafts.find(d=>d.id===id),p=draft&&planOf(data,draft.planRef);if(!draft||!p||draft.status!=='active'||draft.definitionVersion!==p.definitionVersion)return data;let d={...draft};const cursor=currentObservationStep(p,d);const [step,nodeRef]=cursor.split('/');
  if(step==='scope'){if(value!=='confirmed')return data;d={...d,scopeConfirmed:true};}
  else if(step==='branch'){if(typeof value!=='string'||!p.definition.nodes[nodeRef]?.children.includes(value))return data;const branches={...d.branches,[nodeRef]:value};const reachable=new Set(chosenPlanNodes(p.definition,branches).map(n=>n.id));d={...d,branches:Object.fromEntries(Object.entries(branches).filter(([id])=>reachable.has(id))),usedRefs:[],withoutRefs:[],usedConfirmed:false,withoutConfirmed:false};}
  else if(step==='used'||step==='without'){
    if(!Array.isArray(value)||new Set(value).size!==value.length||value.some(ref=>!planItems(data).some(e=>e.id===ref)))return data;
    const required=observationRequiredRefs(data,p,d);
    if(step==='used')d={...d,usedRefs:[...new Set([...chosenPlanNodes(p.definition,d.branches).filter(n=>n.kind==='item').map(n=>n.ref!),...value])],withoutRefs:[],usedConfirmed:true,withoutConfirmed:false};
    else{const used=physicalPlanRefs(data,[p.targetRef,...required,...d.usedRefs]),without=value;if(planExcludedConflict(data.securityModel,used,without))throw new Error('contradictory-observation');d={...d,withoutRefs:without,withoutConfirmed:true};}
  }
  else if(step==='time'){if(value!=='now'&&value!=='earlier')return data;d={...d,timeMode:value,checkedAt:value==='now'?now:undefined};}
  else if(step==='checked-at'){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||Date.parse(value)>Date.parse(now))throw new Error('invalid-observation-date');d={...d,checkedAt:new Date(value).toISOString()};}
  else return data;
  const steps=observationSteps(p,d),index=steps.indexOf(cursor),nextCursor=steps[index+1]??'review';return putObservationDraft(data,{...d,cursor:nextCursor,history:[...d.history,cursor]});
}
export function commitPlanObservation(data:Dataset,id:string,now=nowString()):CurrentDataset{
  const next=writable(data),s=accessPlanStore(next)??empty(),d=s.observationDrafts.find(d=>d.id===id),p=d&&planOf(next,d.planRef);
  if(!d||!p||d.status!=='active'||currentObservationStep(p,d)!=='review'||!d.scopeConfirmed||!d.usedConfirmed||!d.withoutConfirmed||d.definitionVersion!==p.definitionVersion||!d.checkedAt||Date.parse(d.checkedAt)>Date.parse(now))throw new Error('unfinished-observation');
  const chosen=chosenPlanNodes(p.definition,d.branches);if(chosen.some(n=>n.kind==='any'&&!d.branches[n.id]))throw new Error('unfinished-observation');
  const usedNodes=chosen.filter(n=>n.kind==='item'||n.kind==='route'),usedNodeRefs=usedNodes.map(n=>n.id),usedItemRefs=[...new Set([...usedNodes.filter(n=>n.kind==='item').map(n=>n.ref!),...d.usedRefs])],usedRefs=physicalPlanRefs(next,[p.targetRef,...usedItemRefs]);
  const conditionRefs=Object.fromEntries(usedNodes.filter(n=>n.kind==='item').map(n=>[n.id,physicalPlanRefs(next,[n.ref!])])),routeSnapshots=Object.fromEntries(usedNodes.filter(n=>n.kind==='route').map(n=>[n.id,planRouteSignature(next,n.ref!)]));
  if(planExcludedConflict(next.securityModel,usedRefs,d.withoutRefs))throw new Error('contradictory-observation');
  const observation:PlanObservation={id:crypto.randomUUID(),planRef:p.id,definitionVersion:p.definitionVersion,branches:d.branches,usedNodeRefs,usedItemRefs,usedRefs,conditionRefs,routeSnapshots,withoutRefs:d.withoutRefs,checkedAt:d.checkedAt,recordedAt:now};
  return rebuildAccessPlans(write(next,{...s,observations:[...s.observations,observation],observationDrafts:s.observationDrafts.map(x=>x.id===id?{...x,status:'completed'}:x)}),now);
}
export function navigatePlanObservation(data:Dataset,id:string,action:'back'|'cancel'):Dataset{if(data.version!==2)return data;const d=accessPlanStore(data)?.observationDrafts.find(d=>d.id===id);if(!d)return data;if(action==='cancel')return putObservationDraft(data,{...d,status:'cancelled'});const history=[...d.history],cursor=history.pop();return cursor?putObservationDraft(data,{...d,cursor,history}):data;}
export function withdrawPlanObservation(data:Dataset,id:string,now=nowString()):Dataset{if(data.version!==2)return data;const s=accessPlanStore(data);if(!s?.observations.some(o=>o.id===id))return data;return rebuildAccessPlans(write(data,{...s,observations:s.observations.map(o=>o.id===id?{...o,withdrawnAt:now}:o)}),now);}
export function archiveAccessPlan(data:Dataset,id:string,archived:boolean):Dataset{if(data.version!==2)return data;const s=accessPlanStore(data);return s?write(data,{...s,plans:s.plans.map(p=>p.id===id?{...p,archived}:p)}):data;}
function putGroupDraft(data:CurrentDataset,d:FailureGroupDraft){const s=accessPlanStore(data)??empty();return write(data,{...s,groupDrafts:[...s.groupDrafts.filter(g=>g.id!==d.id),d]});}
export function startFailureGroup(data:Dataset,editRef?:string,now=nowString()):{data:CurrentDataset;id:string}{const next=writable(data),g=editRef?accessPlanStore(next)?.groups.find(g=>g.id===editRef):undefined;if(editRef&&!g)throw new Error('missing-group');const d=failureGroupDraftSchema.parse({id:crypto.randomUUID(),groupId:g?.id??crypto.randomUUID(),editRef:g?.id,baseline:g?JSON.stringify(g):undefined,label:g?.label,memberRefs:g?.memberRefs,evidence:g?.evidence,createdAt:now});return {data:putGroupDraft(next,d),id:d.id};}
export function answerFailureGroup(data:Dataset,id:string,value:string|string[]):Dataset{if(data.version!==2)return data;let d=accessPlanStore(data)?.groupDrafts.find(g=>g.id===id);if(!d||d.status!=='active')return data;const before=d.cursor;
  if(before==='label'){if(typeof value!=='string'||!safeMapNickname(value))return data;d={...d,label:value.trim(),cursor:'members'};}
  else if(before==='members'){if(!Array.isArray(value)||value.length<2||new Set(value).size!==value.length||value.some(ref=>!planItems(data).some(e=>e.id===ref)))throw new Error('invalid-group-members');d={...d,memberRefs:value,cursor:'evidence'};}
  else if(before==='evidence'){if(value!=='unknown'&&value!=='user-confirmed')return data;d={...d,evidence:value,cursor:'review'};}
  else return data;return putGroupDraft(data,{...d,history:[...d.history,before]});
}
export function navigateFailureGroup(data:Dataset,id:string,action:'back'|'cancel'):Dataset{if(data.version!==2)return data;const d=accessPlanStore(data)?.groupDrafts.find(d=>d.id===id);if(!d)return data;if(action==='cancel')return putGroupDraft(data,{...d,status:'cancelled'});const history=[...d.history],cursor=history.pop();return cursor?putGroupDraft(data,{...d,cursor,history}):data;}
export function commitFailureGroup(data:Dataset,id:string,now=nowString()):CurrentDataset{const next=writable(data),s=accessPlanStore(next)??empty(),d=s.groupDrafts.find(d=>d.id===id);if(!d||d.cursor!=='review'||d.status!=='active'||!d.label||!d.evidence||d.memberRefs.length<2)throw new Error('unfinished-group');const old=s.groups.find(g=>g.id===d.editRef);if(d.editRef&&(!old||JSON.stringify(old)!==d.baseline))throw new Error('stale-group');const group=failureGroupSchema.parse({...old,id:d.groupId,label:d.label,memberRefs:d.memberRefs,evidence:d.evidence,createdAt:old?.createdAt??now,updatedAt:now});return write(next,{...s,groups:[...s.groups.filter(g=>g.id!==group.id),group],groupDrafts:s.groupDrafts.map(g=>g.id===id?{...g,status:'completed'}:g)});}
export function savePlanScenario(data:Dataset,refs:string[],groupRefs:string[],context:AccessPlan['context']='normal'):CurrentDataset{const next=writable(data),s=accessPlanStore(next)??empty();if(refs.some(ref=>!planItems(next).some(e=>e.id===ref))||groupRefs.some(ref=>!s.groups.some(g=>g.id===ref)))throw new Error('invalid-scenario');return write(next,{...s,scenario:{...s.scenario,refs:[...new Set(refs)],groupRefs:[...new Set(groupRefs)],context}});}
export function planScenarioRefs(data:Dataset):string[]{const s=accessPlanStore(data);return [...new Set([...(s?.scenario?.refs??[]),...(s?.scenario?.groupRefs??[]).flatMap(ref=>s?.groups.find(g=>g.id===ref&&g.evidence==='user-confirmed')?.memberRefs??[])])];}
export function accessPlanResult(data:Dataset,p:AccessPlan,unavailableRefs:readonly string[]=[],now=nowString()){return data.version===2?evaluateAccess(data.securityModel,p.id,{context:p.context,unavailableRefs,now}):undefined;}
