import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentDatasetSchema, DataUpgradeConflict, guideSchema, makeAsset, newDataset, type CurrentDataset } from './models';
import { recordControl } from './controlRecords';
import { chooseCloudDevice, cloudAnswer, cloudManagerReady, cloudSetupRoute, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer } from './cloudManagers';
import { confirmNordSsoConnection, reportNordSsoDisconnected, setNordDirectPasswordUse, saveNordSsoSession, selectNordSsoAccount, selectNordSsoProvider, startNordSsoSession, undoNordSsoEvidence } from './nordSso';
import { nordDirectPasswordAvailable, nordSsoBinding, nordSsoReady, nordSsoStore } from './nordSsoSchemas';
import { beginRecipe, completeStep, currentTask, move, undoStep } from './guideEngine';
import { evaluateAccess, securityEntitySchema, securityModelIssues } from './securityModel';
import { createEncryptedVault, decryptVault } from './crypto';
import { answerPhoneQuestion, confirmPhoneStep, currentPhoneStep, jumpPhoneStep, phoneRecord, phoneStepBlockers, startPhoneWorkflow } from './phoneEngine';
import { nordSsoRecipe } from './nordSsoCatalog';
import { phoneSteps } from './phoneCatalog';
import { cloudPasswordRecipe } from './cloudPasswordCatalog';
import { answerNordRecovery, confirmNordRecovery, currentNordStep, startNordRecovery } from './nordRecovery';
import { nordRecoveryPending, nordRecoveryTasks } from './nordRecoverySchemas';

