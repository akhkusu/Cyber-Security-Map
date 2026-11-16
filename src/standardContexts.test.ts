import {mapConnections} from './securityMapViews';
import {invalidateStandardAccount} from './standardInvalidation';
import {describe,it,expect} from 'vitest';
import {newDataset,makeAsset,currentDatasetSchema,DataUpgradeConflict} from './models';
import {addStandardVault,addStandardApp,selectStandardDevice,selectStandardApp,selectedStandardContext,standardContextReady,standardContextScope,standardStore,recordStandardObservation,standardObservationCurrent,updateStandardCheck,confirmStandardContext} from './standardContexts';
import {withStandardContext} from '../e2e/standard-fixture';
import {createEncryptedVault,decryptVault} from './crypto';
import {saveOnePasswordAccount,onePasswordScope} from './onePasswordAccount';
import {onePasswordHost} from './standardManagerSchemas';
import {standardPasswordMetadata,hasSavedPasswordCandidate,standardPasswordRedirect} from './passwordContext';
import {evaluateAccess} from './securityModel';
import {removeEntry} from './removeEntry';
import {onePasswordHelp} from './onePasswordHelp';

function fixture(){const data=newDataset('ja');data.assets=[{...makeAsset({kind:'account',type:'Password manager',name:'Manager',importance:'critical'}),id:'manager',provider:'bitwarden',purpose:'personal',services:['manager']},{...makeAsset({kind:'device',type:'Computer',name:'Computer',importance:'critical',operatingSystem:'windows'}),id:'computer'},{...makeAsset({kind:'device',type:'Smartphone',name:'Phone',importance:'critical',operatingSystem:'ios'}),id:'phone'},{...makeAsset({kind:'account',type:'Primary email',name:'Mail',importance:'critical'}),id:'mail',provider:'google',purpose:'personal'}];data.guide.managerId='manager';data.guide.answers['manager:region']='eu';return data;}
describe('typed standard manager contexts',()=>{
 it('preserves the Account ID and creates no access proof from a vault, device or app selection',()=>{
  const data=fixture(),before=structuredClone(data.assets),v=addStandardVault(data,'manager','Personal','private'),vault=standardStore(v);expect(vault?.observations).toEqual([]);
  const next=addStandardApp(selectStandardDevice(v,'manager','computer'),'manager','web','Work profile');
  expect(next.assets).toEqual(before);expect(selectedStandardContext(next,'manager')).toBeDefined();expect(standardContextReady(next,'manager')).toBe(false);expect(currentDatasetSchema.safeParse(next).success).toBe(true);
 });
 it('keeps two vaults in one physical app on one device without creating a second device or shared success',()=>{
  let data=withStandardContext(fixture(),'manager');const first=selectedStandardContext(data,'manager')!;
  data=addStandardVault(data,'manager','Another private vault','private') as typeof data;data=selectStandardDevice(data,'manager',first.app.deviceRef) as typeof data;data=selectStandardApp(data,'manager',first.app.id) as typeof data;
  expect(selectedStandardContext(data,'manager')?.app.id).toBe(first.app.id);expect(data.assets.filter(a=>a.kind==='device')).toHaveLength(2);expect(standardContextReady(data,'manager')).toBe(false);
  data=confirmStandardContext(data,'manager') as typeof data;data=confirmStandardContext(data,'manager') as typeof data;
  expect(standardContextReady(data,'manager')).toBe(true);expect(standardStore(data)?.observations.filter(o=>o.kind==='opened').map(o=>o.vaultRef)).toEqual(expect.arrayContaining([first.vault.id,selectedStandardContext(data,'manager')!.vault.id]));
 });
 it('never borrows opening or filling from another physical device',()=>{
  let data=withStandardContext(fixture(),'manager');const vault=selectedStandardContext(data,'manager')!.vault;
  data=updateStandardCheck(data,'manager',{vaultRef:vault.id,stage:'device'}) as typeof data;data=addStandardApp(selectStandardDevice(data,'manager','phone'),'manager','app','Personal') as typeof data;
  expect(standardContextReady(data,'manager')).toBe(false);expect(standardStore(data)?.observations.filter(o=>o.appRef===selectedStandardContext(data,'manager')!.app.id)).toHaveLength(0);
 });
 it('binds candidates to the account, exact vault and client, preserving an accepted change instead of repeating it',()=>{
  let data=withStandardContext(fixture(),'manager');const original=selectedStandardContext(data,'manager')!;
  data.guide.steps['do/mail/password/save-candidate']={status:'done',updatedAt:new Date().toISOString(),...standardPasswordMetadata(data,'mail','save-candidate')};expect(hasSavedPasswordCandidate(data,'mail')).toBe(true);
  data.guide.steps['do/mail/password/apply']={status:'done',updatedAt:new Date().toISOString(),...standardPasswordMetadata(data,'mail','apply')};
  data=addStandardVault(data,'manager','Shared','shared') as typeof data;data=addStandardApp(selectStandardDevice(data,'manager','computer'),'manager','web','Another') as typeof data;
  expect(hasSavedPasswordCandidate(data,'mail')).toBe(false);expect(standardPasswordRedirect(data,'mail','generate')).toBe('standard-password-result/mail');expect(standardContextReady(data,'manager','web',true)).toBe(false);
  expect(data.securityModel.entities.some(e=>e.id===original.vault.id)).toBe(true);
 });
 it('records use for the exact target and keeps untested loss scenarios partial',()=>{
  let data=withStandardContext(fixture(),'manager');data=recordStandardObservation(data,'manager','password-use',{subjectRef:'mail',attempt:'a'}) as typeof data;
  expect(standardObservationCurrent(data,'manager','password-use','mail','a')).toBe(true);expect(standardObservationCurrent(data,'manager','password-use','manager','a')).toBe(false);
  const observed=standardStore(data)!.observations.at(-1)!,route=`standard:${observed.id}:route`;
  expect(evaluateAccess(data.securityModel,route,{context:'normal',now:new Date().toISOString()}).state).toBe('available');
  expect(evaluateAccess(data.securityModel,route,{context:'normal',unavailableRefs:['phone'],now:new Date().toISOString()}).state).toBe('unknown');
  expect(evaluateAccess(data.securityModel,route,{context:'normal',unavailableRefs:[selectedStandardContext(data,'manager')!.app.deviceRef],now:new Date().toISOString()}).state).toBe('unavailable');
 });
 it('does not turn authorization, filling configuration or recovery preparation into a vault-access route',()=>{
  let data=withStandardContext(fixture(),'manager');
  const routes=structuredClone(data.securityModel.routes);
  for(const kind of ['sso-link','autofill','recovery'] as const)data=recordStandardObservation(data,'manager',kind,{sourceKey:`test:${kind}`}) as typeof data;
  expect(data.securityModel.routes).toEqual(routes);
 });
 it('keeps proof on its original physical device and profile even if an app record is edited',()=>{
  const data=withStandardContext(fixture(),'manager'),app=selectedStandardContext(data,'manager')!.app,opened=standardStore(data)!.observations.find(o=>o.kind==='opened')!;
  const moved={...data,securityModel:{...data.securityModel,entities:data.securityModel.entities.map(e=>e.id===app.id?{...app,deviceRef:'phone'}:e)}};
  expect(currentDatasetSchema.safeParse(moved).success).toBe(true);expect(standardContextReady(moved,'manager')).toBe(false);
  expect(evaluateAccess(moved.securityModel,`standard:${opened.id}:route`,{context:'normal',now:new Date().toISOString()}).state).toBe('unknown');
  expect(standardContextScope(moved,'manager')).not.toBe(standardContextScope(data,'manager'));
 });
 it('preserves unknown fact metadata on reconfirmation, and records a changed account scope as new history',()=>{
  const d=fixture();d.assets[0].provider='1password';let data=withStandardContext(d,'manager');data=recordStandardObservation(data,'manager','opened',{sourceKey:'stable-step'}) as typeof data;
  const first=standardStore(data)!.observations.at(-1)!;data.securityModel.facts.find(f=>f.id===`standard:${first.id}`)!.opaque={keep:true};
  data=recordStandardObservation(data,'manager','opened',{sourceKey:'stable-step'}) as typeof data;expect(data.securityModel.facts.find(f=>f.id===`standard:${first.id}`)?.opaque).toEqual({keep:true});
  data=saveOnePasswordAccount(data,'manager',{host:'family.1password.eu',kind:'family',method:'password'},'correct') as typeof data;
  data=recordStandardObservation(data,'manager','opened',{sourceKey:'stable-step'}) as typeof data;
  expect(standardStore(data)?.observations.find(o=>o.id===first.id)?.active).toBe(false);expect(standardStore(data)?.observations.at(-1)?.id).not.toBe(first.id);
 });
 it('round trips exact context, opaque fields, old Account ID and confirmations in encrypted backups',async()=>{
  const data=withStandardContext(fixture(),'manager');data.securityModel.opaque={retained:true};const encrypted=await createEncryptedVault('private test storage phrase',data),restored=(await decryptVault(encrypted.envelope,'private test storage phrase')).data;
  expect(restored).toEqual(data);expect(standardContextScope(restored,'manager')).toBe(standardContextScope(data,'manager'));expect(JSON.stringify(encrypted.envelope)).not.toContain('Fixture private vault');expect(removeEntry(data,'manager')).toBeUndefined();
 });
 it('refuses unsupported future stores without replacing them',()=>{
  const data=fixture();data.securityModel.standardManagersV1={version:99,opaque:{keep:true}};const before=structuredClone(data);
  expect(()=>addStandardVault(data,'manager','Private','private')).toThrow(DataUpgradeConflict);expect(data).toEqual(before);
 });
 it('requires a new saved-candidate confirmation after a new generation, before any accepted change',()=>{
  const data=withStandardContext(fixture(),'manager');
  data.guide.steps['do/mail/password/save-candidate']={status:'done',updatedAt:new Date().toISOString(),...standardPasswordMetadata(data,'mail','save-candidate')};expect(hasSavedPasswordCandidate(data,'mail')).toBe(true);
  data.guide.steps['do/mail/password/generate']={status:'done',updatedAt:new Date().toISOString(),...standardPasswordMetadata(data,'mail','generate')};expect(hasSavedPasswordCandidate(data,'mail')).toBe(false);
  data.guide.steps['do/mail/password/save-candidate']={status:'done',updatedAt:new Date().toISOString(),...standardPasswordMetadata(data,'mail','save-candidate')};expect(hasSavedPasswordCandidate(data,'mail')).toBe(true);
 });
});
describe('1Password account identity',()=>{
 for(const host of ['my.1password.com','my.1password.ca','my.1password.eu','our-team.1password.eu'])it(`accepts the explicitly read host ${host}`,()=>expect(onePasswordHost(`https://${host}/`)).toBe(host));
 for(const value of ['https://my.1password.com/secret','https://me:secret@my.1password.com/','https://my.1password.com/?secret=value','https://my.1password.com/#secret','start.1password.com','support.1password.com','my.1password.com.attacker.test','http://my.1password.com','my.1password.com:443'])it(`rejects credentials, non-host content and unverified host shape: ${value}`,()=>expect(()=>onePasswordHost(value)).toThrow());
 it('distinguishes account kind from work use and changes only explicitly corrected identity',()=>{
  const data=fixture();data.assets[0].provider='1password';data.assets[0].purpose='work';data.assets[0].controls.mfa='verified';
  const saved=saveOnePasswordAccount(data,'manager',{host:'my.1password.eu',kind:'individual',method:'password'});const first=onePasswordScope(saved,'manager');
  const pending=saveOnePasswordAccount(saved,'manager',{host:'our-team.1password.eu',kind:'business',method:'sso'});expect(onePasswordScope(pending,'manager')).toBe(first);
  const corrected=saveOnePasswordAccount(pending,'manager',{host:'our-team.1password.eu',kind:'business',method:'sso'},'correct');expect(onePasswordScope(corrected,'manager')).not.toBe(first);expect(corrected.assets[0].controls.mfa).toBe('verified');expect(corrected.assets[0].id).toBe('manager');
 });
 it('requires a separate Account for a region migration and never copies MFA',()=>{
  const data=fixture();data.assets[0].provider='1password';data.assets[0].controls.mfa='verified';const a=saveOnePasswordAccount(data,'manager',{host:'my.1password.eu',kind:'individual',method:'password'});
  const correction=saveOnePasswordAccount(a,'manager',{host:'my.1password.com',kind:'individual',method:'password'},'correct');expect(onePasswordScope(correction,'manager')).toBe(onePasswordScope(a,'manager'));
  const separate=saveOnePasswordAccount(correction,'manager',{host:'my.1password.com',kind:'individual',method:'password'},'separate');expect(separate.guide.managerId).not.toBe('manager');expect(separate.assets.find(a=>a.id===separate.guide.managerId)?.controls.mfa).toBe('unknown');
 });
 it('invalidates old access observations after a known change without losing history',()=>{
  const d=fixture();d.assets[0].provider='1password';const data=withStandardContext(d,'manager');const old=standardStore(data)!.observations;
  const corrected=saveOnePasswordAccount(data,'manager',{host:'family.1password.eu',kind:'family',method:'password'},'correct');expect(standardContextReady(corrected,'manager')).toBe(false);expect(standardStore(corrected)?.observations).toHaveLength(old.length);expect(standardStore(corrected)?.observations.every(o=>!o.active)).toBe(true);
 });
 it('exports only allowlisted region, method and source labels for help',()=>{
  const d=fixture();d.assets[0].provider='1password';d.assets[0].name='PRIVATE ACCOUNT';const data=saveOnePasswordAccount(d,'manager',{host:'private-organization.1password.eu',kind:'business',method:'sso'});
  data.guide.answers.private='private@example.com';
  for(const language of ['ja','en'] as const){const prompt=onePasswordHelp(data,'manager',language);for(const value of ['PRIVATE ACCOUNT','private-organization','private@example.com'])expect(prompt).not.toContain(value);expect(prompt).toContain('Region: EU');expect(prompt).toContain('Method: sso');}
 });
});

it('Map prefers a reconfirmed connection over the same historical connection and retains its evidence',()=>{
 let data=withStandardContext(fixture(),'manager');
 const first=mapConnections(data).filter(r=>r.typed);expect(first.length).toBeGreaterThan(0);
 data=invalidateStandardAccount(data,'manager') as typeof data;expect(mapConnections(data).filter(r=>r.typed).every(r=>r.historical)).toBe(true);
 const historical=structuredClone(data.securityModel.relations);
 data=recordStandardObservation(data,'manager','opened',{sourceKey:'new-confirmation'}) as typeof data;
 expect(mapConnections(data).filter(r=>r.typed).every(r=>!r.historical)).toBe(true);
 for(const relation of historical)expect(data.securityModel.relations).toContainEqual(relation);
});
