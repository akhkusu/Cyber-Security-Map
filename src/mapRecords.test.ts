import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentDatasetSchema, DataUpgradeConflict, makeAsset, newDataset, type CurrentDataset, type Dataset } from './models';
import { MAP_RECORD_KINDS, mapRecordStore, type MapRecordDraft } from './mapRecordSchemas';
import { activeMapFields, answerMapConnection, answerMapRecord, backMapRecord, commitMapConnection, commitMapRecord, mapNode, mapRecordSnapshot, mapStructureEditable, recordMapConnection, safeMapNickname, setMapArchive, setMapLifecycle, startMapConnection, startMapRecord } from './mapRecords';
import { recordFields } from './mapRecordCatalog';
import { securityEntitySchema, evaluateAccess, securityModelIssues } from './securityModel';
import { mapAffectedItems, mapConnections } from './securityMapViews';
import { createEncryptedVault, decryptVault } from './crypto';
import { completeStep, currentTask, move } from './guideEngine';
import { makeCloudVault, configureCloudRoot, chooseCloudDevice, selectedCloudInstallation } from './cloudManagers';
import { startNordRecovery } from './nordRecovery';
import { selectNordSsoProvider } from './nordSso';
import { confirmPhoneStep, jumpPhoneStep, phoneRecord, startPhoneWorkflow } from './phoneEngine';
import { phoneSteps } from './phoneCatalog';
import { removeEntry } from './removeEntry';

