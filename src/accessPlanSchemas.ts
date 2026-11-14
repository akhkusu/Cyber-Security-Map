import { z } from 'zod';
import { ACCESS_CONTEXTS, type AccessContext } from './securityModel';
import type { Dataset } from './models';

const ref=z.string().min(1),time=z.string().datetime({offset:true});
export const PLAN_PURPOSES=['sign-in','second-step','decrypt','local-unlock','restore'] as const;
export const planNodeSchema=z.object({id:ref,kind:z.enum(['all','any','item','route','pending']),ref:ref.optional(),children:z.array(ref).max(100).default([])}).passthrough();
export type PlanNode=z.infer<typeof planNodeSchema>;
export const planDefinitionSchema=z.object({rootRef:ref,nodes:z.record(ref,planNodeSchema)}).passthrough();
export type PlanDefinition=z.infer<typeof planDefinitionSchema>;
const definitionFields={targetRef:ref,purpose:z.enum(PLAN_PURPOSES),context:z.enum(ACCESS_CONTEXTS),definition:planDefinitionSchema,conditionEvidence:z.enum(['unknown','user-confirmed'])};
export const accessPlanSchema=z.object({id:ref,label:ref.max(80),...definitionFields,definitionVersion:z.number().int().min(1),history:z.array(z.object({...definitionFields,definitionVersion:z.number().int().min(1),at:time}).passthrough()).default([]),archived:z.boolean().default(false),createdAt:time,updatedAt:time}).passthrough();
export type AccessPlan=z.infer<typeof accessPlanSchema>;
export const planDraftSchema=z.object({id:ref,planId:ref,editRef:ref.optional(),baseline:z.string().optional(),targetRef:ref.optional(),purpose:z.enum(PLAN_PURPOSES).optional(),context:z.enum(ACCESS_CONTEXTS).optional(),label:z.string().max(80).optional(),definition:planDefinitionSchema.optional(),conditionEvidence:z.enum(['unknown','user-confirmed']).optional(),cursor:ref.default('target'),history:z.array(ref).default([]),status:z.enum(['active','completed','cancelled']).default('active'),createdAt:time}).passthrough();
export type PlanDraft=z.infer<typeof planDraftSchema>;
export const observationDraftSchema=z.object({id:ref,planRef:ref,definitionVersion:z.number().int().min(1),cursor:ref.default('scope'),history:z.array(ref).default([]),branches:z.record(ref,ref).default({}),usedRefs:z.array(ref).default([]),withoutRefs:z.array(ref).default([]),timeMode:z.enum(['now','earlier']).optional(),checkedAt:time.optional(),scopeConfirmed:z.boolean().optional(),usedConfirmed:z.boolean().optional(),withoutConfirmed:z.boolean().optional(),status:z.enum(['active','completed','cancelled']).default('active'),createdAt:time}).passthrough();
export type ObservationDraft=z.infer<typeof observationDraftSchema>;
export const planObservationSchema=z.object({id:ref,planRef:ref,definitionVersion:z.number().int().min(1),branches:z.record(ref,ref),usedNodeRefs:z.array(ref).min(1),usedItemRefs:z.array(ref),usedRefs:z.array(ref),conditionRefs:z.record(ref,z.array(ref)),routeSnapshots:z.record(ref,z.string()),withoutRefs:z.array(ref),checkedAt:time,recordedAt:time,withdrawnAt:time.optional()}).passthrough();
export type PlanObservation=z.infer<typeof planObservationSchema>;
export const failureGroupSchema=z.object({id:ref,label:ref.max(80),memberRefs:z.array(ref).min(2),evidence:z.enum(['unknown','user-confirmed']),createdAt:time,updatedAt:time,archived:z.boolean().default(false)}).passthrough();
export type FailureGroup=z.infer<typeof failureGroupSchema>;
export const failureGroupDraftSchema=z.object({id:ref,groupId:ref,editRef:ref.optional(),baseline:z.string().optional(),label:z.string().max(80).optional(),memberRefs:z.array(ref).default([]),evidence:z.enum(['unknown','user-confirmed']).optional(),cursor:ref.default('label'),history:z.array(ref).default([]),status:z.enum(['active','completed','cancelled']).default('active'),createdAt:time}).passthrough();
export type FailureGroupDraft=z.infer<typeof failureGroupDraftSchema>;
export const accessPlanStoreSchema=z.object({version:z.literal(1),plans:z.array(accessPlanSchema).default([]),drafts:z.array(planDraftSchema).default([]),observationDrafts:z.array(observationDraftSchema).default([]),observations:z.array(planObservationSchema).default([]),groups:z.array(failureGroupSchema).default([]),groupDrafts:z.array(failureGroupDraftSchema).default([]),scenario:z.object({refs:z.array(ref),groupRefs:z.array(ref),context:z.enum(ACCESS_CONTEXTS).default('normal')}).passthrough().optional()}).passthrough();
export type AccessPlanStore=z.infer<typeof accessPlanStoreSchema>;
export function accessPlanStore(data:Dataset):AccessPlanStore|undefined{if(data.version!==2||data.securityModel.revision<8)return;const p=accessPlanStoreSchema.safeParse(data.securityModel.accessPlansV1);return p.success?p.data:undefined;}
export const planContextLabel=(context:AccessContext,language:'ja'|'en')=>({normal:['Everyday use','普段の利用'],enrollment:['At registration','登録時の受け付け'],'new-device':['On a new device','初めて使う端末'],'after-restart':['After restarting the device','端末を再起動した後'],'no-existing-session':['Without a previous signed-in session','以前のログイン済み状態を使わない'],'all-devices-lost':['Without any previously trusted device','以前の信頼済み端末を一切使わない']})[context][language==='ja'?1:0];
export const planPurposeLabel=(purpose:AccessPlan['purpose'],language:'ja'|'en')=>({'sign-in':['Sign in','ログイン'],'second-step':['Complete additional authentication','追加の認証'],'decrypt':['Read encrypted contents','暗号化された内容を読む'],'local-unlock':['Unlock on this device','端末内の解除'],'restore':['Recover or restore','復旧・復元']})[purpose][language==='ja'?1:0];

