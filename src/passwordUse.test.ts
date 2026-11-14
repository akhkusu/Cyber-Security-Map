import {describe,it,expect} from 'vitest';
import {newDataset,makeAsset} from './models';
import {beginRecipe,completeStep,currentTask,move,taskCursor,undoStep} from './guideEngine';
import {createEncryptedVault,decryptVault} from './crypto';
function fixture(product:'bitwarden'|'1password'){
  let d=newDataset('ja');const account={...makeAsset({kind:'account',type:'Primary email',name:'Mail',importance:'critical'}),provider:'google' as const,purpose:'personal' as const};account.controls.uniquePassword='unknown';account.controls.mfa='verified';account.controls.recovery='verified';
  const manager={...makeAsset({kind:'account',type:'Password manager',name:product,importance:'critical'}),provider:product};manager.controls.mfa='verified';
  d={...d,assets:[account,manager],guide:{...d.guide,accountId:account.id,managerId:manager.id}};d.guide.answers[`${manager.id}:platform`]='windows';return beginRecipe(d,account.id,'password');
}
for(const product of ['bitwarden','1password'] as const)describe(`${product}: existing passwords and actual saved-password use`,()=>{
 it('finds an existing login and keeps a strong unique password without generating or replacing it',()=>{
  let d=fixture(product);const id=d.guide.accountId!;expect(currentTask(d)?.step.id).toBe('find-current');d=completeStep(d,'password-choice');d=completeStep(d,'test');expect(currentTask(d)?.step.id).toBe('test');
  for(const step of ['save-current','change-open','generate','apply','save-new'])expect(d.guide.steps[taskCursor(id,'password',step)]).toBeUndefined();expect(d.assets[0].controls.uniquePassword).toBe('unknown');
  d=completeStep(d,'$complete');expect(d.guide.cursor).toBe('device-select');expect(d.assets[0].controls.uniquePassword).toBe('verified');expect(d.actions.filter(a=>a.controlId==='uniquePassword')).toHaveLength(1);
 });
 it('does not record an existing session or passkey-only sign-in as a saved-password check',()=>{
  let d=fixture(product);const id=d.guide.accountId!,key=taskCursor(id,'password','test');d=move(d,key);const before=d;d=completeStep(d,'password-unconfirmed');expect(d.guide.steps[key]).toBeUndefined();expect(d.actions).toEqual(before.actions);expect(d.assets).toEqual(before.assets);expect(currentTask(d)?.step.id).toBe('password-unconfirmed');
  d=completeStep(d,'test');expect(currentTask(d)?.step.id).toBe('test');expect(d.assets[0].controls.uniquePassword).toBe('unknown');
 });
 it('retains old saved step IDs and prior completion, and can undo only the saved-password confirmation',()=>{
  let d=fixture(product);const id=d.guide.accountId!,key=taskCursor(id,'password','test');d.guide.steps[taskCursor(id,'password','save-current')]={status:'done',updatedAt:'2025-01-01T00:00:00Z',opaque:'keep'};d=move(d,taskCursor(id,'password','save-current'));expect(currentTask(d)?.step.action.en).toContain('existing login');
  d=completeStep(move(d,key),'$complete');const action=d.actions.find(a=>a.controlId==='uniquePassword')!;expect(action).toBeTruthy();d=undoStep(d,key);expect(d.assets[0].controls.uniquePassword).toBe('unknown');expect(d.guide.steps[taskCursor(id,'password','save-current')]?.opaque).toBe('keep');
 });
 it('keeps the selected branch and saved records through encrypted resume',async()=>{
  let d=fixture(product);d=completeStep(d,'password-choice');d=completeStep(d,'test');const encrypted=await createEncryptedVault('fixture app storage phrase',d);const restored=(await decryptVault(encrypted.envelope,'fixture app storage phrase')).data;expect(restored.guide).toEqual(d.guide);expect(currentTask(restored)?.step.id).toBe('test');expect(restored.assets[0].controls.uniquePassword).toBe('unknown');
 });
 it('withdraws an accidental password confirmation when the user corrects the actual method',()=>{
  let d=fixture(product);const id=d.guide.accountId!,key=taskCursor(id,'password','test');d=completeStep(move(d,key),'$complete');expect(d.assets[0].controls.uniquePassword).toBe('verified');d=completeStep(move(d,key),'password-unconfirmed');expect(d.assets[0].controls.uniquePassword).toBe('unknown');expect(d.assets[0].controls.mfa).toBe('verified');expect(d.guide.steps[key]).toBeUndefined();expect(d.actions.filter(a=>a.controlId==='uniquePassword')).toEqual([]);
 });
 it('keeps a retrievable candidate bound to the selected manager before applying a change',()=>{
  let d=fixture(product);const id=d.guide.accountId!,manager=d.guide.managerId!,apply=taskCursor(id,'password','apply');d=move(d,apply);expect(currentTask(d)?.redirectTo).toBe(taskCursor(id,'password','save-candidate'));expect(completeStep(d).actions).toEqual([]);
  d=completeStep(move(d,taskCursor(id,'password','save-candidate')));expect(d.guide.steps[taskCursor(id,'password','save-candidate')]?.managerRef).toBe(manager);expect(currentTask(d)?.redirectTo).toBeUndefined();d=completeStep(d);d=completeStep(d);expect(currentTask(d)?.step.id).toBe('test');d=completeStep(d,'cleanup');expect(d.assets[0].controls.uniquePassword).toBe('verified');expect(currentTask(d)?.step.id).toBe('cleanup');d=completeStep(d);expect(d.guide.cursor).toBe('device-select');expect(d.actions.filter(a=>a.controlId==='uniquePassword')).toHaveLength(1);
 });
 it('does not reuse a candidate from a different manager or Bitwarden region',()=>{
  let d=fixture(product);const id=d.guide.accountId!,manager=d.guide.managerId!;d=completeStep(move(d,taskCursor(id,'password','save-candidate')));const nextManager={...d.assets[1],id:'another-manager'};d={...d,assets:[...d.assets,nextManager],guide:{...d.guide,managerId:nextManager.id,answers:{...d.guide.answers,[`${nextManager.id}:platform`]:'windows'}}};expect(currentTask(d)?.redirectTo).toBe(taskCursor(id,'password','save-candidate'));
  if(product==='bitwarden'){d={...d,guide:{...d.guide,managerId:manager,answers:{...d.guide.answers,[`${manager}:region`]:'eu'}}};expect(currentTask(d)?.redirectTo).toBe(taskCursor(id,'password','save-candidate'));expect(currentTask(move(d,taskCursor(id,'password','find-current')))?.step.url).toBe('https://vault.bitwarden.eu/');}
 });
 it('rejects an unknown destination without completing a control',()=>{const d=fixture(product),test=move(d,taskCursor(d.guide.accountId!,'password','test'));expect(completeStep(test,'missing-target')).toBe(test);expect(completeStep(test)).toBe(test);});
});

it('asks a legacy 1Password record for the missing device without resetting its existing work',()=>{
 let d=fixture('1password');const id=d.guide.accountId!,manager=d.guide.managerId!,cursor=d.guide.cursor;delete d.guide.answers[`${manager}:platform`];const before=structuredClone(d.guide.steps);expect(currentTask(d)?.redirectTo).toBe(`password-manager-device/${manager}/${id}`);d.guide.answers[`${manager}:platform`]='macos';expect(currentTask(d)?.redirectTo).toBeUndefined();expect(currentTask(d)?.step.sources).toContain('opUseMac');expect(d.guide.cursor).toBe(cursor);expect(d.guide.steps).toEqual(before);
});

it('keeps an unsupported legacy manager instead of presenting it as a different product',()=>{
 const d=fixture('bitwarden');d.assets[1].provider='other';const assets=structuredClone(d.assets);expect(currentTask(d)).toBeUndefined();expect(beginRecipe(d,d.guide.accountId!,'password').guide.cursor).toBe(`unsupported/${d.guide.accountId}/password`);expect(d.assets).toEqual(assets);
});
