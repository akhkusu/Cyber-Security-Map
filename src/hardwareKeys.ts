import { DataUpgradeConflict, makeAsset, upgradeDataset, type CurrentDataset, type Dataset, type Language } from './models';
import { c } from './guideCatalog';
import { beginRecipe, currentTask, move } from './guideEngine';
import { keyRegistrationCandidates, keySourceIds, keySteps, KEY_SOURCES, type KeyStep } from './hardwareKeyCatalog';
import { keyStoreSchema, keyTaskSchema, keyTasks, type KeyTask } from './hardwareKeySchemas';
import { safeMapNickname } from './mapRecords';
import { recordedActors, recordedUnavailable } from './recordAvailability';
import { recordControl, undoControl } from './controlRecords';
import type { AccessFact, SecurityEntity, SecurityRelation } from './securityModel';

const keyEpochs = (data: Dataset, refs: string[]) => data.version === 2 ? recordedActors(data,refs).flatMap(ref => {const at=data.securityModel.lifecycle[ref]?.accessResetAt;return at?[at]:[];}) : [];
const nowString = () => new Date().toISOString();
const proofStep = (id: string) => id === 'test-open' || id.startsWith('test-start-') || id.startsWith('test-use-') || id === 'prepare-second-test' || id === 'master-unlock' || id === 'vault-read';
const configured = (t: KeyTask) => Object.keys(t.records).some(id => id.startsWith('verify-'));
export const keyAccountSupported = (data: Dataset, id: string) => data.assets.some(a => a.id === id && a.kind === 'account' && ['google','apple','bitwarden'].includes(a.provider ?? ''));
function writable(data: Dataset): CurrentDataset {
  const next = upgradeDataset(data);
  if ((next.securityModel.revision < 7 && (Object.hasOwn(next.securityModel,'hardwareKeysV1') || [...next.assets,...next.securityModel.entities,...next.securityModel.facts,...next.securityModel.relations,...next.securityModel.routes].some(e => Object.keys(e).some(k => k.startsWith('hardwareKey'))))) || (next.securityModel.revision >= 7 && Object.hasOwn(next.securityModel,'hardwareKeysV1') && !keyStoreSchema.safeParse(next.securityModel.hardwareKeysV1).success)) throw new DataUpgradeConflict();
  return next;
}
function put(data: CurrentDataset, task: KeyTask): CurrentDataset {
  const parsed=keyStoreSchema.safeParse(data.securityModel.hardwareKeysV1),store=parsed.success?parsed.data:{version:1 as const,tasks:[]};
  return {...data,securityModel:{...data.securityModel,revision:7,hardwareKeysV1:{...store,tasks:[...store.tasks.filter(t=>t.id!==task.id),task]}}};
}
export function startKeyGuide(data: Dataset, accountRef: string, returnTo: '/guide'|'/map' = '/map', now=nowString(), forceNew=false): {data: CurrentDataset; id: string} {
  const next=writable(data);
  if(!keyAccountSupported(next,accountRef))throw new Error('unsupported-key-account');
  const pending=forceNew?undefined:keyTasks(next).find(t=>t.accountRef===accountRef&&['active','deferred'].includes(t.status));
  const task=pending?{...pending,status:'active' as const}:keyTaskSchema.parse({id:crypto.randomUUID(),accountRef,returnTo,originGuideCursor:data.guide.cursor,createdAt:now,updatedAt:now});
  return {data:put(next,task),id:task.id};
}
export function keyRecordValid(data: Dataset, task: KeyTask, id: string, visiting = new Set<string>()): boolean {
  const r=task.records[id];if(!r||visiting.has(id)||visiting.size>256)return false;
  visiting.add(id);
  if(proofStep(id)&&keyEpochs(data,r.refs).some(at=>Date.parse(at)>=Date.parse(r.at)))return false;
  return r.requires.every(p=>keyRecordValid(data,task,p,new Set(visiting)));
}
export function currentKeyStep(data: Dataset, task: KeyTask): KeyStep {
  const steps=keySteps(data,task),target=steps.findIndex(s=>s.id===task.cursor),end=target<0?steps.length-1:target;
  const step=steps.slice(0,end+1).find(s=>s.kind==='blocked'||((s.kind==='question'||s.kind==='text')?!task.answers[s.id]:s.kind==='operation'&&!keyRecordValid(data,task,s.id)))??steps[end];
  // A completed record is historical; a new operation needs its actual actors.
  if(step.kind==='operation'){
    const refs=[task.accountRef,...(task.deviceRef?[task.deviceRef]:[]),...task.keyRefs,...(proofStep(step.id)&&task.browserRef?[task.browserRef]:[])];
    const missing=recordedUnavailable(data,refs);
    if(missing)return {id:'unavailable',kind:'blocked',title:c('A selected item is unavailable','選んだ項目を利用できません'),action:c('Keep this task and its records. Review the actual item’s state in Security Map. Correcting a record alone does not restore a lost key or device.','この作業と記録は残します。Security Mapで実際の項目の状態を確認してください。記録の訂正だけでは、紛失したキーや端末は復旧しません。'),sources:keySourceIds(task)};
  }
  return step;
}
function afterStep(data: CurrentDataset, task: KeyTask, previous: string, now: string) {
  const steps=keySteps(data,task),at=steps.findIndex(s=>s.id===previous),cursor=steps[at+1]?.id??'finished';
  task={...task,cursor,status:cursor==='finished'?'completed':'active',history:[...task.history,previous].slice(-200),updatedAt:now};
  return reconcile(put(data,task),task,now);
}
const entity = (data: CurrentDataset, next: SecurityEntity): CurrentDataset => ({...data,securityModel:{...data.securityModel,entities:[...data.securityModel.entities.filter(e=>e.id!==next.id),next]}});
function timeAfterEpoch(data: Dataset, refs: string[], now: string) {return new Date(Math.max(Date.parse(now),...keyEpochs(data,refs).map(at=>Date.parse(at)+1))).toISOString();}
export function answerKeyGuide(data: Dataset, id: string, value: string, now=nowString()): Dataset {
  if(data.version!==2)return data;
  let task=keyTasks(data).find(t=>t.id===id),next=data;
  if(!task||task.status==='cancelled')return data;
  const step=currentKeyStep(data,task);
  if(step.kind==='question'&&!step.choices?.some(o=>o.value===value))return data;
  if(step.kind==='text'&&!safeMapNickname(value))return data;
  if(!['question','text'].includes(step.kind))return data;
  value=step.kind==='text'?value.trim():value;
  const previous=task.answers[step.id];
  // Once a real registration is confirmed, changing its identity requires a
  // separate task. Later browser choices can still be corrected before use.
  const locked=configured(task)&&!['browser','browser-product','browser-label','encryption','enable-encryption','encryption-after','unlock-method'].includes(step.id);
  if(locked&&previous&&previous!==value)return data;
  if(previous&&previous!==value){
    const sequence=keySteps(data,task),at=sequence.findIndex(s=>s.id===step.id),discard=new Set(sequence.slice(at+1).map(s=>s.id));
    task={...task,answers:Object.fromEntries(Object.entries(task.answers).filter(([k])=>!discard.has(k))),records:Object.fromEntries(Object.entries(task.records).filter(([k])=>!discard.has(k)))};
    if(step.id.startsWith('device'))task={...task,deviceRef:undefined,browserRef:undefined};
    if(step.id.startsWith('key-')){const i=step.id.endsWith('2')?1:0;task={...task,keyRefs:task.keyRefs.slice(0,i),registrationRefs:[]};}
    if(step.id==='mode')task={...task,keyRefs:[],registrationRefs:[],deviceRef:undefined,browserRef:undefined,vaultRef:undefined};
    if(step.id.startsWith('browser'))task={...task,browserRef:undefined};
  }
  task={...task,answers:{...task.answers,[step.id]:value}};
  if(step.id==='mode')task={...task,mode:value as KeyTask['mode']};
  if(step.id==='device'&&value!=='new')task={...task,deviceRef:value};
  if(step.id==='device-label'){
    const asset={...makeAsset({kind:'device',type:task.answers['device-os']==='ios'?task.answers['device-kind']==='ipad'?'Tablet':'Smartphone':'Computer',name:value,importance:'critical',operatingSystem:task.answers['device-os'] as 'ios'|'macos'|'windows'|'ubuntu'|'chromeos'}),id:task.deviceRef??crypto.randomUUID()};
    next={...next,assets:[...next.assets.filter(a=>a.id!==asset.id),asset]};task={...task,deviceRef:asset.id};
  }
  if(/^key-[12]$/.test(step.id)&&!['new','none'].includes(value)){const i=Number(step.id.slice(-1))-1;task={...task,keyRefs:task.keyRefs.map((r,j)=>j===i?value:r)};task.keyRefs[i]=value;}
  if(/^key-label-[12]$/.test(step.id)){
    const i=Number(step.id.slice(-1))-1,ref=task.keyRefs[i]??crypto.randomUUID();
    next=entity(next,{id:ref,kind:'security-key',label:value,transports:[],createdAt:now,hardwareKeyGuide:'v1'});
    const refs=[...task.keyRefs];refs[i]=ref;task={...task,keyRefs:refs};
  }
  if(step.id==='vault'){
    if(value==='new'){
      const vaultId=task.vaultRef,accountId=task.accountRef;
      const existing=vaultId?next.securityModel.entities.find(e=>e.id===vaultId&&e.kind==='vault'):undefined;
      const ref=existing?.id??crypto.randomUUID(),name=next.assets.find(a=>a.id===accountId)!.name;
      if(!existing)next=entity(next,{id:ref,kind:'vault',productId:'bitwarden',authenticationAccountRef:task.accountRef,storageMode:'account',label:`${name} · ${data.settings.language==='ja'?'個人用保管庫':'personal vault'}`.slice(0,80),createdAt:now,hardwareKeyGuide:'v1'});
      task={...task,vaultRef:ref};
    }else task={...task,vaultRef:value};
  }
  if(step.id==='browser'&&value!=='new'){
    const b=next.securityModel.entities.find(e=>e.id===value&&e.kind==='installation');
    if(task.mode==='bitwarden-login'&&b?.kind==='installation'&&!['chrome','edge','chromium'].includes(b.productId))return data;
    task={...task,browserRef:value};
  }
  if(step.id==='browser-label'){
    if(!task.deviceRef)return data;
    const ref=task.browserRef??crypto.randomUUID();
    next=entity(next,{id:ref,kind:'installation',productId:task.answers['browser-product'],deviceRef:task.deviceRef,profileLabel:value,label:value,createdAt:now,hardwareKeyGuide:'v1'});task={...task,browserRef:ref};
  }
  if(step.id==='unlock-method'&&value==='key'&&task.answers.encryption!=='used'&&task.answers['encryption-after']!=='used')return data;
  return afterStep(next,task,step.id,now);
}
function recordRefs(t: KeyTask, id: string) {
  if(proofStep(id)){
    const n=/^test-(start|use)-[12]$/.test(id)?Number(id.slice(-1))-1:id==='vault-read'||id==='master-unlock'?0:undefined;
    return [t.accountRef,...(n===undefined?[]:[t.keyRefs[n],t.registrationRefs[n]]),...[t.deviceRef,t.browserRef,id==='vault-read'?t.vaultRef:undefined].filter((r):r is string=>!!r)].filter(Boolean);
  }
  if(id.startsWith('verify-')){const i=Number(id.slice(-1))-1;return [t.accountRef,t.keyRefs[i],t.registrationRefs[i]].filter((r):r is string=>!!r);}
  return [t.accountRef,...[t.deviceRef].filter((r):r is string=>!!r),...t.keyRefs];
}
export function confirmKeyGuide(data: Dataset, id: string, now=nowString()): Dataset {
  if(data.version!==2)return data;
  let task=keyTasks(data).find(t=>t.id===id),next=data;
  if(!task||task.status==='cancelled')return data;
  const step=currentKeyStep(data,task);if(step.kind!=='operation')return data;
  if(step.id==='open-settings'&&task.mode?.startsWith('bitwarden'))next={...next,assets:next.assets.map(a=>a.id===task!.accountRef?{...a,hardwareKeyServer:task!.answers.server}:a)};
  if(step.id==='distinct'&&(task.keyRefs.length!==2||task.keyRefs[0]===task.keyRefs[1]))return data;
  if(step.id.startsWith('verify-')){
    const i=Number(step.id.slice(-1))-1,selection=task.answers[`registration-${i+1}`],chosen=selection?.startsWith('ref:')?keyRegistrationCandidates(data,task,i).find(r=>r.id===selection.slice(4)):undefined;
    if(!task.keyRefs[i]||selection?.startsWith('ref:')&&!chosen)return data;
    const ref=chosen?.id??task.registrationRefs[i]??crypto.randomUUID(),passkey=['google-passkey','bitwarden-login'].includes(task.mode??''),key=next.securityModel.entities.find(e=>e.id===task!.keyRefs[i])!;
    if(!chosen&&!next.securityModel.entities.some(e=>e.id===ref))next=entity(next,{id:ref,kind:'credential',credentialType:passkey?'passkey':'security-key-registration',subjectRef:task.accountRef,storageRef:key.id,roles:[passkey?'sign-in':'second-step'],label:`${key.label} · ${passkey?'passkey':'2FA'}`.slice(0,80),createdAt:now,hardwareKeyGuide:'v1',hardwareKeyMode:task.mode});
    const refs=[...task.registrationRefs];refs[i]=ref;task={...task,registrationRefs:refs};
  }
  const refs=recordRefs(task,step.id),at=timeAfterEpoch(next,refs,now),sequence=keySteps(next,task),position=sequence.findIndex(s=>s.id===step.id);
  const requires=sequence.slice(0,position).filter(s=>s.kind==='operation'&&(!proofStep(s.id)||s.id==='test-open'||(step.id==='test-use-1'&&s.id==='test-start-1')||(step.id==='test-use-2'&&s.id==='test-start-2')||(step.id==='vault-read'&&['test-use-1','master-unlock'].includes(s.id)))).map(s=>s.id);
  // A route cannot confirm a later operation without its preparation.
  if(requires.some(ref=>!keyRecordValid(next,task!,ref)))return data;
  task={...task,records:{...task.records,[step.id]:{...task.records[step.id],titleEn:step.title.en,titleJa:step.title.ja,at,refs,requires}}};
  return afterStep(next,task,step.id,at);
}
function reconcile(data: CurrentDataset, task: KeyTask, now: string): CurrentDataset {
  const mark={hardwareKeyGuide:'v1',hardwareKeyTaskRef:task.id},model=data.securityModel;
  const relations:SecurityRelation[]=[];const facts:AccessFact[]=[];
  if(task.browserRef&&task.deviceRef&&task.records['test-open'])relations.push({id:`key:${task.id}:browser-device`,fromRef:task.browserRef,toRef:task.deviceRef,kind:'installed-on',evidence:keyRecordValid(data,task,'test-open')?'user-confirmed':'unknown',checkedAt:task.records['test-open'].at,sourceIds:keySourceIds(task),...mark});
  for(let i=0;i<task.registrationRefs.length;i++){
    const r=task.records[`verify-${i+1}`],ref=task.registrationRefs[i];if(!r)continue;
    for(const [suffix,to,kind] of [['stored',task.keyRefs[i],'stored-in'],['account',task.accountRef,'authenticates-to']] as const)relations.push({id:`key:${task.id}:registration:${i}:${suffix}`,fromRef:ref,toRef:to,kind,evidence:keyRecordValid(data,task,`verify-${i+1}`)?'user-confirmed':'unknown',checkedAt:r.at,sourceIds:keySourceIds(task),...mark});
  }
  for(const [id,r]of Object.entries(task.records)){
    if(!id.startsWith('test-use-')&&id!=='vault-read')continue;
    const i=id==='vault-read'?0:Number(id.slice(-1))-1,valid=keyRecordValid(data,task,id);
    const refs=id==='vault-read'?[task.vaultRef!,task.accountRef,task.keyRefs[i],task.registrationRefs[i],task.deviceRef!,task.browserRef!]:[task.accountRef,task.keyRefs[i],task.registrationRefs[i],task.deviceRef!,task.browserRef!];
    facts.push({id:`key:${task.id}:fact:${id}`,label:data.settings.language==='ja'?r.titleJa:r.titleEn,state:valid?'available':'unknown',evidence:valid?'user-confirmed':'unknown',checkedAt:r.at,requiredRefs:refs.filter(Boolean),contexts:['normal','no-existing-session'],sourceIds:keySourceIds(task),dependencyCompleteness:'partial',...mark,hardwareKeyStep:id,hardwareKeyUnlockMethod:id==='vault-read'?task.answers['unlock-method']??'master':undefined});
  }
  if(task.mode==='bitwarden-login'&&task.vaultRef&&task.registrationRefs[0]&&task.answers['unlock-method']==='key'&&keyRecordValid(data,task,'vault-read'))relations.push({id:`key:${task.id}:decrypt`,fromRef:task.registrationRefs[0],toRef:task.vaultRef,kind:'decrypts',evidence:'user-confirmed',checkedAt:task.records['vault-read'].at,sourceIds:keySourceIds(task),...mark});
  const ownFactIds=new Set(facts.map(f=>f.id)),ownRelationIds=new Set(relations.map(r=>r.id));
  const retainedFacts=model.facts.map(f=>f.hardwareKeyGuide==='v1'&&f.hardwareKeyTaskRef===task.id&&!ownFactIds.has(f.id)?{...f,state:'unknown' as const,evidence:'unknown' as const}:f).filter(f=>!ownFactIds.has(f.id));
  const retainedRelations=model.relations.map(r=>r.hardwareKeyGuide==='v1'&&r.hardwareKeyTaskRef===task.id&&!ownRelationIds.has(r.id)?{...r,evidence:'unknown' as const}:r).filter(r=>!ownRelationIds.has(r.id));
  const routeIds=new Set(facts.map(f=>`${f.id}:route`));
  const routes=facts.map(f=>({id:`${f.id}:route`,label:f.label,targetRef:f.hardwareKeyStep==='vault-read'?task.vaultRef!:task.accountRef,purpose:f.hardwareKeyStep==='vault-read'?'decrypt' as const:['google-passkey','bitwarden-login'].includes(task.mode??'')?'sign-in' as const:'second-step' as const,contexts:f.contexts,requirements:{kind:'fact' as const,factId:f.id},sourceIds:f.sourceIds,...mark}));
  const encrypted=task.mode==='bitwarden-login'&&(task.answers.encryption==='used'||task.answers['encryption-after']==='used');
  const entities=model.entities.map(e=>e.kind==='credential'&&e.hardwareKeyGuide==='v1'&&task.mode==='bitwarden-login'&&task.registrationRefs.includes(e.id)?{...e,roles:encrypted?['sign-in' as const,'decrypt' as const]:['sign-in' as const]}:e);
  let next:CurrentDataset={...data,securityModel:{...model,entities,relations:[...retainedRelations,...relations],facts:[...retainedFacts,...facts],routes:[...model.routes.filter(r=>!routeIds.has(r.id)),...routes]}};
  // Shared control records are independent of the main guide's old records.
  const complete=task.mode==='apple-keys'?keyRecordValid(next,task,'test-use-1')&&keyRecordValid(next,task,'test-use-2'):task.mode?.startsWith('bitwarden')?keyRecordValid(next,task,'vault-read'):keyRecordValid(next,task,'test-use-1');
  for(const control of ['mfa','recovery']){
    const qualifies=complete&&(control==='mfa'?task.mode!=='bitwarden-login':task.mode==='bitwarden-second-step'&&(keyRecordValid(next,task,'recovery-before')||keyRecordValid(next,task,'recovery-after')));
    const actionId=`key:${task.id}:control:${control}`;
    if(qualifies)next=recordControl(next,task.accountRef,control,{id:actionId,origin:'hardware-key-guide',titleEn:control==='mfa'?'Used the selected physical key':'Stored the current Bitwarden recovery code',titleJa:control==='mfa'?'選んだ物理キーで利用を確認':'現在のBitwarden復旧コードを保管'},now) as CurrentDataset;
    else if(next.actions.some(a=>a.id===actionId))next=undoControl(next,actionId,task.accountRef,control,{state:'unknown',evidence:'not-assessed'},now) as CurrentDataset;
  }
  return next;
}
export function undoKeyGuide(data: Dataset,id:string,stepId:string,now=nowString()):Dataset {
  if(data.version!==2)return data;const task=keyTasks(data).find(t=>t.id===id);if(!task?.records[stepId])return data;
  const removed=new Set([stepId]);let changed=true;
  while(changed){changed=false;for(const [key,r]of Object.entries(task.records))if(!removed.has(key)&&r.requires.some(p=>removed.has(p))){removed.add(key);changed=true;}}
  const next={...task,status:'active' as const,cursor:stepId,records:Object.fromEntries(Object.entries(task.records).filter(([key])=>!removed.has(key))),updatedAt:now};
  return reconcile(put(data,next),next,now);
}
export function navigateKeyGuide(data: Dataset,id:string,operation:'back'|'defer'|'cancel',now=nowString()):Dataset {
  if(data.version!==2)return data;const task=keyTasks(data).find(t=>t.id===id);if(!task)return data;
  if(operation!=='back')return put(data,{...task,status:operation==='defer'?'deferred':'cancelled',updatedAt:now});
  const history=[...task.history],cursor=history.pop();return cursor?put(data,{...task,cursor,history,status:'active',updatedAt:now}):data;
}
export function returnFromKeyGuide(data: Dataset,id:string):Dataset {
  const task=keyTasks(data).find(t=>t.id===id);if(!task||task.status!=='completed'||task.returnTo!=='/guide'||data.guide.cursor!==task.originGuideCursor)return data;
  const current=currentTask(data),account=data.assets.find(a=>a.id===task.accountRef);
  if(current?.asset.id!==task.accountRef||!account)return data;
  if(current.recipe.id==='email-mfa'&&task.mode!=='bitwarden-login')return beginRecipe(data,account.id,'recovery');
  // The launcher only substitutes for the manager's MFA section after setup.
  if(current.recipe.id==='manager'&&task.mode==='bitwarden-second-step'&&['auth-ready','auth-open','auth-scan','auth-activate','auth-test','recovery'].includes(current.step.id))return data.guide.accountId?beginRecipe(data,data.guide.accountId,'password'):move(data,'device-select');
  return data;
}
export function keyHelpPrompt(data: Dataset,task:KeyTask,problem:number,language:Language):string {
  const step=currentKeyStep(data,task),account=data.assets.find(a=>a.id===task.accountRef),device=data.assets.find(a=>a.id===task.deviceRef);
  const problems=['screen differs','item missing','permission or compatibility','key/PIN unavailable','another method was used','waiting for a new key'];
  return `${language==='ja'?'最新の公式情報を確認し、一度に一つの質問または操作を案内してください。最新情報を確認できない場合は、その旨を明示してください。秘密値や個人情報を求めないでください。':'Check current official information and guide one question or action at a time. State if you cannot verify current information. Do not request secrets or personal information.'}\nService: ${account?.provider??'unknown'}\nServer: ${task.answers.server??'not applicable'}\nDevice OS: ${device?.operatingSystem??'unknown'}\nBrowser: ${task.answers['browser-product']??(data.version===2?data.securityModel.entities.find(e=>e.id===task.browserRef&&e.kind==='installation')?.productId:undefined)??'not yet selected'}\nTask: ${task.mode??'not yet selected'}\nStep: ${step.title[language]}\nExpected: ${step.expected?.[language]??step.action[language]}\nProblem: ${problems[problem]??'unresolved'}\nSources:\n${step.sources.map(id=>KEY_SOURCES[id].url).join('\n')}`;
}
