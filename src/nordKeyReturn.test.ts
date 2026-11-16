import {describe,it,expect} from 'vitest';
import {currentDatasetSchema,DataUpgradeConflict,guideSchema,makeAsset,newDataset,type CurrentDataset} from './models';
import {chooseCloudDevice,cloudSetupRoute,configureCloudRoot,makeCloudVault,selectedCloudInstallation,setCloudAnswer} from './cloudManagers';
import {saveNordSsoSession,selectNordSsoAccount,selectNordSsoProvider,startNordSsoSession} from './nordSso';
import {nordSsoBinding,nordSsoStore} from './nordSsoSchemas';
import {beginRecipe,completeStep,currentTask,move} from './guideEngine';
import {adoptNordKeyGuide,restoreNordKeyOrigin,answerKeyGuide,confirmKeyGuide,currentKeyStep,keyReturnPath,navigateKeyGuide,returnFromKeyGuide,startKeyGuide} from './hardwareKeys';
import {keyTasks,type KeyMode} from './hardwareKeySchemas';
import {keyNordOrigin} from './nordKeyReturn';
import {createEncryptedVault,decryptVault} from './crypto';
import {startProtectionGuide} from './deviceProtection';
import {startAccessPlan} from './accessPlans';
import {startPhoneWorkflow} from './phoneEngine';
import {startNordRecovery} from './nordRecovery';
import {nordRecoveryTasks} from './nordRecoverySchemas';
const at='2026-11-14T00:00:00.000Z';let tick=0;
const stamp=()=>new Date(Date.parse(at)+ ++tick*1000).toISOString();
function fixture(provider:'google'|'apple'='google',origin:'phone'|'recovery'='phone'){
  let d=newDataset('ja');d.assets=[{...makeAsset({kind:'account',type:'Identity provider',name:'Nord本人用',importance:'critical'}),id:'nord',provider:'nord',purpose:'personal'},{...makeAsset({kind:'account',type:'Account',name:'本人の提供元',importance:'critical'}),id:'provider',provider,purpose:'personal'},...['phone','fresh','pc','mac'].map(id=>({...makeAsset({kind:'device',type:['phone','fresh'].includes(id)?'Smartphone':'Computer',name:id,operatingSystem:id==='pc'?'windows':id==='mac'?'macos':'ios',importance:'critical'}),id}))];
  d.assets.push({...makeAsset({kind:'account',type:'Primary email',name:'別のメインメール',importance:'critical'}),id:'main-mail',provider:'microsoft',purpose:'personal',services:['mail']});
  d.securityModel.entities=[{id:'key1',kind:'security-key',label:'本人のキー',transports:['usb-c'],createdAt:at},{id:'key2',kind:'security-key',label:'別に保管する予備',transports:['usb-c'],createdAt:at},{id:'browser',kind:'installation',productId:'chrome',deviceRef:provider==='apple'?'mac':'pc',label:'確認用プロフィール',createdAt:at}];
  d=makeCloudVault(d,'nordpass','ja');const vaultRef=d.guide.managerId!;d=configureCloudRoot(d,vaultRef,'nord') as CurrentDataset;d=setCloudAnswer(d,'nord','method','sso') as CurrentDataset;d=setCloudAnswer(d,vaultRef,'usage','existing') as CurrentDataset;d=setCloudAnswer(d,vaultRef,'master','keep') as CurrentDataset;d=chooseCloudDevice(d,vaultRef,'phone') as CurrentDataset;const appRef=selectedCloudInstallation(d,vaultRef)!.id;d=setCloudAnswer(d,appRef,'ios','ios18plus') as CurrentDataset;
  d=selectNordSsoAccount(selectNordSsoProvider(d,'nord',provider),'nord','provider') as CurrentDataset;
  d=startPhoneWorkflow(d,'/guide','phone','move',at);d.deviceWorkflows[0].newDeviceRef='fresh';d.guide={...d.guide,cursor:'device-select',accountId:'main-mail',history:['start','other'],answers:{...d.guide.answers,private:'keep all answers'},unknown:{nested:['keep']}};d.opaque={keep:true};
  if(origin==='recovery')d=startNordRecovery(d,appRef,'/guide',undefined,at);
  const returnTo=origin==='phone'?'/phone/move':`/recover/nord/${nordRecoveryTasks(d)[0].id}`,main=structuredClone(d.guide),workflows=structuredClone(d.deviceWorkflows),recovery=structuredClone(d.securityModel.nordRecoveryV1);
  const side=startNordSsoSession(d,appRef,returnTo),session=nordSsoStore(side.data)!.sessions.find(s=>s.id===side.id)!;let child={...side.data,guide:guideSchema.parse(session.guide)};
  child=move(child,cloudSetupRoute(child,vaultRef)) as CurrentDataset;
  for(let n=0;n<4;n++){expect(currentTask(child)?.recipe.id??child.guide.cursor).toMatch(/^cloud-sso-prepare:/);child=completeStep(child) as CurrentDataset;}
  child={...child,guide:{...child.guide,answers:{...child.guide.answers,[`provider:platform`]:provider==='apple'?'macos':'web',[`return/provider/email-mfa`]:`cloud-sso-resume/${vaultRef}`}}};child=beginRecipe(child,'provider','email-mfa') as CurrentDataset;
  const data=saveNordSsoSession(side.data,child,session.id) as CurrentDataset;expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  return {data,child:{...data,guide:child.guide},sessionRef:session.id,vaultRef,appRef,main,workflows,recovery};
}
function start(f:ReturnType<typeof fixture>){const result=startKeyGuide(f.child,'provider','/map',stamp(),false,undefined,f.sessionRef);return {...result,data:saveNordSsoSession(f.data,result.data,f.sessionRef) as CurrentDataset};}
function drive(input:CurrentDataset,id:string,mode:KeyMode):CurrentDataset{
  let d=input;
  for(let n=0;n<100;n++){
    const t=keyTasks(d).find(t=>t.id===id)!,s=currentKeyStep(d,t);if(s.kind==='finished')return d;
    const defaults:Record<string,string>={mode,scope:'personal',protection:'standard',device:mode==='apple-keys'?'mac':'pc','key-1':'key1','key-2':'key2','registration-1':'existing','registration-2':'existing',browser:'browser','old-factor':'yes'};
    const next=s.kind==='operation'?confirmKeyGuide(d,id,stamp()):answerKeyGuide(d,id,defaults[s.id]??s.choices?.[0]?.value??'本人用',stamp());expect(next,`No advance at ${s.id}`).not.toBe(d);d=currentDatasetSchema.parse(next);
  }throw new Error('key guide loop');
}
describe('hardware keys inside connected-account side guides',()=>{
  it('returns a deferred task to the same session, holding the full main guide and phone workflow',()=>{
    const f=fixture(),k=start(f),t=keyTasks(k.data)[0];expect(keyReturnPath(t,k.data)).toBe(`/nord-connection/${f.sessionRef}`);expect(k.data.securityModel.revision).toBe(10);
    const resumed=returnFromKeyGuide(navigateKeyGuide(k.data,k.id,'defer'),k.id);expect(resumed.guide).toEqual(f.main);expect(resumed.version===2&&resumed.deviceWorkflows).toEqual(f.workflows);expect(nordSsoStore(resumed)?.sessions[0].guide).toEqual(f.child.guide);expect(currentDatasetSchema.safeParse(resumed).success).toBe(true);
  });
  for(const provider of ['google','apple'] as const)it(`${provider}: completed MFA returns to needed recovery without registering another authenticator or connecting Nord`,()=>{
    const f=fixture(provider),k=start(f),completed=drive(k.data,k.id,provider==='apple'?'apple-keys':'google-second-step'),returned=returnFromKeyGuide(completed,k.id) as CurrentDataset;
    expect(returned.guide).toEqual(f.main);expect(returned.deviceWorkflows).toEqual(f.workflows);expect(returned.assets[1].controls.mfa).toBe('verified');expect(returned.assets.find(a=>a.id==='main-mail')?.controls.mfa).toBe('unknown');expect(returned.assets[1].controls.recovery).toBe('unknown');expect(guideSchema.parse(nordSsoStore(returned)?.sessions[0].guide).cursor).toBe(`cloud-sso-security/${f.vaultRef}`);expect(nordSsoBinding(returned,'nord')?.records.connection).toBeUndefined();expect(returned.securityModel.entities.some(e=>e.kind==='installation'&&e.productId.includes('authenticator'))).toBe(false);expect(currentDatasetSchema.safeParse(returned).success).toBe(true);
  });
  it('keeps forgotten-master recovery saved while the provider key guide completes',()=>{
    const f=fixture('google','recovery'),k=start(f),d=returnFromKeyGuide(drive(k.data,k.id,'google-second-step'),k.id) as CurrentDataset;expect(d.securityModel.nordRecoveryV1).toEqual(f.recovery);expect(d.guide).toEqual(f.main);expect(nordSsoStore(d)?.sessions[0].returnTo).toMatch(/^\/recover\/nord\//);
  });
  it('does not reuse a main-guide task or a task from another side session with the same account',()=>{
    const f=fixture(),main=startKeyGuide(f.child,'provider','/guide',stamp()),shared=saveNordSsoSession(f.data,main.data,f.sessionRef) as CurrentDataset,k=start({...f,data:shared,child:{...shared,guide:f.child.guide}});expect(k.id).not.toBe(main.id);
    const newSession=startNordSsoSession(k.data,f.appRef,'/map'),s=nordSsoStore(newSession.data)!.sessions.find(s=>s.id===newSession.id)!;
    const child={...newSession.data,guide:{...guideSchema.parse(s.guide),cursor:f.child.guide.cursor}},saved=saveNordSsoSession(newSession.data,child,s.id),other=startKeyGuide({...saved,guide:child.guide},'provider','/map',stamp(),false,undefined,s.id);expect(other.id).not.toBe(k.id);expect(keyTasks(other.data)).toHaveLength(3);
  });
  it('keeps historical bindings, and does not advance another actual account after selection changes',()=>{
    const f=fixture(),k=start(f);let d=drive(k.data,k.id,'google-second-step');d.assets.push({...d.assets[1],id:'other',controls:{...d.assets[1].controls,mfa:'unknown'}});d=selectNordSsoAccount(d,'nord','other') as CurrentDataset;expect(currentDatasetSchema.safeParse(d).success).toBe(true);
    const returned=returnFromKeyGuide(d,k.id) as CurrentDataset;expect(returned.guide).toEqual(f.main);expect(returned.assets.find(a=>a.id==='other')?.controls.mfa).toBe('unknown');expect(guideSchema.parse(nordSsoStore(returned)?.sessions[0].guide).cursor).toContain('cloud-sso-prepare:');expect(keyNordOrigin(returned,keyTasks(returned)[0])?.bindingRef).not.toBe(nordSsoBinding(returned,'nord')?.id);expect(currentDatasetSchema.safeParse(returned).success).toBe(true);
  });
  it('retains the parent cursor for a separate retry even though the main guide is currently visible to the key page',()=>{
    const f=fixture(),k=start(f),next=startKeyGuide(k.data,'provider','/map',stamp(),true,undefined,f.sessionRef);expect(keyTasks(next.data).find(t=>t.id===next.id)?.originGuideCursor).toBe(f.child.guide.cursor);expect(next.data.guide).toEqual(f.main);
  });
  it('does not reinterpret or overwrite an opaque key-return field in revision 9',()=>{
    const f=fixture(),old=startKeyGuide(f.child,'provider','/map',stamp());old.data.securityModel.revision=9;const t=keyTasks(old.data)[0];t.nordSsoKeyReturnV1={version:1,sessionRef:f.sessionRef,bindingRef:nordSsoBinding(old.data,'nord')!.id};(old.data.securityModel.hardwareKeysV1 as {tasks:typeof t[]}).tasks=[t];expect(currentDatasetSchema.safeParse(old.data).success).toBe(true);expect(keyNordOrigin(old.data,t)).toBeUndefined();expect(()=>startKeyGuide(old.data,'provider','/map',stamp(),false,undefined,f.sessionRef)).toThrow(DataUpgradeConflict);expect(old.data.securityModel.revision).toBe(9);
  });
  it('validates contextual references and retains them through the existing encrypted backup and other feature writers',async()=>{
    const f=fixture(),k=start(f),sealed=await createEncryptedVault('test-only application storage phrase',k.data),opened=(await decryptVault(sealed.envelope,'test-only application storage phrase')).data;expect(opened).toEqual(k.data);
    const protectedPhone=startProtectionGuide(opened,'phone').data,plan=startAccessPlan(protectedPhone,'provider').data;expect(plan.securityModel.revision).toBe(10);expect(keyReturnPath(keyTasks(plan)[0],plan)).toBe(`/nord-connection/${f.sessionRef}`);expect(plan.guide).toEqual(f.main);
    const invalid=structuredClone(plan),t=keyTasks(invalid)[0];t.nordSsoKeyReturnV1={version:1,sessionRef:'missing',bindingRef:'missing'};(invalid.securityModel.hardwareKeysV1 as {tasks:typeof t[]}).tasks[0]=t;expect(currentDatasetSchema.safeParse(invalid).success).toBe(false);
  });
  it('honors the explicit connected-account return point in the ordinary main guide too',()=>{
    const f=fixture(),main={...f.child,guide:{...f.child.guide,nordSsoSessionV1:undefined}},k=startKeyGuide(main,'provider','/guide',stamp()),returned=returnFromKeyGuide(drive(k.data,k.id,'google-second-step'),k.id);
    expect(returned.guide.cursor).toBe(`cloud-sso-security/${f.vaultRef}`);expect(returned.guide.answers['return/provider/email-mfa']).toBeUndefined();expect(keyNordOrigin(returned,keyTasks(returned)[0])).toBeUndefined();
  });
  it('keeps an unknown legacy return answer without sending a hardware-key user into authenticator registration',()=>{
    const f=fixture(),main={...f.child,guide:{...f.child.guide,answers:{...f.child.guide.answers,'return/provider/email-mfa':'opaque-old-extension'}}},k=startKeyGuide(main,'provider','/guide',stamp()),returned=returnFromKeyGuide(drive(k.data,k.id,'google-second-step'),k.id);
    expect(returned.guide.cursor).toMatch(/^do\/provider\/recovery\//);expect(returned.guide.answers['return/provider/email-mfa']).toBe('opaque-old-extension');
  });
  it('explicitly adopts an earlier task without copying its registrations or checks, and can restore its original return point',()=>{
    const f=fixture(),k=startKeyGuide(f.child,'provider','/guide',stamp()),shared=saveNordSsoSession(f.data,k.data,f.sessionRef),before=structuredClone(keyTasks(shared)[0]);
    const next=adoptNordKeyGuide(shared,k.id,f.sessionRef,stamp()),t=keyTasks(next)[0];expect(t.id).toBe(before.id);expect(keyTasks(next)).toHaveLength(1);expect(t.records).toEqual(before.records);expect(t.registrationRefs).toEqual(before.registrationRefs);expect(t.history).toEqual(before.history);expect(next.guide).toEqual(f.main);expect(keyReturnPath(t,next)).toBe(`/nord-connection/${f.sessionRef}`);
    const restored=restoreNordKeyOrigin(next,k.id,stamp()),old=keyTasks(restored)[0];expect(old.returnTo).toBe(before.returnTo);expect(old.originGuideCursor).toBe(before.originGuideCursor);expect(Object.hasOwn(old,'nordSsoKeyReturnV1')).toBe(false);expect(old.records).toEqual(before.records);expect(restored.guide).toEqual(f.main);expect(currentDatasetSchema.safeParse(restored).success).toBe(true);
  });
  it('reuses a completed earlier task without making a second independent confirmation',()=>{
    const f=fixture(),k=startKeyGuide(f.child,'provider','/guide',stamp()),completed=drive(k.data,k.id,'google-second-step'),shared=saveNordSsoSession(f.data,completed,f.sessionRef) as CurrentDataset,before=structuredClone(shared.actions),facts=structuredClone(shared.securityModel.facts);
    const adopted=adoptNordKeyGuide(shared,k.id,f.sessionRef,stamp()),returned=returnFromKeyGuide(adopted,k.id) as CurrentDataset;expect(returned.actions).toEqual(before);expect(returned.securityModel.facts).toEqual(facts);expect(keyTasks(returned)).toHaveLength(1);expect(returned.guide).toEqual(f.main);expect(guideSchema.parse(nordSsoStore(returned)?.sessions[0].guide).cursor).toBe(`cloud-sso-security/${f.vaultRef}`);
  });
  it('does not advance a completed historical task after its actual key has been reset',()=>{
    const f=fixture(),k=startKeyGuide(f.child,'provider','/guide',stamp()),completed=drive(k.data,k.id,'google-second-step'),shared=saveNordSsoSession(f.data,completed,f.sessionRef) as CurrentDataset;
    shared.securityModel.lifecycle.key1={state:'in-use',evidence:'user-confirmed',updatedAt:'2026-11-14T05:00:00Z',accessResetAt:'2026-11-14T05:00:00Z'};
    const adopted=adoptNordKeyGuide(shared,k.id,f.sessionRef,stamp());expect(keyTasks(adopted)[0].status).toBe('active');const returned=returnFromKeyGuide(adopted,k.id);expect(nordSsoStore(returned)?.sessions[0].guide).toEqual(f.child.guide);expect(returned.guide).toEqual(f.main);
  });
  it('does not use an old completed task to override a later account-setting correction',()=>{
    const f=fixture(),k=start(f),completed=drive(k.data,k.id,'google-second-step');completed.assets[1].controls.mfa='needs-improvement';completed.assets[1].controlEvidence.mfa='user-confirmed';const returned=returnFromKeyGuide(completed,k.id);
    expect(nordSsoStore(returned)?.sessions[0].guide).toEqual(f.child.guide);expect(returned.assets[1].controls.mfa).toBe('needs-improvement');expect(returned.guide).toEqual(f.main);
  });
  it('keeps the main guide intact even when its cursor happens to equal the child cursor',()=>{
    const f=fixture();f.data.guide={...f.data.guide,cursor:f.child.guide.cursor};f.main=structuredClone(f.data.guide);const k=start(f),returned=returnFromKeyGuide(drive(k.data,k.id,'google-second-step'),k.id);expect(returned.guide).toEqual(f.main);expect(guideSchema.parse(nordSsoStore(returned)?.sessions[0].guide).cursor).not.toBe(f.child.guide.cursor);
  });

});