const tick=()=>vi.setSystemTime(new Date(Date.now()+1000));
function fixture(){
 const data=newDataset('ja');
 data.assets=[{...makeAsset({kind:'account',type:'Account',name:'同じ呼び名',importance:'critical'}),id:'account',provider:'google',purpose:'personal'},{...makeAsset({kind:'device',type:'Smartphone',name:'スマホ',importance:'critical',operatingSystem:'ios'}),id:'phone'},{...makeAsset({kind:'device',type:'Computer',name:'PC',importance:'important',operatingSystem:'macos'}),id:'computer'}];
 const time=new Date().toISOString();data.securityModel.entities=[{id:'person',kind:'person',role:'self',label:'自分',createdAt:time},{id:'organization',kind:'organization',label:'組織',createdAt:time},{id:'vault',kind:'vault',productId:'other',storageMode:'local',label:'既存の保管庫',createdAt:time},{id:'installation',kind:'installation',deviceRef:'phone',productId:'other',label:'アプリ',createdAt:time},{id:'key',kind:'security-key',transports:['usb-c'],label:'キー',createdAt:time},{id:'data',kind:'data-set',dataType:'files',label:'データ',createdAt:time}].map(e=>securityEntitySchema.parse(e));return data;
}
function draft(data:Dataset,id:string){return mapRecordStore(data)!.drafts.find(d=>d.id===id)!;}
function finish(data:CurrentDataset,id:string,answers:Record<string,string|string[]>={},confirmed=true){
 for(let n=0;n<80;n++){
  const d=draft(data,id);if(d.cursor==='review')return commitMapRecord(data,id);
  const field=activeMapFields(data,d).find(f=>f.id===d.cursor);let value:string|string[];
  if(d.cursor.startsWith('link:'))value=confirmed?'user-confirmed':'unknown';
  else if(d.cursor==='reuse')value='new';
  else if(Object.hasOwn(answers,d.cursor))value=answers[d.cursor];
  else if(field?.id==='label')value=`登録 ${d.kind}`;
  else if(field?.optional)value=field.kind==='multi'?[]:'';
  else if(field?.kind==='multi')value=[field.choices![0].value];
  else value=field?.choices?.[0].value??'';
  tick();data=answerMapRecord(data,id,value);
 }
 throw new Error('did not reach review');
}
function add(data:CurrentDataset,kind:MapRecordDraft['kind'],answers:Record<string,string|string[]>={},confirmed=true){let result=startMapRecord(data);tick();result.data=answerMapRecord(result.data,result.id,kind!);return{data:finish(result.data,result.id,answers,confirmed),id:result.id};}
afterEach(()=>vi.useRealTimers());
describe('Security Map records and personal dependencies',()=>{
 for(const kind of MAP_RECORD_KINDS)it(`${kind}: registers the actual type without completing setup, authentication or recovery`,()=>{
  vi.useFakeTimers();const original=fixture(),guide=structuredClone(original.guide),result=add(original,kind,{subjectRef:'account',deviceRef:'phone',accountRef:'account',grantorRef:'account',granteeRef:'person',targetRefs:['data'],helperRef:'person',storageRef:'key',roles:['sign-in'],simType:'esim',productId:'other',storageMode:'local',primaryDeviceRef:'phone'}),d=draft(result.data,result.id),node=mapNode(result.data,d.nodeId)!;
  expect(node.kind).toBe(kind);expect(result.data.guide).toEqual(guide);expect(result.data.actions).toEqual(original.actions);expect(result.data.securityModel.facts).toEqual([]);expect(result.data.securityModel.routes).toEqual([]);expect(currentDatasetSchema.safeParse(result.data).success).toBe(true);expect(securityModelIssues(result.data.securityModel,result.data.assets)).toEqual([]);expect(result.data.securityModel.revision).toBe(6);
 });
 it('keeps an unconfirmed storage connection off the graph and permits a separate confirmation later',()=>{
  vi.useFakeTimers();let result=add(fixture(),'credential',{credentialType:'passkey',subjectRef:'account',storageRef:'key',roles:['sign-in']},false),ref=draft(result.data,result.id).nodeId;
  expect(mapConnections(result.data).some(r=>r.recoveryAssetId===ref)).toBe(false);
  const edge=result.data.securityModel.relations.find(r=>r.fromRef===ref&&r.toRef==='key')!;
  let data=recordMapConnection(result.data,{...edge,evidence:'user-confirmed'},edge.id);
  expect(mapConnections(data).some(r=>r.recoveryAssetId===ref&&r.assetId==='key')).toBe(true);expect(data.securityModel.facts).toEqual([]);
  data=recordMapConnection(data,{...edge,evidence:'unknown'},edge.id);expect(mapConnections(data).some(r=>r.id===edge.id)).toBe(false);expect(data.securityModel.relations.some(r=>r.id===edge.id)).toBe(true);
 });
 it('does not merge same-name accounts or different registrations on the same physical key',()=>{
  vi.useFakeTimers();const original=fixture(),a=add(original,'account',{label:'同じ呼び名',provider:'google',purpose:'personal'}),b=add(a.data,'credential',{credentialType:'security-key-registration',subjectRef:'account',storageRef:'key',roles:['second-step']}),c=add(b.data,'credential',{credentialType:'security-key-registration',subjectRef:draft(a.data,a.id).nodeId,storageRef:'key',roles:['second-step']});
  const registrations=c.data.securityModel.entities.filter(e=>e.kind==='credential');expect(registrations).toHaveLength(2);expect(registrations[0].id).not.toBe(registrations[1].id);expect(c.data.assets.filter(a=>a.kind==='account')).toHaveLength(2);expect(registrations.every(e=>e.kind==='credential'&&e.replicaGroupId===undefined)).toBe(true);
 });
 it('asks only relevant installation questions and keeps distinct app profiles',()=>{
  vi.useFakeTimers();let result=startMapRecord(fixture()),data=answerMapRecord(result.data,result.id,'installation');
  data=answerMapRecord(data,result.id,'new');data=answerMapRecord(data,result.id,'コード用アプリ');data=answerMapRecord(data,result.id,'google-authenticator');data=answerMapRecord(data,result.id,'phone');
  expect(recordFields(data,draft(data,result.id)).map(f=>f.id)).not.toContain('vaultRef');expect(recordFields(data,draft(data,result.id)).map(f=>f.id)).not.toContain('profileLabel');
  const a=add(fixture(),'installation',{productId:'chrome',deviceRef:'computer',profileLabel:'個人用'}),b=add(a.data,'installation',{productId:'chrome',deviceRef:'computer',profileLabel:'仕事用'});
  expect(mapNode(b.data,draft(a.data,a.id).nodeId)?.profileLabel).toBe('個人用');expect(mapNode(b.data,draft(b.data,b.id).nodeId)?.profileLabel).toBe('仕事用');
 });
 it('saves a draft separately, restores it encrypted and supports another referenced item without losing the parent',async()=>{
  vi.useFakeTimers();const f=fixture(),first=startMapRecord(f);let data=answerMapRecord(first.data,first.id,'credential');data=answerMapRecord(data,first.id,'new');data=answerMapRecord(data,first.id,'予備の登録');const originalGuide=structuredClone(data.guide),second=startMapRecord(data);expect(second.id).not.toBe(first.id);
  const result=await createEncryptedVault('application fixture passphrase',second.data),restored=currentDatasetSchema.parse((await decryptVault(result.envelope,'application fixture passphrase')).data);
  expect(draft(restored,first.id).cursor).toBe('credentialType');expect(draft(restored,second.id).cursor).toBe('kind');expect(restored.guide).toEqual(originalGuide);expect(backMapRecord(restored,first.id).guide).toEqual(originalGuide);
 });
 it('clears an optional reference on explicit edit, preserves opaque metadata, and leaves a rename’s proofs intact',()=>{
  vi.useFakeTimers();let result=add(fixture(),'phone-line',{deviceRef:'phone',carrierAccountRef:'account',simType:'esim'}),ref=draft(result.data,result.id).nodeId;
  result.data.securityModel.entities=result.data.securityModel.entities.map(e=>e.id===ref?{...e,unknownLegacy:{keep:true}}:e);
  expect(mapStructureEditable(result.data,ref)).toBe(true);
  const edit=startMapRecord(result.data,ref);let changed=finish(edit.data,edit.id,{label:'別の呼び名',deviceRef:'',carrierAccountRef:'account',simType:'esim'});
  expect(mapNode(changed,ref)?.deviceRef).toBeUndefined();expect(mapNode(changed,ref)?.unknownLegacy).toEqual({keep:true});expect(changed.securityModel.lifecycle[ref].accessResetAt).toBeDefined();
  const reset=changed.securityModel.lifecycle[ref].accessResetAt,rename=startMapRecord(changed,ref);changed=finish(rename.data,rename.id,{label:'回線の呼び名',deviceRef:'',carrierAccountRef:'account',simType:'esim'});expect(changed.securityModel.lifecycle[ref].accessResetAt).toBe(reset);
 });
 it('keeps guide-owned identities stable and rejects stale edits instead of overwriting a newer record',()=>{
  vi.useFakeTimers();const f=fixture();const edit=startMapRecord(f,'account');expect(activeMapFields(edit.data,draft(edit.data,edit.id)).map(f=>f.id)).toEqual(['label']);
  let data=answerMapRecord(edit.data,edit.id,'メインのメール');data.assets=data.assets.map(a=>a.id==='account'?{...a,notes:'newer record'}:a);
  expect(()=>commitMapRecord(data,edit.id)).toThrow('changed-since-start');expect(data.assets[0].name).toBe('同じ呼び名');
 });
 it('shares only an explicitly confirmed credential copy, preserving different account registrations',()=>{
  vi.useFakeTimers();const a=add(fixture(),'credential',{credentialType:'totp',subjectRef:'account',roles:['second-step'],storageRef:'installation'}),first=draft(a.data,a.id).nodeId,b=add(a.data,'credential',{credentialType:'totp',subjectRef:'account',roles:['second-step'],storageRef:'key',replicaOf:first});
  const one=mapNode(b.data,first),two=mapNode(b.data,draft(b.data,b.id).nodeId);expect(one?.replicaGroupId).toBeDefined();expect(two?.replicaGroupId).toBe(one?.replicaGroupId);
 });
 it('archives without deleting references, suppressing loss consequences or asserting physical revocation',()=>{
  vi.useFakeTimers();const a=add(fixture(),'credential',{subjectRef:'account',storageRef:'key',roles:['sign-in']}),ref=draft(a.data,a.id).nodeId,archived=setMapArchive(a.data,'key',true);
  expect(mapRecordStore(archived)?.archivedRefs).toContain('key');expect(mapNode(archived,'key')).toBeDefined();expect(archived.securityModel.lifecycle.key).toBeUndefined();expect(mapAffectedItems(archived,'key','ja').map(n=>n.id)).toEqual(expect.arrayContaining([ref,'account']));expect(setMapArchive(archived,'key',false).securityModel.relations).toEqual(archived.securityModel.relations);expect(removeEntry(archived,'key')).toBeUndefined();
 });
 it('follows physical storage in reverse and access forward while ignoring ownership, unknown links and cycles',()=>{
  vi.useFakeTimers();let data=recordMapConnection(fixture(),{fromRef:'installation',toRef:'phone',kind:'installed-on',evidence:'user-confirmed'});data=recordMapConnection(data,{fromRef:'person',toRef:'phone',kind:'owns',evidence:'user-confirmed'});data=recordMapConnection(data,{fromRef:'account',toRef:'installation',kind:'recovers',evidence:'unknown'});data=recordMapConnection(data,{fromRef:'phone',toRef:'installation',kind:'stored-in',evidence:'user-confirmed'});
  expect(mapAffectedItems(data,'phone','ja').map(n=>n.id)).toEqual(['installation']);
 });
 it('does not resurrect old access after a loss is corrected, and blocks recording work on an unavailable actor',()=>{
  vi.useFakeTimers();let data=fixture(),time=new Date().toISOString();data.securityModel.facts=[{id:'used',label:'used',requiredRefs:['phone'],state:'available',evidence:'user-confirmed',checkedAt:time,contexts:['normal'],sourceIds:[]}];data.securityModel.routes=[{id:'route',targetRef:'account',label:'route',purpose:'sign-in',contexts:['normal'],sourceIds:[],requirements:{kind:'fact',factId:'used'}}];
  tick();data=setMapLifecycle(data,'phone','lost');expect(evaluateAccess(data.securityModel,'route',{context:'normal',now:new Date().toISOString()}).state).toBe('unavailable');
  data=move(data,'do/phone/device/lock') as CurrentDataset;const task=currentTask(data);expect(task?.redirectTo).toBe('record-unavailable/phone');expect(completeStep(data).actions).toEqual(data.actions);
  tick();data=setMapLifecycle(data,'phone','in-use');expect(evaluateAccess(data.securityModel,'route',{context:'normal',now:new Date().toISOString()}).state).toBe('unknown');expect(data.securityModel.facts[0].state).toBe('available');
 });
 it('persists connection edits and undo, guards guide-created edges and refuses self-connections',()=>{
  vi.useFakeTimers();let result=startMapConnection(fixture(),'key');let data=result.data;
  for(const answer of ['key','account','authenticates-to','user-confirmed']){tick();data=answerMapConnection(data,result.id,answer);}
  data=commitMapConnection(data,result.id);const edge=data.securityModel.relations.at(-1)!;expect(edge.evidence).toBe('user-confirmed');
  const edit=startMapConnection(data,undefined,edge.id);data=edit.data;for(const answer of ['key','account','authenticates-to','unknown'])data=answerMapConnection(data,edit.id,answer);data=commitMapConnection(data,edit.id);expect(data.securityModel.relations.at(-1)?.evidence).toBe('unknown');
  expect(()=>recordMapConnection(data,{fromRef:'key',toRef:'key',kind:'owns',evidence:'user-confirmed'})).toThrow();data.securityModel.relations.push({...edge,id:'guide-owned',mapRecordRelationV1:undefined});expect(()=>startMapConnection(data,undefined,'guide-owned')).toThrow('protected-connection');
 });
 it('requires a new phone check after a Map loss without discarding the old receipt or main guide',()=>{
  vi.useFakeTimers();let data=fixture();data.assets=data.assets.filter(a=>a.kind==='device');data.securityModel.entities=[];data.assets.push({...makeAsset({kind:'device',type:'Smartphone',name:'New phone',importance:'important',operatingSystem:'ios'}),id:'fresh'});data=startPhoneWorkflow(data,'/guide','phone','replacement');Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',answers:{stage:'using',availability:'available',ownership:'personal',setup:'ready',authenticator:'none','special-apps':'none','phone-line':'no-line','old-fate':'spare'}});
  const original=structuredClone(data.guide);tick();data=confirmPhoneStep(jumpPhoneStep(data,'replacement','new-lock'),'replacement') as CurrentDataset;let step=phoneSteps(data,data.deviceWorkflows[0]).find(s=>s.id==='new-lock')!;expect(step,phoneSteps(data,data.deviceWorkflows[0]).map(s=>s.id).join(',')).toBeDefined();expect(phoneRecord(data.deviceWorkflows[0],step)?.status).toBe('confirmed');const receipts=Object.keys(data.deviceWorkflows[0].records).length;
  tick();data=setMapLifecycle(data,'fresh','lost');step=phoneSteps(data,data.deviceWorkflows[0]).find(s=>s.id==='new-lock')!;expect(step.kind).toBe('blocked');expect(step.unavailableMapRef).toBe('fresh');expect(confirmPhoneStep(jumpPhoneStep(data,'replacement','new-lock'),'replacement').actions).toEqual(data.actions);
  tick();data=setMapLifecycle(data,'fresh','in-use');step=phoneSteps(data,data.deviceWorkflows[0]).find(s=>s.id==='new-lock')!;expect(step.kind).toBe('action');expect(phoneRecord(data.deviceWorkflows[0],step)).toBeUndefined();tick();data=confirmPhoneStep(jumpPhoneStep(data,'replacement','new-lock'),'replacement') as CurrentDataset;expect(phoneRecord(data.deviceWorkflows[0],phoneSteps(data,data.deviceWorkflows[0]).find(s=>s.id==='new-lock')!)?.status).toBe('confirmed');expect(Object.keys(data.deviceWorkflows[0].records).length).toBeGreaterThan(receipts);expect(data.guide).toEqual(original);
 });
 it('blocks a fresh account sign-in while allowing unrelated physical app access to stay separate',()=>{
  vi.useFakeTimers();let data=fixture();data.assets.push({...makeAsset({kind:'account',type:'Account',name:'Nord用',importance:'important'}),id:'nord',provider:'nord',purpose:'personal'});data=makeCloudVault(data,'nordpass','ja');const vault=data.guide.managerId!;data=configureCloudRoot(data,vault,'nord') as CurrentDataset;data=chooseCloudDevice(data,vault,'phone') as CurrentDataset;const app=selectedCloudInstallation(data,vault)!;tick();data=setMapLifecycle(data,'nord','unavailable');data=move(data,`do/${app.id}/cloud-onboard/sign-in`) as CurrentDataset;expect(currentTask(data)?.redirectTo).toBe('record-unavailable/nord');expect(completeStep(data).actions).toEqual(data.actions);
 });
 it('preserves model 6 through later cloud, Nord recovery and connected-sign-in work',()=>{
  vi.useFakeTimers();let data=add(fixture(),'person',{role:'trusted-contact'}).data;data.assets.push({...makeAsset({kind:'account',type:'Account',name:'Nord用',importance:'important'}),id:'nord',provider:'nord',purpose:'personal'});
  data=makeCloudVault(data,'nordpass','ja');const vault=data.guide.managerId!;data=configureCloudRoot(data,vault,'nord') as CurrentDataset;data=chooseCloudDevice(data,vault,'phone') as CurrentDataset;data=startNordRecovery(data,selectedCloudInstallation(data,vault)!.id);data=selectNordSsoProvider(data,'nord','google') as CurrentDataset;
  expect(data.securityModel.revision).toBe(6);expect(mapRecordStore(data)?.manualRefs).toHaveLength(1);expect(currentDatasetSchema.safeParse(data).success).toBe(true);
 });
 it('uses an explicitly recorded session or grant expiry and does not turn a recovery invitation into ready access',()=>{
  vi.useFakeTimers();let data=fixture(),time=new Date().toISOString(),past=new Date(Date.now()-1000).toISOString();data.securityModel.revision=6;data.securityModel.entities.push(securityEntitySchema.parse({id:'session',kind:'session',accountRef:'account',label:'Session',createdAt:time,expiresAt:past}),securityEntitySchema.parse({id:'grant',kind:'grant',grantType:'oauth',grantorRef:'account',granteeRef:'person',targetRefs:['data'],permissions:['read'],label:'Grant',createdAt:time,expiresAt:past}),securityEntitySchema.parse({id:'helper',kind:'recovery-arrangement',mode:'contact',subjectRef:'account',stage:'accepted',label:'Recovery',createdAt:time}));
  for(const ref of ['session','grant','helper']){data.securityModel.facts=[{id:'observed',label:'Use',state:'available',evidence:'user-confirmed',checkedAt:time,requiredRefs:[ref],contexts:['normal'],sourceIds:[]}];data.securityModel.routes=[{id:'use',label:'Use',purpose:'sign-in',targetRef:'account',contexts:['normal'],sourceIds:[],requirements:{kind:'fact',factId:'observed'}}];const result=evaluateAccess(data.securityModel,'use',{context:'normal',now:time});expect(result.state).toBe(ref==='helper'?'unknown':'unavailable');expect(result.reasons[0].code).toBe(ref==='helper'?'unconfirmed':'expired');}
 });
 it('extends an actual version 1 payload only on opt-in while retaining IDs, progress and unknown fields through encryption',async()=>{
  vi.useFakeTimers();const base=fixture(),legacy={...base,version:1 as const,opaqueLegacy:{keep:['old']}};delete (legacy as unknown as Record<string,unknown>).securityModel;delete (legacy as unknown as Record<string,unknown>).deviceWorkflows;legacy.assets[0]={...legacy.assets[0],legacyExtra:{keep:true}};
  const original=structuredClone(legacy),started=startMapRecord(legacy as Dataset);let data=answerMapRecord(started.data,started.id,'organization');data=finish(data,started.id,{label:'所属の呼び名'});expect(data.version).toBe(2);expect(data.guide).toEqual(original.guide);expect(data.assets).toEqual(original.assets);expect(data.opaqueLegacy).toEqual(original.opaqueLegacy);const sealed=await createEncryptedVault('fixture app passphrase',data);expect((await decryptVault(sealed.envelope,'fixture app passphrase')).data).toEqual(data);
 });
 it('can inspect a legacy date without rewriting it or calling a confirmed reference unconfirmed',()=>{
  vi.useFakeTimers();const f=fixture();f.assets[0].createdAt='legacy unformatted date';expect(mapRecordSnapshot(f,'account')?.values.label).toBe('同じ呼び名');expect(f.assets[0].createdAt).toBe('legacy unformatted date');
  const result=add(f,'credential',{subjectRef:'account',storageRef:'key',roles:['sign-in']});const snapshot=mapRecordSnapshot(result.data,draft(result.data,result.id).nodeId)!;expect(Object.values(snapshot.confirmations)).toEqual(['user-confirmed','user-confirmed']);
 });
 it('retains old opaque fields and refuses conflicting or malformed new metadata and invalid session references',()=>{
  const f=fixture();f.securityModel.mapRecordsV1={opaque:true};expect(currentDatasetSchema.parse(f).securityModel.mapRecordsV1).toEqual({opaque:true});expect(()=>startMapRecord(f)).toThrow(DataUpgradeConflict);delete f.securityModel.mapRecordsV1;f.securityModel.lifecycle.phone={state:'unknown',evidence:'unknown',updatedAt:new Date().toISOString(),mapRecordChangedAt:'opaque'};expect(()=>startMapRecord(f)).toThrow(DataUpgradeConflict);
  const data=startMapRecord(fixture()).data;data.securityModel.mapRecordsV1={version:2};expect(currentDatasetSchema.safeParse(data).success).toBe(false);
  const other=fixture();other.securityModel.revision=6;other.securityModel.entities.push(securityEntitySchema.parse({id:'session',kind:'session',accountRef:'phone',label:'誤った参照',createdAt:new Date().toISOString()}));expect(currentDatasetSchema.safeParse(other).success).toBe(false);
 });
 for(const value of ['me@example.com','123456','+81 90 1234 5678','https://example.com','password: secret','-----BEGIN PRIVATE KEY-----','ABCDabcd1234567890abcdZZ'])it(`rejects private-looking input ${value.slice(0,12)} before it is persisted`,()=>{
  vi.useFakeTimers();const result=startMapRecord(fixture());let data=answerMapRecord(result.data,result.id,'person');data=answerMapRecord(data,result.id,'new');expect(safeMapNickname(value)).toBe(false);expect(()=>answerMapRecord(data,result.id,value)).toThrow('invalid-answer');expect(JSON.stringify(mapRecordStore(data))).not.toContain(value);
 });
});
