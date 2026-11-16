import { accessPlanStoreSchema, chosenPlanNodes, definitionNodes, validPlanDefinition, type PlanDefinition } from './accessPlanSchemas';
import type { SecurityModel } from './securityModel';

export function accessPlanIssues(data:{assets:readonly {id:string;kind:string}[];securityModel:SecurityModel}):string[]{
  const m=data.securityModel;if(m.revision<8)return [];if(!Object.hasOwn(m,'accessPlansV1'))return m.facts.some(f=>f.accessPlanObservationV1==='v1')?['missing-access-plan-store']:[];
  const parsed=accessPlanStoreSchema.safeParse(m.accessPlansV1);if(!parsed.success)return ['invalid-access-plan-store'];
  const s=parsed.data,issues:string[]=[],refs=new Set([...data.assets,...m.entities].map(e=>e.id)),routeRefs=new Set([...m.routes.map(r=>r.id),...s.plans.map(p=>p.id)]),ids=new Set<string>();
  for(const r of [...s.plans,...s.drafts,...s.observations,...s.observationDrafts,...s.groups,...s.groupDrafts]){if(ids.has(r.id))issues.push('duplicate-plan-record');ids.add(r.id);}
  const exists=(values:(string|undefined)[])=>values.every(ref=>ref===undefined||refs.has(ref));
  const definition=(d:PlanDefinition,partial=false)=>{try{return (partial||validPlanDefinition(d))&&definitionNodes(d).every(n=>n.kind==='item'?!n.ref?partial:refs.has(n.ref):n.kind==='route'?!n.ref?partial:routeRefs.has(n.ref):true);}catch{return false;}};
  for(const p of s.plans){
    if(!refs.has(p.targetRef)||!definition(p.definition)||p.history.some(h=>!refs.has(h.targetRef)||!definition(h.definition)||h.definitionVersion>=p.definitionVersion)||new Set(p.history.map(h=>h.definitionVersion)).size!==p.history.length)issues.push('invalid-plan-definition');
  }
  for(const d of s.drafts)if(!exists([d.targetRef])||(d.editRef&&!s.plans.some(p=>p.id===d.editRef))||(d.definition&&!definition(d.definition,true)))issues.push('invalid-plan-draft');
  for(const o of s.observations){
    const p=s.plans.find(p=>p.id===o.planRef),v=p?.definitionVersion===o.definitionVersion?p:p?.history.find(h=>h.definitionVersion===o.definitionVersion);
    if(!v||!exists([...o.usedRefs,...o.usedItemRefs,...o.withoutRefs,...Object.values(o.conditionRefs).flat()])||o.usedRefs.some(r=>o.withoutRefs.includes(r))||!o.usedRefs.includes(v.targetRef)||o.usedItemRefs.some(r=>!o.usedRefs.includes(r))){issues.push('invalid-plan-observation');continue;}
    try{const chosen=chosenPlanNodes(v.definition,o.branches),leaves=chosen.filter(n=>n.kind==='item'||n.kind==='route');
      if(chosen.some(n=>n.kind==='any'&&!o.branches[n.id])||leaves.length!==o.usedNodeRefs.length||leaves.some(n=>!o.usedNodeRefs.includes(n.id)||n.kind==='item'&&(!o.usedItemRefs.includes(n.ref!)||!o.conditionRefs[n.id]?.includes(n.ref!))||n.kind==='route'&&typeof o.routeSnapshots[n.id]!=='string'))issues.push('invalid-plan-observation-branch');
    }catch{issues.push('invalid-plan-observation-branch');}
  }
  for(const d of s.observationDrafts){const p=s.plans.find(p=>p.id===d.planRef);if(!p||!exists([...d.usedRefs,...d.withoutRefs])||d.definitionVersion>p.definitionVersion)issues.push('invalid-observation-draft');}
  for(const g of [...s.groups,...s.groupDrafts])if(!exists(g.memberRefs)||new Set(g.memberRefs).size!==g.memberRefs.length)issues.push('invalid-failure-group');
  if(s.scenario&&(!exists(s.scenario.refs)||s.scenario.groupRefs.some(id=>!s.groups.some(g=>g.id===id))))issues.push('invalid-plan-scenario');
  // Only this versioned store can establish the scope of a manually recorded
  // without-resource observation; old opaque fields never acquire that power.
  for(const f of m.facts.filter(f=>f.accessPlanObservationV1==='v1')){
    const o=s.observations.find(o=>o.id===f.accessPlanObservationRef),p=o&&s.plans.find(p=>p.id===o.planRef),v=p?.definitionVersion===o?.definitionVersion?p:p?.history.find(h=>h.definitionVersion===o?.definitionVersion);
    if(!o||!v||f.accessPlanRef!==o.planRef||f.accessPlanDefinitionVersion!==o.definitionVersion||f.checkedAt!==o.checkedAt||JSON.stringify(f.observedWithoutRefs)!==JSON.stringify(o.withoutRefs)||f.contexts.length!==1||f.contexts[0]!==v.context||f.requiredRefs.some(ref=>!o.usedRefs.includes(ref)))issues.push('invalid-plan-observation-evidence');
  }
  return [...new Set(issues)];
}
