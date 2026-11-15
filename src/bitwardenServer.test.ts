import {withStandardContext} from '../e2e/standard-fixture';
import {standardPasswordMetadata} from './passwordContext';
import {describe,it,expect} from 'vitest';
import {makeAsset,newDataset,DataUpgradeConflict} from './models';
import {beginRecipe,completeStep,currentTask,guidePresentation,move,taskCursor} from './guideEngine';
import {managerRecipe,passwordRecipe} from './guideCatalog';
import {standardPasswordScope,hasSavedPasswordCandidate} from './passwordContext';
import {createEncryptedVault,decryptVault} from './crypto';
import {bitwardenRegion,bitwardenServerCheck,bitwardenServerHelp,bitwardenWebURL,chooseBitwardenServer,openBitwardenServerCheck,updateBitwardenServerCheck} from './bitwardenServer';
function fixture(region?:string){
 let d=newDataset('ja');const mail={...makeAsset({kind:'account',type:'Primary email',name:'PRIVATE MAIL',importance:'critical'}),id:'mail',provider:'google' as const,purpose:'personal' as const},manager={...makeAsset({kind:'account',type:'Password manager',name:'PRIVATE MANAGER',importance:'critical'}),id:'manager',provider:'bitwarden' as const,purpose:'personal' as const};
 mail.controls.mfa='verified';mail.controls.recovery='verified';manager.controls.mfa='verified';manager.controls.recovery='verified';d.assets=[mail,manager];d.guide.accountId='mail';d.guide.managerId='manager';d.guide.answers['manager:platform']='ios';if(region)d.guide.answers['manager:region']=region;
 if(region==='us'||region==='eu')d=withStandardContext(d,'manager');
 d.guide.steps[taskCursor('mail','password','save-candidate')]={status:'done',updatedAt:'2026-01-01',...standardPasswordMetadata(d,'mail','save-candidate'),managerRef:'manager',managerScope:'bitwarden:us',standardPasswordAttemptV1:'fixture-candidate',opaque:{keep:true}};
 return move(d,taskCursor('mail','password','apply'));
}
describe('Bitwarden account server identity',()=>{
 it('creates independent guide defaults for separate new datasets',()=>{const first=newDataset(),second=newDataset();expect(first.guide.answers).not.toBe(second.guide.answers);expect(first.guide.steps).not.toBe(second.guide.steps);expect(first.guide.history).not.toBe(second.guide.history);first.guide.answers['private-fixture-key']='first only';expect(second.guide.answers['private-fixture-key']).toBeUndefined();expect(newDataset().guide.answers['private-fixture-key']).toBeUndefined();});
 for(const value of [undefined,'','self-hosted','unknown','US','PRIVATE URL'])it(`does not turn ${String(value)} into a US account or URL`,()=>{
  const d=fixture(value),before=structuredClone(d);expect(bitwardenRegion(d,'manager')).toBeUndefined();expect(bitwardenWebURL(value)).toBeUndefined();expect(standardPasswordScope(d)).toBeUndefined();expect(hasSavedPasswordCandidate(d,'mail')).toBe(false);
  expect(currentTask(d)?.redirectTo).toBe('standard-server/manager');expect(guidePresentation(d).data).toEqual(before);expect(d).toEqual(before);
  expect(managerRecipe('bitwarden','ios',value).steps.filter(s=>s.url).map(s=>s.url)).not.toContain('https://vault.bitwarden.com/');expect(passwordRecipe('bitwarden',d.assets[0],'web',value).steps.filter(s=>s.url).map(s=>s.url)).not.toContain('https://vault.bitwarden.com/');
 });
 it('keeps an explicit legacy US server and its candidate without resetting any protection',()=>{
  const d=fixture('us'),before=structuredClone(d);expect(bitwardenRegion(d,'manager')).toBe('us');expect(standardPasswordScope(d)).toBe('bitwarden:us');expect(hasSavedPasswordCandidate(d,'mail')).toBe(true);expect(currentTask(d)?.redirectTo).toBeUndefined();expect(d).toEqual(before);
 });
 it('asks only when a server-specific operation is needed',()=>{
  const d=fixture();expect(currentTask(move(d,taskCursor('manager','manager','install')))?.redirectTo).toBeUndefined();expect(currentTask(move(d,taskCursor('manager','manager','master')))?.redirectTo).toBeUndefined();expect(currentTask(move(d,taskCursor('manager','manager','create')))?.redirectTo).toBe('standard-server/manager');
 });
 it('returns to the exact interrupted step and preserves old controls, unknown fields and all confirmations',()=>{
  const d=fixture(),before=structuredClone(d),started=updateBitwardenServerCheck(d,'manager',{where:'ios',stage:'read'}),result=chooseBitwardenServer(started,'manager','us');
  expect(result.guide.cursor).toBe(before.guide.cursor);expect(result.guide.steps).toEqual(before.guide.steps);expect(result.actions).toEqual(before.actions);expect(result.assets.map(a=>a.controls)).toEqual(before.assets.map(a=>a.controls));expect(result.assets[1].id).toBe('manager');expect(result.assets[1].bitwardenServerV1).toMatchObject({version:1,region:'us',evidence:'user-confirmed'});expect(currentTask(result)?.redirectTo).toBe('standard-context/manager/web/write/verify');expect(d).toEqual(before);
 });
 it('keeps the return point even when a direct completion caller opens the missing prerequisite',()=>{
  const d=fixture(),next=completeStep(d);expect(next.guide.cursor).toBe('standard-server/manager');expect(bitwardenServerCheck(next,'manager').returnCursor).toBe(d.guide.cursor);expect(next.guide.steps).toEqual(d.guide.steps);expect(chooseBitwardenServer(next,'manager','us').guide.cursor).toBe(d.guide.cursor);
 });
 it('distinguishes choosing a new account region from confirming an existing account',()=>{
  const d=move(fixture(),taskCursor('manager','manager','create')),chosen=chooseBitwardenServer(d,'manager','eu');expect(chosen.assets[1].bitwardenServerV1).toMatchObject({evidence:'selected-for-new'});expect(chosen.assets[1].controls).toEqual(d.assets[1].controls);const created=completeStep(chosen);expect(created.assets[1].bitwardenServerV1).toMatchObject({region:'eu',evidence:'user-confirmed'});expect(created.guide.cursor).toBe(taskCursor('manager','manager','paper'));
 });
 it('requires a decision before replacing a different saved server',()=>{
  const d=openBitwardenServerCheck(fixture('us'),'manager'),next=chooseBitwardenServer(d,'manager','eu');expect(bitwardenServerCheck(next,'manager')).toMatchObject({stage:'different',selected:'eu'});expect(bitwardenRegion(next,'manager')).toBe('us');expect(next.assets).toEqual(d.assets);expect(next.guide.steps).toEqual(d.guide.steps);
 });
 it('corrects only this same account’s metadata, without reusing a candidate from another server',()=>{
  const d=openBitwardenServerCheck(fixture('us'),'manager'),next=chooseBitwardenServer(chooseBitwardenServer(d,'manager','eu'),'manager','eu','correct');expect(next.assets).toHaveLength(d.assets.length);expect(next.guide.managerId).toBe('manager');expect(next.guide.steps).toEqual(d.guide.steps);expect(hasSavedPasswordCandidate(next,'mail')).toBe(false);expect(currentTask(next)?.redirectTo).toBe('standard-context/manager/web/write/verify');expect(currentTask(withStandardContext(next,'manager'))?.redirectTo).toBe(taskCursor('mail','password','save-candidate'));expect(next.assets[1].controls.mfa).toBe('verified');
 });
 it('keeps a separate account separate, including protection and saved candidates',()=>{
  const d=openBitwardenServerCheck(fixture('us'),'manager'),next=chooseBitwardenServer(chooseBitwardenServer(d,'manager','eu'),'manager','eu','separate'),id=next.guide.managerId!;expect(id).not.toBe('manager');expect(next.assets.find(a=>a.id==='manager')).toEqual(d.assets[1]);expect(next.assets.find(a=>a.id===id)?.controls.mfa).toBe('unknown');expect(bitwardenRegion(next,id)).toBe('eu');expect(next.guide.cursor).toBe(`platform/${id}/manager`);expect(next.guide.steps).toEqual(d.guide.steps);expect(hasSavedPasswordCandidate(next,'mail')).toBe(false);
 });
 it('does not silently overwrite future server/check records',()=>{
  for(const target of ['account','check'] as const){const d=fixture('us');if(target==='account')d.assets[1].bitwardenServerV1={version:2,opaque:'keep'};else d.guide.bitwardenServerChecksV1={version:2,opaque:'keep'};const before=structuredClone(d);expect(currentTask(d)?.redirectTo).toBe('standard-server/manager');expect(()=>chooseBitwardenServer(d,'manager','eu','correct')).toThrow(DataUpgradeConflict);expect(d).toEqual(before);}
 });
 it('retains unknown fields in a supported server record and detects conflicting legacy metadata',()=>{
  const d=fixture('us');d.assets[1].bitwardenServerV1={version:1,region:'eu',evidence:'user-confirmed',checkedAt:'2026-01-01',opaque:{keep:true}};expect(bitwardenRegion(d,'manager')).toBeUndefined();expect(currentTask(d)?.redirectTo).toBe('standard-server/manager');const next=chooseBitwardenServer(d,'manager','us');expect(bitwardenServerCheck(next,'manager').stage).toBe('different');const corrected=chooseBitwardenServer(next,'manager','us','correct');expect(corrected.assets[1].bitwardenServerV1).toMatchObject({opaque:{keep:true},region:'us'});
 });
 it('resumes the same server operation through an encrypted backup without changing the parent guide',async()=>{
  const d=updateBitwardenServerCheck(fixture(),'manager',{where:'android',stage:'choose'});const encrypted=await createEncryptedVault('app-only fixture passphrase',d),restored=(await decryptVault(encrypted.envelope,'app-only fixture passphrase')).data;expect(restored.guide).toEqual(d.guide);expect(bitwardenServerCheck(restored,'manager')).toMatchObject({where:'android',stage:'choose',returnCursor:d.guide.cursor});
 });
 it('excludes private account labels, notes, addresses and arbitrary answers from AI help',()=>{
  const d=updateBitwardenServerCheck(fixture(),'manager',{where:'ios',stage:'problem',problem:'self-hosted'});d.assets[1].notes='PRIVATE NOTE';d.guide.answers['PRIVATE KEY']='PRIVATE PASSWORD';for(const language of ['ja','en'] as const){const prompt=bitwardenServerHelp(d,'manager',language);for(const secret of ['PRIVATE MANAGER','PRIVATE MAIL','PRIVATE NOTE','PRIVATE KEY','PRIVATE PASSWORD'])expect(prompt).not.toContain(secret);expect(prompt).toContain('self-hosted');expect(prompt).toContain('https://bitwarden.com/help/choose-my-server/');expect(prompt).toContain('ios');}
 });
 it('preserves a completed manager when resuming a different recipe',()=>{const d=fixture();d.assets[1].controls.mfa='verified';const next=beginRecipe(d,'mail','password');expect(next.guide.steps).toEqual(d.guide.steps);expect(next.assets).toEqual(d.assets);expect(currentTask(next)?.redirectTo).toBe('standard-server/manager');});
 it('keeps separate unfinished positions for different accounts and parent operations',()=>{
  let d=updateBitwardenServerCheck(fixture(),'manager',{where:'ios',stage:'choose'});const original=d.guide.cursor;d={...d,assets:[...d.assets,{...d.assets[1],id:'other-manager'}],guide:{...d.guide,managerId:'other-manager'}};d=updateBitwardenServerCheck(d,'other-manager',{where:'android',stage:'read'});expect(bitwardenServerCheck(d,'manager')).toMatchObject({where:'ios',stage:'choose',returnCursor:original});expect(bitwardenServerCheck(d,'other-manager')).toMatchObject({where:'android',stage:'read'});
  d=move(d,taskCursor('manager','manager','auth-open'));d=updateBitwardenServerCheck(d,'manager',{where:'login',stage:'read'});expect(bitwardenServerCheck(d,'manager')).toMatchObject({where:'login',stage:'read'});d=move(d,original);expect(bitwardenServerCheck(d,'manager')).toMatchObject({where:'ios',stage:'choose'});expect(d.guide.steps).toEqual(fixture().guide.steps);
 });
 it('preserves unknown check/store fields when explicitly reopening a check',()=>{let d=fixture('us');d.guide.bitwardenServerChecksV1={version:1,opaque:'store value',checks:[{...bitwardenServerCheck(d,'manager'),opaque:'check value'}]};d=openBitwardenServerCheck(d,'manager');expect(bitwardenServerCheck(d,'manager').opaque).toBe('check value');expect(d.guide.bitwardenServerChecksV1).toMatchObject({opaque:'store value'});});
 it('uses the account’s confirmed server when another guide has no local region answer',()=>{const d=fixture();d.assets[1].bitwardenServerV1={version:1,region:'eu',evidence:'user-confirmed',checkedAt:'2026-01-01'};expect(bitwardenRegion(d,'manager')).toBe('eu');expect(currentTask(d)?.redirectTo).toBe('standard-context/manager/web/write/verify');});
 it('keeps a server confirmed in the earlier key settings without assuming an explicit unknown answer is US',()=>{const d=fixture();d.assets[1].hardwareKeyServer='eu';expect(bitwardenRegion(d,'manager')).toBe('eu');d.guide.answers['manager:region']='unknown';expect(bitwardenRegion(d,'manager')).toBeUndefined();});
});
