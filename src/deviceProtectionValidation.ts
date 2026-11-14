import type {CurrentDataset} from './models';
import {protectionStoreSchema,protectionSettingKey} from './deviceProtectionSchemas';
import {keyStoreSchema} from './hardwareKeySchemas';
import {protectionRelationMatches} from './deviceProtectionEvidence';

export function protectionIssues(data:Pick<CurrentDataset,'assets'|'securityModel'|'deviceWorkflows'>,validGuide:(v:unknown)=>boolean=()=>true):string[]{
  const model=data.securityModel;if(model.revision<9)return [];
  const marked=[...model.facts,...model.routes,...model.relations].some(e=>e.deviceProtectionObservationV1==='v1'||e.deviceProtectionConfigurationV1==='v1'||e.deviceProtectionRouteV1==='v1'||e.deviceProtectionRelationV1==='v1');
  if(!Object.hasOwn(model,'deviceProtectionV1'))return marked?['missing-protection-store']:[];
  const parsed=protectionStoreSchema.safeParse(model.deviceProtectionV1);if(!parsed.success)return ['invalid-protection-store'];
  const store=parsed.data,issues:string[]=[],refs=new Set([...data.assets,...model.entities].map(e=>e.id)),ids=new Set<string>();
  const unique=(values:readonly string[])=>new Set(values).size===values.length;
  const keyStore=keyStoreSchema.safeParse(model.hardwareKeysV1);
  if(keyStore.success)for(const key of keyStore.data.tasks){
    if(!Object.hasOwn(key,'deviceProtectionKeyReturnV1'))continue;
    const v=key.deviceProtectionKeyReturnV1;
    if(!v||typeof v!=='object'||!('version' in v)||v.version!==1||!('taskRef' in v)||typeof v.taskRef!=='string'||key.returnTo!=='/map'||!store.tasks.some(t=>t.id===v.taskRef&&t.accountRef===key.accountRef&&t.childGuide))issues.push('invalid-protection-key-return');
  }
  const known=(values:readonly string[])=>values.every(ref=>refs.has(ref));
  for(const task of store.tasks){
    if(ids.has(task.id)||!data.assets.some(a=>a.id===task.deviceRef&&a.kind==='device'))issues.push('invalid-protection-task');ids.add(task.id);
    if(task.accountRef&&!data.assets.some(a=>a.id===task.accountRef&&a.kind==='account'&&['apple','google'].includes(a.provider??'')))issues.push('invalid-protection-account');
    // Actual installations and lines can move after a check. Retain that history;
    // the evidence guard invalidates the previous physical snapshot.
    if(task.environmentRef&&!model.entities.some(e=>e.id===task.environmentRef&&e.kind==='installation'))issues.push('invalid-protection-environment');
    if(task.sessionRef&&!model.entities.some(e=>e.id===task.sessionRef&&e.kind==='session'))issues.push('invalid-protection-session');
    if(task.environmentDeviceRef&&!data.assets.some(a=>a.id===task.environmentDeviceRef&&a.kind==='device'))issues.push('invalid-protection-environment-device');
    if(!unique(task.managementUsedRefs)||!known(task.managementUsedRefs))issues.push('invalid-protection-used-resources');
    if(task.lineRef&&!model.entities.some(e=>e.id===task.lineRef&&e.kind==='phone-line'))issues.push('invalid-protection-line');
    if(task.returnTo==='phone'&&(!task.phoneWorkflowRef||!data.deviceWorkflows.some(w=>w.id===task.phoneWorkflowRef&&(w.oldDeviceRef===task.deviceRef||w.newDeviceRef===task.deviceRef))))issues.push('invalid-protection-return');
    if((task.childGuide!==undefined)!==(task.childRecipe!==undefined)||(task.childGuide!==undefined&&!validGuide(task.childGuide)))issues.push('invalid-protection-child-guide');
    for(const record of [...Object.values(task.records),...task.recordHistory.map(h=>h.record)]){
      if(record.accountRef&&!data.assets.some(a=>a.id===record.accountRef&&a.kind==='account'))issues.push('invalid-protection-record-account');
      if(!unique(record.refs)||!unique(record.requires)||!unique(record.withoutRefs)||!known([...record.refs,...record.withoutRefs,...Object.keys(record.actorSignatures),...Object.keys(record.actorEpochs)])||record.requires.some(id=>!task.records[id]))issues.push('invalid-protection-record-reference');
      if((record.kind==='configuration'&&(!record.feature||!record.value))||(record.kind!=='configuration'&&(record.feature||record.value)))issues.push('invalid-protection-record-kind');
      for(const [key,generation] of Object.entries(record.featureVersions))if(!store.settings[key]||generation>store.settings[key].generation)issues.push('invalid-protection-generation');
      if(record.kind==='configuration'&&record.feature&&!Object.hasOwn(record.featureVersions,protectionSettingKey(task.deviceRef,record.feature)))issues.push('missing-protection-generation');
    }
  }
  for(const [key,setting] of Object.entries(store.settings)){
    const task=store.tasks.find(t=>t.id===setting.taskRef),record=task?.records[setting.recordRef];
    if(key!==protectionSettingKey(setting.deviceRef,setting.feature)||!data.assets.some(a=>a.id===setting.deviceRef&&a.kind==='device')||!task||task.deviceRef!==setting.deviceRef||(setting.accountRef&&!data.assets.some(a=>a.id===setting.accountRef&&a.kind==='account')))issues.push('invalid-protection-setting');
    if(!setting.withdrawn&&(!record||record.kind!=='configuration'||record.feature!==setting.feature||record.value!==setting.value||record.featureVersions[key]!==setting.generation||record.withdrawnAt||record.accountRef!==setting.accountRef))issues.push('invalid-protection-setting-source');
  }
  for(const setting of store.history)if(!data.assets.some(a=>a.id===setting.deviceRef&&a.kind==='device')||!store.tasks.some(t=>t.id===setting.taskRef)||(setting.accountRef&&!refs.has(setting.accountRef)))issues.push('invalid-protection-history');
  for(const fact of model.facts.filter(f=>f.deviceProtectionObservationV1==='v1'||f.deviceProtectionConfigurationV1==='v1')){
    const task=store.tasks.find(t=>t.id===fact.deviceProtectionTaskRef);if(!task||typeof fact.deviceProtectionRecordRef!=='string'||!task.records[fact.deviceProtectionRecordRef])issues.push('invalid-protection-fact-source');
  }
  for(const route of model.routes.filter(r=>r.deviceProtectionRouteV1==='v1'))if(!store.tasks.some(t=>t.id===route.deviceProtectionTaskRef&&t.deviceRef===route.targetRef)||route.purpose!=='device-management')issues.push('invalid-protection-route');
  for(const relation of model.relations.filter(r=>r.deviceProtectionRelationV1==='v1'))if(!store.tasks.some(t=>t.id===relation.deviceProtectionTaskRef&&protectionRelationMatches(t,relation)))issues.push('invalid-protection-relation');
  return [...new Set(issues)];
}
