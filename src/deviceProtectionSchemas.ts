import {z} from 'zod';
import type {Dataset} from './models';

const ref=z.string().min(1),time=z.string().datetime({offset:true});
export const PROTECTION_FEATURES=['device-location','significant-locations','device-biometrics','find-enabled','find-offline','find-last-location','stolen-device-protection','stolen-delay','theft-detection','offline-lock','failed-auth-lock','remote-lock','remote-question','identity-check'] as const;
export type ProtectionFeature=typeof PROTECTION_FEATURES[number];
export const PROTECTION_VALUES=['on','off','unknown','recent','busy','everywhere','familiar','always','unsupported'] as const;
export type ProtectionValue=typeof PROTECTION_VALUES[number];
export const protectionRecordSchema=z.object({
  titleEn:ref,titleJa:ref,at:time,accountRef:ref.optional(),withdrawnAt:time.optional(),kind:z.enum(['navigation','configuration','management-use','prerequisite']),
  refs:z.array(ref).default([]),requires:z.array(ref).default([]),
  feature:z.enum(PROTECTION_FEATURES).optional(),value:z.enum(PROTECTION_VALUES).optional(),
  featureVersions:z.record(ref,z.number().int().min(1)).default({}),
  actorSignatures:z.record(ref,z.string()).default({}),actorEpochs:z.record(ref,time.nullable()).default({}),
  context:z.enum(['normal','no-existing-session']).optional(),withoutRefs:z.array(ref).default([]),
}).passthrough();
export type ProtectionRecord=z.infer<typeof protectionRecordSchema>;
export const protectionTaskSchema=z.object({
  id:ref,deviceRef:ref,accountRef:ref.optional(),environmentRef:ref.optional(),environmentDeviceRef:ref.optional(),sessionRef:ref.optional(),lineRef:ref.optional(),managementUsedRefs:z.array(ref).default([]),
  cursor:ref.default('available'),answers:z.record(z.string(),z.string()).default({}),history:z.array(ref).default([]),
  status:z.enum(['active','deferred','completed','cancelled']).default('active'),
  returnTo:z.enum(['guide','map','phone']),phoneWorkflowRef:ref.optional(),originGuideCursor:z.string(),
  records:z.record(ref,protectionRecordSchema).default({}),recordHistory:z.array(z.object({stepRef:ref,record:protectionRecordSchema}).passthrough()).default([]),
  childGuide:z.unknown().optional(),childRecipe:z.enum(['email-mfa','recovery']).optional(),
  createdAt:time,updatedAt:time,
}).passthrough();
export type ProtectionTask=z.infer<typeof protectionTaskSchema>;
export const protectionSettingSchema=z.object({
  deviceRef:ref,feature:z.enum(PROTECTION_FEATURES),accountRef:ref.optional(),value:z.enum(PROTECTION_VALUES),
  generation:z.number().int().min(1),updatedAt:time,taskRef:ref,recordRef:ref,withdrawn:z.boolean().default(false),
}).passthrough();
export type ProtectionSetting=z.infer<typeof protectionSettingSchema>;
export const protectionStoreSchema=z.object({
  version:z.literal(1),tasks:z.array(protectionTaskSchema).default([]),
  settings:z.record(ref,protectionSettingSchema).default({}),
  history:z.array(protectionSettingSchema).default([]),
}).passthrough();
export type ProtectionStore=z.infer<typeof protectionStoreSchema>;
export const protectionSettingKey=(deviceRef:string,feature:ProtectionFeature)=>JSON.stringify([deviceRef,feature]);
export function protectionStore(data:Dataset):ProtectionStore|undefined{
  if(data.version!==2||data.securityModel.revision<9)return;
  const parsed=protectionStoreSchema.safeParse(data.securityModel.deviceProtectionV1);return parsed.success?parsed.data:undefined;
}
export const protectionTasks=(data:Dataset)=>protectionStore(data)?.tasks??[];
