import { describe, expect, it } from 'vitest';
import { makeAsset, newDataset, currentDatasetSchema, type CurrentDataset } from './models';
import { makeNativeVault, chooseNativeDevice, configureNativeStorage, selectedNativeInstallation, type NativeProduct } from './nativeManagers';
import { beginRecipe, completeStep, currentTask, guidePresentation, deferStep, helpPrompt, move, taskCursor, undoStep } from './guideEngine';
import { recordControl } from './controlRecords';
import { nativeCandidateCopy, nativeCandidateIndependent, nativePreparedCandidate } from './nativePasswordContext';
import { controlSubject } from './subjects';
import { mapConnections } from './securityMapViews';
import { evaluateAccess } from './securityModel';
import { createEncryptedVault, decryptVault } from './crypto';

function fixture(product: NativeProduct, own = false) {
  let d = newDataset('ja');
  const root = { ...makeAsset({kind:'account',type:'Primary email',name:'PRIVATE ROOT',importance:'critical'}), id:'root', provider:product==='apple-passwords'?'apple' as const:'google' as const, purpose:'personal' as const, services:['mail' as const] };
  const mail = { ...makeAsset({kind:'account',type:'Primary email',name:'PRIVATE MAIL',importance:'critical'}), id:'mail',provider:'proton' as const,purpose:'personal' as const,services:['mail' as const] };
  const device = {...makeAsset({kind:'device',type:'Smartphone',name:'PRIVATE PHONE',importance:'critical',operatingSystem:product==='apple-passwords'?'ios':'android'}),id:'phone'};
  d.assets=[root,mail,device]; d.guide.accountId=own?'root':'mail';
  for(const id of ['root','mail'])for(const c of ['mfa','recovery'])d=recordControl(d,id,c,{id:`fixture:${id}:${c}`}) as CurrentDataset;
  d=makeNativeVault(d,product,'ja');const vault=d.guide.managerId!;d=chooseNativeDevice(d,vault,'phone') as CurrentDataset;d=configureNativeStorage(d,vault,'account','root') as CurrentDataset;
  const app=selectedNativeInstallation(d,vault)!;d.guide.answers[`${app.id}:version`]='ios18plus';
  for(const c of ['opened','storageChecked','autofill','independentRoot'])d=recordControl(d,app.id,c,{id:`fixture:${app.id}:${c}`}) as CurrentDataset;
  d=recordControl(d,'phone','screenLock',{id:'fixture:phone:lock'}) as CurrentDataset;
  const account=d.guide.accountId!,recipe=`native-password:${app.id}`;
  return {data:beginRecipe(d,account,recipe) as CurrentDataset,account,recipe,app:app.id,vault};
}
function choose(d:CurrentDataset,next?:string):CurrentDataset {
  const task=currentTask(d);expect(task,d.guide.cursor).toBeDefined();expect(task?.redirectTo,d.guide.cursor).toBeUndefined();expect(task?.needsPrerequisites,d.guide.cursor).toBe(false);
  if(next)expect(task?.step.choices?.some(c=>c.next===next),d.guide.cursor).toBe(true);
  return currentDatasetSchema.parse(completeStep(d,next));
}
function prepare(d:CurrentDataset,method:'note'|'paper') {
  d=choose(d);d=choose(d,'preserve-current');d=choose(d,'change-open');d=choose(d);d=choose(d,'candidate-method');d=choose(d,method==='note'?'candidate-note-open':'candidate-paper');
  if(method==='note'){d=choose(d);d=choose(d,'candidate-note-edit');d=choose(d);}
  return choose(d,'candidate-check');
}
for(const product of ['apple-passwords','google-password-manager'] as const)describe(`${product}: candidate and saved-password use`,()=>{
  it('keeps recipe IDs unique and every choice reachable when borrowing the official setting location',()=>{
    for(const own of [false,true]){const f=fixture(product,own),recipe=currentTask(f.data)!.recipe,ids=recipe.steps.map(s=>s.id);expect(new Set(ids).size).toBe(ids.length);expect(ids).toContain('candidate-status');expect(ids).toContain('accepted-result');for(const step of recipe.steps)for(const choice of step.choices??[])expect(choice.next==='$complete'||ids.includes(choice.next)).toBe(true);}
  });
  it('keeps an existing strong password without preparing a change, and rejects a different sign-in method',()=>{
    const f=fixture(product);let d=choose(choose(f.data),'test');const before=d;
    d=choose(d,'password-unconfirmed');expect(d.assets).toEqual(before.assets);expect(d.actions).toEqual(before.actions);expect(mapConnections(d).some(r=>r.relation==='authenticates-to')).toBe(false);
    d=choose(d,'test');d=choose(d,'$complete');expect(d.guide.cursor).toBe('device-select');expect(d.assets.find(a=>a.id===f.account)?.controls.uniquePassword).toBe('verified');
    expect(d.guide.steps[taskCursor(f.account,f.recipe,'generate')]).toBeUndefined();expect(d.guide.steps[taskCursor(f.account,f.recipe,'candidate-check')]).toBeUndefined();
  });
  it('requires a retrievable private note before accepting an unapplied change',()=>{
    const f=fixture(product);let d=prepare(f.data,'note');expect(nativePreparedCandidate(d,f.account,f.recipe)).toBeUndefined();expect(d.securityModel.lifecycle[f.account]?.accessResetAt).toBeUndefined();
    d=choose(d,'apply');expect(nativePreparedCandidate(d,f.account,f.recipe)?.method).toBe('note');expect(currentTask(d)?.redirectTo).toBeUndefined();
    const before=d;d=choose(d,'candidate-not-ready');expect(d.actions).toEqual(before.actions);expect(d.guide.steps[taskCursor(f.account,f.recipe,'apply')]).toBeUndefined();expect(d.assets.find(a=>a.id===f.account)?.controls.uniquePassword??'unknown').toBe('unknown');
    expect(deferStep(d).guide.cursor).toBe('device-select');
  });
  it('requires an independent candidate before changing the account that opens the store, and retains cleanup after acceptance',()=>{
    const f=fixture(product,true);let d=prepare(f.data,'note');d=choose(d,'independent-candidate');expect(nativeCandidateIndependent(d,f.account,f.recipe)).toBe(false);
    expect(currentTask(move(d,taskCursor(f.account,f.recipe,'apply')))?.redirectTo).toBe(taskCursor(f.account,f.recipe,'independent-candidate'));
    d=choose(d,'apply');expect(nativeCandidateIndependent(d,f.account,f.recipe)).toBe(true);d=choose(d,'save-new');expect(d.securityModel.lifecycle[f.account]?.accessResetAt).toBeTruthy();expect(nativePreparedCandidate(d,f.account,f.recipe)).toBeUndefined();expect(nativeCandidateCopy(d,f.account,f.recipe)).toBeTruthy();
    d=choose(d);d=choose(d);expect(currentTask(d)?.step.id).toBe('test');d=choose(d,'cleanup');expect(controlSubject(d,f.app)?.controls.loginUse).toBe('verified');expect(d.actions.filter(a=>a.controlId==='uniquePassword')).toHaveLength(1);d=choose(d,'$complete');expect(d.guide.cursor).toBe('device-select');
  });
  it('uses the already independent paper copy without asking for a second copy of it',()=>{
    const f=fixture(product,true);let d=prepare(f.data,'paper');d=choose(d,'apply');expect(nativeCandidateIndependent(d,f.account,f.recipe)).toBe(true);expect(d.guide.steps[taskCursor(f.account,f.recipe,'independent-candidate')]).toBeUndefined();expect(currentTask(d)?.redirectTo).toBeUndefined();
  });
  it('can switch a shared or uncertain note to paper and binds the result to the current selection',()=>{
    const f=fixture(product);let d=choose(choose(f.data),'preserve-current');d=choose(d,'change-open');d=choose(d);d=choose(d,'candidate-method');d=choose(d,'candidate-note-open');d=choose(d);d=choose(d,'candidate-paper');d=choose(d,'candidate-check');d=choose(d,'apply');expect(nativePreparedCandidate(d,f.account,f.recipe)?.method).toBe('paper');
    d=choose(move(d,taskCursor(f.account,f.recipe,'candidate-method')) as CurrentDataset,'candidate-note-open');expect(nativePreparedCandidate(d,f.account,f.recipe)).toBeUndefined();
  });
  it('does not reuse a candidate after generation, the store, the app device, or the account password changes',()=>{
    const f=fixture(product);let prepared=choose(prepare(f.data,'paper'),'apply');
    const generation=choose(move(prepared,taskCursor(f.account,f.recipe,'generate')) as CurrentDataset,'candidate-method');expect(nativePreparedCandidate(generation,f.account,f.recipe)).toBeUndefined();
    for(const edit of [
      (d:CurrentDataset)=>{d.securityModel.entities=d.securityModel.entities.map(e=>e.id===f.app&&e.kind==='installation'?{...e,deviceRef:'another-phone'}:e);},
      (d:CurrentDataset)=>{d.securityModel.entities=d.securityModel.entities.map(e=>e.id===f.vault&&e.kind==='vault'?{...e,storageMode:'local'}:e);},
      (d:CurrentDataset)=>{d.securityModel.entities=d.securityModel.entities.map(e=>e.id===f.vault&&e.kind==='vault'?{...e,authenticationAccountRef:'mail'}:e);},
      (d:CurrentDataset)=>{d.securityModel.lifecycle[f.account]={state:'in-use',evidence:'user-confirmed',updatedAt:'2026-11-14T23:59:00Z',accessResetAt:'2026-11-14T23:59:00Z'};},
    ]){const changed=structuredClone(prepared);edit(changed);expect(nativePreparedCandidate(changed,f.account,f.recipe)).toBeUndefined();}
  });
  it('checks the working-password copy before generation and repeats that check only after a known password change',()=>{
    const f=fixture(product);let d=move(f.data,taskCursor(f.account,f.recipe,'generate')) as CurrentDataset;expect(currentTask(d)?.redirectTo).toBe(taskCursor(f.account,f.recipe,'preserve-current'));d=completeStep(d) as CurrentDataset;d=choose(d,'candidate-not-ready');expect(d.securityModel.lifecycle[f.account]?.accessResetAt).toBeUndefined();
    d=choose(move(d,taskCursor(f.account,f.recipe,'preserve-current')) as CurrentDataset,'change-open');expect(d.guide.steps[taskCursor(f.account,f.recipe,'preserve-current')]?.nativeCurrentPasswordRevisionV1).toBe('');d.securityModel.lifecycle[f.account]={state:'in-use',evidence:'user-confirmed',updatedAt:'2026-11-14T23:59:00Z',accessResetAt:'2026-11-14T23:59:00Z'};expect(currentTask(move(d,taskCursor(f.account,f.recipe,'generate')))?.redirectTo).toBe(taskCursor(f.account,f.recipe,'preserve-current'));expect(d.assets.find(a=>a.id==='root')?.controls.mfa).toBe('verified');
  });
  it('resumes an accepted legacy change without generating or applying another password',()=>{
    const f=fixture(product);let d=move(f.data,taskCursor(f.account,f.recipe,'apply')) as CurrentDataset;
    expect(currentTask(d)?.redirectTo).toBe(taskCursor(f.account,f.recipe,'candidate-status'));d=completeStep(d) as CurrentDataset;d=choose(d,'save-new');expect(d.guide.cursor).toBe(taskCursor(f.account,f.recipe,'save-new'));expect(d.guide.steps[taskCursor(f.account,f.recipe,'generate')]).toBeUndefined();expect(d.securityModel.lifecycle[f.account]?.accessResetAt).toBeTruthy();
    const legacy=structuredClone(f.data);legacy.guide.steps[taskCursor(f.account,f.recipe,'apply')]={status:'done',updatedAt:'2025-01-01',opaque:'keep'};d=move(legacy,taskCursor(f.account,f.recipe,'apply')) as CurrentDataset;d=completeStep(d) as CurrentDataset;expect(d.guide.cursor).toBe(taskCursor(f.account,f.recipe,'accepted-result'));d=choose(d,'save-new');expect(d.guide.cursor).toBe(taskCursor(f.account,f.recipe,'save-new'));expect(d.guide.steps[taskCursor(f.account,f.recipe,'apply')]?.opaque).toBe('keep');
  });
  it('does not regenerate after acceptance and offers an explicit correction without erasing other protections',()=>{
    const f=fixture(product);let d=choose(choose(prepare(f.data,'paper'),'apply'),'save-new');const generation=d.guide.steps[taskCursor(f.account,f.recipe,'generate')];
    for(const step of ['generate','candidate-method','candidate-check','apply'])expect(currentTask(move(d,taskCursor(f.account,f.recipe,step)))?.redirectTo).toBe(taskCursor(f.account,f.recipe,'accepted-result'));
    d=completeStep(move(d,taskCursor(f.account,f.recipe,'generate'))) as CurrentDataset;expect(d.guide.steps[taskCursor(f.account,f.recipe,'generate')]).toEqual(generation);d=choose(d,'candidate-status');expect(d.guide.steps[taskCursor(f.account,f.recipe,'apply')]).toBeUndefined();expect(d.securityModel.lifecycle[f.account]?.accessResetAt).toBeTruthy();expect(d.assets.find(a=>a.id==='root')?.controls.mfa).toBe('verified');
  });
  it('requires the account copy to be updated after acceptance before claiming use of the changed root password',()=>{
    const f=fixture(product,true);let d=choose(choose(prepare(f.data,'paper'),'apply'),'save-new');d=choose(d);const test=move(d,taskCursor(f.account,f.recipe,'test'));
    expect(currentTask(test)?.redirectTo).toBe(taskCursor(f.account,f.recipe,'update-independent-root'));expect(d.assets.find(a=>a.id===f.account)?.controls.uniquePassword??'unknown').toBe('unknown');d=completeStep(test) as CurrentDataset;d=choose(d);expect(currentTask(d)?.step.id).toBe('test');expect(currentTask(d)?.redirectTo).toBeUndefined();
  });
  it('resumes an accepted change instead of reusing a password-use record from before that change',()=>{
    const f=fixture(product,true);let d=recordControl(f.data,f.account,'uniquePassword',{id:'previous-use'}) as CurrentDataset;d=recordControl(d,f.app,'loginUse',{id:'previous-app-use'}) as CurrentDataset;d.guide.steps[taskCursor(f.account,f.recipe,'test')]={status:'done',updatedAt:'2026-01-01T00:00:00Z',opaque:{keep:true}};
    d=choose(choose(prepare(d,'paper'),'apply'),'save-new');expect(d.securityModel.lifecycle[f.account]?.accessResetAt).toBeTruthy();expect(d.guide.steps[taskCursor(f.account,f.recipe,'test')].opaque).toEqual({keep:true});
    d=beginRecipe(d,f.account,f.recipe) as CurrentDataset;expect(d.guide.cursor).toBe(taskCursor(f.account,f.recipe,'accepted-result'));d=completeStep(move(d,taskCursor(f.app,'builtin-manager','independent-root'))) as CurrentDataset;expect(d.guide.cursor).toBe(taskCursor(f.account,f.recipe,'accepted-result'));d=choose(d,'save-new');d=choose(d);expect(currentTask(d)?.redirectTo).toBe(taskCursor(f.account,f.recipe,'test'));d=completeStep(d) as CurrentDataset;expect(d.guide.steps[taskCursor(f.account,f.recipe,'update-independent-root')]).toBeUndefined();d=choose(d,'cleanup');expect(d.guide.steps[taskCursor(f.account,f.recipe,'test')].opaque).toEqual({keep:true});expect(beginRecipe(d,f.account,f.recipe).guide.cursor).toBe(`recorded/${f.account}/${f.recipe}`);expect(d.assets.find(a=>a.id==='root')?.controls.mfa).toBe('verified');
  });
  it('does not skip an expired manager prerequisite because the target password has an old success flag',()=>{
    const f=fixture(product);let d=recordControl(f.data,f.account,'uniquePassword',{id:'old-use'}) as CurrentDataset;d=recordControl(d,f.app,'loginUse',{id:'old-app-use'}) as CurrentDataset;expect(beginRecipe(d,f.account,f.recipe).guide.cursor).toBe(`recorded/${f.account}/${f.recipe}`);
    d.securityModel.lifecycle.root={state:'in-use',evidence:'user-confirmed',updatedAt:'2026-11-14T20:00:00Z',accessResetAt:'2026-11-14T20:00:00Z'};d=beginRecipe(d,f.account,f.recipe) as CurrentDataset;expect(d.guide.cursor).toBe('password-prerequisite');expect(d.assets.find(a=>a.id===f.account)?.controls.uniquePassword).toBe('verified');
  });
  it('does not treat an acceptance before a later known password change as the current result',()=>{
    const f=fixture(product,true),d=f.data;d.guide.steps[taskCursor(f.account,f.recipe,'apply')]={status:'done',updatedAt:'2026-01-01T00:00:00Z'};d.securityModel.lifecycle[f.account]={state:'in-use',evidence:'user-confirmed',updatedAt:'2026-11-14T00:00:00Z',accessResetAt:'2026-11-14T00:00:00Z'};expect(currentTask(move(d,taskCursor(f.account,f.recipe,'apply')))?.needsPrerequisites).toBe(true);expect(beginRecipe(d,f.account,f.recipe).guide.cursor).toBe('password-prerequisite');expect(d.guide.steps[taskCursor(f.account,f.recipe,'apply')]?.status).toBe('done');
  });
  it('displays a required question without changing the saved cursor, and records its answer in one action',()=>{
    const f=fixture(product),original=move(f.data,taskCursor(f.account,f.recipe,'apply')) as CurrentDataset,before=structuredClone(original);const view=guidePresentation(original);
    expect(view.task?.step.id).toBe('candidate-status');expect(view.data.guide.cursor).toBe(taskCursor(f.account,f.recipe,'candidate-status'));expect(original).toEqual(before);expect(view.data.guide.history).toEqual(before.guide.history);expect(view.data.guide.steps).toBe(original.guide.steps);
    const answered=completeStep(view.data,'save-new');expect(answered.guide.cursor).toBe(taskCursor(f.account,f.recipe,'save-new'));expect(answered.guide.steps[taskCursor(f.account,f.recipe,'candidate-status')]?.status).toBe('done');expect(answered.guide.steps[taskCursor(f.account,f.recipe,'apply')]).toBeUndefined();expect(original).toEqual(before);
  });
  it('presents an accepted result without persisting a redirect or regenerating a candidate',()=>{
    const f=fixture(product);const accepted=choose(choose(prepare(f.data,'paper'),'apply'),'save-new'),original=move(accepted,taskCursor(f.account,f.recipe,'generate')),before=structuredClone(original);const view=guidePresentation(original);
    expect(view.task?.step.id).toBe('accepted-result');expect(original).toEqual(before);const continued=completeStep(view.data,'save-new');expect(continued.guide.cursor).toBe(taskCursor(f.account,f.recipe,'save-new'));expect(continued.guide.steps[taskCursor(f.account,f.recipe,'generate')]).toEqual(before.guide.steps[taskCursor(f.account,f.recipe,'generate')]);expect(original).toEqual(before);
  });
  it('withdraws a failed retrieval rather than reusing the old candidate proof',()=>{
    const f=fixture(product);let d=choose(prepare(f.data,'paper'),'apply');d=choose(move(d,taskCursor(f.account,f.recipe,'candidate-check')) as CurrentDataset,'candidate-not-ready');expect(nativePreparedCandidate(d,f.account,f.recipe)).toBeUndefined();expect(currentTask(move(d,taskCursor(f.account,f.recipe,'apply')))?.redirectTo).toBe(taskCursor(f.account,f.recipe,'candidate-status'));
  });
  it('corrects only the mistaken password-use record and its observations',()=>{
    const f=fixture(product);let d=choose(choose(choose(f.data),'test'),'$complete');const route=d.securityModel.routes.find(r=>r.purpose==='sign-in'&&r.targetRef===f.account)!;expect(evaluateAccess(d.securityModel,route.id,{context:'normal',now:new Date().toISOString()}).state).toBe('available');
    d=choose(move(d,taskCursor(f.account,f.recipe,'test')) as CurrentDataset,'password-unconfirmed');expect(d.assets.find(a=>a.id===f.account)?.controls.uniquePassword??'unknown').toBe('unknown');expect(controlSubject(d,f.app)?.controls.loginUse).toBe('unknown');expect(d.assets.find(a=>a.id==='root')?.controls.mfa).toBe('verified');expect(evaluateAccess(d.securityModel,route.id,{context:'normal',now:new Date().toISOString()}).state).toBe('unknown');expect(mapConnections(d).some(r=>r.relation==='authenticates-to')).toBe(false);
  });
  it('preserves the exact candidate question, opaque data and previous protections through encrypted backup',async()=>{
    const f=fixture(product);let d=prepare(f.data,'paper');d.guide.steps[taskCursor(f.account,f.recipe,'save-current')]={...d.guide.steps[taskCursor(f.account,f.recipe,'save-current')],status:'done',updatedAt:'2026-11-14',opaque:{keep:true}};const before=structuredClone(d.guide);const encrypted=await createEncryptedVault('fixture native storage passphrase',d);const restored=(await decryptVault(encrypted.envelope,'fixture native storage passphrase')).data;expect(restored.guide).toEqual(before);expect(currentTask(restored)?.step.id).toBe('candidate-check');expect(helpPrompt(restored,'different','ja')).not.toContain('PRIVATE');const undone=undoStep(restored,taskCursor(f.account,f.recipe,'generate'));expect(nativePreparedCandidate(undone,f.account,f.recipe)).toBeUndefined();expect(undone.assets.find(a=>a.id==='root')?.controls.recovery).toBe('verified');
  });
});
