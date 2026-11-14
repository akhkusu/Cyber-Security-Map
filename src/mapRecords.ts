import { currentDatasetSchema, DataUpgradeConflict, looksLikeSecret, makeAsset, upgradeDataset, type CurrentDataset, type Dataset } from './models';
import { entityIndex, lifecycleSchema, securityEntitySchema, securityRelationSchema, type SecurityEntity, type SecurityRelation } from './securityModel';
import { mapRecordDraftSchema, mapRecordStore, mapRecordStoreSchema, type MapRecordDraft } from './mapRecordSchemas';
import { recordFields, recordLinks, type RecordField } from './mapRecordCatalog';

const empty = () => mapRecordStoreSchema.parse({ version: 1 });
const now = () => new Date().toISOString();
export function safeMapNickname(value: string) {
  return !!value.trim() && value.trim().length <= 80 && !looksLikeSecret(value) && !/https?:\/\/|^\+?[\d\s()-]{6,}$|^[\w/+=-]{20,}$/i.test(value.trim());
}
export const mapNode = (data: Dataset, ref: string) => data.assets.find(a=>a.id===ref) ?? (data.version===2?data.securityModel.entities.find(e=>e.id===ref):undefined);
const stamp = (node: NonNullable<ReturnType<typeof mapNode>>) => JSON.stringify(node);
function writable(data: Dataset) {
  const next=upgradeDataset(data);
  if(next.securityModel.revision<6 && (Object.hasOwn(next.securityModel,'mapRecordsV1') || [...next.securityModel.entities,...next.securityModel.relations,...Object.values(next.securityModel.lifecycle)].some(e=>Object.keys(e).some(k=>k.startsWith('mapRecord'))))) throw new DataUpgradeConflict();
  if(next.securityModel.revision>=6 && Object.hasOwn(next.securityModel,'mapRecordsV1')&&!mapRecordStoreSchema.safeParse(next.securityModel.mapRecordsV1).success)throw new DataUpgradeConflict();
  return next;
}
function write(data: CurrentDataset, store: ReturnType<typeof empty>): CurrentDataset {
  return currentDatasetSchema.parse({...data,securityModel:{...data.securityModel,revision:6,mapRecordsV1:store}});
}
function put(data: CurrentDataset, draft: MapRecordDraft) {
  const store=mapRecordStore(data)??empty();return write(data,{...store,drafts:[...store.drafts.filter(d=>d.id!==draft.id),draft]});
}
export function mapStructureEditable(data: Dataset, ref: string) {
  if(data.version!==2||!mapRecordStore(data)?.manualRefs.includes(ref))return false;
  const node=mapNode(data,ref);if(!node)return false;
  if('controls' in node&&node.controls&&Object.values(node.controls).some(v=>v!=='unknown'))return false;
  if(Object.keys(node).some(k=>/^(native|cloud|authenticator|nord|proton)/.test(k)))return false;
  const used=(value:unknown):boolean=>typeof value==='string'?value===ref||value.split('/').includes(ref):Array.isArray(value)?value.some(used):!!value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>key===ref||used(v));
  return !used([data.guide,data.actions,data.deviceWorkflows,Object.fromEntries(Object.entries(data.securityModel).filter(([k])=>!['revision','entities','relations','facts','routes','lifecycle','controlBaselines','mapRecordsV1'].includes(k)))]);
}
export function mapRecordSnapshot(data:Dataset,ref:string):MapRecordDraft|undefined {
 const node=mapNode(data,ref);if(!node)return;
 const snapshot=mapRecordDraftSchema.parse({id:'preview',nodeId:ref,kind:node.kind,cursor:'review',createdAt:now(),values:{}});
 for(const key of ['storageMode','codeStorage','credentialType','subjectRef','deviceRef','productId'])if(typeof node[key]==='string')snapshot.values[key]=node[key] as string;
 for(const field of recordFields(data,snapshot)){const value=field.id==='label'?'name' in node?node.name:node.label:node[field.id];if(typeof value==='string'||Array.isArray(value)&&value.every(v=>typeof v==='string'))snapshot.values[field.id]=value;}
 for(const link of recordLinks(snapshot))if(data.version===2&&data.securityModel.relations.some(r=>r.fromRef===link.fromRef&&r.toRef===link.toRef&&r.kind===link.kind&&r.evidence==='user-confirmed'))snapshot.confirmations[link.key]='user-confirmed';
 return snapshot;
}
export function startMapRecord(data: Dataset, editRef?: string): { data: CurrentDataset; id: string } {
  const next=writable(data), store=mapRecordStore(next)??empty(), node=editRef?mapNode(next,editRef):undefined;
  if(editRef&&!node)throw new Error('missing-entry');
  const existing=editRef?store.drafts.find(d=>d.status==='active'&&d.editRef===editRef):undefined;if(existing)return{data:next,id:existing.id};
  const id=crypto.randomUUID(), kind=node?.kind as MapRecordDraft['kind'];
  const draft=mapRecordDraftSchema.parse({id,nodeId:node?.id??crypto.randomUUID(),editRef,baseline:node?stamp(node):undefined,kind,cursor:node?'label':'kind',createdAt:now()});
  if(node) {
    for(const key of ['storageMode','codeStorage','credentialType','subjectRef'])if(typeof node[key]==='string')draft.values[key]=node[key] as string;
    for(const field of recordFields(next,draft)) {
      const value=field.id==='label'?'name' in node?node.name:node.label:node[field.id];
      if(typeof value==='string'||Array.isArray(value)&&value.every(v=>typeof v==='string'))draft.values[field.id]=value;
    }
    // Fields conditional on another answer are populated after that answer.
    if(node.kind==='credential'&&node.replicaGroupId){const peer=next.securityModel.entities.find(e=>e.kind==='credential'&&e.id!==node.id&&e.replicaGroupId===node.replicaGroupId);if(peer)draft.values.replicaOf=peer.id;}
    if(node.kind==='installation'&&node.syncAccountRef)draft.values.syncAccountRef=node.syncAccountRef;
    if(!mapStructureEditable(next,node.id))draft.values={label:draft.values.label};
    for(const link of recordLinks(draft)) if(next.securityModel.relations.some(r=>r.mapRecordRelationV1==='v1'&&r.fromRef===link.fromRef&&r.toRef===link.toRef&&r.kind===link.kind&&r.evidence==='user-confirmed'))draft.confirmations[link.key]='user-confirmed';
  }
  return{data:put(next,draft),id};
}
export function activeMapFields(data: Dataset, draft: MapRecordDraft): RecordField[] {
  const fields=recordFields(data,draft);return draft.editRef&&!mapStructureEditable(data,draft.editRef)?fields.filter(f=>f.id==='label'):fields;
}
export function validMapAnswer(field: RecordField, value: unknown) {
  if(field.kind==='multi')return Array.isArray(value)&&value.every(v=>typeof v==='string'&&field.choices?.some(c=>c.value===v))&&(field.optional||value.length>0)&&new Set(value).size===value.length;
  if(typeof value!=='string')return false;
  if(!value)return !!field.optional;
  if(field.kind==='select')return !!field.choices?.some(c=>c.value===value);
  if(field.kind==='date')return Number.isFinite(Date.parse(value))&&/^\d{4}-\d\d-\d\dT/.test(value);
  if(field.id==='appVersion')return value.length<=40&&/^[\w .()+-]+$/.test(value)&&!looksLikeSecret(value);
  return safeMapNickname(value);
}
export function mapDraftSteps(data: Dataset, draft: MapRecordDraft): string[] {
  return [...(!draft.editRef?['kind','reuse']:[]),...activeMapFields(data,draft).map(f=>f.id),...recordLinks(draft).map(l=>'link:'+l.key),'review'];
}
export function answerMapRecord(data: Dataset,id:string,value:string|string[]) {
  const next=writable(data),draft=mapRecordStore(next)?.drafts.find(d=>d.id===id&&d.status==='active');if(!draft)throw new Error('missing-draft');
  let updated={...draft,values:{...draft.values},confirmations:{...draft.confirmations}};
  if(draft.cursor==='kind') {
    const parsed=mapRecordDraftSchema.shape.kind.safeParse(value);if(!parsed.success||!parsed.data)throw new Error('invalid-kind');
    updated={...updated,kind:parsed.data,values:{},confirmations:{}};
  } else if(draft.cursor==='reuse') {if(value!=='new')throw new Error('invalid-choice');}
  else if(draft.cursor.startsWith('link:')) {const key=draft.cursor.slice(5);if(!recordLinks(draft).some(l=>l.key===key)||!['unknown','user-confirmed'].includes(String(value)))throw new Error('invalid-link');updated.confirmations[key]=value as 'unknown'|'user-confirmed';}
  else {
    const field=activeMapFields(next,draft).find(f=>f.id===draft.cursor);if(!field||!validMapAnswer(field,value))throw new Error('invalid-answer');
    updated.values[field.id]=typeof value==='string'?value.trim():value;
  }
  const steps=mapDraftSteps(next,updated),index=steps.indexOf(draft.cursor);
  return put(next,{...updated,cursor:steps[index+1]??'review',history:[...draft.history,draft.cursor]});
}
export function backMapRecord(data: Dataset,id:string) {
  const next=writable(data), draft=mapRecordStore(next)?.drafts.find(d=>d.id===id&&d.status==='active');if(!draft)return data;
  const history=[...draft.history],steps=mapDraftSteps(next,draft);let cursor=history.pop();while(cursor&&!steps.includes(cursor))cursor=history.pop();return put(next,{...draft,cursor:cursor??steps[0],history});
}
export function cancelMapRecord(data: Dataset,id:string) {const next=writable(data),draft=mapRecordStore(next)?.drafts.find(d=>d.id===id);return draft?put(next,{...draft,status:'cancelled'}):data;}
export function commitMapRecord(data: Dataset,id:string): CurrentDataset {
  let next=writable(data);const store=mapRecordStore(next),draft=store?.drafts.find(d=>d.id===id&&d.status==='active');if(!draft||!draft.kind||draft.cursor!=='review')throw new Error('unfinished');
  const original=draft.editRef?mapNode(next,draft.editRef):undefined;
  if(draft.editRef&&(!original||stamp(original)!==draft.baseline))throw new Error('changed-since-start');
  const fields=activeMapFields(next,draft),values:Record<string,unknown>={};
  for(const field of fields) {const value=draft.values[field.id]??(field.kind==='multi'?[]:'');if(!validMapAnswer(field,value))throw new Error('unfinished:'+field.id);if(value!==''&&!(Array.isArray(value)&&!value.length))values[field.id]=value;}
  const links=recordLinks({...draft,values:values as MapRecordDraft['values']});if(links.some(l=>!draft.confirmations[l.key]))throw new Error('unchecked-links');
  const label=String(values.label),time=now();
  delete values.label; const replicaOf=values.replicaOf;delete values.replicaOf;
  const base={...original} as Record<string,unknown>;
  if(fields.length>1)for(const field of fields)if(field.id!=='label')delete base[field.id];
  if(fields.some(f=>f.id==='replicaOf')||(draft.kind==='credential'&&original?.credentialType!==values.credentialType))delete base.replicaGroupId;
  if(draft.kind==='installation'&&values.codeStorage!=='account')delete base.syncAccountRef;
  if(draft.kind==='vault'&&values.storageMode==='account')delete base.primaryDeviceRef;
  if(draft.kind==='vault'&&values.storageMode==='local')delete base.authenticationAccountRef;
  let node: ReturnType<typeof mapNode>;
  const legacy=['account','device','backup','network','identity'].includes(draft.kind);
  if(original&&fields.length===1) node='name' in original?{...original,name:label,updatedAt:time}:{...original,label};
  else if(legacy)node={...makeAsset({kind:draft.kind as 'account',type:draft.kind==='account'?'Account':draft.kind==='identity'?'Digital identity':String(values.type??draft.kind),name:label,importance:'important'}),...base,id:draft.nodeId,...values,name:label,updatedAt:time};
  else {
    if(values.storageMode==='account')delete values.primaryDeviceRef;
    if(values.codeStorage!=='account')delete values.syncAccountRef;
    node=securityEntitySchema.parse({...base,id:draft.nodeId,createdAt:original?.createdAt??time,kind:draft.kind,...values,label});
    if(draft.kind==='credential'&&typeof replicaOf==='string') {
      const other=next.securityModel.entities.find(e=>e.id===replicaOf&&e.kind==='credential');if(!other||other.kind!=='credential'||other.subjectRef!==values.subjectRef||other.credentialType!==values.credentialType)throw new Error('invalid-copy');
      const group=other.replicaGroupId??crypto.randomUUID();next={...next,securityModel:{...next.securityModel,entities:next.securityModel.entities.map(e=>e.id===other.id?{...e,replicaGroupId:group}:e)}};node={...node,replicaGroupId:group} as SecurityEntity;
    }
  }
  if(!node)throw new Error('invalid-node');
  const structural=!!original&&fields.some(f=>f.id!=='label'&&JSON.stringify(original[f.id])!==JSON.stringify(node?.[f.id]));
  let relations=next.securityModel.relations;
  if(fields.length>1||!draft.editRef) {
    relations=relations.map(r=>r.mapRecordRelationV1==='v1'&&r.mapRecordNodeRef===node.id?{...r,evidence:'unknown' as const}:r);
    for(const link of links){const old=relations.find(r=>r.mapRecordRelationV1==='v1'&&r.mapRecordNodeRef===node.id&&r.fromRef===link.fromRef&&r.toRef===link.toRef&&r.kind===link.kind);const record=securityRelationSchema.parse({...old,id:old?.id??crypto.randomUUID(),...link,evidence:draft.confirmations[link.key],checkedAt:time,sourceIds:old?.sourceIds??[],mapRecordRelationV1:'v1',mapRecordNodeRef:node.id});relations=[...relations.filter(r=>r.id!==record.id),record];}
  }
  next={...next,assets:legacy?[...next.assets.filter(e=>e.id!==node.id),node as CurrentDataset['assets'][number]]:next.assets,securityModel:{...next.securityModel,entities:legacy?next.securityModel.entities:[...next.securityModel.entities.filter(e=>e.id!==node.id),node as SecurityEntity],relations,lifecycle:structural?{...next.securityModel.lifecycle,[node.id]:{...next.securityModel.lifecycle[node.id],state:next.securityModel.lifecycle[node.id]?.state??'unknown',evidence:next.securityModel.lifecycle[node.id]?.evidence??'unknown',updatedAt:time,accessResetAt:time}}:next.securityModel.lifecycle}};
  return write(next,{...store!,manualRefs:[...new Set([...store!.manualRefs,...(!draft.editRef?[node.id]:[])])],drafts:store!.drafts.map(d=>d.id===id?{...d,status:'completed'}:d)});
}
export function setMapArchive(data: Dataset,ref:string,archived:boolean) {const next=writable(data),store=mapRecordStore(next)??empty();if(!mapNode(next,ref))throw new Error('missing-entry');return write(next,{...store,archivedRefs:archived?[...new Set([...store.archivedRefs,ref])]:store.archivedRefs.filter(r=>r!==ref)});}
export function setMapLifecycle(data: Dataset,ref:string,state:unknown) {
  let next=writable(data);const parsed=lifecycleSchema.shape.state.safeParse(state);if(!parsed.success||!mapNode(next,ref))throw new Error('invalid-state');
  const previous=next.securityModel.lifecycle[ref],time=new Date(Math.max(Date.now(),Date.parse(previous?.updatedAt??'1970-01-01T00:00:00Z')+1)).toISOString(),terminal=['unavailable','lost','transferred','retired','revoked','deleted'].includes(parsed.data);
  next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[ref]:{...previous,state:parsed.data,evidence:parsed.data==='unknown'?'unknown':'user-confirmed',updatedAt:time,mapRecordLifecycleV1:'v1',mapRecordChangedAt:time,...(terminal?{accessResetAt:time,mapRecordResetAt:time}:{})}}}};
  return write(next,mapRecordStore(next)??empty());
}
export function recordMapConnection(data:Dataset,input:{fromRef:string;toRef:string;kind:SecurityRelation['kind'];evidence:'unknown'|'user-confirmed'},id?:string) {
  const next=writable(data),refs=entityIndex(next.securityModel,next.assets);if(!refs.has(input.fromRef)||!refs.has(input.toRef)||input.fromRef===input.toRef)throw new Error('invalid-connection');
  const old=id?next.securityModel.relations.find(r=>r.id===id):next.securityModel.relations.find(r=>r.mapRecordRelationV1==='v1'&&r.fromRef===input.fromRef&&r.toRef===input.toRef&&r.kind===input.kind);
  if(id&&(!old||old.mapRecordRelationV1!=='v1'))throw new Error('protected-connection');
  const record=securityRelationSchema.parse({...old,...input,id:old?.id??crypto.randomUUID(),checkedAt:now(),sourceIds:old?.sourceIds??[],mapRecordRelationV1:'v1'});
  return write({...next,securityModel:{...next.securityModel,relations:[...next.securityModel.relations.filter(r=>r.id!==record.id),record]}},mapRecordStore(next)??empty());
}

