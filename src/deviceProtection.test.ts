import {describe,it,expect} from 'vitest';
import {currentDatasetSchema,DataUpgradeConflict,guideSchema,makeAsset,newDataset,type CurrentDataset,type Dataset} from './models';
import {answerProtectionGuide,beginProtectionAccountGuide,confirmProtectionGuide,confirmProtectionResources,currentProtectionStep,navigateProtectionGuide,saveProtectionAccountGuide,startProtectionGuide,undoProtectionGuide} from './deviceProtection';
import {protectionSettingKey,protectionStore,protectionTasks} from './deviceProtectionSchemas';
import {protectionRecordCurrent,protectionBindingCurrent} from './deviceProtectionEvidence';
import {protectionRefValue} from './deviceProtectionCatalog';
import {evaluateAccess} from './securityModel';
import {answerKeyGuide,confirmKeyGuide,currentKeyStep,keyReturnPath,returnFromKeyGuide,startKeyGuide} from './hardwareKeys';
import {keyTasks} from './hardwareKeySchemas';
import {recordProtectionDisposal,undoProtectionDisposal} from './deviceProtection';
import {protectionMapStatus} from './deviceProtectionViews';
const at='2026-11-14T01:00:00Z';
function fixture(os:'ios'|'android'='ios'){
  const d=newDataset('ja');d.assets=[{...makeAsset({kind:'device',type:'Smartphone',name:'本人のスマホ',operatingSystem:os,importance:'critical'}),id:'phone'},{...makeAsset({kind:'account',type:'Account',name:'本人用',importance:'critical'}),id:'account',provider:os==='ios'?'apple':'google',purpose:'personal'},{...makeAsset({kind:'device',type:'Computer',name:'別のPC',operatingSystem:'windows',importance:'important'}),id:'pc'}];
  d.guide={...d.guide,cursor:'private/main/position',answers:{private:'keep'},history:['earlier'],unknownField:{deep:true}};d.opaque={legacy:true};
  const started=startProtectionGuide(d,'phone','map',undefined,at);return {d:started.data,id:started.id,main:structuredClone(d.guide)};
}
const task=(d:Dataset,id:string)=>protectionTasks(d).find(t=>t.id===id)!;
function walk(d:CurrentDataset,id:string,answers:Record<string,string>,stop='finished'){
  for(let n=0;n<150;n++){
    const t=task(d,id),s=currentProtectionStep(d,t);if(s.id===stop||s.kind==='finished'||s.kind==='blocked')return d;
    const v=answers[s.id]??({available:'yes',form:d.assets[0].operatingSystem==='ios'?'iphone':'android-phone',ownership:'personal','android-maker':'pixel','android-profile':'owner',account:protectionRefValue('account'),'lock-state':'ready','apple-theft-choice':'later','android-theft-choice':'later','management-choice':'later','google-tabs':'yes'} as Record<string,string>)[s.id]??(s.kind==='check'?(s.choices?.some(o=>o.value==='on')?'on':s.choices?.[0]?.value??''):s.choices?.[0]?.value??'');
    const next=s.kind==='operation'?confirmProtectionGuide(d,id,at):s.kind==='multi'?confirmProtectionResources(d,id,[],at):answerProtectionGuide(d,id,v,at);
    expect(next,`Step ${s.id} did not advance`).not.toBe(d);d=next as CurrentDataset;expect(currentDatasetSchema.safeParse(d).success,`Invalid dataset after ${s.id}: ${currentDatasetSchema.safeParse(d).error?.message}`).toBe(true);
  }throw new Error('guide-loop');
}
describe('optional device protection guide',()=>{
  it('records Apple settings one action at a time without changing the main guide or claiming management use',()=>{
    const f=fixture(),d=walk(f.d,f.id,{});expect(currentProtectionStep(d,task(d,f.id)).kind).toBe('finished');expect(d.guide).toEqual(f.main);expect(d.opaque).toEqual({legacy:true});
    expect(protectionStore(d)?.settings[protectionSettingKey('phone','find-enabled')].value).toBe('on');expect(d.securityModel.relations).toHaveLength(0);expect(evaluateAccess(d.securityModel,d.securityModel.routes[0].id,{context:'normal',now:at}).state).toBe('unknown');
    expect(task(d,f.id).records['find-enabled'].requires).toContain('account-check');expect(task(d,f.id).records['management-check']).toBeUndefined();
    expect(task(d,f.id).history.filter(id=>id==='available')).toHaveLength(1);
    expect(protectionMapStatus(d,'phone','ja')).toMatchObject({tone:'unknown',label:'別端末からの管理は未確認'});
  });
  it('checks an already enabled Apple theft setting without forcing new biometrics or account changes',()=>{
    const f=fixture(),d=walk(f.d,f.id,{'apple-theft-choice':'check','biometric-menu':'face','stolen-device-protection-state':'on','stolen-delay':'always'});const t=task(d,f.id);
    expect(currentProtectionStep(d,t).kind).toBe('finished');expect(t.records['stolen-device-protection-state'].value).toBe('on');expect(t.records['biometric-check']).toBeUndefined();expect(t.childGuide).toBeUndefined();expect(d.assets[1].controls.mfa).toBe('unknown');
  });
  it('keeps an initial OFF observation historical after a genuinely completed setup turns protection ON',()=>{
    const f=fixture();f.d.assets[1].controls={mfa:'verified',recovery:'verified'};f.d.assets[1].controlEvidence={mfa:'user-confirmed',recovery:'user-confirmed'};
    const d=walk(f.d,f.id,{'apple-theft-choice':'check','biometric-menu':'touch','stolen-device-protection-state':'setup','biometric-setup':'existing','stolen-delay':'always'}),t=task(d,f.id);
    expect(currentProtectionStep(d,t).kind).toBe('finished');expect(t.records['stolen-device-protection-state'].value).toBe('off');expect(t.records['stolen-device-protection'].value).toBe('on');expect(protectionStore(d)?.settings[protectionSettingKey('phone','stolen-device-protection')].generation).toBe(2);
    expect(protectionRecordCurrent(d.securityModel,t,'stolen-delay')).toBe(true);
  });
  it('keeps unavailable theft features distinct and does not request Remote Lock without an active line',()=>{
    const f=fixture('android'),d=walk(f.d,f.id,{'android-theft-choice':'check','theft-detection':'unsupported','offline-lock':'on','failed-auth-lock':'unsupported','remote-sim':'no','identity-available':'no'}),t=task(d,f.id);
    expect(currentProtectionStep(d,t).kind).toBe('finished');expect(t.records['theft-detection'].value).toBe('unsupported');expect(t.records['remote-lock']).toBeUndefined();expect(protectionStore(d)?.settings[protectionSettingKey('phone','offline-lock')].value).toBe('on');
  });
  it('uses a separate actual browser and session for a scoped phone-free management observation',()=>{
    const f=fixture(),d=walk(f.d,f.id,{'management-choice':'check','management-device':protectionRefValue('pc'),'management-browser':'new','management-browser-product':'chrome','management-browser-label':'今回の本人用プロフィール','management-context':'no-existing-session','management-target':'selected','management-phone-use':'without'}),t=task(d,f.id);
    expect(currentProtectionStep(d,t).kind).toBe('finished');expect(t.sessionRef).toBeTruthy();expect(t.records['management-check'].refs).toContain(t.sessionRef);expect(t.records['management-check'].refs).not.toContain('phone');expect(d.securityModel.relations.every(r=>protectionBindingCurrent(d.securityModel,r))).toBe(true);
    const route=d.securityModel.routes[0];expect(evaluateAccess(d.securityModel,route.id,{now:at,context:'no-existing-session',unavailableRefs:['phone']}).state).toBe('available');expect(evaluateAccess(d.securityModel,route.id,{now:at,context:'normal'}).state).toBe('not-applicable');
    const undo=undoProtectionGuide(d,f.id,'find-enabled',at) as CurrentDataset;expect(evaluateAccess(undo.securityModel,route.id,{now:at,context:'no-existing-session',unavailableRefs:['phone']}).state).toBe('unknown');expect(d.guide).toEqual(f.main);
  });
  it('does not accept a phone-free claim when selected actual resources include the target phone',()=>{
    const f=fixture();let d=walk(f.d,f.id,{'management-choice':'check','management-device':protectionRefValue('pc'),'management-browser':'new','management-browser-product':'chrome','management-browser-label':'本人用','management-context':'normal','management-target':'selected'},'management-resources');
    d=confirmProtectionResources(d,f.id,['phone'],at) as CurrentDataset;d=answerProtectionGuide(d,f.id,'without',at) as CurrentDataset;expect(currentProtectionStep(d,task(d,f.id)).id).toBe('management-check');expect(confirmProtectionGuide(d,f.id,at)).toBe(d);
  });
  it('shares the same actual setting and keeps another valid confirmation until its last undo',()=>{
    const f=fixture(),first=walk(f.d,f.id,{}),second=startProtectionGuide(first,'phone','map',undefined,at,true),d=walk(second.data,second.id,{}),key=protectionSettingKey('phone','find-enabled');
    expect(protectionStore(d)?.settings[key].generation).toBe(1);
    const one=undoProtectionGuide(d,second.id,'find-enabled',at) as CurrentDataset;expect(protectionStore(one)?.settings[key].withdrawn).toBe(false);expect(protectionRecordCurrent(one.securityModel,task(one,f.id),'find-enabled')).toBe(true);
    const last=undoProtectionGuide(one,f.id,'find-enabled',at);expect(protectionStore(last)?.settings[key].withdrawn).toBe(true);expect(protectionStore(last)?.history.length).toBeGreaterThan(0);
  });
  it('keeps main-guide state during account prerequisites and saves child work separately',()=>{
    const f=fixture(),d=walk(f.d,f.id,{'apple-theft-choice':'check','biometric-menu':'face','stolen-device-protection-state':'setup'});expect(currentProtectionStep(d,task(d,f.id)).id).toBe('account-preparation');
    const child=beginProtectionAccountGuide(d,f.id);expect(child.guide).toEqual(f.main);expect(task(child,f.id).childGuide).toBeTruthy();const modified={...child,guide:{...child.guide,cursor:'child/next'}};
    const merged=saveProtectionAccountGuide(child,modified,f.id);expect(merged.guide).toEqual(f.main);expect(task(merged,f.id).childGuide).toMatchObject({cursor:'child/next'});
  });
  it('resumes the same task and preserves revision 1 opaque collisions without overwriting them',()=>{
    const f=fixture(),paused=navigateProtectionGuide(f.d,f.id,'defer'),resumed=startProtectionGuide(paused,'phone');expect(resumed.id).toBe(f.id);expect(resumed.data.guide).toEqual(f.main);
    const old=newDataset('ja');old.assets=f.d.assets;old.securityModel.deviceProtectionV1={opaque:'do not reinterpret'};expect(()=>startProtectionGuide(old,'phone')).toThrow(DataUpgradeConflict);expect(old.securityModel.revision).toBe(1);
  });
  it('returns from physical-key account preparation to the child guide while preserving every main-guide field',()=>{
    const f=fixture(),device=walk(f.d,f.id,{'apple-theft-choice':'check','biometric-menu':'face','stolen-device-protection-state':'setup'}),started=beginProtectionAccountGuide(device,f.id) as CurrentDataset;
    const t=task(started,f.id),child={...started,guide:guideSchema.parse(t.childGuide)};
    child.assets=[...child.assets,{...makeAsset({kind:'device',type:'Computer',name:'本人のMac',importance:'important',operatingSystem:'macos'}),id:'mac'}];child.securityModel={...child.securityModel,entities:[...child.securityModel.entities,{id:'key1',kind:'security-key',label:'本人のキー',transports:['usb-c'],createdAt:at},{id:'key2',kind:'security-key',label:'別の予備キー',transports:['usb-c'],createdAt:at}]};
    const key=startKeyGuide(child,'account','/map',at,false,t.id);expect(keyReturnPath(keyTasks(key.data).find(t=>t.id===key.id)!,key.data)).toBe(`/protect/account/${t.id}`);
    for(let n=0;n<100;n++){const k=keyTasks(key.data).find(t=>t.id===key.id)!,s=currentKeyStep(key.data,k);if(s.kind==='finished')break;const answers:Record<string,string>={mode:'apple-keys',scope:'personal',device:'mac','key-1':'key1','key-2':'key2','registration-1':'existing','registration-2':'existing'};key.data=(s.kind==='operation'?confirmKeyGuide(key.data,k.id,at):answerKeyGuide(key.data,k.id,answers[s.id]??s.choices?.[0]?.value??'本人用',at)) as CurrentDataset;expect(s.kind).not.toBe('blocked');}
    expect(keyTasks(key.data).find(t=>t.id===key.id)?.status).toBe('completed');
    const saved=saveProtectionAccountGuide(started,key.data,f.id) as CurrentDataset,returned=returnFromKeyGuide(saved,key.id);
    const retry=startKeyGuide(saved,'account','/map',at,true,t.id);expect(keyTasks(retry.data).find(k=>k.id===retry.id)?.originGuideCursor).toBe(child.guide.cursor);
    expect(returned.guide).toEqual(f.main);expect(task(returned,f.id).childGuide).not.toMatchObject({cursor:child.guide.cursor});expect(currentDatasetSchema.safeParse(returned).success).toBe(true);
  });
  it('invalidates older enabled theft settings after real sale preparation, and undo does not resurrect the old ON state',()=>{
    const f=fixture(),d=walk(f.d,f.id,{'apple-theft-choice':'check','biometric-menu':'face','stolen-device-protection-state':'on','stolen-delay':'always'}),before=task(d,f.id),key=protectionSettingKey('phone','stolen-device-protection');
    const off=recordProtectionDisposal(d,'phone','sale',at);expect(task(off,f.id).cursor).toBe(before.cursor);expect(off.guide).toEqual(f.main);expect(protectionStore(off)?.settings[key].value).toBe('off');expect(protectionRecordCurrent(off.securityModel,task(off,f.id),'stolen-delay')).toBe(false);
    const corrected=undoProtectionDisposal(off,'phone','sale',at);expect(protectionStore(corrected)?.settings[key].withdrawn).toBe(true);expect(protectionStore(corrected)?.settings[key].value).toBe('unknown');expect(currentDatasetSchema.safeParse(corrected).success).toBe(true);
  });
  it('does not reinterpret an opaque old key-return field or overwrite it during model upgrade',()=>{
    const d=newDataset('ja');d.assets=fixture().d.assets;const key=startKeyGuide(d,'account','/map',at),t=keyTasks(key.data)[0];t.deviceProtectionKeyReturnV1={version:1,taskRef:'opaque-old-meaning'};
    (key.data.securityModel.hardwareKeysV1 as {tasks:typeof t[]}).tasks=[t];expect(keyReturnPath(t,key.data)).toBe('/map?item=account');expect(currentDatasetSchema.safeParse(key.data).success).toBe(true);expect(()=>startProtectionGuide(key.data,'phone')).toThrow(DataUpgradeConflict);expect(key.data.securityModel.revision).toBe(7);
  });
  it('reuses the same new account and physical environment when returning to a nickname',()=>{
    const f=fixture();let d=walk(f.d,f.id,{account:'new','account-label':'今回の本人用'},'account-settings');const original=task(d,f.id).accountRef;d=navigateProtectionGuide(d,f.id,'back',at) as CurrentDataset;
    expect(currentProtectionStep(d,task(d,f.id)).id).toBe('account-label');d=answerProtectionGuide(d,f.id,'本人用の呼び名を訂正',at) as CurrentDataset;expect(task(d,f.id).accountRef).toBe(original);expect(d.assets.filter(a=>a.kind==='account')).toHaveLength(2);
    d=walk(d,f.id,{'management-choice':'check','management-device':'new','management-device-os':'windows','management-device-label':'別の実物'},'management-browser');const environment=task(d,f.id).environmentDeviceRef;d=navigateProtectionGuide(d,f.id,'back',at) as CurrentDataset;d=answerProtectionGuide(d,f.id,'別の実物',at) as CurrentDataset;expect(task(d,f.id).environmentDeviceRef).toBe(environment);expect(d.assets.filter(a=>a.kind==='device')).toHaveLength(3);expect(currentDatasetSchema.safeParse(d).success).toBe(true);
  });
  it('confirms a missing legacy account purpose without replacing its ID or completed records',()=>{
    const f=fixture();delete f.d.assets[1].purpose;f.d.assets[1].controls.mfa='verified';f.d.assets[1].controlEvidence.mfa='user-confirmed';const d=walk(f.d,f.id,{});expect(task(d,f.id).accountRef).toBe('account');expect(d.assets.filter(a=>a.kind==='account')).toHaveLength(1);expect(d.assets[1].purpose).toBe('personal');expect(d.assets[1].controls.mfa).toBe('verified');expect(d.guide).toEqual(f.main);
  });
  it('completes the new Face ID branch without re-entering the initial OFF state',()=>{
    const f=fixture();f.d.assets[1].controls={mfa:'verified',recovery:'verified'};f.d.assets[1].controlEvidence={mfa:'user-confirmed',recovery:'user-confirmed'};
    const d=walk(f.d,f.id,{'apple-theft-choice':'check','biometric-menu':'face','stolen-device-protection-state':'setup','biometric-setup':'new','stolen-delay':'always'}),t=task(d,f.id);expect(currentProtectionStep(d,t).kind).toBe('finished');expect(t.records['bio-first-scan']).toBeTruthy();expect(t.records['bio-second-scan']).toBeTruthy();expect(protectionStore(d)?.settings[protectionSettingKey('phone','device-biometrics')].value).toBe('on');
  });
  it.each([['ios','ipad'],['android','android-tablet']] as const)('keeps phone-only theft features out of %s %s', (os,form)=>{
    const f=fixture(os),d=walk(f.d,f.id,{form}),t=task(d,f.id);expect(currentProtectionStep(d,t).kind).toBe('finished');expect(t.answers['apple-theft-choice']).toBeUndefined();expect(t.answers['android-theft-choice']).toBeUndefined();expect(t.records['find-enabled'].value).toBe('on');
  });
  it('uses Galaxy lock and account-list variants without duplicating the opening questions',()=>{
    const f=fixture('android'),d=walk(f.d,f.id,{'android-maker':'galaxy','lock-state':'setup','galaxy-lock-menu':'biometrics'}),t=task(d,f.id);expect(currentProtectionStep(d,t).kind).toBe('finished');expect(t.records['lock-save']).toBeTruthy();expect(t.records['account-accounts']).toBeTruthy();expect(d.assets[0].controls.screenLock).toBe('verified');expect(t.history.filter(id=>id==='available')).toHaveLength(1);
  });
  it('retains supported model revisions 1 through 8, completed work and opaque fields when the optional feature is first used',()=>{
    for(const revision of [1,2,3,4,5,6,7,8] as const){const d=newDataset('ja');d.assets=fixture().d.assets;d.securityModel.revision=revision;d.securityModel.unknownExtension={revision,nested:['keep']};d.assets[1].controls.mfa='verified';d.assets[1].controlEvidence.mfa='user-confirmed';d.guide={...d.guide,cursor:'original/position',unknown:{keep:true}};
      const before=structuredClone(d),next=startProtectionGuide(currentDatasetSchema.parse(d),'phone').data;expect(next.guide).toEqual(before.guide);expect(next.assets).toEqual(before.assets);expect(next.securityModel.unknownExtension).toEqual(before.securityModel.unknownExtension);expect(next.securityModel.revision).toBe(9);expect(currentDatasetSchema.safeParse(next).success).toBe(true);
    }
  });
});
