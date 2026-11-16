import {describe,it,expect} from 'vitest';
import {newDataset,makeAsset,type Dataset} from './models';
import {beginRecipe,completeStep,currentTask,deferStep,helpPrompt,move,taskCursor} from './guideEngine';
import {createEncryptedVault,decryptVault} from './crypto';
import {resumeAfterRecoveryContact} from './recoveryContacts';
function fixture(provider:'google'|'microsoft'):Dataset{
 let d=newDataset('ja');const email={...makeAsset({kind:'account',type:'Primary email',name:'PRIVATE MAIN',importance:'critical'}),provider,purpose:'personal' as const,services:['mail' as const]},backup={...makeAsset({kind:'account',type:'Primary email',name:'PRIVATE BACKUP',importance:'critical'}),provider:'proton' as const,purpose:'personal' as const,services:['mail' as const]};
 email.controls.mfa='unknown';email.controls.recovery='unknown';d={...d,assets:[email,backup],guide:{...d.guide,accountId:email.id,cursor:taskCursor(email.id,'email-mfa','ready')}};return d;
}
function choose(d:Dataset,next:string){expect(currentTask(d)?.step.choices?.some(c=>c.next===next)).toBe(true);return completeStep(d,next);}
for(const provider of ['google','microsoft'] as const)describe(`${provider}: actionable recovery preparation`,()=>{
 it('checks an existing mailbox without changing it and records its relationship only after an explicit identity choice',()=>{
  let d=fixture(provider);const id=d.assets[0].id,backup=d.assets[1].id;for(const next of ['prep-email-open','prep-email-state','prep-email-access','state'])d=choose(d,next);
  expect(d.guide.cursor).toBe(`recovery-email-link/${id}`);expect(d.dependencies).toEqual([]);expect(d.assets[0].controls).toMatchObject({mfa:'unknown',recovery:'unknown'});
  d=resumeAfterRecoveryContact(d,id,backup);expect(d.guide.cursor).toBe(taskCursor(id,'email-mfa','state'));expect(d.dependencies).toHaveLength(1);expect(d.dependencies[0]).toMatchObject({assetId:id,recoveryAssetId:backup,relationType:'recovery-email'});expect(d.assets[0].controls.mfa).toBe('unknown');expect(d.guide.steps[taskCursor(id,'email-mfa','prep-email-add')]).toBeUndefined();
 });
 it('cannot turn missing access, rejected codes, or a waiting selection into completed authentication',()=>{
  for(const step of ['ready','prep-email-state','prep-email-add','prep-email-code','prep-email-submit']){
   let d=fixture(provider);d=move(d,taskCursor(d.assets[0].id,'email-mfa',step));const next=choose(d,'prep-unavailable');expect(next.guide.steps[d.guide.cursor]).toBeUndefined();expect(next.actions).toEqual([]);expect(next.dependencies).toEqual([]);expect(completeStep(next,'$complete')).toBe(next);expect(deferStep(next).guide.cursor).toBe('manager-select');
  }
 });
 it('requires the actual registration result after adding and verifying a new email',()=>{
  let d=fixture(provider);for(const next of ['prep-email-open','prep-email-state','prep-email-prepare',...(provider==='microsoft'?['prep-email-add-open']:[]),'prep-email-add','prep-email-code','prep-email-submit','prep-email-registered'])d=choose(d,next);
  expect(d.dependencies).toEqual([]);expect(d.assets[0].controls.mfa).toBe('unknown');expect(d.guide.cursor).toContain('/prep-email-registered');d=choose(d,'state');const id=d.assets[0].id;d=resumeAfterRecoveryContact(d,id);expect(d.dependencies).toEqual([]);expect(d.guide.cursor).toBe(taskCursor(id,'email-mfa','state'));
 });
 it('retains legacy completed protection and opaque records when the instructions change',()=>{
  let d=fixture(provider);const id=d.assets[0].id;d.assets[0].controls.mfa='verified';d.guide.steps[taskCursor(id,'email-mfa','ready')]={status:'done',updatedAt:'2025-01-01',opaque:'keep'};const before=structuredClone(d.guide.steps);d=beginRecipe(d,id,'email-mfa');expect(d.guide.cursor).toBe(`recorded/${id}/email-mfa`);expect(d.guide.steps).toEqual(before);expect(d.assets[0].controls.mfa).toBe('verified');
 });
 it('resumes the actual email operation in an encrypted backup and excludes private labels from AI help',async()=>{
  let d=fixture(provider);d=choose(d,'prep-email-open');d=choose(d,'prep-email-state');const encrypted=await createEncryptedVault('fixture app storage passphrase',d);const opened=(await decryptVault(encrypted.envelope,'fixture app storage passphrase')).data;expect(opened.guide).toEqual(d.guide);expect(currentTask(opened)?.step.id).toBe('prep-email-state');for(const language of ['ja','en'] as const){const prompt=helpPrompt(opened,'The screen differs',language);expect(prompt).not.toContain('PRIVATE');expect(prompt).toContain(provider==='google'?'support.google.com/accounts/answer/183723':'support.microsoft.com/');}
 });
});
it('keeps a Google recovery-phone waiting period unfinished and restores that exact operation',()=>{
 let d=fixture('google');for(const next of ['prep-phone-open','prep-phone-prepare','prep-phone-add','prep-phone-enter','prep-wait'])d=choose(d,next);expect(d.guide.cursor).toContain('/prep-wait');expect(d.guide.steps[taskCursor(d.assets[0].id,'email-mfa','prep-phone-enter')]).toBeUndefined();expect(d.assets[0].controls.mfa).toBe('unknown');expect(d.dependencies).toEqual([]);d=choose(d,'ready');expect(d.guide.cursor).toContain('/ready');
});
it('rejects an unconfirmed, self, or non-mail recovery relationship',()=>{
 let d=fixture('google');const id=d.assets[0].id;d=move(d,`recovery-email-link/${id}`);expect(resumeAfterRecoveryContact(d,id,d.assets[1].id).dependencies).toEqual([]);d.guide.answers[`recovery-mail-return:${id}`]=taskCursor(id,'email-mfa','state');d.guide.steps[taskCursor(id,'email-mfa','prep-email-access')]={status:'done',updatedAt:'2026-11-14'};expect(resumeAfterRecoveryContact(d,id,id)).toBe(d);expect(resumeAfterRecoveryContact(d,id,'missing')).toBe(d);
});

