import {describe,it,expect} from 'vitest';
import {newDataset,makeAsset,currentDatasetSchema,DataUpgradeConflict,type CurrentDataset} from './models';
import {startPhoneWorkflow} from './phoneEngine';
import {startPhoneProducts,addPhoneProduct,reviewPhoneProducts} from './lineData';
import {lineTask,lineStore,lineRecorded,lineMoveReady,phoneProductsReady,lineFactCurrent} from './lineSchemas';
import {lineAccessProfile,lineAccessStore,lineKeyOperation} from './lineAccessSchemas';
import {startLineAccess,resumeLineKeyResult,restartLineKeyPreparation} from './lineAccessData';
import {currentLineStep,lineSteps} from './lineCatalog';
import {answerLine,confirmLine,jumpLine,undoLineReceipt,lineStepMissing,lineHelpPrompt} from './lineEngine';
import {createEncryptedVault,decryptVault} from './crypto';
import {lineMapStatus} from './lineViews';
import {mapConnections,mapAffectedItems} from './securityMapViews';
import {evaluateAccess} from './securityModel';
import {startProtectionGuide} from './deviceProtection';
import {removeEntry} from './removeEntry';

function fixture(os:'ios'|'android'='ios',destination:'ios'|'android'=os){
  let data=newDataset('ja');data.assets=['old','fresh'].map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'以前のスマホ':'新しいスマホ',operatingSystem:id==='old'?os:destination,importance:'critical'}),id}));
  data.guide={...data.guide,cursor:'manager-select',history:['start'],answers:{private:'keep my main guide'},steps:{untouched:{status:'done',updatedAt:new Date().toISOString()}}};
  data=startPhoneWorkflow(data,'/guide','old','phone');Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',answers:{stage:'using',availability:'available',ownership:'personal',setup:'ready',authenticator:'none','special-apps':'yes','phone-line':'no-line','old-fate':'sell'}});
  const i=startPhoneProducts(data,'phone');data=addPhoneProduct(i.data,i.id,'line');data=reviewPhoneProducts(data,i.id) as CurrentDataset;return {data,id:lineStore(data)!.tasks[0].id};
}
function drive(data:CurrentDataset,id:string,answers:Record<string,string>={},until?:string){
  for(let count=0;count<280;count++){
    const t=lineTask(data,id)!,s=currentLineStep(data,t);if(s.id===until||['finished','prepared','blocked'].includes(s.kind))return data;
    const defaults:Record<string,string>={account:'add','destination-state':'login','new-version':'current','source-state':'usable',version:'current','access2:mail-state':'available','access2:mail-account':'add','access2:mail-provider':'google','access2:mail-editable':'yes','access2:mail-verification':'code','access2:method':'passkey','access2:key-version':'supported','access2:store':data.assets.find(a=>a.id===t.oldDeviceRef)?.operatingSystem==='ios'?'apple':'google','access2:key-root':'add','access2:key-state':'existing','access2:key-record':'add','access2:key-result':'registered','password-access':'known',history:'recent','premium-state':'using','pin-state':'ready','key-move:pin-state':'ready','transfer-method':'passkey','key-login:result':'passkey','destination-match':'yes','cutover-result':'home','number-changed':'no'};
    const value=answers[s.id]??(['source-app','previous-app'].includes(s.id)?s.choices![0].value:s.id==='backup-account'?data.assets.find(a=>a.id===t.oldDeviceRef)?.operatingSystem==='ios'?'add:apple':'add:google':s.id.startsWith('restore-screen:')?'home':defaults[s.id]);
    const next=(s.kind==='question'?answerLine(data,id,value):confirmLine(data,id)) as CurrentDataset;
    if(next===data)throw Error(`No progress at ${s.id}; missing ${lineStepMissing(data,t,s).map(s=>s.id)}; choice ${value}`);
    const valid=currentDatasetSchema.safeParse(next);if(!valid.success)throw Error(s.id+' '+JSON.stringify(valid.error.issues));data=next;
  }throw Error('LINE access did not finish');
}

