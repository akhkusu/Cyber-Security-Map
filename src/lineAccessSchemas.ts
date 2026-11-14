import { z } from 'zod';
import type { Dataset, CurrentDataset } from './models';
import type { LineTask } from './lineSchemas';
import type { LineStore, LineReceipt } from './lineSchemas';
import type { SecurityModel } from './securityModel';

const ref=z.string().min(1), time=z.string().datetime({offset:true});
export const lineAccessProfileSchema=z.object({id:ref,lineTaskRef:ref,storeRef:ref.optional(),rootRef:ref.optional(),keyRef:ref.optional(),sourceStoreAppRef:ref.optional(),newStoreAppRef:ref.optional(),operationRef:ref.optional(),createdAt:time}).passthrough();
export type LineAccessProfile=z.infer<typeof lineAccessProfileSchema>;
export const lineAccessOperationSchema=z.object({id:ref,profileRef:ref,lineTaskRef:ref,accountRef:ref,deviceRef:ref,storeRef:ref,rootRef:ref,candidateRef:ref,phase:z.enum(['requested','registered','cancelled']),requestedAt:time,registeredAt:time.optional(),cancelledAt:time.optional()}).passthrough();
export const lineAccessStoreSchema=z.object({version:z.literal(1),profiles:z.array(lineAccessProfileSchema).default([]),operations:z.array(lineAccessOperationSchema).default([])}).passthrough();
export type LineAccessStore=z.infer<typeof lineAccessStoreSchema>;
export function lineAccessStore(data:Dataset|Pick<CurrentDataset,'securityModel'>):LineAccessStore|undefined{
  if('version' in data&&data.version!==2||!('securityModel' in data)||data.securityModel.revision<14)return;
  const parsed=lineAccessStoreSchema.safeParse(data.securityModel.lineAccessV1);return parsed.success?parsed.data:undefined;
}
export const lineAccessProfile=(data:Dataset,taskId:string)=>lineAccessStore(data)?.profiles.find(p=>p.lineTaskRef===taskId);
export const lineKeyOperation=(data:Dataset,taskId:string)=>{const s=lineAccessStore(data),p=s?.profiles.find(p=>p.lineTaskRef===taskId);return s?.operations.find(o=>o.id===p?.operationRef);};
export const lineUsesPasskey=(data:Dataset,t:LineTask)=>!!lineAccessProfile(data,t.id)&&t.answers['access2:method']==='passkey';
export const lineAccessRefs=(data:Dataset,t:LineTask)=>{
  const p=lineAccessProfile(data,t.id);return p&&lineUsesPasskey(data,t)?[p.storeRef,p.rootRef,p.keyRef,p.newStoreAppRef].filter((v):v is string=>!!v):[];
};
export function lineAccessReceiptFresh(model:SecurityModel,base:LineStore,r:LineReceipt):boolean{
  const s=lineAccessStore({securityModel:model}),p=s?.profiles.find(p=>p.lineTaskRef===r.taskRef),t=base.tasks.find(t=>t.id===r.taskRef);
  if(!p||!t)return true;
  let refs:(string|undefined)[]=[];
  if(r.stepId==='access2:mail-check')refs=[t.recoveryMailRef];
  else if(r.stepId==='access2:root-check'||r.stepId==='access2:root-sync')refs=[p.storeRef,p.rootRef];
  else if(r.stepId==='access2:new-root-check'||r.stepId==='access2:new-root-sync')refs=[p.storeRef,p.rootRef,t.newDeviceRef];
  else if(r.stepId==='access2:key-check')refs=[p.storeRef,p.rootRef,p.keyRef];
  else if(r.stepId==='access2:key-new-check')refs=[p.storeRef,p.rootRef,p.keyRef,p.newStoreAppRef,t.newDeviceRef];
  else if(r.stepId==='access2:key-independent')refs=[p.storeRef,p.rootRef,p.keyRef];
  else if(r.stepId==='future-access')refs=[t.recoveryMailRef,...(t.answers['access2:method']==='passkey'?[p.storeRef,p.rootRef,p.keyRef,p.newStoreAppRef]:[])];
  return refs.filter((id):id is string=>!!id).every(id=>{
    const life=model.lifecycle[id];return !['lost','unavailable','revoked','deleted','retired','transferred'].includes(life?.state??'')&&(!life?.accessResetAt||Date.parse(r.at)>Date.parse(life.accessResetAt));
  });
}