export function definitionNodes(definition:PlanDefinition):PlanNode[]{
  const out:PlanNode[]=[],seen=new Set<string>(),queue=[{id:definition.rootRef,depth:0}];
  while(queue.length){const p=queue.shift()!;if(seen.has(p.id)||p.depth>60||out.length>=4096)throw new Error('invalid-plan-tree');const n=definition.nodes[p.id];if(!n||n.id!==p.id)throw new Error('invalid-plan-tree');seen.add(p.id);out.push(n);for(const child of n.children)queue.push({id:child,depth:p.depth+1});}
  if(seen.size!==Object.keys(definition.nodes).length)throw new Error('orphan-plan-condition');return out;
}
export function validPlanDefinition(definition:PlanDefinition):boolean{
  try{return definitionNodes(definition).every(n=>n.kind==='all'||n.kind==='any'?n.children.length>0&&new Set(n.children).size===n.children.length:!!n.ref&&n.kind!=='pending'&&!n.children.length);}catch{return false;}
}
export function chosenPlanNodes(definition:PlanDefinition,branches:Record<string,string>):PlanNode[]{
  const out:PlanNode[]=[],seen=new Set<string>(),queue=[definition.rootRef];
  while(queue.length){const id=queue.shift()!;if(seen.has(id)||seen.size>4096)throw new Error('invalid-plan-tree');seen.add(id);const node=definition.nodes[id];if(!node)throw new Error('invalid-plan-tree');out.push(node);if(node.kind==='all')queue.push(...node.children);if(node.kind==='any'){const selected=branches[id];if(selected){if(!node.children.includes(selected))throw new Error('invalid-plan-branch');queue.push(selected);}}}
  return out;
}
