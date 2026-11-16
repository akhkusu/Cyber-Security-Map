import { describe, expect, it } from 'vitest';
import { makeAsset, newDataset, currentDatasetSchema, type CurrentDataset } from './models';
import { makeNativeVault, chooseNativeDevice, configureNativeStorage, selectedNativeInstallation, nativeInstallation, managerReady, nativeSetupRoute, type NativeProduct } from './nativeManagers';
import { recordControl } from './controlRecords';
import { beginRecipe, completeStep, currentTask, move, taskCursor, undoStep } from './guideEngine';
import { nativeRootCopyReady, nativeRootCopyState } from './nativeRootCopy';
import { mapItems, typedMapStatus } from './securityMapViews';
import { createEncryptedVault, decryptVault } from './crypto';
import { startPhoneWorkflow, confirmPhoneStep, currentPhoneStep, phoneBlockingSteps, phoneStepBlockers, undoPhoneRecord } from './phoneEngine';
import { phoneSteps } from './phoneCatalog';

const first = '2026-11-14T01:00:00Z', changed = '2026-11-14T02:00:00Z';
function fixture(product: NativeProduct) {
  let data = newDataset('ja');
  const root = { ...makeAsset({ kind:'account', type:'Primary email', name:'PRIVATE', importance:'critical' }), id:'root', provider:product==='apple-passwords'?'apple' as const:'google' as const, purpose:'personal' as const, services:['mail' as const] };
  const device = (id:string) => ({ ...makeAsset({kind:'device',type:'Smartphone',name:id,importance:'critical',operatingSystem:product==='apple-passwords'?'ios':'android'}),id });
  data.assets=[root,{...root,id:'other',purpose:'work'},device('old'),device('fresh')];data.guide.accountId='root';
  for(const control of ['mfa','recovery']) data=recordControl(data,'root',control,{id:`initial:${control}`},first) as CurrentDataset;
  data=makeNativeVault(data,product,'ja');const vault=data.guide.managerId!;
  data=chooseNativeDevice(data,vault,'old') as CurrentDataset;data=configureNativeStorage(data,vault,'account','root') as CurrentDataset;
  const oldApp=selectedNativeInstallation(data,vault)!.id;
  data=chooseNativeDevice(data,vault,'fresh') as CurrentDataset;const newApp=selectedNativeInstallation(data,vault)!.id;
  for(const app of [oldApp,newApp]) {
    data.guide.answers[`${app}:version`]='ios18plus';
    for(const control of ['opened','storageChecked','autofill'])data=recordControl(data,app,control,{id:`initial:${app}:${control}`},first) as CurrentDataset;
    data=recordControl(data,nativeInstallation(data,app)!.deviceRef,'screenLock',{id:`initial:${app}:lock`},first) as CurrentDataset;
  }
  return {data,vault,oldApp,newApp};
}
function confirm(data:CurrentDataset,app:string) { return completeStep(move(data,taskCursor(app,'builtin-manager','independent-root'))) as CurrentDataset; }
function rotate(data:CurrentDataset) {const next=structuredClone(data);next.securityModel.lifecycle.root={...next.securityModel.lifecycle.root,state:'in-use',evidence:'user-confirmed',updatedAt:changed,accessResetAt:changed};return next;}
function status(data:CurrentDataset,id:string){return typedMapStatus(data,mapItems(data,'ja').find(n=>n.id===id)!,'ja');}
function phone(data:CurrentDataset,vault:string,app:string,elsewhere=false) {
  const d=startPhoneWorkflow(data,'/map','old','phone',first), w=d.deviceWorkflows[0];w.newDeviceRef='fresh';w.answers={stage:'using',availability:'available',ownership:'personal',authenticator:'none','use:root':'yes','use:other':'elsewhere','special-apps':'none','phone-line':'no-line','old-fate':'sell','ios-generation':'18','sale-theft-menu':'older','android-maker':'pixel',[`native-use:${vault}`]:elsewhere?'elsewhere':'yes',[`native-install:${vault}`]:app,[`native-version:${vault}`]:'ios18plus',[`native-test-account:${vault}`]:'root'};return d;
}
function confirmPhone(data:CurrentDataset,cursor:string){const d=structuredClone(data);d.deviceWorkflows[0].cursor=cursor;return confirmPhoneStep(d,'phone',changed) as CurrentDataset;}

