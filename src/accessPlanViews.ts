import type {Dataset,Language} from './models';
import {accessPlanStore,definitionNodes,planContextLabel,type AccessPlan} from './accessPlanSchemas';
import {accessPlanResult,physicalPlanRefs} from './accessPlans';
import type {MapConnection,MapItem} from './securityMapViews';
import type {AccessCondition} from './securityModel';

export function planMapItems(data:Dataset,language:Language):MapItem[]{return (accessPlanStore(data)?.plans??[]).map(p=>({id:p.id,routeRef:p.id,kind:'backup',type:language==='ja'?'ログイン・復旧の方法':'Sign-in or recovery method',name:p.label,importance:'important',createdAt:p.createdAt,updatedAt:p.updatedAt,controls:{},controlEvidence:{},services:[]}));}
export function planMapConnections(data:Dataset):MapConnection[]{return (accessPlanStore(data)?.plans??[]).filter(p=>p.conditionEvidence==='user-confirmed').map(p=>({id:`access-plan-view:${p.id}`,assetId:p.targetRef,recoveryAssetId:p.id,relation:'access-plan',typed:true,createdAt:p.updatedAt}));}
export function planMapStatus(data:Dataset,p:AccessPlan,language:Language){const result=accessPlanResult(data,p);return {tone:result?.state==='available'?'recorded':result?.state==='unavailable'?'needs-work':'unknown',label:language==='ja'?result?.state==='available'?'利用の記録あり':result?.state==='unavailable'?'必要条件が不足':'利用は未確認':result?.state==='available'?'Use recorded':result?.state==='unavailable'?'Required condition missing':'Use unconfirmed',reason:planContextLabel(p.context,language)};}
export function planReferences(data:Dataset,p:AccessPlan):string[]{
  const out=new Set<string>(),seen=new Set<string>(),queue=definitionNodes(p.definition).filter(n=>n.kind==='route').map(n=>n.ref!);
  definitionNodes(p.definition).filter(n=>n.kind==='item').forEach(n=>physicalPlanRefs(data,[n.ref!]).forEach(r=>out.add(r)));
  if(data.version!==2)return [...out];let visits=0;
  const visit=(condition:AccessCondition)=>{if(++visits>4096)return;if(condition.kind==='route')queue.push(condition.routeId);else if(condition.kind==='fact')data.securityModel.facts.find(f=>f.id===condition.factId)?.requiredRefs.forEach(ref=>out.add(ref));else condition.conditions.forEach(visit);};
  while(queue.length&&seen.size<4096){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);const r=data.securityModel.routes.find(r=>r.id===id);if(r)visit(r.requirements);}
  return [...out];
}
