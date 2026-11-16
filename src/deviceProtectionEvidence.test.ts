import {describe,it,expect} from 'vitest';
import {makeAsset,newDataset,currentDatasetSchema,type CurrentDataset} from './models';
import {decryptVault,createEncryptedVault} from './crypto';
import {evaluateAccess,securityModelIssues} from './securityModel';
import {protectionActorEpoch,protectionActorSignature,protectionBindingCurrent} from './deviceProtectionEvidence';
import {protectionSettingKey,protectionTaskSchema,type ProtectionRecord} from './deviceProtectionSchemas';
import {removeEntry} from './removeEntry';
import {startAccessPlan} from './accessPlans';
import {startKeyGuide} from './hardwareKeys';

const at='2026-11-14T00:00:00Z',later='2026-11-14T01:00:00Z';
function fixture(){
  const d=newDataset('ja');d.securityModel.revision=9;
  d.assets=[{...makeAsset({kind:'device',type:'Smartphone',name:'対象のスマホ',importance:'critical',operatingSystem:'android'}),id:'phone'},{...makeAsset({kind:'device',type:'Computer',name:'本人のPC',importance:'critical',operatingSystem:'windows'}),id:'pc'},{...makeAsset({kind:'account',type:'Account',name:'本人のGoogle',importance:'critical'}),id:'account',provider:'google',purpose:'personal'}];
  d.securityModel.entities=[{id:'browser',kind:'installation',productId:'browser.chrome',deviceRef:'pc',label:'本人のブラウザー',createdAt:at},{id:'session',kind:'session',accountRef:'account',installationRef:'browser',deviceRef:'pc',label:'記録した管理画面のログイン状態',createdAt:at}];
  const snapshot=(refs:string[])=>({actorEpochs:Object.fromEntries(refs.map(ref=>[ref,protectionActorEpoch(d.securityModel,ref)])),actorSignatures:Object.fromEntries(refs.map(ref=>[ref,protectionActorSignature(d.securityModel,ref)]))});
  const base={accountRef:'account',titleEn:'Checked',titleJa:'確認しました',at,refs:[],requires:[],kind:'navigation' as const,featureVersions:{},withoutRefs:[]};
  const key=protectionSettingKey('phone','find-enabled');
  const records:Record<string,ProtectionRecord>={
    'account-check':{...base,kind:'prerequisite',refs:['phone','account'],...snapshot(['phone','account'])},
    'find-enabled':{...base,kind:'configuration',feature:'find-enabled',value:'on',refs:['phone','account'],requires:['account-check'],featureVersions:{[key]:1},...snapshot(['phone','account'])},
    'management-open':{...base,refs:['account','browser','pc'],...snapshot(['account','browser','pc'])},
    'management-check':{...base,kind:'management-use',refs:['account','browser','pc','session'],context:'normal',requires:['account-check','find-enabled','management-open'],withoutRefs:['phone'],...snapshot(['phone','account','browser','pc','session'])},
  };
  const task=protectionTaskSchema.parse({id:'task',deviceRef:'phone',accountRef:'account',environmentRef:'browser',sessionRef:'session',returnTo:'map',originGuideCursor:'private/main/position',createdAt:at,updatedAt:at,records});
  d.securityModel.deviceProtectionV1={version:1,tasks:[task],settings:{[key]:{deviceRef:'phone',feature:'find-enabled',accountRef:'account',value:'on',generation:1,updatedAt:at,taskRef:task.id,recordRef:'find-enabled',withdrawn:false}},history:[]};
  d.securityModel.facts=[{id:'fact',label:'対象一覧を開いた記録',state:'available',evidence:'user-confirmed',checkedAt:at,requiredRefs:records['management-check'].refs,contexts:['normal'],sourceIds:[],dependencyCompleteness:'partial',observedWithoutRefs:['phone'],deviceProtectionObservationV1:'v1',deviceProtectionTaskRef:task.id,deviceProtectionRecordRef:'management-check'}];
  d.securityModel.routes=[{id:'management',label:'本人の管理画面で対象を選ぶ',targetRef:'phone',purpose:'device-management',contexts:['normal'],requirements:{kind:'fact',factId:'fact'},sourceIds:[]}];
  d.guide.answers.private='whole main guide must remain';d.opaque={retained:true};return {d,task,key};
}
const result=(d:CurrentDataset,missing:string[]=[],context:'normal'|'all-devices-lost'='normal')=>evaluateAccess(d.securityModel,'management',{context,unavailableRefs:missing,now:later}).state;
describe('device management is separate from possession, sign-in and recovery',()=>{
  it('can retain a specifically phone-free management check when the target is unavailable, without guaranteeing recovery',()=>{
    const {d}=fixture();expect(securityModelIssues(d.securityModel,d.assets)).toEqual([]);expect(result(d,['phone'])).toBe('available');
    d.securityModel.routes[0].purpose='restore';expect(result(d,['phone'])).toBe('unavailable');
  });
  it('keeps untested losses and all-devices-lost contexts unknown instead of broadening the check',()=>{
    const {d}=fixture();d.securityModel.facts[0].observedWithoutRefs=[];expect(result(d,['phone'])).toBe('unknown');
    expect(result(fixture().d,[],'all-devices-lost')).toBe('not-applicable');expect(result(fixture().d,['pc'])).toBe('unavailable');
  });
  it('does not call a transferred or erased former device available for management',()=>{
    for(const state of ['transferred','deleted','retired','revoked'] as const){const {d}=fixture();d.securityModel.lifecycle.phone={state,evidence:'user-confirmed',updatedAt:at};expect(result(d)).toBe('unavailable');}
  });
  it('requires this purpose to use revision 9 and an actual device target',()=>{
    const {d}=fixture();d.securityModel.revision=8;expect(securityModelIssues(d.securityModel,d.assets).some(i=>i.code==='invalid-purpose')).toBe(true);
    d.securityModel.revision=9;d.securityModel.routes[0].targetRef='account';expect(securityModelIssues(d.securityModel,d.assets).some(i=>i.code==='invalid-purpose')).toBe(true);
  });
  it('withdraws stale proof after a feature change, record undo, reset or actual browser rebinding',()=>{
    const changed=fixture();const store=changed.d.securityModel.deviceProtectionV1 as {settings:Record<string,{generation:number}>};store.settings[changed.key].generation=2;expect(result(changed.d)).toBe('unknown');
    const undone=fixture();delete undone.task.records['find-enabled'];const saved=undone.d.securityModel.deviceProtectionV1 as {tasks:typeof undone.task[]};saved.tasks=[undone.task];expect(result(undone.d)).toBe('unknown');
    const reset=fixture();reset.d.securityModel.lifecycle.phone={state:'in-use',evidence:'user-confirmed',updatedAt:later,accessResetAt:later};expect(result(reset.d)).toBe('unknown');
    const moved=fixture();const browser=moved.d.securityModel.entities[0];if(browser.kind!=='installation')throw new Error();browser.deviceRef='phone';expect(result(moved.d)).toBe('unknown');
  });
  it('does not promote a marker with missing prerequisites or contradictory resources to trusted phone-free evidence',()=>{
    const {d,task}=fixture();task.records['management-check'].requires=[];(d.securityModel.deviceProtectionV1 as {tasks:typeof task[]}).tasks=[task];expect(result(d,['phone'])).toBe('unknown');
    const extra=fixture();extra.d.securityModel.facts[0].observedWithoutRefs=['phone','unasked-resource'];expect(result(extra.d)).toBe('unknown');
  });
  it('keeps the main guide, opaque data and revision 9 when other optional guides save',()=>{
    const {d}=fixture(),guide=structuredClone(d.guide);const next=startAccessPlan(d,'account').data;expect(next.securityModel.revision).toBe(9);expect(next.guide).toEqual(guide);expect(next.opaque).toEqual(d.opaque);
    const keys=startKeyGuide(next,'account').data;expect(keys.securityModel.revision).toBe(9);expect(keys.securityModel.deviceProtectionV1).toEqual(d.securityModel.deviceProtectionV1);expect(keys.guide).toEqual(guide);
  });
  it('round trips the actual proof and all earlier records in the existing encrypted envelope',async()=>{
    const {d}=fixture();const seal=await createEncryptedVault('test-only-long-passphrase',d);const reopened=await decryptVault(seal.envelope,'test-only-long-passphrase');expect(reopened.data).toEqual(d);expect(result(reopened.data as CurrentDataset,['phone'])).toBe('available');
  });
});