export function startMapConnection(data:Dataset,fromRef?:string,editRef?:string) {
  const next=writable(data),store=mapRecordStore(next)??empty(),old=editRef?next.securityModel.relations.find(r=>r.id===editRef&&r.mapRecordRelationV1==='v1'):undefined;
  if(editRef&&!old)throw new Error('protected-connection');
  const id=crypto.randomUUID(),draft={id,editRef,baseline:old?JSON.stringify(old):undefined,cursor:0,fromRef:old?.fromRef??fromRef??'',toRef:old?.toRef??'',kind:old?.kind??'stored-in',evidence:old?.evidence==='user-confirmed'?'user-confirmed' as const:'unknown' as const,status:'active' as const};
  return {data:write(next,{...store,connectionDrafts:[...store.connectionDrafts,draft]}),id};
}
export function answerMapConnection(data:Dataset,id:string,value:string|number) {
  const next=writable(data),store=mapRecordStore(next),draft=store?.connectionDrafts.find(d=>d.id===id&&d.status==='active');if(!draft)throw new Error('missing-draft');
  if(typeof value==='number'){if(value!==-1)throw new Error('invalid-back');return write(next,{...store!,connectionDrafts:store!.connectionDrafts.map(d=>d.id===id?{...d,cursor:Math.max(0,d.cursor-1)}:d)});}
  const updated={...draft};
  if(draft.cursor<3&&value!==[draft.fromRef,draft.toRef,draft.kind][draft.cursor])updated.evidence='unknown';
  if(draft.cursor===0||draft.cursor===1){if(!mapNode(next,value))throw new Error('missing-entry');if(draft.cursor===0)updated.fromRef=value;else updated.toRef=value;if(updated.fromRef===updated.toRef){if(draft.cursor===0)updated.toRef='';else throw new Error('self-connection');}}
  if(draft.cursor===2){const kind=securityRelationSchema.shape.kind.safeParse(value);if(!kind.success)throw new Error('invalid-kind');updated.kind=kind.data;}
  if(draft.cursor===3){if(!['unknown','user-confirmed'].includes(value))throw new Error('invalid-evidence');updated.evidence=value as 'unknown'|'user-confirmed';}
  if(draft.cursor>=4)throw new Error('already-at-review');updated.cursor++;
  return write(next,{...store!,connectionDrafts:store!.connectionDrafts.map(d=>d.id===id?updated:d)});
}
export function commitMapConnection(data:Dataset,id:string) {
  const next=writable(data),store=mapRecordStore(next),draft=store?.connectionDrafts.find(d=>d.id===id&&d.status==='active');if(!draft||draft.cursor!==4)throw new Error('unfinished');
  if(draft.editRef&&JSON.stringify(next.securityModel.relations.find(r=>r.id===draft.editRef))!==draft.baseline)throw new Error('changed-since-start');
  const recorded=recordMapConnection(next,draft,draft.editRef);
  return write(recorded,{...mapRecordStore(recorded)!,connectionDrafts:store!.connectionDrafts.map(d=>d.id===id?{...d,status:'completed'}:d)});
}

export function cancelMapConnection(data:Dataset,id:string){const next=writable(data),store=mapRecordStore(next);return store?write(next,{...store,connectionDrafts:store.connectionDrafts.map(d=>d.id===id?{...d,status:'cancelled'}:d)}):data;}
