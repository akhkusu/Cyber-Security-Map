import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from './models';
import { recordControl } from './controlRecords';
import { chooseCloudDevice, cloudInstallation, cloudManagerReady, cloudSetupRoute, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer } from './cloudManagers';
import { beginRecipe, completeStep, currentTask, deferStep, helpPrompt, move, undoStep } from './guideEngine';
import { extraApplied, extraCycle, extraRecipeId, extraSetting, startProtonExtra } from './protonPassExtra';
import { recordCloudObservation } from './cloudObservations';
import { cloudPasswordRecipe } from './cloudPasswordCatalog';
import { evaluateAccess, securityModelIssues } from './securityModel';
import { mapItems, typedMapStatus } from './securityMapViews';
import { answerPhoneQuestion, jumpPhoneStep, startPhoneWorkflow } from './phoneEngine';
import { createEncryptedVault, decryptVault } from './crypto';

function fixture(os: 'ios' | 'android' | 'windows' = 'ios') {
  let data = newDataset('ja');
  const root = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'PRIVATE ROOT', importance: 'critical' }), id: 'proton-root', provider: 'proton' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const phone = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'PRIVATE PHONE', importance: 'critical', operatingSystem: os }), id: 'phone' };
  data.assets = [root, phone]; data.guide.accountId = root.id;
  data = makeCloudVault(data, 'proton-pass', 'ja') as CurrentDataset;
  const vaultId = data.guide.managerId!;
  data = configureCloudRoot(data, vaultId, root.id) as CurrentDataset;
  data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, phone.id) as CurrentDataset; const appId = selectedCloudInstallation(data, vaultId)!.id;
  if (os === 'ios') data = setCloudAnswer(data, appId, 'ios', 'ios18plus') as CurrentDataset;
  if (os === 'windows') { data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset; data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: 'PRIVATE PROFILE' } : e); }
  for (const [ref, c] of [[root.id, 'mfa'], [root.id, 'recovery'], [root.id, 'dataRecovery'], [root.id, 'passwordResetRecovery'], [root.id, 'recoveryFile'], [phone.id, 'screenLock'], [appId, 'opened'], [appId, 'storageChecked'], [appId, 'autofill'], [appId, 'loginUse']]) data = recordControl(data, ref, c, { id: `old:${ref}:${c}` }) as CurrentDataset;
  data = setCloudAnswer(data, root.id, `password:${appId}`, 'keep') as CurrentDataset;
  const oldTest = cloudPasswordRecipe(data, root, appId)!.steps.find(s => s.id === 'test')!;
  data = recordCloudObservation(data, 'existing-saved-use', root.id, `cloud-password:${appId}`, oldTest, [], '2026-11-13T00:00:00Z') as CurrentDataset;
  data = move(data, `cloud-ready/${vaultId}`) as CurrentDataset;
  return { data, rootId: root.id, appId, vaultId };
}
function tick() { vi.setSystemTime(new Date(Date.now() + 1000)); }
function complete(data: CurrentDataset) { tick(); const task = currentTask(data); expect(task?.redirectTo, data.guide.cursor).toBeUndefined(); return completeStep(data) as CurrentDataset; }
function choose(data: CurrentDataset, appId: string, mode: 'enable' | 'review' | 'default') {
  const cycle = extraCycle(data, appId)!;
  data.guide.answers[`${appId}:proton-extra-state:${cycle}`] = mode === 'review' ? 'on' : 'off';
  return beginRecipe(data, appId, extraRecipeId(data, appId, mode)) as CurrentDataset;
}
function inspect(data: CurrentDataset, appId: string) { return complete(startProtonExtra(data, appId) as CurrentDataset); }
function finish(data: CurrentDataset) { for (let n = 0; n < 24 && currentTask(data); n++) data = complete(data); return data; }