function fixture(provider: 'google' | 'apple' = 'google', opened = false, os: 'ios' | 'android' | 'windows' = 'ios') {
  let data = newDataset('ja');
  const root = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: 'PRIVATE NORD', importance: 'critical' }), id: 'nord', provider: 'nord' as const, purpose: 'personal' as const };
  const identity = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'PRIVATE PROVIDER', importance: 'critical' }), id: 'provider', provider, purpose: 'personal' as const, services: ['mail' as const] };
  const device = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'PRIVATE DEVICE', importance: 'critical', operatingSystem: os }), id: 'device' };
  data.assets = [root, identity, device]; data.guide.accountId = identity.id;
  data = makeCloudVault(data, 'nordpass', 'ja'); const vaultId = data.guide.managerId!; data = configureCloudRoot(data, vaultId, root.id) as CurrentDataset;
  data = setCloudAnswer(data, root.id, 'method', 'sso') as CurrentDataset; data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset; data = setCloudAnswer(data, vaultId, 'master', 'keep') as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, device.id) as CurrentDataset; const appId = selectedCloudInstallation(data, vaultId)!.id;
  if (os === 'ios' || os === 'android') data = setCloudAnswer(data, appId, os === 'ios' ? 'ios' : 'android', os === 'ios' ? 'ios18plus' : 'android9plus') as CurrentDataset;
  else { data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset; data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: 'PRIVATE PROFILE' } : e); }
  const controls = [[root.id, 'mfa'], [root.id, 'recovery'], [identity.id, 'mfa'], [identity.id, 'recovery'], [device.id, 'screenLock'], [vaultId, 'recovery'], [vaultId, 'independentRoot'], [appId, 'autofill'], ...(opened ? [[appId, 'opened'], [appId, 'storageChecked']] : [])];
  for (const [ref, control] of controls) data = recordControl(data, ref, control, { id: `existing:${ref}:${control}` }) as CurrentDataset;
  data = move(data, cloudSetupRoute(data, vaultId)) as CurrentDataset;
  return { data, vaultId, appId, rootId: root.id, providerId: identity.id, provider };
}
const tick = () => vi.setSystemTime(new Date(Date.now() + 1000));
function complete(data: CurrentDataset, next?: string) { tick(); expect(currentTask(data)?.redirectTo, data.guide.cursor).toBeUndefined(); return completeStep(data, next) as CurrentDataset; }
function prepare(f: ReturnType<typeof fixture>) {
  let data = selectNordSsoProvider(f.data, f.rootId, f.provider) as CurrentDataset; data = selectNordSsoAccount(data, f.rootId, f.providerId) as CurrentDataset;
  data = move(data, cloudSetupRoute(data, f.vaultId)) as CurrentDataset;
  for (let n = 0; n < 4; n++) data = complete(data);
  expect(data.guide.cursor).toBe(`cloud-sso-state/${f.vaultId}`); return data;
}
function connected(f: ReturnType<typeof fixture>) { const data = confirmNordSsoConnection(prepare(f), f.rootId) as CurrentDataset; return move(data, cloudSetupRoute(data, f.vaultId)) as CurrentDataset; }
function finishPhase(data: CurrentDataset) {
  const recipe = currentTask(data)!.recipe.id;
  for (let n = 0; n < 32 && currentTask(data)?.recipe.id === recipe; n++) data = complete(data);
  return data;
}
afterEach(() => vi.useRealTimers());
describe('personal NordPass connected provider identity and work', () => {
  for (const provider of ['google', 'apple'] as const) for (const os of ['ios', 'android', 'windows'] as const) it(`${provider}/${os}: selection, connection, provider authentication, Nord sign-in and vault read stay separate`, () => {
    vi.useFakeTimers(); const f = fixture(provider, false, os), originalProvider = structuredClone(f.data.assets[1]);
    let data = prepare(f); expect(nordSsoReady(data, f.rootId)).toBe(false); expect(data.securityModel.entities.some(e => e.kind === 'grant')).toBe(false);
    data = confirmNordSsoConnection(data, f.rootId) as CurrentDataset; expect(nordSsoReady(data, f.rootId)).toBe(true); expect(data.securityModel.routes).toHaveLength(0);
    data = move(data, cloudSetupRoute(data, f.vaultId)) as CurrentDataset; data = complete(data); expect(currentTask(data)?.step.id).toBe('sso-state');
    data = complete(data, 'sso-email'); data = finishPhase(data);
    const b = nordSsoBinding(data, f.rootId)!;
    const providerAuth = data.securityModel.routes.find(r => r.targetRef === f.providerId && r.purpose === 'sign-in')!, accountAuth = data.securityModel.routes.find(r => r.targetRef === f.rootId && r.purpose === 'sign-in')!, vaultRead = data.securityModel.routes.find(r => r.targetRef === f.vaultId && r.purpose === 'decrypt')!;
    expect(providerAuth).toBeDefined(); expect(accountAuth).toBeDefined(); expect(vaultRead).toBeDefined(); expect(b.providerRef).toBe(f.providerId); expect(data.assets[1]).toEqual(originalProvider);
    for (const r of [providerAuth, accountAuth, vaultRead]) expect(evaluateAccess(data.securityModel, r.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('available');
    expect(evaluateAccess(data.securityModel, accountAuth.id, { context: 'normal', now: new Date().toISOString(), unavailableRefs: [f.providerId] }).state).toBe('unavailable');
    expect(evaluateAccess(data.securityModel, accountAuth.id, { context: 'all-devices-lost', now: new Date().toISOString() }).state).toBe('not-applicable');
    expect(cloudManagerReady(data, f.vaultId)).toBe(true); expect(data.guide.accountId).toBe(f.providerId); expect(securityModelIssues(data.securityModel, data.assets)).toEqual([]); expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it('keeps a currently signed-in app without making up a fresh provider sign-in or creating another master', () => {
    vi.useFakeTimers(); const f = fixture(); let data = connected(f); data = complete(data); data = complete(data, 'vault-open'); data = finishPhase(data);
    expect(cloudManagerReady(data, f.vaultId)).toBe(true); expect(data.securityModel.routes.filter(r => r.purpose === 'sign-in')).toHaveLength(0); expect(data.securityModel.routes.filter(r => r.purpose === 'decrypt')).toHaveLength(1);
    expect(data.securityModel.entities.filter(e => e.kind === 'vault')).toHaveLength(1); expect(data.guide.steps[`do/${f.appId}/cloud-onboard/master-set`]).toBeUndefined();
  });
  it('blocks forged connection/fresh sign-in confirmations without independent preparation or provider protection', () => {
    vi.useFakeTimers(); const f = fixture(); let data = selectNordSsoAccount(selectNordSsoProvider(f.data, f.rootId, 'google'), f.rootId, f.providerId) as CurrentDataset;
    expect(confirmNordSsoConnection(data, f.rootId)).toEqual(data); data = move(data, `do/${f.appId}/cloud-onboard/sign-in`) as CurrentDataset;
    expect(currentTask(data)?.redirectTo).toMatch(/cloud-sso-prepare/); expect(completeStep(data).securityModel).toEqual(data.securityModel);
    data = prepare(f); data.assets = data.assets.map(a => a.id === f.providerId ? { ...a, controls: { ...a.controls, recovery: 'unknown' } } : a);
    expect(cloudSetupRoute(data, f.vaultId)).toBe(`cloud-sso-security/${f.vaultId}`); expect(nordSsoReady(confirmNordSsoConnection(data, f.rootId), f.rootId)).toBe(false);
  });
  it('connects an existing identity only after protection, and undo withdraws configuration/use without unlinking it', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = prepare(f), b = nordSsoBinding(data, f.rootId)!;
    data = beginRecipe(data, f.appId, `cloud-sso-add:${b.id}`) as CurrentDataset; data = finishPhase(data); b = nordSsoBinding(data, f.rootId)!;
    expect(b.connectionCreatedAt).toBeDefined(); expect(nordSsoReady(data, f.rootId)).toBe(true); const grant = data.securityModel.entities.find(e => e.id === b.grantRef);
    data = undoStep(data, b.records.connect.key) as CurrentDataset;
    expect(nordSsoReady(data, f.rootId)).toBe(false); expect(nordSsoBinding(data, f.rootId)?.connectionCreatedAt).toBe(b.connectionCreatedAt); expect(data.securityModel.entities.find(e => e.id === b.grantRef)).toEqual(grant);
    expect(data.securityModel.relations.filter(r => r.nordSsoBindingRef === b.id).every(r => r.evidence === 'unknown')).toBe(true);
  });
  it('does not group different actual provider accounts, even with identical labels, or another Nord Account', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = connected(f); const first = nordSsoBinding(data, f.rootId)!;
    data.assets.push({ ...data.assets[1], id: 'other-provider' }); data = selectNordSsoAccount(data, f.rootId, 'other-provider') as CurrentDataset;
    expect(nordSsoReady(data, f.rootId)).toBe(false); expect(nordSsoBinding(data, f.rootId)?.id).not.toBe(first.id); expect(nordSsoBinding(data, f.rootId)?.records).toEqual({});
    data = selectNordSsoAccount(data, f.rootId, f.providerId) as CurrentDataset; expect(nordSsoBinding(data, f.rootId)?.id).toBe(first.id); expect(nordSsoReady(data, f.rootId)).toBe(true);
    data.assets.push({ ...data.assets[0], id: 'other-nord' }); data = selectNordSsoProvider(data, 'other-nord', 'google') as CurrentDataset; data = selectNordSsoAccount(data, 'other-nord', f.providerId) as CurrentDataset;
    expect(nordSsoBinding(data, 'other-nord')?.records).toEqual({}); expect(nordSsoReady(data, 'other-nord')).toBe(false);
  });
  it('can use the same actual provider after a normal email setup without repeating its MFA/recovery', () => {
    vi.useFakeTimers(); const f = fixture(); const oldActions = f.data.actions.length, data = connected(f);
    expect(data.assets.filter(a => a.provider === 'google')).toHaveLength(1); expect(data.actions).toHaveLength(oldActions); expect(data.guide.cursor).toBe(`do/${f.appId}/cloud-onboard/open`);
  });
  it('preserves the entire main guide during a side session, including provider setup records and mode selection', async () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); f.data.guide.cursor = 'device-select'; f.data.guide.answers[f.rootId + ':cloud-method'] = 'unknown';
    const original = structuredClone(f.data.guide), session = startNordSsoSession(f.data, f.appId, '/phone/change'); let data = session.data;
    const s = nordSsoStore(data)!.sessions.find(s => s.id === session.id)!;
    let child = { ...data, guide: guideSchema.parse(s.guide) };
    child = selectNordSsoProvider(child, f.rootId, 'google') as CurrentDataset; child = selectNordSsoAccount(child, f.rootId, f.providerId) as CurrentDataset;
    child = move(child, cloudSetupRoute(child, f.vaultId)) as CurrentDataset; for (let n = 0; n < 4; n++) child = complete(child);
    child = confirmNordSsoConnection(child, f.rootId) as CurrentDataset; data = saveNordSsoSession(data, child, session.id!) as CurrentDataset;
    expect(data.guide).toEqual(original); expect(cloudAnswer(data, f.rootId, 'method')).toBe('sso'); expect(nordSsoReady(data, f.rootId)).toBe(true); expect(nordSsoStore(data)?.sessions[0].finished).toBe(true);
    const sealed = await createEncryptedVault('test only application passphrase', data), restored = (await decryptVault(sealed.envelope, 'test only application passphrase')).data;
    expect(restored).toEqual(data); expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it('keeps unfinished side progress on reload and applies an explicit correction to a shared old record', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = connected(f); const b = nordSsoBinding(data, f.rootId)!, old = b.records.outside.key;
    const started = startNordSsoSession(data, f.appId, '/phone/change'); data = started.data; const s = nordSsoStore(data)!.sessions[0];
    const child = undoStep({ ...data, guide: guideSchema.parse(s.guide) }, old);
    data = saveNordSsoSession(data, child, s.id) as CurrentDataset; expect(data.guide.steps[old]).toBeUndefined(); expect(nordSsoReady(data, f.rootId)).toBe(false);
    expect(startNordSsoSession(data, f.appId, '/phone/change').id).toBe(s.id);
  });
  it('retains old opaque fields and rejects malformed/current or colliding/pre-feature metadata', () => {
    const f = fixture(); f.data.securityModel.nordSsoV1 = { old: 'opaque' }; expect(currentDatasetSchema.parse(f.data).securityModel.nordSsoV1).toEqual({ old: 'opaque' });
    expect(() => selectNordSsoProvider(f.data, f.rootId, 'google')).toThrow(DataUpgradeConflict); delete f.data.securityModel.nordSsoV1;
    f.data.securityModel.entities[0].nordSsoGrant = 'opaque'; expect(() => selectNordSsoProvider(f.data, f.rootId, 'google')).toThrow(DataUpgradeConflict); delete f.data.securityModel.entities[0].nordSsoGrant;
    let data = selectNordSsoAccount(selectNordSsoProvider(f.data, f.rootId, 'google'), f.rootId, f.providerId) as CurrentDataset; const store = nordSsoStore(data)!; store.bindings[0].providerRef = 'missing'; data.securityModel.nordSsoV1 = store; expect(currentDatasetSchema.safeParse(data).success).toBe(false);
  });
  it('withdraws provider/Nord login observations when their connected-account preparation is corrected', () => {
    vi.useFakeTimers(); const f = fixture(); let data = connected(f); data = complete(data); data = complete(data, 'sso-email'); data = finishPhase(data);
    const b = nordSsoBinding(data, f.rootId)!, route = data.securityModel.routes.find(r => r.targetRef === f.rootId)!;
    data = undoNordSsoEvidence(data, b.records.outside.key) as CurrentDataset; expect(nordSsoReady(data, f.rootId)).toBe(false); expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('unknown');
    expect(data.securityModel.entities.some(e => e.id === b.grantRef)).toBe(true);
  });
  it('requires an independent candidate and uses the provider screen if the connected provider password changes', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = connected(f); data = setCloudAnswer(data, f.providerId, `password:${f.appId}`, 'change') as CurrentDataset;
    const recipe = cloudPasswordRecipe(data, data.assets[1], f.appId)!; expect(recipe.steps.some(s => s.id === 'independent-candidate')).toBe(true); expect(recipe.steps.some(s => s.id === 'manager-sso-start')).toBe(true);
    data = beginRecipe(data, f.providerId, recipe.id) as CurrentDataset;
    while (currentTask(data)?.step.id !== 'manager-reopen-state') data = complete(data);
    data = complete(data, 'save-new'); expect(currentTask(data)?.step.id).toBe('save-new'); data = complete(data); expect(currentTask(data)?.step.id).toBe('test');
    expect(data.guide.steps[`do/${f.providerId}/${recipe.id}/manager-sso-start`]).toBeUndefined();
  });
  for (const provider of ['google', 'apple'] as const) it(`${provider}: a phone move uses provider and Nord authentication separately without changing main progress`, () => {
    vi.useFakeTimers(); const f = fixture(provider, true); let data = connected(f); data.guide.cursor = 'device-select';
    data.assets.push({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'New', importance: 'critical', operatingSystem: 'android' }), id: 'new' });
    data = startPhoneWorkflow(data, '/guide', 'device', 'phone-change'); Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'new', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'old-fate': 'spare' } });
    const original = structuredClone(data.guide); data = answerPhoneQuestion(jumpPhoneStep(data, 'phone-change', `cloud-use:${f.vaultId}`), 'phone-change', 'new') as CurrentDataset;
    for (const suffix of ['recovery', 'account-mfa', 'vault-secret', 'vault-recovery']) data = confirmPhoneStep(jumpPhoneStep(data, 'phone-change', `cloud:${f.vaultId}:${suffix}`), 'phone-change') as CurrentDataset;
    data = answerPhoneQuestion(jumpPhoneStep(data, 'phone-change', `cloud-destination:${f.vaultId}`), 'phone-change', 'add') as CurrentDataset;
    data = answerPhoneQuestion(jumpPhoneStep(data, 'phone-change', 'cloud-phone-version'), 'phone-change', 'android9plus') as CurrentDataset;
    data = confirmPhoneStep(jumpPhoneStep(data, 'phone-change', `cloud:${f.vaultId}:open`), 'phone-change') as CurrentDataset;
    data = answerPhoneQuestion(jumpPhoneStep(data, 'phone-change', `cloud:${f.vaultId}:state`), 'phone-change', 'signin') as CurrentDataset;
    for (let n = 0; n < 8; n++) { const w = data.deviceWorkflows[0], step = currentPhoneStep(data, w); expect(phoneStepBlockers(data, w, step)).toEqual([]); data = confirmPhoneStep(data, w.id) as CurrentDataset; }
    expect(data.guide).toEqual(original); expect(data.securityModel.routes.some(r => r.targetRef === f.providerId && r.contexts.includes('new-device'))).toBe(true); expect(data.securityModel.routes.some(r => r.targetRef === f.rootId && r.contexts.includes('new-device'))).toBe(true);
    const w = data.deviceWorkflows[0], signIn = phoneSteps(data, w).find(s => s.id === `cloud:${f.vaultId}:sign-in`)!; expect(phoneRecord(w, signIn)?.status).toBe('confirmed');
    const secret = phoneSteps(data, w).find(s => s.id === `cloud:${f.vaultId}:vault-secret`)!, savedSecret = phoneRecord(w, secret);
    expect(savedSecret?.status).toBe('confirmed');
    data = undoNordSsoEvidence(data, nordSsoBinding(data, f.rootId)!.records.connection.key) as CurrentDataset;
    data = confirmNordSsoConnection(data, f.rootId) as CurrentDataset;
    const updated = data.deviceWorkflows[0], newSignIn = phoneSteps(data, updated).find(s => s.id === signIn.id)!, sameSecret = phoneSteps(data, updated).find(s => s.id === secret.id)!;
    expect(phoneRecord(updated, newSignIn)).toBeUndefined(); expect(phoneRecord(updated, sameSecret)).toEqual(savedSecret);
    expect(data.guide).toEqual(original);

  });
  it('supports connected sign-in during forgotten-master recovery and preserves revision 5', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = connected(f); const original = structuredClone(data.guide); data = startNordRecovery(data, f.appId);
    for (let n = 0; n < 40; n++) { const task = nordRecoveryTasks(data).at(-1)!, step = currentNordStep(data, task)!; if (step.id === 'finished') break; tick(); if (step.kind === 'question') data = answerNordRecovery(data, task.id, ({ method: 'code', 'target-state': 'sign-in', 'backup-state': 'current' } as Record<string, string>)[step.id] ?? step.choicesNord![0].value) as CurrentDataset; else { expect(step.kind).toBeUndefined(); data = confirmNordRecovery(data, task.id) as CurrentDataset; } }
    expect(nordRecoveryTasks(data).at(-1)?.status).toBe('completed'); expect(data.guide).toEqual(original); expect(data.securityModel.revision).toBe(5); expect(data.securityModel.routes.some(r => r.targetRef === f.rootId && r.purpose === 'sign-in')).toBe(true);
  });
  it('records a reconnected permission separately and never revives a revoked registration', () => {
    vi.useFakeTimers(); const f = fixture(); let data = prepare(f), b = nordSsoBinding(data, f.rootId)!;
    data = finishPhase(beginRecipe(data, f.appId, `cloud-sso-add:${b.id}`) as CurrentDataset); b = nordSsoBinding(data, f.rootId)!;
    const oldGrant = b.grantRef!, firstCreated = b.connectionCreatedAt;
    data = reportNordSsoDisconnected(data, f.rootId) as CurrentDataset;
    expect(data.securityModel.lifecycle[oldGrant].state).toBe('revoked');
    expect(nordSsoRecipe(data, f.appId, `cloud-sso-add:${b.id}`)?.steps[0].title.en).toContain('Connect the intended');
    data = finishPhase(beginRecipe(data, f.appId, `cloud-sso-add:${b.id}`) as CurrentDataset);
    const current = nordSsoBinding(data, f.rootId)!; expect(current.grantRef).not.toBe(oldGrant); expect(current.connectionCreatedAt).toBe(firstCreated);
    data = complete(data); data = complete(data, 'sso-email'); data = finishPhase(data);
    const route = data.securityModel.routes.find(r => r.targetRef === f.rootId && r.purpose === 'sign-in')!;
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('available');
    expect(data.securityModel.lifecycle[oldGrant].state).toBe('revoked');
  });
  it('blocks new connection work when the actual provider or Nord identity is unavailable', () => {
    vi.useFakeTimers();
    for (const ref of ['nord', 'provider']) {
      const f = fixture(); let data = prepare(f); const b = nordSsoBinding(data, f.rootId)!;
      data.securityModel.lifecycle[ref] = { state: 'unavailable', evidence: 'user-confirmed', updatedAt: new Date().toISOString() };
      expect(confirmNordSsoConnection(data, f.rootId)).toEqual(data);
      data = move(data, `do/${f.appId}/cloud-sso-prepare:${b.id}/open`) as CurrentDataset;
      expect(currentTask(data)?.redirectTo).toBe(`cloud-sso-unavailable/${f.vaultId}`);
      expect(nordSsoReady(data, f.rootId)).toBe(false);
    }
  });
  it('can prepare the provider during a physically pending recovery without overwriting either guide', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = connected(f); data = startNordRecovery(data, f.appId);
    for (let n = 0; n < 24 && !nordRecoveryPending(data, f.vaultId); n++) {
      const task = nordRecoveryTasks(data).at(-1)!, step = currentNordStep(data, task)!; tick();
      if (step.kind === 'question') data = answerNordRecovery(data, task.id, step.id === 'method' ? 'biometric' : step.choicesNord![0].value) as CurrentDataset;
      else data = confirmNordRecovery(data, task.id) as CurrentDataset;
    }
    const pending = nordRecoveryPending(data, f.vaultId)!; expect(pending).toBeDefined();
    data = undoNordSsoEvidence(data, nordSsoBinding(data, f.rootId)!.records.outside.key) as CurrentDataset;
    const original = structuredClone(data.guide), recovery = structuredClone(nordRecoveryTasks(data));
    const session = startNordSsoSession(data, f.appId, `/recover/nord/${pending.id}`);
    let child = { ...session.data, guide: guideSchema.parse(nordSsoStore(session.data)!.sessions.at(-1)!.guide) };
    expect(cloudSetupRoute(child, f.vaultId)).not.toContain('recovery-pending');
    child = move(child, cloudSetupRoute(child, f.vaultId)) as CurrentDataset;
    for (let n = 0; n < 4; n++) child = complete(child);
    child = confirmNordSsoConnection(child, f.rootId) as CurrentDataset;
    const saved = saveNordSsoSession(session.data, child, session.id!) as CurrentDataset;
    expect(saved.guide).toEqual(original); expect(nordRecoveryTasks(saved)).toEqual(recovery); expect(saved.securityModel.revision).toBe(5);
    expect(nordSsoReady(saved, f.rootId)).toBe(true); expect(cloudSetupRoute(saved, f.vaultId)).toContain('recovery-pending');
  });
  it('honors an explicit SSO-only password answer and still allows an already accepted change to be saved', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = connected(f);
    data = recordControl(data, f.rootId, 'uniquePassword', { id: 'old-confirmation' }) as CurrentDataset;
    data = setCloudAnswer(data, f.rootId, `password:${f.appId}`, 'change') as CurrentDataset;
    data = setNordDirectPasswordUse(data, f.rootId, 'not-used') as CurrentDataset;
    expect(nordDirectPasswordAvailable(data, f.rootId)).toBe(false); expect(cloudPasswordRecipe(data, data.assets[0], f.appId)).toBeUndefined();
    data.guide.steps[`do/${f.rootId}/cloud-password:${f.appId}/apply`] = { status: 'done', updatedAt: new Date().toISOString() };
    expect(cloudPasswordRecipe(data, data.assets[0], f.appId)).toBeDefined();
  });
  it('revokes the actual legacy Nord vault recovery-key format while keeping unrelated recovery keys', () => {
    vi.useFakeTimers(); const f = fixture(undefined, true); let data = connected(f); const now = new Date().toISOString();
    data.securityModel.entities.push(securityEntitySchema.parse({ id: 'legacy', kind: 'credential', credentialType: 'recovery-key', subjectRef: f.vaultId, roles: ['restore'], label: 'legacy', createdAt: now, cloudRecoveryPhase: 'cloud-recovery' }));
    data.securityModel.relations.push({ id: 'legacy:cloud:recovery', fromRef: 'legacy', toRef: f.vaultId, kind: 'recovers', evidence: 'user-confirmed', checkedAt: now, sourceIds: ['nordRecovery'] });
    data = startNordRecovery(data, f.appId);
    for (let n = 0; n < 16; n++) { const task = nordRecoveryTasks(data).at(-1)!, step = currentNordStep(data, task)!; tick(); if (step.kind === 'question') data = answerNordRecovery(data, task.id, step.id === 'method' ? 'biometric' : step.choicesNord![0].value) as CurrentDataset; else data = confirmNordRecovery(data, task.id) as CurrentDataset; if (data.securityModel.lifecycle.legacy?.state === 'revoked') break; }
    expect(data.securityModel.lifecycle.legacy?.state).toBe('revoked'); expect(data.securityModel.revision).toBe(5);
  });
});
