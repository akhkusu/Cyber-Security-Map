import {standardClientLabel} from './standardManagerLabels';
import {DataUpgradeConflict,upgradeDataset,type Dataset,type CurrentDataset} from './models';
import {securityEntitySchema,type SecurityEntity} from './securityModel';
import {isStandardManager} from './standardManagerAccounts';
import {bitwardenRegion} from './bitwardenServer';
import {onePasswordScope,onePasswordAccount} from './onePasswordAccount';
import {standardAppSchema,standardVaultSchema,standardStoreSchema,standardChecksSchema,standardCheckSchema,standardAppSignature,type StandardStore} from './standardManagerSchemas';
import {recordedUnavailable} from './recordAvailability';

export type StandardVault=Extract<SecurityEntity,{kind:'vault'}>;
export type StandardApp=Extract<SecurityEntity,{kind:'installation'}>;
export const standardStore=(data:Dataset):StandardStore|undefined=>{const p=standardStoreSchema.safeParse(data.version===2?data.securityModel.standardManagersV1:undefined);return p.success?p.data:undefined;};
export function standardAccountScope(data:Dataset,ref:string){const a=data.assets.find(a=>a.id===ref);return a?.provider==='bitwarden'?(bitwardenRegion(data,ref)?`bitwarden:${bitwardenRegion(data,ref)}`:undefined):a?.provider==='1password'?onePasswordScope(data,ref):undefined;}
export function standardEpoch(data:Dataset,ref:string){const receipt=data.guide.steps[`do/${ref}/manager/master-submit`];return JSON.stringify([receipt?.status==='done'?receipt.standardMasterAttemptV1??null:null,data.version===2?data.securityModel.lifecycle[ref]?.accessResetAt??null:null]);}
export function standardSupported(data:Dataset){return (data.version!==2||data.securityModel.revision<=15)&&(data.version!==2||!Object.hasOwn(data.securityModel,'standardManagersV1')||data.securityModel.revision>=15&&standardStoreSchema.safeParse(data.securityModel.standardManagersV1).success)&&(!Object.hasOwn(data.guide,'standardContextChecksV1')||standardChecksSchema.safeParse(data.guide.standardContextChecksV1).success);}
function writable(data:Dataset):CurrentDataset{if(!standardSupported(data))throw new DataUpgradeConflict();const next=upgradeDataset(data);return {...next,securityModel:{...next.securityModel,revision:15,standardManagersV1:standardStore(next)??{version:1,selections:{},observations:[]}}};}
export const standardVaults=(data:Dataset,ref:string):StandardVault[]=>data.version===2?data.securityModel.entities.filter((e):e is StandardVault=>e.kind==='vault'&&e.authenticationAccountRef===ref&&standardVaultSchema.safeParse(e.standardVaultV1).success):[];
export const standardApps=(data:Dataset,ref:string):StandardApp[]=>{const a=data.assets.find(a=>a.id===ref);return data.version===2?data.securityModel.entities.filter((e):e is StandardApp=>e.kind==='installation'&&e.productId===a?.provider&&standardAppSchema.safeParse(e.standardAppV1).success):[];};
export function selectedStandardContext(data:Dataset,ref:string){const selection=standardStore(data)?.selections[ref],vault=standardVaults(data,ref).find(v=>v.id===selection?.vaultRef),app=standardApps(data,ref).find(a=>a.id===selection?.appRef);return vault&&app?{vault,app}:undefined;}
export function standardContextScope(data:Dataset,ref:string){const selected=selectedStandardContext(data,ref),scope=standardAccountScope(data,ref);return selected&&scope?JSON.stringify([ref,selected.vault.id,selected.app.id,scope,standardAppSignature(selected.app)]):undefined;}
export function standardObservationValid(data:Dataset,id:string){
 const o=standardStore(data)?.observations.find(o=>o.id===id);if(!o||!o.active||o.scope!==standardAccountScope(data,o.accountRef)||o.kind!=='autofill'&&o.epoch!==standardEpoch(data,o.accountRef)||data.version!==2)return false;
 const app=standardApps(data,o.accountRef).find(a=>a.id===o.appRef),vault=standardVaults(data,o.accountRef).find(v=>v.id===o.vaultRef);
 if(!app||!vault||o.deviceRef!==app.deviceRef||!o.appSignature||o.appSignature!==standardAppSignature(app)||recordedUnavailable(data,[o.accountRef,app.id,vault.id,o.subjectRef]))return false;
 return ![o.accountRef,app.deviceRef,app.id,vault.id,o.subjectRef].some(ref=>{const reset=ref?data.securityModel.lifecycle[ref]?.accessResetAt:undefined;return !!reset&&Date.parse(o.checkedAt)<=Date.parse(reset);});
}
export function standardObservationCurrent(data:Dataset,ref:string,kind:StandardStore['observations'][number]['kind'],subjectRef?:string,attempt?:string){
 const selected=selectedStandardContext(data,ref),scope=standardAccountScope(data,ref);if(!selected||!scope||recordedUnavailable(data,[ref,selected.vault.id,selected.app.id]))return false;
 return !!standardStore(data)?.observations.some(o=>standardObservationValid(data,o.id)&&o.kind===kind&&o.accountRef===ref&&o.vaultRef===selected.vault.id&&o.appRef===selected.app.id&&o.scope===scope&&o.subjectRef===subjectRef&&(attempt===undefined||o.attempt===attempt));
}
export function selectStandardPair(data:Dataset,ref:string,vaultRef:string,appRef:string):Dataset{
 const next=writable(data),vault=standardVaults(next,ref).find(v=>v.id===vaultRef),app=standardApps(next,ref).find(a=>a.id===appRef);if(!vault||!app)throw Error('invalid-standard-context');
 const store=standardStore(next)!;return {...next,securityModel:{...next.securityModel,standardManagersV1:{...store,selections:{...store.selections,[ref]:{vaultRef,appRef}}}}};
}
export function standardContextReady(data:Dataset,ref:string,client?:'web'|'app'|'extension',write=false){const selected=selectedStandardContext(data,ref),a=data.assets.find(a=>a.id===ref),os=data.assets.find(d=>d.id===selected?.app.deviceRef)?.operatingSystem;const osKnown=!selected||a?.provider!=='1password'||standardAppSchema.parse(selected.app.standardAppV1).client!=='app'||['ios','android','macos','windows','ubuntu'].includes(os??'');return osKnown&&!!selected&&(!client||standardAppSchema.parse(selected.app.standardAppV1).client===client)&&(!write||standardVaultSchema.parse(selected.vault.standardVaultV1).ownership==='private')&&standardObservationCurrent(data,ref,'opened')&&standardObservationCurrent(data,ref,'autofill');}
export function standardContextCheck(data:Dataset,ref:string,client:'web'|'app'|'extension'='web'){
 const parsed=standardChecksSchema.safeParse(data.guide.standardContextChecksV1);
 const pending=parsed.success?[...parsed.data.checks].reverse().find(c=>c.accountRef===ref&&(c.returnCursor===data.guide.cursor||data.guide.cursor===`standard-context/${ref}`)):undefined;
 if(pending)return pending;
 const selected=selectedStandardContext(data,ref),write=data.guide.cursor.split('/')[2]==='password';
 const reuse=selected&&standardAppSchema.parse(selected.app.standardAppV1).client===client&&(!write||standardVaultSchema.parse(selected.vault.standardVaultV1).ownership==='private');
 const osNeeded=reuse&&data.assets.find(a=>a.id===ref)?.provider==='1password'&&client==='app'&&!['ios','android','macos','windows','ubuntu'].includes(data.assets.find(a=>a.id===selected.app.deviceRef)?.operatingSystem??'');
 return {version:1 as const,accountRef:ref,returnCursor:data.guide.cursor,stage:osNeeded?'client' as const:reuse?(standardObservationCurrent(data,ref,'opened')?'autofill' as const:'open' as const):'vault' as const,client,...(reuse?{vaultRef:selected.vault.id,appRef:selected.app.id,deviceRef:selected.app.deviceRef}:{})};
}
export function updateStandardCheck(data:Dataset,ref:string,patch:Partial<ReturnType<typeof standardContextCheck>>,client:'web'|'app'|'extension'='web'):Dataset{
 const next=writable(data),a=next.assets.find(a=>a.id===ref);if(!isStandardManager(a))throw Error('invalid-standard-account');
 const check=standardCheckSchema.parse({...standardContextCheck(next,ref,client),...patch});
 const parsed=standardChecksSchema.safeParse(next.guide.standardContextChecksV1),store=parsed.success?parsed.data:{version:1 as const,checks:[]};
 return {...next,guide:{...next.guide,standardContextChecksV1:{...store,checks:[...store.checks.filter(c=>c.accountRef!==ref||c.returnCursor!==check.returnCursor),check]}}};
}
export function addStandardVault(data:Dataset,ref:string,label:string,ownership:'private'|'shared'|'managed'|'unknown'):Dataset{
 const next=writable(data),a=next.assets.find(a=>a.id===ref);if(!isStandardManager(a))throw Error('invalid-standard-account');
 const vault=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'vault',label:label.trim(),createdAt:new Date().toISOString(),productId:a.provider,authenticationAccountRef:ref,storageMode:'account',standardVaultV1:standardVaultSchema.parse({version:1,ownership})});
 return selectStandardVault({...next,securityModel:{...next.securityModel,entities:[...next.securityModel.entities,vault]}},ref,vault.id);
}
export function selectStandardVault(data:Dataset,ref:string,vaultRef:string):Dataset{if(!standardVaults(data,ref).some(v=>v.id===vaultRef))throw Error('invalid-standard-vault');return updateStandardCheck(data,ref,{vaultRef,stage:'device'});}
export function selectStandardDevice(data:Dataset,ref:string,deviceRef:string):Dataset{if(data.guide.answers['standard-phone:device']&&deviceRef!==data.guide.answers['standard-phone:device'])throw Error('wrong-standard-phone-device');if(!data.assets.some(a=>a.id===deviceRef&&a.kind==='device'))throw Error('invalid-standard-device');return updateStandardCheck(data,ref,{deviceRef,stage:'client'});}
export function addStandardApp(data:Dataset,ref:string,client:'web'|'app'|'extension',profile:string):Dataset{
 const next=writable(data),a=next.assets.find(a=>a.id===ref),check=standardContextCheck(next,ref);if(!isStandardManager(a)||!check.deviceRef)throw Error('invalid-standard-device');
 const device=next.assets.find(a=>a.id===check.deviceRef&&a.kind==='device');if(!device)throw Error('invalid-standard-device');
 const details=standardAppSchema.parse({version:1,client,...(profile.trim()?{profile:profile.trim()}:{})});
 const app=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'installation',label:`${a.provider==='bitwarden'?'Bitwarden':'1Password'} · ${device.name} · ${standardClientLabel(client,data.settings.language)}${profile.trim()?` · ${profile.trim()}`:''}`.slice(0,80),createdAt:new Date().toISOString(),productId:a.provider,deviceRef:device.id,profileLabel:details.profile,standardAppV1:details});
 return selectStandardApp({...next,securityModel:{...next.securityModel,entities:[...next.securityModel.entities,app]}},ref,app.id);
}
export function selectStandardApp(data:Dataset,ref:string,appRef:string):Dataset{
 const next=writable(data),check=standardContextCheck(next,ref),app=standardApps(next,ref).find(a=>a.id===appRef),vault=standardVaults(next,ref).find(v=>v.id===check.vaultRef);if(!app||!vault||app.deviceRef!==check.deviceRef)throw Error('invalid-standard-context');
 const store=standardStore(next)!;
 return updateStandardCheck({...next,securityModel:{...next.securityModel,standardManagersV1:{...store,selections:{...store.selections,[ref]:{vaultRef:vault.id,appRef:app.id}}}}},ref,{appRef,stage:'open'});
}
export function recordStandardObservation(data:Dataset,ref:string,kind:StandardStore['observations'][number]['kind'],options:{subjectRef?:string;attempt?:string;sourceKey?:string;sourceIds?:string[]}={}):Dataset{
 const next=writable(data),context=selectedStandardContext(next,ref),scope=standardAccountScope(next,ref);if(!context||!scope||recordedUnavailable(next,[ref,context.vault.id,context.app.id]))throw Error('unavailable-standard-context');
 const now=new Date().toISOString(),store=standardStore(next)!,old=store.observations.find(o=>o.sourceKey&&o.sourceKey===options.sourceKey&&o.kind===kind&&o.accountRef===ref&&o.vaultRef===context.vault.id&&o.appRef===context.app.id&&o.scope===scope&&o.epoch===standardEpoch(next,ref)&&o.appSignature===standardAppSignature(context.app)&&o.subjectRef===options.subjectRef&&o.attempt===options.attempt),id=old?.id??crypto.randomUUID();
 const observation={...old,id,accountRef:ref,vaultRef:context.vault.id,appRef:context.app.id,deviceRef:context.app.deviceRef,appSignature:standardAppSignature(context.app),scope,epoch:standardEpoch(next,ref),kind,...options,checkedAt:now,active:true};
 const model=next.securityModel,refs=[ref,context.vault.id,context.app.id,context.app.deviceRef,...(options.subjectRef?[options.subjectRef]:[])];
 const sourceIds=options.sourceIds??[next.assets.find(a=>a.id===ref)?.provider==='bitwarden'?'bwUse':onePasswordAccount(next,ref)?.method==='sso'?'opSsoLinked':onePasswordAccount(next,ref)?.method==='passkey-beta'?'opPasskeyBeta':'opSignin'];
 const fact={...model.facts.find(f=>f.id===`standard:${id}`),id:`standard:${id}`,label:kind==='password-use'?'Used this saved password':kind==='opened'?'Opened this account and vault here':kind==='autofill'?'Checked this app’s password filling':kind==='master-use'?'Used the current account password here':kind==='sso-link'?'Linked this app to this account':'Checked this account’s recovery',state:'available' as const,evidence:'user-confirmed' as const,checkedAt:now,requiredRefs:refs,contexts:['normal' as const],sourceIds,dependencyCompleteness:'partial' as const,standardObservationV1:id};
 const route={...model.routes.find(r=>r.id===`standard:${id}:route`),id:`standard:${id}:route`,label:fact.label,targetRef:options.subjectRef??context.vault.id,purpose:kind==='password-use'?'sign-in' as const:'decrypt' as const,contexts:['normal' as const],requirements:{kind:'fact' as const,factId:fact.id},sourceIds,standardObservationV1:id};
 const routes=['opened','master-use','password-use'].includes(kind)?[route]:[];
 const relations=kind==='opened'?[{id:`standard:${id}:device`,fromRef:context.app.id,toRef:context.app.deviceRef,kind:'installed-on' as const},{id:`standard:${id}:vault`,fromRef:context.app.id,toRef:context.vault.id,kind:'unlocks' as const},{id:`standard:${id}:account`,fromRef:context.vault.id,toRef:ref,kind:'synced-via' as const}].map(r=>({...model.relations.find(old=>old.id===r.id),...r,evidence:'user-confirmed' as const,checkedAt:now,sourceIds,standardObservationV1:id})):[];
 return {...next,securityModel:{...model,standardManagersV1:{...store,observations:[...store.observations.filter(o=>o.id!==id),observation]},facts:[...model.facts.filter(f=>f.id!==fact.id),fact],routes:[...model.routes.filter(r=>r.id!==route.id),...routes],relations:[...model.relations.filter(r=>!relations.some(n=>n.id===r.id)),...relations]}};
}
export function confirmStandardContext(data:Dataset,ref:string):Dataset{
 const check=standardContextCheck(data,ref);if(check.stage==='open'){const opened=recordStandardObservation(data,ref,'opened');return standardObservationCurrent(opened,ref,'autofill')?finishStandardSelection(opened,ref):updateStandardCheck(opened,ref,{stage:'autofill'});}
 if(check.stage!=='autofill'||!standardObservationCurrent(data,ref,'opened'))return data;
 const next=recordStandardObservation(data,ref,'autofill');
 const parsed=standardChecksSchema.parse(next.guide.standardContextChecksV1);
 return {...next,guide:{...next.guide,cursor:check.returnCursor,standardContextChecksV1:{...parsed,checks:parsed.checks.filter(c=>c.accountRef!==ref||c.returnCursor!==check.returnCursor)}}};
}
export function finishStandardSelection(data:Dataset,ref:string):Dataset{
 const check=standardContextCheck(data,ref),parsed=standardChecksSchema.parse(data.guide.standardContextChecksV1);
 return {...data,guide:{...data.guide,cursor:check.returnCursor,standardContextChecksV1:{...parsed,checks:parsed.checks.filter(c=>c.accountRef!==ref||c.returnCursor!==check.returnCursor)}}};
}
export function undoStandardObservations(data:Dataset,sourceKey:string):Dataset{
 if(data.version!==2)return data;const store=standardStore(data);if(!store)return data;const ids=new Set(store.observations.filter(o=>o.sourceKey===sourceKey).map(o=>o.id));
 return {...data,securityModel:{...data.securityModel,standardManagersV1:{...store,observations:store.observations.map(o=>ids.has(o.id)?{...o,active:false}:o)},facts:data.securityModel.facts.map(f=>ids.has(String(f.standardObservationV1))?{...f,state:'unknown',evidence:'unknown'}:f)}};
}
