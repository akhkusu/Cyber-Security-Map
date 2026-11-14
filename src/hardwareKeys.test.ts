import { describe, expect, it } from 'vitest';
import { currentDatasetSchema, legacyDatasetSchema, makeAsset, newDataset, type CurrentDataset, type Dataset } from './models';
import { answerKeyGuide, confirmKeyGuide, currentKeyStep, keyHelpPrompt, keyRecordValid, navigateKeyGuide, returnFromKeyGuide, startKeyGuide, undoKeyGuide } from './hardwareKeys';
import { KEY_MODES, keyTasks, type KeyMode } from './hardwareKeySchemas';
import { keySteps } from './hardwareKeyCatalog';
import { evaluateAccess } from './securityModel';
import { recordControl } from './controlRecords';
import { removeEntry } from './removeEntry';
import { setMapArchive, setMapLifecycle } from './mapRecords';
import { createEncryptedVault, decryptVault, updateEncryptedVault } from './crypto';

const time='2026-11-14T12:00:00.000Z';let tick=0;
const stamp=()=>new Date(Date.parse(time)+ ++tick*1000).toISOString();
function fixture(mode:KeyMode='google-second-step'){
  const data=newDataset('ja'),provider=mode.startsWith('google')?'google':mode.startsWith('apple')?'apple':'bitwarden';
  data.assets=[{...makeAsset({kind:'account',type:provider==='bitwarden'?'Password manager':'Account',name:'確認するアカウント',importance:'critical'}),id:'account',provider,purpose:'personal'},...['pc','mac','phone'].map((id)=>({...makeAsset({kind:'device',type:id==='phone'?'Smartphone':'Computer',name:id,importance:'critical',operatingSystem:id==='phone'?'ios':id==='mac'?'macos':'windows'}),id}))];
  data.securityModel.entities=[{id:'key1',kind:'security-key',label:'青いキー',transports:['usb-c'],createdAt:time},{id:'key2',kind:'security-key',label:'予備のキー',transports:['usb-c'],createdAt:time},{id:'browser',kind:'installation',label:'個人の確認用ブラウザー',profileLabel:'個人用',productId:'chrome',deviceRef:provider==='apple'?'mac':'pc',createdAt:time}];
  data.guide={...data.guide,cursor:'manager-select',accountId:'account',answers:{private:'PRIVATE ANSWER NOT FOR AI'},history:['start','prior'],steps:{legacy:{status:'done',updatedAt:time}}};
  data.keepOpaque={same:'preserve'};
  return data;
}
function drive(input:Dataset,id:string,mode:KeyMode,until='finished',answers:Record<string,string>={},existing=false):CurrentDataset{
  let data=currentDatasetSchema.parse(input);
  for(let n=0;n<100;n++){
    const task=keyTasks(data).find(t=>t.id===id)!;const step=currentKeyStep(data,task);
    if(step.id===until||step.kind==='finished'||step.kind==='blocked')return data;
    let next:Dataset;
    if(step.kind==='operation')next=confirmKeyGuide(data,id,stamp());
    else {
      const defaults:Record<string,string>={mode,scope:'personal',protection:'standard',server:'us',vault:'new',device:mode==='apple-keys'?'mac':'pc','key-1':'key1','key-2':'key2','registration-1':existing?'existing':'new','registration-2':existing?'existing':'new','old-factor':'yes',encryption:'unsupported','enable-encryption':'no',browser:'browser','unlock-method':'master'};
      const value=answers[step.id]??defaults[step.id]??(step.kind==='text'?'新しい呼び名':step.choices![0].value);
      next=answerKeyGuide(data,id,value,stamp());
    }
    if(next===data)throw new Error(`No advance at ${step.id}`);data=currentDatasetSchema.parse(next);
  }
  throw new Error('Guide did not finish');
}
function taskOf(data:Dataset,id?:string){return keyTasks(data).find(t=>!id||t.id===id)!;}
describe('physical security-key guide',()=>{
  it('uses the intended provider’s sources before a mode is selected',()=>{
    for(const mode of ['google-second-step','apple-keys','bitwarden-login'] as const){const started=startKeyGuide(fixture(mode),'account','/map',stamp());const prefix=mode.startsWith('bitwarden')?'bw':mode.startsWith('apple')?'apple':'google';expect(currentKeyStep(started.data,taskOf(started.data)).sources.every(id=>id.startsWith(prefix))).toBe(true);}
  });
  for(const mode of KEY_MODES)for(const existing of [false,true])it(`${mode}: ${existing?'existing registration is checked without repeating enrollment':'new registration and actual use are distinct'}`,()=>{
    const input=fixture(mode),original=structuredClone(input.guide),started=startKeyGuide(input,'account','/map',stamp());
    let data=drive(started.data,started.id,mode,'test-open',{},existing),task=taskOf(data);
    expect(task.records['verify-1']).toBeDefined();expect(data.assets[0].controls.mfa).toBe('unknown');expect(data.securityModel.facts).toHaveLength(0);
    expect(!!task.records['start-registration']).toBe(!existing);
    data=drive(data,task.id,mode,undefined,{},existing) as CurrentDataset;task=taskOf(data);
    expect(task.status).toBe('completed');expect(data.guide).toEqual(original);expect(data.keepOpaque).toEqual(input.keepOpaque);
    expect(data.assets[0].controls.mfa).toBe(mode==='bitwarden-login'?'unknown':'verified');
    expect(data.securityModel.entities.filter(e=>e.kind==='credential')).toHaveLength(mode==='apple-keys'?2:1);
    expect(data.securityModel.facts.some(f=>f.hardwareKeyStep==='test-use-1'&&f.state==='available')).toBe(true);
    if(mode==='bitwarden-login'){expect(data.securityModel.relations.some(r=>r.kind==='decrypts')).toBe(false);expect(data.securityModel.facts.find(f=>f.hardwareKeyStep==='vault-read')?.hardwareKeyUnlockMethod).toBe('master');}
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it('tailors Apple settings to the actual device and records an iPad separately from a phone',()=>{
    const started=startKeyGuide(fixture('apple-keys'),'account','/map',stamp());
    const ipad=drive(started.data,started.id,'apple-keys','open-settings',{device:'new','device-os':'ios','device-kind':'ipad','device-label':'自分のiPad'});
    const t=taskOf(ipad),device=ipad.assets.find(a=>a.id===t.deviceRef)!;
    expect(device.type).toBe('Tablet');expect(currentKeyStep(ipad,t).action.en).not.toContain('System Settings');
    const reading=drive(ipad,t.id,'apple-keys','read-1');expect(keySteps(reading,taskOf(reading)).find(s=>s.id==='read-1')?.action.en).not.toContain('NFC');
    const mac=drive(started.data,started.id,'apple-keys','open-settings');expect(currentKeyStep(mac,taskOf(mac)).action.en).toContain('System Settings');
  });
  it('records selection without a completed setting, and refuses a forged later cursor',()=>{
    const started=startKeyGuide(fixture(),'account','/map',stamp());let data=drive(started.data,started.id,'google-second-step','open-settings') as CurrentDataset;
    expect(data.securityModel.entities.filter(e=>e.kind==='credential')).toHaveLength(0);expect(data.actions).toHaveLength(0);
    data={...data,securityModel:{...data.securityModel,hardwareKeysV1:{version:1,tasks:[{...taskOf(data),cursor:'test-use-1'}]}}};
    const next=confirmKeyGuide(data,started.id,stamp()) as CurrentDataset;expect(taskOf(next).records['test-use-1']).toBeUndefined();expect(taskOf(next).records['open-settings']).toBeDefined();
  });
  it('reuses an actual registration but separates accounts and different key purposes',()=>{
    let input=fixture();const first=startKeyGuide(input,'account','/map',stamp());let data=drive(first.data,first.id,'google-second-step') as CurrentDataset;
    const ref=taskOf(data).registrationRefs[0],start2=startKeyGuide(data,'account','/map',stamp());
    data=drive(start2.data,start2.id,'google-second-step',undefined,{'registration-1':`ref:${ref}`}) as CurrentDataset;
    expect(taskOf(data,start2.id).registrationRefs[0]).toBe(ref);expect(data.securityModel.entities.filter(e=>e.kind==='credential')).toHaveLength(1);
    data.assets.push({...data.assets[0],id:'other',name:'別の個人用アカウント'});const other=startKeyGuide(data,'other','/map',stamp());
    data=drive(other.data,other.id,'google-second-step') as CurrentDataset;expect(taskOf(data,other.id).registrationRefs[0]).not.toBe(ref);
    const passkey=startKeyGuide(data,'account','/map',stamp());data=drive(passkey.data,passkey.id,'google-passkey') as CurrentDataset;
    expect(taskOf(data,passkey.id).registrationRefs[0]).not.toBe(ref);expect(data.securityModel.entities.filter(e=>e.kind==='security-key')).toHaveLength(2);
  });
  it('requires two distinct Apple keys and a second fresh sign-in, not two names for one reference',()=>{
    const started=startKeyGuide(fixture('apple-keys'),'account','/map',stamp());let data=drive(started.data,started.id,'apple-keys','key-2');
    expect(answerKeyGuide(data,started.id,'key1',stamp())).toBe(data);
    data=drive(data,started.id,'apple-keys','prepare-second-test');expect(data.assets[0].controls.mfa).toBe('unknown');
    data=drive(data,started.id,'apple-keys');expect(data.assets[0].controls.mfa).toBe('verified');
  });
  it('explicitly reuses manual FIDO2 second-step records and a Google passkey in its second-step role',()=>{
    const input=fixture('bitwarden-second-step');input.securityModel.entities.push({id:'manual',kind:'credential',label:'手動で確認した2段階用',credentialType:'passkey',subjectRef:'account',storageRef:'key1',roles:['second-step'],createdAt:time,opaque:'keep'});
    const started=startKeyGuide(input,'account','/map',stamp()),data=drive(started.data,started.id,'bitwarden-second-step',undefined,{'registration-1':'ref:manual'});
    expect(taskOf(data).registrationRefs).toEqual(['manual']);expect(data.securityModel.entities.filter(e=>e.kind==='credential')).toHaveLength(1);expect(data.securityModel.entities.find(e=>e.id==='manual')?.opaque).toBe('keep');
    const g=startKeyGuide(fixture('google-passkey'),'account','/map',stamp()),passkey=drive(g.data,g.id,'google-passkey'),ref=taskOf(passkey).registrationRefs[0],second=startKeyGuide(passkey,'account','/map',stamp());
    const reused=drive(second.data,second.id,'google-second-step',undefined,{'registration-1':`ref:${ref}`});expect(taskOf(reused,second.id).registrationRefs).toEqual([ref]);expect(reused.securityModel.entities.filter(e=>e.kind==='credential')).toHaveLength(1);
  });
  it('withdraws dependent use and its own progress on undo while keeping real registrations and old confirmations',()=>{
    let input=fixture();input=recordControl(input,'account','mfa',{id:'prior-mfa',origin:'legacy'},stamp()) as CurrentDataset;
    const started=startKeyGuide(input,'account','/map',stamp());let data=drive(started.data,started.id,'google-second-step') as CurrentDataset;const task=taskOf(data);
    const ref=task.registrationRefs[0];data=undoKeyGuide(data,task.id,'verify-1',stamp()) as CurrentDataset;
    expect(data.assets[0].controls.mfa).toBe('verified');expect(data.actions.map(a=>a.id)).toContain('prior-mfa');
    expect(data.actions.some(a=>a.origin==='hardware-key-guide')).toBe(false);expect(data.securityModel.entities.some(e=>e.id===ref)).toBe(true);
    expect(data.securityModel.lifecycle[ref]).toBeUndefined();expect(data.securityModel.facts.every(f=>f.state==='unknown')).toBe(true);
    expect(data.securityModel.relations.filter(r=>r.fromRef===ref).every(r=>r.evidence==='unknown')).toBe(true);expect(taskOf(data).records['test-use-1']).toBeUndefined();
  });
  it('does not count elapsed Google waiting time as key use; defer and resume preserve the exact step and main guide',()=>{
    const input=fixture(),started=startKeyGuide(input,'account','/map',stamp());let data=drive(started.data,started.id,'google-passkey','test-use-1');
    data=navigateKeyGuide(data,started.id,'defer',stamp()) as CurrentDataset;const resumed=startKeyGuide(data,'account','/guide','2027-01-01T00:00:00.000Z');
    expect(resumed.id).toBe(started.id);expect(currentKeyStep(resumed.data,taskOf(resumed.data)).id).toBe('test-use-1');expect(resumed.data.guide).toEqual(input.guide);expect(resumed.data.assets[0].controls.mfa).toBe('unknown');
  });
  it('retains settings but requires actual use again after physical loss/reset, without invalidating an independent spare test',()=>{
    const started=startKeyGuide(fixture('apple-keys'),'account','/map',stamp());let data=drive(started.data,started.id,'apple-keys') as CurrentDataset,task=taskOf(data);
    data=setMapLifecycle(data,'key1','lost');data=setMapLifecycle(data,'key1','in-use');
    // Map clock is real; make the reset follow the synthetic test observations.
    data.securityModel.lifecycle.key1={...data.securityModel.lifecycle.key1,accessResetAt:'2028-01-01T00:00:00.000Z'};
    expect(keyRecordValid(data,task,'test-use-1')).toBe(false);expect(keyRecordValid(data,task,'test-use-2')).toBe(true);
    expect(keyRecordValid(data,task,'verify-1')).toBe(true);expect(currentKeyStep(data,task).id).toBe('test-start-1');
    const own=data.securityModel.routes.find(r=>r.hardwareKeyTaskRef===task.id&&r.requirements.kind==='fact'&&r.requirements.factId.endsWith('test-use-1'))!;
    expect(evaluateAccess(data.securityModel,own.id,{context:'normal',now:'2029-01-01T00:00:00.000Z'}).state).not.toBe('available');
  });
  it('blocks unavailable actors in both engine and UI model without deleting their task',()=>{
    const started=startKeyGuide(fixture(),'account','/map',stamp());let data=drive(started.data,started.id,'google-second-step','compatibility') as CurrentDataset;
    data=setMapLifecycle(data,'key1','lost');expect(currentKeyStep(data,taskOf(data)).kind).toBe('blocked');expect(confirmKeyGuide(data,started.id,stamp())).toBe(data);
    expect(taskOf(data).keyRefs).toEqual(['key1']);
  });
  it('keeps login and PRF decryption separate, including enabling existing supported encryption',()=>{
    const started=startKeyGuide(fixture('bitwarden-login'),'account','/map',stamp());let data=drive(started.data,started.id,'bitwarden-login',undefined,{encryption:'available','enable-encryption':'yes','encryption-after':'used','unlock-method':'key'}) as CurrentDataset;
    expect(taskOf(data).records['set-encryption']).toBeDefined();expect(data.securityModel.relations.some(r=>r.kind==='decrypts'&&r.evidence==='user-confirmed')).toBe(true);expect(data.assets[0].controls.mfa).toBe('unknown');
    data=undoKeyGuide(data,started.id,'vault-read',stamp()) as CurrentDataset;expect(data.securityModel.relations.find(r=>r.kind==='decrypts')?.evidence).toBe('unknown');
    const notSupported=startKeyGuide(fixture('bitwarden-login'),'account','/map',stamp()),before=drive(notSupported.data,notSupported.id,'bitwarden-login','unlock-method');
    expect(answerKeyGuide(before,notSupported.id,'key',stamp())).toBe(before);
  });
  it('stores a first-factor recovery code before trying a new Bitwarden sign-in, without consuming it',()=>{
    const started=startKeyGuide(fixture('bitwarden-second-step'),'account','/map',stamp());let data=drive(started.data,started.id,'bitwarden-second-step','recovery-after',{'old-factor':'no'}) as CurrentDataset;
    expect(taskOf(data).records['verify-1']).toBeDefined();expect(taskOf(data).records['test-open']).toBeUndefined();
    data=drive(data,started.id,'bitwarden-second-step',undefined,{'old-factor':'no'}) as CurrentDataset;expect(data.assets[0].controls.recovery).toBe('verified');
    expect(JSON.stringify(taskOf(data))).not.toContain('recover-2fa');
  });
  for(const [mode,answers,blocked] of [['google-passkey',{protection:'advanced'},'advanced'],['apple-keys',{scope:'managed'},'managed'],['bitwarden-login',{server:'other'},'server-blocked']] as const)it(`keeps ${blocked} separate from standard personal setup`,()=>{
    const started=startKeyGuide(fixture(mode),'account','/map',stamp()),data=drive(started.data,started.id,mode,undefined,answers);
    expect(currentKeyStep(data,taskOf(data)).id).toBe(blocked);expect(data.securityModel.facts).toHaveLength(0);expect(data.actions).toHaveLength(0);
  });
  it('cannot change a confirmed registration’s identity through Back or silently move a Bitwarden account between regions',()=>{
    const input=fixture('bitwarden-second-step');input.guide.answers['account:region']='eu';const started=startKeyGuide(input,'account','/map',stamp());let data=drive(started.data,started.id,'bitwarden-second-step','server');
    expect(answerKeyGuide(data,started.id,'us',stamp())).toBe(data);data=drive(data,started.id,'bitwarden-second-step','test-open',{server:'eu'}) as CurrentDataset;
    const t=taskOf(data);data={...data,securityModel:{...data.securityModel,hardwareKeysV1:{version:1,tasks:[{...t,cursor:'key-1'}]}}};
    expect(answerKeyGuide(data,t.id,'key2',stamp())).toBe(data);expect(data.assets[0].hardwareKeyServer).toBe('eu');
  });
  it('starts a new task after cancel, without undoing the real prior registration or losing other work',()=>{
    const started=startKeyGuide(fixture(),'account','/map',stamp());let data=drive(started.data,started.id,'google-second-step','test-open');data=navigateKeyGuide(data,started.id,'cancel',stamp()) as CurrentDataset;
    expect(confirmKeyGuide(data,started.id,stamp())).toBe(data);const next=startKeyGuide(data,'account','/map',stamp());expect(next.id).not.toBe(started.id);expect(keyTasks(next.data)).toHaveLength(2);expect(next.data.securityModel.entities.some(e=>e.kind==='credential')).toBe(true);const separate=startKeyGuide(next.data,'account','/map',stamp(),true);expect(separate.id).not.toBe(next.id);expect(keyTasks(separate.data)).toHaveLength(3);
  });
  it('validates all actual references, refuses deletion, preserves revision 7 through Map writes and retains opaque fields',()=>{
    const started=startKeyGuide(fixture(),'account','/map',stamp()),data=drive(started.data,started.id,'google-second-step') as CurrentDataset;
    expect(removeEntry(data,'account')).toBeUndefined();expect(removeEntry(data,'pc')).toBeUndefined();const map=setMapArchive(data,'key1',true);expect(map.securityModel.revision).toBe(7);expect(keyTasks(map)).toEqual(keyTasks(data));
    const bad=structuredClone(data),store=bad.securityModel.hardwareKeysV1 as {tasks:{keyRefs:string[]}[]};store.tasks[0].keyRefs=['account'];expect(currentDatasetSchema.safeParse(bad).success).toBe(false);
  });
  it('upgrades old payloads only on use, preserves opaque data and refuses reserved-name collisions without mutation',()=>{
    const raw:Record<string,unknown>={...fixture(),version:1,oldProgress:{x:1}};delete raw.securityModel;delete raw.deviceWorkflows;const old=legacyDatasetSchema.parse(raw),before=structuredClone(old);
    const next=startKeyGuide(old,'account','/map',stamp());expect(old).toEqual(before);expect(next.data.version).toBe(2);expect(next.data.oldProgress).toEqual({x:1});expect(next.data.guide).toEqual(old.guide);
    const conflict=fixture();conflict.securityModel.hardwareKeysV1={opaque:'legacy'};const preserved=structuredClone(conflict);expect(()=>startKeyGuide(conflict,'account')).toThrow('legacy-feature-key-conflict');expect(conflict).toEqual(preserved);
  });
  it('encrypts and restores a partially completed key task at the exact step',async()=>{
    const started=startKeyGuide(fixture(),'account','/map',stamp()),data=drive(started.data,started.id,'google-passkey','test-use-1');
    const vault=await createEncryptedVault('long testing passphrase',data),opened=await decryptVault(vault.envelope,'long testing passphrase');const updated=await updateEncryptedVault(opened.data,opened.context),restored=await decryptVault(updated,'long testing passphrase');
    expect(keyTasks(restored.data)).toEqual(keyTasks(data));expect(currentKeyStep(restored.data,taskOf(restored.data)).id).toBe('test-use-1');
  });
  it('keeps private nicknames, opaque answers and secret values out of AI prompts, and requires current official sources',()=>{
    const started=startKeyGuide(fixture(),'account','/map',stamp()),data=drive(started.data,started.id,'google-second-step','test-use-1');
    const prompt=keyHelpPrompt(data,taskOf(data),3,'ja');expect(prompt).toContain('最新');expect(prompt).toContain('https://support.google.com/');expect(prompt).toContain('windows');expect(prompt).not.toContain('PRIVATE ANSWER');expect(prompt).not.toContain('青いキー');expect(prompt).not.toContain('確認するアカウント');
    const adding=startKeyGuide(fixture(),'account','/map',stamp());let name=drive(adding.data,adding.id,'google-second-step','device-label',{device:'new','device-os':'windows'});expect(answerKeyGuide(name,adding.id,'private@example.com')).toBe(name);
  });
  it('returns from completed main MFA in one action and preserves a main guide changed while the optional task was open',()=>{
    const input=fixture();input.guide.cursor='do/account/email-mfa/open';const started=startKeyGuide(input,'account','/guide',stamp()),completed=drive(started.data,started.id,'google-second-step') as CurrentDataset;
    expect(returnFromKeyGuide(completed,started.id).guide.cursor).toMatch(/^do\/account\/recovery\//);
    const changed={...completed,guide:{...completed.guide,cursor:'device-select'}};expect(returnFromKeyGuide(changed,started.id)).toBe(changed);
  });
});