describe('Microsoft independent backup after MFA',()=>{
 it('records an independently usable mailbox and advances on that one confirmation',()=>{
  let d=fixture('microsoft');const id=d.assets[0].id;d.assets[0].controls.mfa='verified';d=beginRecipe(d,id,'recovery');d=choose(d,'email-independent');d=choose(d,'$complete');expect(d.guide.cursor).toBe(`recovery-location/${id}`);expect(d.assets[0].controls.recovery).toBe('verified');expect(d.actions.filter(a=>a.controlId==='recovery')).toHaveLength(1);expect(d.guide.steps[taskCursor(id,'recovery','save')]).toBeUndefined();
 });
 it('does not count a backup that still requires the main phone',()=>{
  let d=fixture('microsoft');const id=d.assets[0].id;d.assets[0].controls.mfa='verified';d=beginRecipe(d,id,'recovery');d=choose(d,'backup-use');d=choose(d,'not-ready');expect(d.assets[0].controls.recovery).toBe('unknown');expect(d.actions).toEqual([]);expect(completeStep(d,'$complete')).toBe(d);
 });
 it('can register a missing email and bind that exact contact before checking independence',()=>{
  let d=fixture('microsoft');const id=d.assets[0].id;d.assets[0].controls.mfa='verified';d=beginRecipe(d,id,'recovery');for(const next of ['prep-email-open','prep-email-state','prep-email-prepare','prep-email-add-open','prep-email-add','prep-email-code','prep-email-submit','prep-email-registered','email-independent'])d=choose(d,next);expect(d.guide.cursor).toBe(`recovery-email-link/${id}`);d=resumeAfterRecoveryContact(d,id,d.assets[1].id);expect(d.guide.cursor).toBe(taskCursor(id,'recovery','email-independent'));expect(d.assets[0].controls.recovery).toBe('unknown');expect(d.dependencies).toHaveLength(1);
 });
});