for(const product of ['apple-passwords','google-password-manager'] as const)describe(`${product}: current independent account copy`,()=>{
  it('shares one explicit account-copy confirmation while keeping each device setup separate',()=>{
    const f=fixture(product),d=confirm(f.data,f.oldApp),key=taskCursor(f.oldApp,'builtin-manager','independent-root');
    expect(nativeRootCopyState(d,'root')).toBe('current');expect(nativeRootCopyReady(d,'other')).toBe(false);
    expect(managerReady(d,f.vault,f.newApp)).toBe(true);expect(nativeInstallation(d,f.newApp)?.controls?.independentRoot).toBeUndefined();
    const at=move(d,taskCursor(f.newApp,'builtin-manager','independent-root'));expect(currentTask(at)?.redirectTo).toBe(taskCursor(f.newApp,'builtin-manager','autofill-open'));
    const skipped=completeStep(at);expect(skipped.guide.steps[taskCursor(f.newApp,'builtin-manager','independent-root')]).toBeUndefined();expect(skipped.guide.steps[key]).toEqual(d.guide.steps[key]);
    const unprepared=structuredClone(d);unprepared.securityModel.entities=unprepared.securityModel.entities.map(e=>e.id===f.newApp?{...e,controls:{}}:e);expect(managerReady(unprepared,f.vault,f.newApp)).toBe(false);
  });
  it('returns directly to the changed copy and updates both devices without rewriting other confirmations',()=>{
    const f=fixture(product),key=taskCursor(f.oldApp,'builtin-manager','independent-root');let d=confirm(f.data,f.oldApp);const action=d.actions.find(a=>a.id===key)!;
    d=rotate(d);expect(managerReady(d,f.vault,f.oldApp)).toBe(false);expect(managerReady(d,f.vault,f.newApp)).toBe(false);expect(status(d,f.vault).tone).toBe('needs-work');expect(status(d,f.newApp).label).toContain('変更後');
    expect(nativeSetupRoute(d,f.vault,f.oldApp)).toBe(key);expect(beginRecipe(d,f.oldApp,'builtin-manager').guide.cursor).toBe(key);
    d.guide.steps[key].opaque={keep:true};d=confirm(d,f.oldApp);expect(d.actions.find(a=>a.id===key)).toEqual(action);expect(d.guide.steps[key].opaque).toEqual({keep:true});expect(managerReady(d,f.vault,f.newApp)).toBe(true);expect(nativeRootCopyState(d,'root')).toBe('current');expect(d.assets.find(a=>a.id==='root')?.controls.mfa).toBe('verified');expect(status(d,f.vault).tone).toBe('unknown');
  });
  it('does not resurrect unscoped flags after the explicit shared proof is undone',()=>{
    const f=fixture(product);let d=confirm(f.data,f.oldApp);d=recordControl(d,f.newApp,'independentRoot',{id:'old-unscoped'},first) as CurrentDataset;
    d=undoStep(d,taskCursor(f.oldApp,'builtin-manager','independent-root')) as CurrentDataset;expect(nativeInstallation(d,f.newApp)?.controls?.independentRoot).toBe('verified');expect(nativeRootCopyState(d,'root')).toBe('missing');expect(managerReady(d,f.vault,f.newApp)).toBe(false);expect(d.assets.find(a=>a.id==='root')?.controls.recovery).toBe('verified');
  });
  it('retains legacy confirmations until a known password change, not a text revision',()=>{
    const f=fixture(product);const legacy=recordControl(f.data,f.oldApp,'independentRoot',{id:'legacy'},first) as CurrentDataset;
    expect(nativeRootCopyState(legacy,'root')).toBe('legacy');expect(managerReady(legacy,f.vault,f.newApp)).toBe(true);legacy.guide.answers.catalogRevision='new explanation';expect(nativeRootCopyReady(legacy,'root')).toBe(true);expect(nativeRootCopyState(rotate(legacy),'root')).toBe('changed');expect(nativeRootCopyReady(legacy,'other')).toBe(false);
  });
  it('uses the shared proof during a phone move without creating a second receipt or changing the main guide',()=>{
    const f=fixture(product);let d=phone(confirm(f.data,f.oldApp),f.vault,f.newApp);const before=structuredClone(d.guide),id=`native:${f.vault}:independent-root`;d.deviceWorkflows[0].cursor=id;
    expect(currentPhoneStep(d,d.deviceWorkflows[0]).id).toBe(`native:${f.vault}:autofill-open`);expect(phoneBlockingSteps(d,d.deviceWorkflows[0]).some(s=>s.id===id)).toBe(false);d=confirmPhoneStep(d,'phone',changed) as CurrentDataset;expect(d.guide).toEqual(before);expect(Object.values(d.deviceWorkflows[0].records).some(r=>r.stepId===id)).toBe(false);expect(Object.values(d.deviceWorkflows[0].records).some(r=>r.stepId===`native:${f.vault}:autofill-open`)).toBe(true);
    d=rotate(d);expect(phoneBlockingSteps(d,d.deviceWorkflows[0]).some(s=>s.id===id)).toBe(true);expect(confirmPhone(d,'erase-old').securityModel.lifecycle.old).toBeUndefined();
  });
  it('records and withdraws a current phone confirmation independently of the main guide',()=>{
    const f=fixture(product);let d=phone(rotate(f.data),f.vault,f.newApp);const before=structuredClone(d.guide),id=`native:${f.vault}:independent-root`;d=confirmPhone(d,id);const key=Object.keys(d.deviceWorkflows[0].records).find(k=>d.deviceWorkflows[0].records[k].stepId===id)!;
    expect(nativeRootCopyState(d,'root')).toBe('current');expect(managerReady(d,f.vault,f.oldApp)).toBe(true);expect(d.guide).toEqual(before);
    d=undoPhoneRecord(d,'phone',key,changed) as CurrentDataset;expect(nativeRootCopyReady(d,'root')).toBe(false);expect(phoneBlockingSteps(d,d.deviceWorkflows[0]).some(s=>s.id===id)).toBe(true);expect(d.guide).toEqual(before);expect(d.assets.find(a=>a.id==='root')?.controls.mfa).toBe('verified');
  });
  it('requires the independent copy separately from using the store on another device',()=>{
    const f=fixture(product);let d=phone(rotate(f.data),f.vault,f.oldApp,true),id=`native-elsewhere-copy:${f.vault}`;const step=phoneSteps(d,d.deviceWorkflows[0]).find(s=>s.id===`native-elsewhere:${f.vault}`)!;
    expect(phoneStepBlockers(d,d.deviceWorkflows[0],step).map(s=>s.id)).toContain(id);d=confirmPhone(d,step.id);expect(Object.values(d.deviceWorkflows[0].records).some(r=>r.stepId===step.id)).toBe(false);
    d=confirmPhone(d,id);expect(phoneStepBlockers(d,d.deviceWorkflows[0],step)).toEqual([]);d=confirmPhone(d,step.id);expect(Object.values(d.deviceWorkflows[0].records).some(r=>r.stepId===step.id&&r.status==='confirmed')).toBe(true);d=rotate(d);d.securityModel.lifecycle.root.accessResetAt='2026-11-14T03:00:00Z';expect(phoneBlockingSteps(d,d.deviceWorkflows[0]).some(s=>s.id===id)).toBe(true);
  });
  it('preserves opaque evidence and resume data through encryption and does not interpret a future format',async()=>{
    const f=fixture(product);let d=confirm(f.data,f.oldApp);const key=taskCursor(f.oldApp,'builtin-manager','independent-root'),proof=d.guide.steps[key].nativeRootCopyV1 as Record<string,unknown>;proof.future={keep:true};d.securityModel.nativeRootCopyStateV1={...(d.securityModel.nativeRootCopyStateV1 as object),future:{keep:true}};d=rotate(d);d.guide.cursor=key;
    const sealed=await createEncryptedVault('fixture storage passphrase',d),restored=(await decryptVault(sealed.envelope,'fixture storage passphrase')).data as CurrentDataset;expect(restored).toEqual(d);expect(nativeRootCopyReady(restored,'root')).toBe(false);const updated=confirm(restored,f.oldApp);expect((updated.guide.steps[key].nativeRootCopyV1 as Record<string,unknown>).future).toEqual({keep:true});expect((updated.securityModel.nativeRootCopyStateV1 as Record<string,unknown>).future).toEqual({keep:true});expect(currentDatasetSchema.safeParse(updated).success).toBe(true);
    const future=structuredClone(updated);(future.guide.steps[key].nativeRootCopyV1 as Record<string,unknown>).version=2;expect(nativeRootCopyState(future,'root')).toBe('unsupported');expect(currentTask(move(future,key))?.redirectTo).toBe(`unsupported/${f.oldApp}/builtin-manager`);const blocked=phone(future,f.vault,f.newApp);expect(phoneBlockingSteps(blocked,blocked.deviceWorkflows[0]).some(s=>s.id===`native-copy-version:${f.vault}`)).toBe(true);expect(future.guide.steps[key].nativeRootCopyV1).toEqual({...updated.guide.steps[key].nativeRootCopyV1 as object,version:2});
  });
});
