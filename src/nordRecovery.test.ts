import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentDatasetSchema, DataUpgradeConflict, makeAsset, newDataset, type CurrentDataset } from './models';
import { recordControl } from './controlRecords';
import { chooseCloudDevice, cloudAnswer, cloudInstallation, cloudManagerReady, cloudMasterChanged, cloudSetupRoute, cloudVault, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer } from './cloudManagers';
import { answerNordRecovery, confirmNordRecovery, currentNordStep, navigateNordRecovery, nordRecoveryPrompt, startNordRecovery, startPhoneNordRecovery, undoNordRecovery } from './nordRecovery';
import { nordBiometricEligible } from './nordRecoveryCatalog';
import { nordRecoveryApplied, nordRecoveryMasterConfirmed, nordRecoveryPending, nordRecoveryTasks } from './nordRecoverySchemas';
import { evaluateAccess, securityEntitySchema, securityModelIssues } from './securityModel';
import { createEncryptedVault, decryptVault } from './crypto';
import { answerPhoneQuestion, jumpPhoneStep, phoneRecord, startPhoneWorkflow } from './phoneEngine';
import { phoneSteps } from './phoneCatalog';
import { startProtonExtra } from './protonPassExtra';
import { mapItems, typedMapStatus } from './securityMapViews';