it('validates private store references and retains moved physical history without reusing its proof',()=>{
  const {d}=fixture();expect(currentDatasetSchema.safeParse(d).success).toBe(true);
  const browser=d.securityModel.entities[0];if(browser.kind!=='installation')throw new Error();browser.deviceRef='phone';expect(currentDatasetSchema.safeParse(d).success).toBe(true);expect(result(d)).toBe('unknown');
  const invalid=fixture();const task=(invalid.d.securityModel.deviceProtectionV1 as {tasks:typeof invalid.task[]}).tasks[0];task.environmentRef='missing';expect(currentDatasetSchema.safeParse(invalid.d).success).toBe(false);
  const missingStore=fixture();delete missingStore.d.securityModel.deviceProtectionV1;expect(currentDatasetSchema.safeParse(missingStore.d).success).toBe(false);
});

it('keeps the actual target, account and physical management device while their task or history refers to them',()=>{
  const {d}=fixture();for(const id of ['phone','account','pc'])expect(removeEntry(d,id)).toBeUndefined();
  d.assets.push({...makeAsset({kind:'device',type:'Computer',name:'使っていない別のPC',importance:'important'}),id:'unused'});expect(removeEntry(d,'unused')?.assets.some(a=>a.id==='unused')).toBe(false);
});