afterEach(() => vi.useRealTimers());
describe('optional Proton Pass extra password', () => {
  for (const os of ['ios', 'android', 'windows'] as const) it(`${os}: recovery first, real change, separate account/extra/read observations`, () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
    const f = fixture(os); const oldAccount = structuredClone(f.data.assets[0]);
    let data = choose(inspect(f.data, f.appId), f.appId, 'enable');
    expect(extraSetting(data, f.vaultId)).toBeUndefined();
    const recipeId = currentTask(data)!.recipe.id;
    while (currentTask(data)?.step.id !== 'apply') data = complete(data);
    expect(extraSetting(data, f.vaultId)).toBeUndefined();
    data = complete(data);
    expect(extraApplied(data, f.appId, recipeId)).toBe(true);
    expect(extraSetting(data, f.vaultId)?.extraState).toBe('enabled');
    expect(data.securityModel.facts.filter(f => f.protonPassExtraEvidence === 'v1' && f.label.includes('Fresh sign-in'))).toHaveLength(0);
    expect(typedMapStatus(data, mapItems(data, 'ja').find(e => e.id === f.appId)!, 'ja').tone).toBe('unknown');
    data = finish(data);
    expect(data.assets.find(a => a.id === f.rootId)).toEqual(oldAccount);
    expect(securityModelIssues(data.securityModel, data.assets)).toEqual([]);
    const routes = data.securityModel.routes.filter(r => data.securityModel.facts.some(f => f.protonPassExtraEvidence === 'v1' && r.requirements.kind === 'fact' && r.requirements.factId === f.id));
    expect(routes).toHaveLength(3);
    expect(routes.every(r => evaluateAccess(data.securityModel, r.id, { context: 'no-existing-session', now: new Date().toISOString() }).state === 'available')).toBe(true);
    expect(routes.every(r => evaluateAccess(data.securityModel, r.id, { context: 'all-devices-lost', now: new Date().toISOString() }).state === 'not-applicable')).toBe(true);
    // Pass sign-in cannot be mislabeled as use of a saved service password.
    expect(typedMapStatus(data, mapItems(data, 'ja').find(e => e.id === f.appId)!, 'ja').label).toContain('利用待ち');
    const app = cloudInstallation(data, f.appId)!;
    const test = cloudPasswordRecipe(data, data.assets[0], app.id)!.steps.find(s => s.id === 'test')!; tick();
    data = recordCloudObservation(data, 'fresh-saved-use', f.rootId, `cloud-password:${app.id}`, test, [], new Date().toISOString()) as CurrentDataset;
    expect(typedMapStatus(data, mapItems(data, 'ja').find(e => e.id === f.appId)!, 'ja').tone).toBe('recorded');
  });
  it('preserves completed older setup, supports standard mode, and gates the new feature from revision-2 readers', () => {
    vi.useFakeTimers(); const f = fixture();
    expect(cloudSetupRoute(f.data, f.vaultId)).toBe(`cloud-ready/${f.vaultId}`); expect(cloudManagerReady(f.data, f.vaultId)).toBe(true);
    const data = finish(choose(inspect(f.data, f.appId), f.appId, 'default'));
    expect(data.securityModel.revision).toBe(3); expect(extraSetting(data, f.vaultId)?.extraState).toBe('disabled');
    expect(data.securityModel.entities.some(e => e.protonPassExtraCycle)).toBe(false);
    expect(data.assets).toEqual(f.data.assets);
    expect(z.object({ revision: z.union([z.literal(1), z.literal(2)]) }).passthrough().safeParse(data.securityModel).success).toBe(false);
  });
  it('blocks jumping to mutation without independent preparation or missing root recovery', () => {
    vi.useFakeTimers(); const f = fixture(); let data = choose(inspect(f.data, f.appId), f.appId, 'enable');
    const recipe = currentTask(data)!.recipe.id;
    data = move(data, `do/${f.appId}/${recipe}/apply`) as CurrentDataset;
    expect(currentTask(data)?.redirectTo).toBeDefined();
    data = completeStep(data) as CurrentDataset; expect(extraApplied(data, f.appId, recipe)).toBe(false);
    data.assets[0].controls.recoveryFile = 'unknown';
    expect(currentTask(data)?.redirectTo).toBe(`cloud-extra-prerequisites/${f.appId}`);
  });
  it('checks an existing setting and paper without inventing sign-in, changing credentials or repeated copies', () => {
    vi.useFakeTimers(); const f = fixture(); let data = finish(choose(inspect(f.data, f.appId), f.appId, 'review'));
    const id = extraSetting(data, f.vaultId)?.extraCredentialRef;
    expect(data.securityModel.routes.some(r => r.id.includes('proton-extra'))).toBe(false);
    expect(data.securityModel.lifecycle[f.appId]?.accessResetAt).toBeUndefined();
    data = finish(choose(inspect(data, f.appId), f.appId, 'review'));
    expect(extraSetting(data, f.vaultId)?.extraCredentialRef).toBe(id);
    expect(data.securityModel.entities.filter(e => e.protonPassExtraPaper)).toHaveLength(1);
  });
  it('resumes the exact deferred action without generating another phrase or request', async () => {
    vi.useFakeTimers(); const f = fixture(); let data = choose(inspect(f.data, f.appId), f.appId, 'enable');
    while (currentTask(data)?.step.id !== 'form') data = complete(data);
    const cursor = data.guide.cursor, cycle = extraCycle(data, f.appId);
    data = startProtonExtra(deferStep(data), f.appId) as CurrentDataset;
    expect(data.guide.cursor).toBe(cursor); expect(extraCycle(data, f.appId)).toBe(cycle);
    const vault = await createEncryptedVault('test only storage phrase', data);
    expect(currentDatasetSchema.parse((await decryptVault(vault.envelope, 'test only storage phrase')).data)).toEqual(data);
  });
  it('does not repeat a recorded mutation and permits finishing a real change after a preparation correction', () => {
    vi.useFakeTimers(); const f = fixture(); let data = choose(inspect(f.data, f.appId), f.appId, 'enable'); const recipe = currentTask(data)!.recipe.id;
    while (currentTask(data)?.step.id !== 'apply') data = complete(data); data = complete(data);
    const reset = data.securityModel.lifecycle[f.appId].accessResetAt;
    data = move(data, `do/${f.appId}/${recipe}/form`) as CurrentDataset;
    expect(currentTask(data)?.step.action.ja).not.toContain('Continue'); data = complete(data); data = complete(data);
    expect(data.securityModel.lifecycle[f.appId].accessResetAt).toBe(reset);
    data = undoStep(data, `do/${f.appId}/${recipe}/paper`) as CurrentDataset;
    data = move(data, `do/${f.appId}/${recipe}/account`) as CurrentDataset;
    expect(currentTask(data)?.redirectTo).toBeUndefined(); data = finish(data);
    expect(data.guide.cursor).toBe(`cloud-ready/${f.vaultId}`);
    expect(data.securityModel.lifecycle[f.appId].accessResetAt).toBe(reset);
  });
  it('withdraws dependent observations while retaining the actual change epoch and referenced routes', () => {
    vi.useFakeTimers(); const f = fixture(); let data = finish(choose(inspect(f.data, f.appId), f.appId, 'enable'));
    const route = data.securityModel.routes.find(r => r.id.includes(':proton-extra:read:route'))!, before = data.securityModel.lifecycle[f.appId].accessResetAt;
    const recipe = extraRecipeId(data, f.appId, 'enable'); data = undoStep(data, `do/${f.appId}/${recipe}/extra`) as CurrentDataset;
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('unknown');
    expect(data.securityModel.lifecycle[f.appId].accessResetAt).toBe(before); expect(securityModelIssues(data.securityModel, data.assets)).toEqual([]);
  });
  it('keeps revision 3 when creating another store and answering a cloud phone question', () => {
    vi.useFakeTimers(); const f = fixture(); let data = inspect(f.data, f.appId);
    data = makeCloudVault(data, 'nordpass', 'ja') as CurrentDataset; expect(data.securityModel.revision).toBe(3);
    data.assets.push({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'New phone', importance: 'critical', operatingSystem: 'android' }), id: 'fresh' });
    data = startPhoneWorkflow(data, '/guide', 'phone', 'change'); data.deviceWorkflows[0].newDeviceRef = 'fresh';
    data.deviceWorkflows[0].answers = { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none' };
    data = answerPhoneQuestion(jumpPhoneStep(data, 'change', `cloud-use:${f.vaultId}`), 'change', 'old') as CurrentDataset;
    expect(data.securityModel.revision).toBe(3); expect(data.deviceWorkflows[0].answers[`cloud-use:${f.vaultId}`]).toBe('old');
  });
  it('invalidates all Pass profiles for the same actual Account, preserving other Accounts and Mail', () => {
    vi.useFakeTimers(); const f = fixture('windows'); let data = f.data;
    const app = cloudInstallation(data, f.appId)!;
    data.assets.push({ ...data.assets[0], id: 'other-root' });
    const vault = data.securityModel.entities.find(e => e.id === f.vaultId)!;
    data.securityModel.entities.push({ ...app, id: 'same-root-profile', profileLabel: 'Another profile' }, { ...vault, id: 'other-vault', authenticationAccountRef: 'other-root' }, { ...app, id: 'other-root-app', vaultRef: 'other-vault', profileLabel: 'Other Account' });
    data = finish(choose(inspect(data, f.appId), f.appId, 'enable'));
    expect(data.securityModel.lifecycle['same-root-profile']?.accessResetAt).toBeTruthy();
    expect(data.securityModel.lifecycle['other-root-app']?.accessResetAt).toBeUndefined();
    expect(data.securityModel.lifecycle['other-vault']?.accessResetAt).toBeUndefined();
    expect(data.securityModel.lifecycle[f.rootId]?.accessResetAt).toBeUndefined();
  });
  it('rechecks a changed external setting and retires the previous extra secret without suggesting removal', () => {
    vi.useFakeTimers(); const f = fixture(); let data = finish(choose(inspect(f.data, f.appId), f.appId, 'enable'));
    const credential = extraSetting(data, f.vaultId)?.extraCredentialRef as string;
    data = finish(choose(inspect(data, f.appId), f.appId, 'default'));
    expect(extraSetting(data, f.vaultId)?.extraState).toBe('disabled');
    expect(data.securityModel.lifecycle[credential]?.state).toBe('revoked');
  });
  it('preserves conflicting opaque older answers instead of overwriting them on feature entry', () => {
    const f = fixture(); f.data.guide.answers[`${f.appId}:proton-extra-cycle`] = 'PRIVATE OLD OPAQUE FIELD';
    const original = structuredClone(f.data);
    expect(() => startProtonExtra(f.data, f.appId)).toThrow('legacy-feature-key-conflict');
    expect(f.data).toEqual(original);
  });
  it('cannot reactivate an older change by revisiting an old inspection', () => {
    vi.useFakeTimers(); const f = fixture(); let data = startProtonExtra(f.data, f.appId) as CurrentDataset;
    const inspection = data.guide.cursor; data = complete(data); data = finish(choose(data, f.appId, 'default'));
    data = startProtonExtra(data, f.appId) as CurrentDataset; const cycle = extraCycle(data, f.appId);
    data = move(data, inspection) as CurrentDataset;
    expect(currentTask(data)?.redirectTo).toBe(`cloud-extra-state/${f.appId}`);
    data = completeStep(data) as CurrentDataset; expect(extraCycle(data, f.appId)).toBe(cycle);
  });
  it('does not fall back to an obsolete setting or secret when a later physical change record is withdrawn', () => {
    vi.useFakeTimers(); const f = fixture(); let data = finish(choose(inspect(f.data, f.appId), f.appId, 'default'));
    data = choose(inspect(data, f.appId), f.appId, 'enable'); const recipe = currentTask(data)!.recipe.id;
    while (currentTask(data)?.step.id !== 'apply') data = complete(data); data = complete(data);
    data = undoStep(data, `do/${f.appId}/${recipe}/apply`) as CurrentDataset;
    expect(extraSetting(data, f.vaultId)).toBeUndefined();
    expect(extraApplied(data, f.appId, recipe)).toBe(true);
    expect(data.securityModel.lifecycle[f.appId]?.accessResetAt).toBeTruthy();
  });
  it('keeps opaque older credential fields uninterpreted and does not revoke them during the new setting', () => {
    vi.useFakeTimers(); const f = fixture(); const legacy = { id: 'opaque-credential', kind: 'credential' as const, credentialType: 'password' as const, subjectRef: f.rootId, roles: ['sign-in' as const], label: 'Legacy record', createdAt: '2026-11-13T00:00:00Z', protonPassExtraAccount: f.rootId, protonPassExtraCycle: 'opaque-old-value' };
    f.data.securityModel.entities.push(legacy);
    expect(typedMapStatus(f.data, mapItems(f.data, 'ja').find(e => e.id === legacy.id)!, 'ja').label).not.toContain('追加パスワード');
    const data = finish(choose(inspect(f.data, f.appId), f.appId, 'enable'));
    expect(data.securityModel.entities.find(e => e.id === legacy.id)).toEqual(legacy);
    expect(data.securityModel.lifecycle[legacy.id]).toBeUndefined();
  });
  it('keeps private account/device/profile names out of manual exception prompts', () => {
    vi.useFakeTimers(); const f = fixture('windows'); let data = inspect(f.data, f.appId);
    data = move(data, `cloud-extra-unavailable/${f.appId}`) as CurrentDataset;
    for (const language of ['ja', 'en'] as const) expect(helpPrompt(data, '画面が違う', language)).not.toContain('PRIVATE');
  });
});