describe('LINE registered email and passkey access',()=>{
  it.each(['ios','android'] as const)('uses an existing %s passkey for the actual new-phone login without requiring a LINE password',os=>{
    const f=fixture(os),main=structuredClone(f.data.guide),d=drive(f.data,f.id),t=lineTask(d,f.id)!,p=lineAccessProfile(d,f.id)!;
    expect(lineMoveReady(d,t)).toBe(true);expect(phoneProductsReady(d,'phone')).toBe(true);expect(d.guide).toEqual(main);expect(d.securityModel.revision).toBe(14);
    expect(t.answers['password-access']).toBeUndefined();expect(t.records['qr-scan']).toBeUndefined();expect(t.records['key-login:result']).toBeTruthy();expect(t.records['key-move:pin-keep']).toBeTruthy();expect(lineAccessStore(d)!.operations).toHaveLength(0);
    const fact=d.securityModel.facts.find(f=>f.linePasskeyUseV1===p.keyRef)!;expect(fact).toBeTruthy();expect(fact.requiredRefs).toEqual(expect.arrayContaining([p.keyRef,p.storeRef,p.rootRef,p.newStoreAppRef,'fresh']));expect(fact.requiredRefs).not.toContain('old');
    const route=d.securityModel.routes.find(r=>r.targetRef===t.accountRef)!;expect(evaluateAccess(d.securityModel,route.id,{context:'new-device',unavailableRefs:['old'],now:new Date().toISOString()}).state).toBe('available');
    expect(evaluateAccess(d.securityModel,route.id,{context:'new-device',unavailableRefs:[p.rootRef!],now:new Date().toISOString()}).state).not.toBe('available');
    expect(mapConnections(d).some(r=>r.assetId===t.accountRef&&r.recoveryAssetId===p.keyRef)).toBe(true);expect(mapAffectedItems(d,'old','ja').some(r=>r.id===t.accountRef)).toBe(false);
    expect(d.securityModel.lifecycle[t.sourceSessionRef!].state).toBe('revoked');expect(d.securityModel.lifecycle.old).toBeUndefined();expect(d.assets.find(a=>a.id===t.accountRef)!.controls.mfa).toBe('unknown');
  });
  it.each(['ios','android'] as const)('creates a %s passkey with a saved request and a distinct actual registration',os=>{
    const f=fixture(os);let d=drive(f.data,f.id,{'access2:key-state':'create'},'access2:key-request');expect(lineAccessProfile(d,f.id)!.keyRef).toBeUndefined();d=confirmLine(d,f.id) as CurrentDataset;
    const requested=lineKeyOperation(d,f.id)!;expect(requested.phase).toBe('requested');expect(d.securityModel.entities.some(e=>e.id===requested.candidateRef)).toBe(false);
    d=drive(d,f.id,{'access2:key-state':'create'});const p=lineAccessProfile(d,f.id)!;expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineKeyOperation(d,f.id)!.phase).toBe('registered');expect(p.keyRef).toBe(requested.candidateRef);expect(lineAccessStore(d)!.operations).toHaveLength(1);
    expect(d.securityModel.entities.filter(e=>e.id===p.keyRef)).toHaveLength(1);
  });
  it.each(['code','link'] as const)('registers the actual mailbox using the native %s confirmation before creating a key',method=>{
    const f=fixture();const d=drive(f.data,f.id,{'access2:mail-state':'new','access2:mail-verification':method,'access2:key-state':'create'}),t=lineTask(d,f.id)!;
    expect(lineMoveReady(d,t)).toBe(true);expect(t.records['access2:mail-enter']).toBeTruthy();expect(t.records['access2:mail-verify']).toBeTruthy();expect(t.recoveryMailRef).toBeTruthy();
    expect(mapConnections(d).some(r=>r.assetId===t.accountRef&&r.recoveryAssetId===t.recoveryMailRef&&r.relation==='recovers')).toBe(true);
  });
  it('keeps an actual email change and its24-hour restriction separate from inferred transfer times',()=>{
    const f=fixture();let d=drive(f.data,f.id,{'access2:mail-state':'change','access2:mail-editable':'waiting'});expect(currentLineStep(d,lineTask(d,f.id)!).id).toBe('access2:mail-wait');expect(lineTask(d,f.id)!.cutover).toBeUndefined();expect(lineKeyOperation(d,f.id)).toBeUndefined();
    d=answerLine(jumpLine(d,f.id,'access2:mail-editable'),f.id,'yes') as CurrentDataset;d=drive(d,f.id);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineTask(d,f.id)!.records['access2:mail-change']).toBeTruthy();
  });
  it('resumes a creation result from encrypted storage without replaying native creation or inventing an accepted key',async()=>{
    const f=fixture();let d=drive(f.data,f.id,{'access2:key-state':'create'},'access2:key-request');d=confirmLine(d,f.id) as CurrentDataset;const op=lineKeyOperation(d,f.id)!;
    const saved=await createEncryptedVault('fixture app storage phrase for new LINE access',d);d=(await decryptVault(saved.envelope,'fixture app storage phrase for new LINE access')).data as CurrentDataset;
    d=resumeLineKeyResult(d,f.id,true) as CurrentDataset;d=answerLine(d,f.id,'unknown') as CurrentDataset;expect(currentLineStep(d,lineTask(d,f.id)!).id).toBe('access2:key-uncertain');expect(lineKeyOperation(d,f.id)!.id).toBe(op.id);expect(lineAccessProfile(d,f.id)!.keyRef).toBeUndefined();
    const blocked=jumpLine(d,f.id,'access2:method');expect(answerLine(blocked,f.id,'password')).toBe(blocked);
    d=answerLine(jumpLine(d,f.id,'access2:key-result'),f.id,'registered') as CurrentDataset;d=drive(d,f.id);expect(lineKeyOperation(d,f.id)!.id).toBe(op.id);expect(lineAccessProfile(d,f.id)!.keyRef).toBe(op.candidateRef);expect(lineAccessStore(d)!.operations).toHaveLength(1);
  });
  it('starts a new creation attempt only after an explicit confirmed cancellation and retry',()=>{
    const f=fixture();let d=drive(f.data,f.id,{'access2:key-state':'create','access2:key-result':'cancelled'});const op=lineKeyOperation(d,f.id)!;expect(op.phase).toBe('cancelled');expect(lineAccessProfile(d,f.id)!.keyRef).toBeUndefined();
    d=restartLineKeyPreparation(d,f.id) as CurrentDataset;d=drive(d,f.id,{'access2:key-state':'create'});expect(lineAccessStore(d)!.operations).toHaveLength(2);expect(lineKeyOperation(d,f.id)!.candidateRef).not.toBe(op.candidateRef);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);
  });
  it('retains the real registration after correcting its observation and never creates a second native key',()=>{
    const f=fixture();let d=drive(f.data,f.id,{'access2:key-state':'create'}),t=lineTask(d,f.id)!,p=lineAccessProfile(d,f.id)!,operation=structuredClone(lineKeyOperation(d,f.id));
    d=undoLineReceipt(d,f.id,t.records['access2:key-check']) as CurrentDataset;expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);expect(lineKeyOperation(d,f.id)).toEqual(operation);expect(d.securityModel.entities.some(e=>e.id===p.keyRef)).toBe(true);
    d=drive(d,f.id,{'access2:key-state':'create'});expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineAccessStore(d)!.operations).toHaveLength(1);expect(lineAccessProfile(d,f.id)!.keyRef).toBe(p.keyRef);
  });
  it('records a prepared key separately when the actual phone transfer uses QR',()=>{
    const f=fixture(),d=drive(f.data,f.id,{'transfer-method':'qr'}),t=lineTask(d,f.id)!;expect(lineMoveReady(d,t)).toBe(true);expect(t.records['qr-scan']).toBeTruthy();expect(t.records['key-login:result']).toBeUndefined();expect(d.securityModel.facts.some(f=>f.linePasskeyUseV1)).toBe(false);expect(lineMapStatus(d,lineAccessProfile(d,f.id)!.keyRef!,'ja')!.label).toContain('ログイン未確認');
  });
  it('does not attribute an actual fallback login to the prepared passkey',()=>{
    const f=fixture(),d=drive(f.data,f.id,{'key-login:result':'other'});expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(d.securityModel.facts.some(f=>f.linePasskeyUseV1)).toBe(false);
  });
  it('withdraws passkey-use evidence when the actual login method is corrected, while keeping the physical switch',()=>{
    const f=fixture();let d=drive(f.data,f.id),t=lineTask(d,f.id)!,old=structuredClone(d.securityModel.lifecycle[t.sourceSessionRef!]),fact=d.securityModel.facts.find(f=>f.linePasskeyUseV1)!;
    expect(lineFactCurrent(d.securityModel,fact)).toBe(true);
    d=answerLine(jumpLine(d,f.id,'key-login:result'),f.id,'other') as CurrentDataset;
    expect(lineFactCurrent(d.securityModel,fact)).toBe(false);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);expect(d.securityModel.lifecycle[t.sourceSessionRef!]).toEqual(old);
    d=drive(d,f.id,{'key-login:result':'other'});expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(d.securityModel.facts.filter(f=>f.linePasskeyUseV1&&lineFactCurrent(d.securityModel,f))).toHaveLength(0);
  });
  it('binds actual passkey use to the original key and store, independently of later preparation preferences',()=>{
    const f=fixture(),d=drive(f.data,f.id),t=lineTask(d,f.id)!,p=lineAccessProfile(d,f.id)!,fact=d.securityModel.facts.find(f=>f.linePasskeyUseV1)!;
    const altered=structuredClone(d);const entity=altered.securityModel.entities.find(e=>e.id===p.keyRef)!;altered.securityModel.entities.push({...entity,id:'different-key'});
    altered.securityModel.lineAccessV1={...lineAccessStore(altered),profiles:[{...p,keyRef:'different-key'}]};
    expect(currentDatasetSchema.safeParse(altered).success).toBe(true);expect(lineFactCurrent(altered.securityModel,fact)).toBe(true);expect(fact.linePasskeyUseV1).toBe(t.cutover!.passkeyBinding!.keyRef);expect(fact.requiredRefs).not.toContain('different-key');
  });
  it('saves the cutover before any native passkey login and can resume straight from the actual result',()=>{
    const f=fixture();let d=drive(f.data,f.id,{},'transfer-ready');expect(d.securityModel.facts).toHaveLength(0);d=confirmLine(d,f.id) as CurrentDataset;const t=lineTask(d,f.id)!;expect(t.cutover?.phase).toBe('requested');expect(t.cutover?.passkeyBinding?.keyRef).toBe(lineAccessProfile(d,f.id)!.keyRef);
    d=resumeLineKeyResult(d,f.id,false) as CurrentDataset;d=answerLine(d,f.id,'passkey') as CurrentDataset;d=drive(d,f.id);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineTask(d,f.id)!.records['key-login:open']).toBeUndefined();expect(d.securityModel.facts.some(f=>f.linePasskeyUseV1)).toBe(true);
  });
  it('keeps unsupported storage, PRF, cross-OS copy, email errors and uncertain login unfinished',()=>{
    const cases:Record<string,string>[]=[{'access2:store':'other'},{'access2:key-version':'unsupported'},{'access2:mail-state':'unknown'},{'access2:mail-state':'new','access2:mail-verification':'other'},{'key-login:result':'unknown'}];
    for(const answers of cases){const f=fixture(),d=drive(f.data,f.id,answers);expect(currentLineStep(d,lineTask(d,f.id)!).kind).toBe('blocked');expect(phoneProductsReady(d,'phone')).toBe(false);}
    const f=fixture('ios','android'),d=drive(f.data,f.id);expect(currentLineStep(d,lineTask(d,f.id)!).id).toBe('access2:key-copy-needed');expect(lineTask(d,f.id)!.cutover).toBeUndefined();
  });
  it('rechecks current store availability after reset without reviving the old main session',()=>{
    const f=fixture();let d=drive(f.data,f.id);const t=lineTask(d,f.id)!,p=lineAccessProfile(d,f.id)!,old=structuredClone(d.securityModel.lifecycle[t.sourceSessionRef!]),at=new Date().toISOString();d.securityModel.lifecycle[p.rootRef!]={state:'in-use',evidence:'user-confirmed',updatedAt:at,accessResetAt:at};
    expect(lineMoveReady(d,t)).toBe(false);expect(lineRecorded(d,t,'future-access')).toBe(false);d=jumpLine(d,f.id,'future-access') as CurrentDataset;
    const step=currentLineStep(d,lineTask(d,f.id)!);expect(lineStepMissing(d,lineTask(d,f.id)!,step).length).toBeGreaterThan(0);
    d=drive(jumpLine(d,f.id,'access2:home') as CurrentDataset,f.id);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(d.securityModel.lifecycle[t.sourceSessionRef!]).toEqual(old);
  });
  it('keeps the old completed13 recipe unchanged and opts into the new preparation only explicitly',()=>{
    const f=fixture();const {lineAccessV1:ignored,...model}=f.data.securityModel;void ignored;let d:CurrentDataset={...f.data,securityModel:{...model,revision:13 as const}};expect(lineSteps(d,lineTask(d,f.id)!).some(s=>s.id.startsWith('access2:'))).toBe(false);
    d=drive(d,f.id,{'access2:method':'password','recovery-email':'available','recovery-mail':'add','recovery-provider':'google','password-access':'known'});const before=structuredClone(d);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);
    expect(startProtectionGuide(d,'fresh').data.securityModel.revision).toBe(13);expect(lineStore(d)).toEqual(lineStore(before));
    const upgraded=startLineAccess(d,f.id);expect(upgraded.securityModel.revision).toBe(14);expect(upgraded.guide).toEqual(before.guide);expect(lineTask(upgraded,f.id)!.records).toEqual(lineTask(before,f.id)!.records);
  });
  it('preserves reserved lower-model fields and refuses cross-account or cross-store passkey bindings',()=>{
    const f=fixture(),foreign=structuredClone(f.data);foreign.securityModel.revision=13;foreign.securityModel.lineAccessV1={opaque:'keep'};expect(()=>startLineAccess(foreign,f.id)).toThrow(DataUpgradeConflict);
    const d=drive(f.data,f.id),p=lineAccessProfile(d,f.id)!;expect(removeEntry(d,p.rootRef!)).toBeUndefined();const bad=structuredClone(d);bad.securityModel.lineAccessV1={...lineAccessStore(bad),profiles:[{...p,rootRef:lineTask(bad,f.id)!.accountRef}]};expect(currentDatasetSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects a source-store app reused as the new phone app and the reverse',()=>{
    const f=fixture(),d=drive(f.data,f.id),p=lineAccessProfile(d,f.id)!;
    for(const changed of [{newStoreAppRef:p.sourceStoreAppRef},{sourceStoreAppRef:p.newStoreAppRef}]){
      const invalid=structuredClone(d);invalid.securityModel.lineAccessV1={...lineAccessStore(invalid),profiles:[{...p,...changed}]};expect(currentDatasetSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it('never offers a registered physical creation as a confirmed no-key cancellation',()=>{
    const f=fixture();let d=drive(f.data,f.id,{'access2:key-state':'create'},'transfer-ready'),t=lineTask(d,f.id)!;
    d=undoLineReceipt(d,f.id,t.records['access2:key-result']) as CurrentDataset;
    d=jumpLine(d,f.id,'access2:key-result') as CurrentDataset;t=lineTask(d,f.id)!;expect(lineKeyOperation(d,f.id)!.phase).toBe('registered');
    expect(currentLineStep(d,t).choices?.some(c=>c.value==='cancelled')).toBe(false);expect(answerLine(d,f.id,'cancelled')).toBe(d);expect(lineAccessStore(d)!.operations).toHaveLength(1);
  });
  it('never copies email addresses, device labels, raw answers, QR data or secrets into AI help',()=>{
    const f=fixture();f.data.assets[0].name='PRIVATE PHONE';let d=drive(f.data,f.id,{'access2:key-state':'create'},'access2:key-native');const t=lineTask(d,f.id)!;t.answers.secret='PRIVATE PASSWORD';d.securityModel.linePhoneV1={...lineStore(d),tasks:[t]};
    const prompt=lineHelpPrompt(d,f.id,0,'ja');expect(prompt).not.toContain('PRIVATE');expect(prompt).toContain('LINE');expect(prompt).toContain('https://help.line.me/');expect(prompt).toContain('一度に一つ');
  });
});