it('records use that still depended on the target phone instead of forcing every management check to be independent',()=>{
  const {d,task}=fixture();const r=task.records['management-check'];r.refs=[...r.refs,'phone'];r.withoutRefs=[];
  d.securityModel.facts[0].requiredRefs=r.refs;d.securityModel.facts[0].observedWithoutRefs=[];(d.securityModel.deviceProtectionV1 as {tasks:typeof task[]}).tasks=[task];
  expect(result(d)).toBe('available');expect(result(d,['phone'])).toBe('unavailable');
});

it('keeps a known disabled Find prerequisite separate from the unconfirmed management trial',()=>{
  const {d,task,key}=fixture();const r=task.records['find-enabled'];r.value='off';
  const store=d.securityModel.deviceProtectionV1 as {settings:Record<string,{value:string}>,tasks:typeof task[]};store.settings[key].value='off';store.tasks=[task];
  d.securityModel.facts.push({id:'configured',label:'Current Find setting',state:'unavailable',evidence:'user-confirmed',checkedAt:r.at,requiredRefs:[],contexts:['normal'],sourceIds:[],dependencyCompleteness:'complete',deviceProtectionConfigurationV1:'v1',deviceProtectionTaskRef:task.id,deviceProtectionRecordRef:'find-enabled'});
  d.securityModel.routes[0].requirements={kind:'all',conditions:[{kind:'fact',factId:'configured'},{kind:'fact',factId:'fact'}]};
  expect(result(d)).toBe('unavailable');expect(result(d,['phone'])).toBe('unavailable');
  d.securityModel.facts[1].state='available';expect(result(d)).toBe('unknown');
});
it('withdraws a management connection when its actual finding prerequisite or physical binding is no longer current',()=>{
  const {d,key}=fixture();const relation={id:'binding',kind:'administers' as const,fromRef:'account',toRef:'phone',evidence:'user-confirmed' as const,checkedAt:at,sourceIds:[],deviceProtectionRelationV1:'v1',deviceProtectionTaskRef:'task'};
  expect(protectionBindingCurrent(d.securityModel,relation)).toBe(true);
  (d.securityModel.deviceProtectionV1 as {settings:Record<string,{generation:number}>}).settings[key].generation++;
  expect(protectionBindingCurrent(d.securityModel,relation)).toBe(false);
});