function fixture(os: 'ios' | 'android' | 'windows' | 'macos' = 'ios') {
  let data = newDataset('ja');
  const root = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'PRIVATE ROOT', importance: 'critical' }), id: 'root', provider: 'nord' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const device = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'PRIVATE DEVICE', importance: 'critical', operatingSystem: os }), id: 'phone' };
  data.assets = [root, device]; data = makeCloudVault(data, 'nordpass', 'ja'); const vaultId = data.guide.managerId!;
  data = configureCloudRoot(data, vaultId, root.id) as CurrentDataset;
  data = setCloudAnswer(data, root.id, 'method', 'direct') as CurrentDataset;
  data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset;
  data = setCloudAnswer(data, vaultId, 'master', 'keep') as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, device.id) as CurrentDataset; const appId = selectedCloudInstallation(data, vaultId)!.id;
  if (os === 'ios' || os === 'android') data = setCloudAnswer(data, appId, os === 'ios' ? 'ios' : 'android', os === 'ios' ? 'ios18plus' : 'android9plus') as CurrentDataset;
  else { data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset; data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: 'PRIVATE PROFILE' } : e); }
  for (const [ref, control] of [[root.id, 'mfa'], [root.id, 'recovery'], [device.id, 'screenLock'], [appId, 'opened'], [appId, 'storageChecked'], [appId, 'autofill'], [vaultId, 'recovery'], [vaultId, 'independentRoot']]) data = recordControl(data, ref, control, { id: `old:${ref}:${control}` }) as CurrentDataset;
  data.guide.cursor = `do/${appId}/cloud-onboard/vault-open`;
  return { data, rootId: root.id, vaultId, appId };
}
const task = (data: CurrentDataset) => nordRecoveryTasks(data).at(-1)!;
const current = (data: CurrentDataset) => currentNordStep(data, task(data))!;
function tick() { vi.setSystemTime(new Date(Date.now() + 1000)); }
function answer(data: CurrentDataset, value: string) { tick(); return answerNordRecovery(data, task(data).id, value) as CurrentDataset; }
function confirm(data: CurrentDataset) { tick(); return confirmNordRecovery(data, task(data).id) as CurrentDataset; }
function until(data: CurrentDataset, id: string, method = 'code', backup = 'current') {
  for (let n = 0; n < 60 && current(data).id !== id; n++) {
    const step = current(data); if (step.kind === 'question') { const values: Record<string, string> = { method, source: `app:${task(data).targetRef}`, 'target-state': 'signed-in', 'backup-state': backup }; data = answer(data, values[step.id] ?? step.choicesNord![0].value); }
    else if (!step.kind) data = confirm(data); else throw new Error(`Blocked at ${step.id}`);
  }
  expect(current(data).id).toBe(id); return data;
}
afterEach(() => vi.useRealTimers());
describe('personal NordPass forgotten-master recovery', () => {
  for (const os of ['ios', 'android', 'windows', 'macos'] as const) it(`${os}: uses current 24-symbol code, tests the new master and preserves the original guide`, () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
    const f = fixture(os), guide = structuredClone(f.data.guide), root = structuredClone(f.data.assets[0]);
    let data = startNordRecovery(f.data, f.appId);
    expect(data.securityModel.revision).toBe(4); expect(data.securityModel.lifecycle[f.vaultId]?.accessResetAt).toBeUndefined();
    data = until(data, 'apply'); expect(nordRecoveryApplied(task(data))).toBe(false);
    data = confirm(data); expect(current(data).id).toBe('master-test'); expect(nordRecoveryPending(data, f.vaultId)).toBeDefined();
    expect(cloudManagerReady(data, f.vaultId)).toBe(false); expect(cloudSetupRoute(data, f.vaultId)).toBe(`cloud-recovery-pending/${f.vaultId}`);
    expect(data.securityModel.routes.filter(r => r.purpose === 'decrypt')).toHaveLength(0);
    data = until(data, 'finished');
    expect(task(data).status).toBe('completed'); expect(data.guide).toEqual(guide); expect(data.assets[0]).toEqual(root);
    expect(data.securityModel.entities.filter(e => e.kind === 'credential' && e.nordRecoveryCredential === 'v1')).toHaveLength(2);
    expect(nordRecoveryMasterConfirmed(data, f.vaultId)).toBe(true); expect(cloudManagerReady(data, f.vaultId)).toBe(true);
    const route = data.securityModel.routes.find(r => r.purpose === 'decrypt')!;
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('available');
    expect(evaluateAccess(data.securityModel, route.id, { context: 'all-devices-lost', now: new Date().toISOString() }).state).toBe('not-applicable');
    expect(typedMapStatus(data, mapItems(data, 'ja').find(e => e.id === f.appId)!, 'ja').label).toContain('利用待ち');
    expect(currentDatasetSchema.safeParse(data).success).toBe(true); expect(securityModelIssues(data.securityModel, data.assets)).toEqual([]);
  });
  it('uses only previously configured biometrics and never repeats a recorded code/master mutation', () => {
    vi.useFakeTimers(); const f = fixture(); let data = until(startNordRecovery(f.data, f.appId), 'bio-code', 'biometric');
    data = confirm(data); expect(current(data).id).toBe('code-copy'); const code = task(data).currentCodeRef, mutation = task(data).mutations['bio-code'];
    data = navigateNordRecovery(data, task(data).id, 'back') as CurrentDataset;
    expect(current(data).id).not.toBe('bio-code'); data = until(data, 'apply', 'biometric'); data = confirm(data); const epoch = data.securityModel.lifecycle[f.vaultId].accessResetAt;
    data = navigateNordRecovery(data, task(data).id, 'back') as CurrentDataset; expect(current(data).id).toBe('master-test');
    data = until(data, 'finished', 'biometric'); expect(task(data).currentCodeRef).toBe(code); expect(task(data).mutations['bio-code']).toEqual(mutation); expect(data.securityModel.lifecycle[f.vaultId].accessResetAt).toBe(epoch);
  });
  it('records a new post-recovery code without invalidating the tested new master', () => {
    vi.useFakeTimers(); const f = fixture(); let data = until(startNordRecovery(f.data, f.appId), 'backup-code', 'code', 'replace');
    const oldCode = task(data).currentCodeRef!, route = data.securityModel.routes.find(r => r.purpose === 'decrypt')!;
    data = confirm(data); expect(current(data).id).toBe('backup-copy'); expect(task(data).currentCodeRef).not.toBe(oldCode); expect(data.securityModel.lifecycle[oldCode].state).toBe('revoked');
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('available');
    expect(nordRecoveryPending(data, f.vaultId)).toBeDefined(); data = confirm(data); expect(nordRecoveryPending(data, f.vaultId)).toBeUndefined();
  });
  it('undo withdraws dependent use/controls while preserving real master/code epochs and physical device roles', () => {
    vi.useFakeTimers(); const f = fixture();
    f.data.securityModel.lifecycle[f.appId] = { state: 'backup', evidence: 'user-reported', updatedAt: '2026-11-12T00:00:00Z', opaque: 'keep' };
    let data = until(startNordRecovery(f.data, f.appId), 'finished', 'code', 'replace');
    const epoch = data.securityModel.lifecycle[f.vaultId].accessResetAt, code = task(data).currentCodeRef!, route = data.securityModel.routes.find(r => r.purpose === 'decrypt')!;
    data = undoNordRecovery(data, task(data).id, 'master-test') as CurrentDataset;
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('unknown');
    expect(data.securityModel.lifecycle[f.vaultId].accessResetAt).toBe(epoch); expect(task(data).currentCodeRef).toBe(code); expect(data.securityModel.lifecycle[f.appId]).toMatchObject({ state: 'backup', evidence: 'user-reported', opaque: 'keep' });
    data = until(data, 'finished'); expect(task(data).currentCodeRef).toBe(code); expect(data.securityModel.lifecycle[f.vaultId].accessResetAt).toBe(epoch);
  });
  it('blocks forged cursors, wrong profile, Safari biometrics and missing methods without deleting data', () => {
    vi.useFakeTimers(); const f = fixture('macos'); let data = startNordRecovery(f.data, f.appId);
    (data.securityModel.nordRecoveryV1 as { tasks: { cursor: string }[] }).tasks[0].cursor = 'apply';
    data = confirm(data); expect(nordRecoveryApplied(task(data))).toBe(false); expect(current(data).id).toBe('method');
    data = setCloudAnswer(data, f.appId, 'browser', 'safari') as CurrentDataset;
    expect(nordBiometricEligible(data, selectedCloudInstallation(data, f.vaultId)!.id)).toBe(false); expect(nordBiometricEligible(data, f.appId)).toBe(true);
    data = answer(data, 'none'); expect(current(data).id).toBe('no-method'); expect(confirm(data)).toEqual(data);
    expect(data.assets).toEqual(f.data.assets); expect(data.securityModel.lifecycle).toEqual(f.data.securityModel.lifecycle);
  });
  it('registers a previously used native desktop source separately from browser/autofill setup', () => {
    vi.useFakeTimers(); const f = fixture(); let data = until(startNordRecovery(f.data, f.appId), 'source', 'biometric');
    data = answer(data, 'register'); expect(current(data).id).toBe('source-device'); data = answer(data, 'new:macos'); expect(current(data).id).toBe('source-surface'); data = answer(data, 'native');
    const source = cloudInstallation(data, task(data).sourceRef)!; expect(source.nordRecoverySurface).toBe('native-v1'); expect(source.controls).toEqual({}); expect(nordBiometricEligible(data, source.id)).toBe(true);
    expect(current(data).id).toBe('bio-open'); data = until(data, 'finished', 'biometric');
    expect(cloudInstallation(data, source.id)?.controls).toMatchObject({ opened: 'verified', storageChecked: 'verified' }); expect(cloudInstallation(data, source.id)?.controls?.autofill).toBeUndefined();
    expect(source.profileLabel).toBeUndefined(); expect(cloudManagerReady(data, f.vaultId, source.id)).toBe(false);
    expect(data.guide).toEqual(f.data.guide); expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it('only invalidates actual same-account stores and recognized vault codes, never Account MFA or opaque fields', () => {
    vi.useFakeTimers(); const f = fixture(); let data = f.data;
    const oldCode = securityEntitySchema.parse({ id: 'old-code', kind: 'credential', label: 'old', createdAt: '2026-11-12T00:00:00Z', credentialType: 'recovery-code', subjectRef: f.vaultId, roles: ['restore'], cloudRecoveryPhase: 'cloud-recovery' });
    const mfaCode = securityEntitySchema.parse({ ...oldCode, id: 'account-mfa-code', subjectRef: f.rootId });
    const opaque = securityEntitySchema.parse({ ...oldCode, id: 'opaque', cloudRecoveryPhase: 'unrecognized' });
    data.securityModel.entities.push(oldCode, mfaCode, opaque);
    data.securityModel.relations.push({ id: 'old-observation:cloud:recovery', fromRef: oldCode.id, toRef: f.vaultId, kind: 'recovers', evidence: 'user-confirmed', checkedAt: '2026-11-12T00:00:00Z', sourceIds: ['nordRecovery'] });
    data = makeCloudVault(data, 'nordpass', 'ja'); const otherVault = data.guide.managerId!; data = configureCloudRoot({ ...data, assets: [...data.assets, { ...data.assets[0], id: 'other-root' }] }, otherVault, 'other-root') as CurrentDataset;
    const before = cloudVault(data, otherVault);
    data = until(startNordRecovery(data, f.appId), 'finished', 'biometric');
    expect(data.securityModel.lifecycle[oldCode.id].state).toBe('revoked'); expect(data.securityModel.lifecycle[mfaCode.id]).toBeUndefined(); expect(data.securityModel.lifecycle[opaque.id]).toBeUndefined();
    expect(cloudVault(data, otherVault)).toEqual(before); expect(data.securityModel.lifecycle[otherVault]).toBeUndefined();
  });
  it('binds recovered strength to the current request and blocks replay after a newer master change', () => {
    vi.useFakeTimers(); const f = fixture(); let data = setCloudAnswer(f.data, f.vaultId, 'master', 'change') as CurrentDataset;
    data = until(startNordRecovery(data, f.appId), 'finished'); expect(cloudMasterChanged(data, f.vaultId)).toBe(true); const first = task(data), request = cloudAnswer(data, f.vaultId, 'master-request');
    data = setCloudAnswer(data, f.vaultId, 'master', 'change') as CurrentDataset;
    expect(cloudAnswer(data, f.vaultId, 'master-request')).not.toBe(request); expect(cloudMasterChanged(data, f.vaultId)).toBe(false);
    tick(); data = until(startNordRecovery(data, f.appId), 'finished');
    expect(currentNordStep(data, first)?.id).toBe('superseded');
  });
  it('keeps a superseded pending task historical and starts a fresh attempt without reviving a revoked code', () => {
    vi.useFakeTimers(); const f = fixture(); let data = until(startNordRecovery(f.data, f.appId), 'use-code'); const old = task(data), oldCode = old.currentCodeRef!;
    data.securityModel.lifecycle[oldCode] = { state: 'revoked', evidence: 'user-confirmed', updatedAt: new Date().toISOString() };
    expect(currentNordStep(data, old)?.id).toBe('superseded'); tick(); data = startNordRecovery(data, f.appId);
    expect(task(data).id).not.toBe(old.id); expect(nordRecoveryTasks(data)).toHaveLength(2); expect(current(data).id).toBe('method');
    expect(data.securityModel.lifecycle[oldCode].state).toBe('revoked');
    data.assets = data.assets.map(a => a.id === f.rootId ? { ...a, purpose: 'work' } : a);
    expect(current(data).id).toBe('managed'); expect(confirm(data)).toEqual(data);
  });
  it('resumes encrypted work and rejects new-field collisions while preserving older opaque data', async () => {
    vi.useFakeTimers(); const f = fixture(); f.data.securityModel.nordRecoveryV1 = { old: 'opaque' };
    expect(currentDatasetSchema.parse(f.data).securityModel.nordRecoveryV1).toEqual({ old: 'opaque' }); expect(() => startNordRecovery(f.data, f.appId)).toThrow(DataUpgradeConflict);
    delete f.data.securityModel.nordRecoveryV1; let data = until(startNordRecovery(f.data, f.appId), 'use-code'); const id = task(data).id;
    data = navigateNordRecovery(data, id, 'defer') as CurrentDataset;
    const sealed = await createEncryptedVault('only the test app passphrase', data); data = (await decryptVault(sealed.envelope, 'only the test app passphrase')).data as CurrentDataset;
    data = startNordRecovery(data, f.appId); expect(task(data).id).toBe(id); expect(current(data).id).toBe('use-code'); expect(nordRecoveryTasks(data)).toHaveLength(1);
    data.securityModel.nordRecoveryV1 = { version: 1, tasks: [{ id: 'broken' }] }; expect(currentDatasetSchema.safeParse(data).success).toBe(false);
  });
  it('does not interpret same-named opaque pre-revision-4 metadata or overwrite it during upgrade', () => {
    const f = fixture('windows'); f.data.securityModel.entities = f.data.securityModel.entities.map(e => e.id === f.appId ? { ...e, nordRecoverySurface: 'native-v1', unrelated: 'preserve' } : e);
    expect(cloudManagerReady(f.data, f.vaultId)).toBe(true); expect(() => startNordRecovery(f.data, f.appId)).toThrow(DataUpgradeConflict);
    expect(currentDatasetSchema.parse(f.data).securityModel.entities.find(e => e.id === f.appId)?.unrelated).toBe('preserve');
  });
  it('phone recovery preserves all main-guide data, shares exact confirmed work, and undo withdraws its derived receipts', () => {
    vi.useFakeTimers(); const f = fixture(); let data = f.data;
    data.assets.push({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'New phone', importance: 'critical', operatingSystem: 'android' }), id: 'new' });
    data = startPhoneWorkflow(data, '/guide', 'phone', 'change'); Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'new', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', [`cloud-use:${f.vaultId}`]: 'new', 'old-fate': 'spare' }, cursor: `cloud:${f.vaultId}:vault-secret` });
    const guide = structuredClone(data.guide); data = startPhoneNordRecovery(data, 'change', f.vaultId); const newApp = task(data).targetRef;
    expect(cloudInstallation(data, newApp)?.controls).toEqual({}); expect(data.guide).toEqual(guide);
    data = until(data, 'finished'); expect(data.guide).toEqual(guide);
    const w = data.deviceWorkflows[0], steps = phoneSteps(data, w);
    for (const suffix of ['recovery', 'account-mfa', 'vault-secret', 'vault-recovery', 'open', 'vault-open', 'storage-check']) { const s = steps.find(s => s.id === `cloud:${f.vaultId}:${suffix}`)!; expect(phoneRecord(w, s)?.status, suffix).toBe('confirmed'); }
    expect(Object.values(w.records).some(r => r.stepId.endsWith(':test'))).toBe(false);
    data = undoNordRecovery(data, task(data).id, 'master-test') as CurrentDataset;
    expect(Object.values(data.deviceWorkflows[0].records).some(r => r.nordRecoveryTaskRef === task(data).id)).toBe(false); expect(data.guide).toEqual(guide);
  });
  it('leaves separately changed phone work untouched and never substitutes another profile', () => {
    vi.useFakeTimers(); const f = fixture(); let data = f.data; data.assets.push({ ...data.assets[1], id: 'new' }); data = startPhoneWorkflow(data, '/guide', 'phone', 'change');
    Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'new', answers: { [`cloud-use:${f.vaultId}`]: 'new' } });
    data = startPhoneNordRecovery(data, 'change', f.vaultId); data.deviceWorkflows[0].cursor = 'new-device'; const before = structuredClone(data.deviceWorkflows[0]);
    data = until(data, 'finished'); expect(data.deviceWorkflows[0]).toEqual(before);
    const prompt = nordRecoveryPrompt(data, task(data), 2, 'ja'); expect(prompt).not.toMatch(/PRIVATE|root|phone|Recovery profile/); expect(prompt).toContain('https://support.nordpass.com/');
  });
  it('preserves revision 4 through Proton extra setup and cloud phone answers', () => {
    vi.useFakeTimers(); const f = fixture(); let data = startNordRecovery(f.data, f.appId);
    data = makeCloudVault(data, 'proton-pass', 'ja'); const protonVault = data.guide.managerId!; const protonRoot = { ...data.assets[0], id: 'proton', provider: 'proton' as const }; data.assets.push(protonRoot);
    data = configureCloudRoot(data, protonVault, 'proton') as CurrentDataset; data = chooseCloudDevice(data, protonVault, 'phone') as CurrentDataset; const protonApp = selectedCloudInstallation(data, protonVault)!;
    data = startProtonExtra(data, protonApp.id) as CurrentDataset; expect(data.securityModel.revision).toBe(4);
    data.assets.push({ ...data.assets[1], id: 'fresh' }); data = startPhoneWorkflow(data, '/guide', 'phone', 'change'); data.deviceWorkflows[0].newDeviceRef = 'fresh';
    data = answerPhoneQuestion(jumpPhoneStep(data, 'change', `cloud-use:${f.vaultId}`), 'change', 'old') as CurrentDataset; expect(data.securityModel.revision).toBe(4); expect(nordRecoveryTasks(data)).toHaveLength(1);
  });
});
