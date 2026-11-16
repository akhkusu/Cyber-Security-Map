import type { AccessFact, AccessCondition, SecurityModel } from './securityModel';
import type { AccessPlan, AccessPlanStore, PlanDefinition, PlanNode, PlanObservation } from './accessPlanSchemas';

const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function storeOf(model:SecurityModel):AccessPlanStore|undefined{const value=model.accessPlansV1 as AccessPlanStore|undefined;return model.revision>=8&&value?.version===1&&Array.isArray(value.plans)&&Array.isArray(value.observations)?value:undefined;}
export function planDisplayRef(model:SecurityModel|undefined,ref:string):string{const seen=new Set<string>();while(!seen.has(ref)&&seen.size<4096){seen.add(ref);const e=model?.entities.find(e=>e.id===ref);if(e&&(e.kind==='installation'||e.kind==='vault')&&typeof e.mergedIntoRef==='string'){ref=e.mergedIntoRef;continue;}break;}return ref;}
export function planExcludedConflict(model:SecurityModel|undefined,usedRefs:readonly string[],withoutRefs:readonly string[]):boolean{
  const canonicalUsed=new Set(usedRefs.map(ref=>planDisplayRef(model,ref))),usedGroups=new Set(usedRefs.flatMap(ref=>{const e=model?.entities.find(e=>e.id===ref);return e?.kind==='credential'&&e.replicaGroupId?[e.replicaGroupId]:[];}));
  return withoutRefs.some(ref=>{if(canonicalUsed.has(planDisplayRef(model,ref)))return true;const e=model?.entities.find(e=>e.id===ref);return e?.kind==='credential'&&!!e.replicaGroupId&&usedGroups.has(e.replicaGroupId);});
}
export function planPhysicalRefs(model:SecurityModel|undefined,refs:readonly string[]):string[]{
  const found=new Set<string>(),pending=[...refs];
  while(pending.length&&found.size<4096){const ref=pending.pop()!;if(found.has(ref))continue;found.add(ref);const e=model?.entities.find(e=>e.id===ref);
    if(e?.kind==='installation')pending.push(e.deviceRef);if(e?.kind==='credential'&&e.storageRef)pending.push(e.storageRef);if(e?.kind==='session'){if(e.deviceRef)pending.push(e.deviceRef);if(e.installationRef)pending.push(e.installationRef);}
  }return [...found].sort();
}
function nodesOf(d:PlanDefinition):PlanNode[]{const out:PlanNode[]=[],seen=new Set<string>(),pending=[d.rootRef];while(pending.length){const id=pending.shift()!;if(seen.has(id)||seen.size>4096)throw new Error('invalid');seen.add(id);const n=d.nodes[id];if(!n)throw new Error('invalid');out.push(n);pending.push(...n.children);}return out;}
export function planSemanticSignature(model:SecurityModel,routeRef:string):string{
  const seen=new Set<string>(),queue=[routeRef],records:unknown[]=[];let visits=0;
  try{while(queue.length){const ref=queue.shift()!;if(seen.has(ref))continue;if(++visits>4096)return JSON.stringify(['limit',routeRef]);seen.add(ref);const p=storeOf(model)?.plans.find(p=>p.id===ref);
    if(p){records.push([p.id,p.definitionVersion,p.targetRef,p.purpose,p.context,p.conditionEvidence,nodesOf(p.definition).map(n=>{if(n.kind==='route')queue.push(n.ref!);return [n.id,n.kind,n.ref,n.children,n.kind==='item'?planPhysicalRefs(model,[n.ref!]):null];})]);continue;}
    const r=model.routes.find(r=>r.id===ref);if(!r){records.push(['missing',ref]);continue;}
    const visit=(c:AccessCondition):unknown=>c.kind==='route'?(queue.push(c.routeId),['route',c.routeId]):c.kind==='fact'?(()=>{const f=model.facts.find(f=>f.id===c.factId);return f?['fact',f.id,f.requiredRefs,planPhysicalRefs(model,f.requiredRefs),f.contexts,f.availableAt,f.expiresAt]:['missing',c.factId];})():[c.kind,c.conditions.map(visit)];
    records.push([ref,r.targetRef,r.purpose,r.contexts,visit(r.requirements)]);
  }}catch{return JSON.stringify(['invalid',routeRef]);}return JSON.stringify(records);
}
export function observationScopeCurrent(model:SecurityModel,p:AccessPlan,o:PlanObservation):boolean{
  if(o.withdrawnAt||o.definitionVersion!==p.definitionVersion||!Array.isArray(o.usedRefs)||!Array.isArray(o.usedItemRefs)||!Array.isArray(o.usedNodeRefs)||!o.conditionRefs||!o.routeSnapshots)return false;
  if(!equal(o.usedRefs,planPhysicalRefs(model,[p.targetRef,...o.usedItemRefs])))return false;
  if(planExcludedConflict(model,o.usedRefs,o.withoutRefs))return false;
  return o.usedNodeRefs.every(id=>{const n=p.definition.nodes[id];return n?.kind==='item'?equal(o.conditionRefs[id],planPhysicalRefs(model,[n.ref!])):n?.kind==='route'?o.routeSnapshots[id]===planSemanticSignature(model,n.ref!):false;});
}
export function planFactCurrent(model:SecurityModel,f:AccessFact):boolean{
  if(model.revision<8||f.accessPlanVersion!=='v1')return true;
  const s=storeOf(model),p=s?.plans.find(p=>p.id===f.accessPlanRef);if(!p||p.definitionVersion!==f.accessPlanDefinitionVersion)return false;
  if(f.accessPlanObservationV1!=='v1')return true;
  const o=s?.observations.find(o=>o.id===f.accessPlanObservationRef);
  return !!o&&o.planRef===p.id&&o.checkedAt===f.checkedAt&&equal(o.withoutRefs,f.observedWithoutRefs)&&observationScopeCurrent(model,p,o);
}
export function planRequirementRefs(model:SecurityModel,f:AccessFact):string[]{
  if(model.revision>=8&&f.accessPlanVersion==='v1'&&f.accessPlanObservationV1!=='v1'&&typeof f.accessPlanConditionRef==='string'){
    const p=storeOf(model)?.plans.find(p=>p.id===f.accessPlanRef),n=p?.definition.nodes[f.accessPlanConditionRef];if(n?.kind==='item'&&n.ref)return planPhysicalRefs(model,[n.ref]);
  }return f.requiredRefs;
}
