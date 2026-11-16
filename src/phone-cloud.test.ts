import { describe, expect, it } from 'vitest';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from './models';
import { recordControl } from './controlRecords';
import { addCloudRoot, chooseCloudDevice, cloudInstallation, cloudVault, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer, type CloudProduct } from './cloudManagers';
import { answerPhoneQuestion, confirmPhoneStep, currentPhoneStep, jumpPhoneStep, phoneBlockingSteps, phoneHelpPrompt, phoneRecordKey, startPhoneWorkflow, undoPhoneRecord } from './phoneEngine';
import { cloudPhoneSteps } from './phoneCloudManagers';
import { evaluateAccess, securityModelIssues } from './securityModel';
import { mapItems, typedMapStatus } from './securityMapViews';
import { createEncryptedVault, decryptVault } from './crypto';

export function phoneCloudFixture(product: CloudProduct, from: 'ios' | 'android', to: 'ios' | 'android') {
  let data = newDataset('ja');
  const mail = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'PRIVATE MAIL', importance: 'critical' }), id: 'mail', provider: product === 'proton-pass' ? 'proton' as const : 'google' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const old = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'PRIVATE OLD PHONE', importance: 'critical', operatingSystem: from }), id: 'old' };
  const fresh = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'PRIVATE NEW PHONE', importance: 'critical', operatingSystem: to }), id: 'fresh' };
  data.assets = [mail, old, fresh]; data.guide = { ...data.guide, accountId: mail.id, cursor: 'device-select', history: ['start', 'manager-select'], answers: { 'keep-this-answer': 'PRIVATE ANSWER' }, privateLegacy: { keep: true } };
  data = makeCloudVault(data, product, 'ja'); const vaultId = data.guide.managerId!;
  data = (product === 'proton-pass' ? configureCloudRoot(data, vaultId, mail.id) : addCloudRoot(data, vaultId, 'personal', true)) as CurrentDataset;
  const rootId = cloudVault(data, vaultId)!.authenticationAccountRef!;
  if (product === 'nordpass') data = setCloudAnswer(data, rootId, 'method', 'direct') as CurrentDataset;
  data = setCloudAnswer(data, vaultId, 'usage', 'existing') as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, old.id) as CurrentDataset; const oldAppId = selectedCloudInstallation(data, vaultId)!.id;
  const marks: [string, string][] = [[mail.id, 'mfa'], [mail.id, 'recovery'], [rootId, 'mfa'], [rootId, 'recovery'], [oldAppId, 'opened'], [oldAppId, 'storageChecked']];
  if (product === 'nordpass') { data = setCloudAnswer(data, vaultId, 'master', 'keep') as CurrentDataset; marks.push([vaultId, 'recovery'], [vaultId, 'independentRoot']); }
  else marks.push([rootId, 'dataRecovery'], [rootId, 'passwordResetRecovery'], [rootId, 'recoveryFile']);
  for (const [id, control] of marks) data = recordControl(data, id, control, { id: `existing:${id}:${control}` }) as CurrentDataset;
  data = startPhoneWorkflow(data, '/guide', old.id, 'phone-cloud');
  Object.assign(data.deviceWorkflows[0], { newDeviceRef: fresh.id, cursor: `cloud-use:${vaultId}`, answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', [`use:${mail.id}`]: 'yes', [`use:${rootId}`]: 'yes', 'special-apps': 'none', 'phone-line': 'no-line', 'old-fate': 'sell', 'ios-generation': '18', 'android-maker': 'pixel' } });
  return { data, vaultId, rootId, oldAppId };
}
function answer(data: CurrentDataset, id: string, value: string) { return answerPhoneQuestion(jumpPhoneStep(data, 'phone-cloud', id), 'phone-cloud', value) as CurrentDataset; }
function confirm(data: CurrentDataset, id: string, now?: string) { return confirmPhoneStep(jumpPhoneStep(data, 'phone-cloud', id), 'phone-cloud', now) as CurrentDataset; }
function finishCloud(data: CurrentDataset, vaultId: string, state = 'signin') {
  let next = answer(data, `cloud-use:${vaultId}`, 'new'); next = answer(next, `cloud-destination:${vaultId}`, 'add');
  const appId = next.deviceWorkflows[0].answers[`cloud-destination:${vaultId}`];
  const version = next.assets.find(a => a.id === 'fresh')?.operatingSystem === 'ios' ? 'ios18plus' : 'android9plus';
  if (cloudPhoneSteps(next, next.deviceWorkflows[0]).steps.some(s => s.id === 'cloud-phone-version')) next = answer(next, 'cloud-phone-version', version);
  next = answer(next, `cloud:${vaultId}:state`, state);
  if (state === 'signin') next = answer(next, `cloud:${vaultId}:mfa-needed`, 'yes');
  next = answer(next, `cloud:${vaultId}:target`, 'mail');
  for (const step of cloudPhoneSteps(next, next.deviceWorkflows[0]).steps) if (step.kind === 'action') {
    next = confirm(next, step.id);
    expect(next.deviceWorkflows[0].records[phoneRecordKey(next.deviceWorkflows[0], step)]?.status, step.id).toBe('confirmed');
  }
  return { data: next, appId };
}

describe('cloud managers on a new phone', () => {
  for (const product of ['proton-pass', 'nordpass'] as const) for (const from of ['ios', 'android'] as const) for (const to of ['ios', 'android'] as const) {
    it(`${product} ${from} → ${to}: new app, separate sign-in/unlock/use, shared identity and unchanged main guide`, () => {
      const f = phoneCloudFixture(product, from, to), main = structuredClone(f.data.guide), oldApp = structuredClone(cloudInstallation(f.data, f.oldAppId));
      const { data, appId } = finishCloud(f.data, f.vaultId);
      const ids = cloudPhoneSteps(data, data.deviceWorkflows[0]).steps.map(s => s.id); expect(new Set(ids).size).toBe(ids.length);
      expect(data.guide).toEqual(main); expect(appId).not.toBe(f.oldAppId); expect(cloudInstallation(data, f.oldAppId)).toEqual(oldApp);
      expect(data.assets.filter(a => a.kind === 'account')).toHaveLength(product === 'proton-pass' ? 1 : 2);
      expect(cloudInstallation(data, appId)?.controls).toMatchObject({ opened: 'verified', storageChecked: 'verified', autofill: 'verified', loginUse: 'verified' });
      expect(data.assets.find(a => a.id === 'mail')?.controls.uniquePassword).toBe('verified');
      expect(cloudPhoneSteps(data, data.deviceWorkflows[0]).steps.every(s => s.kind !== 'action' || data.deviceWorkflows[0].records[phoneRecordKey(data.deviceWorkflows[0], s)]?.status === 'confirmed')).toBe(true);
      const use = data.securityModel.routes.find(r => r.targetRef === 'mail' && r.purpose === 'sign-in' && r.contexts.includes('new-device') && r.id.endsWith(':cloud:password-use:route'))!;
      expect(evaluateAccess(data.securityModel, use.id, { context: 'new-device', unavailableRefs: ['old'], now: new Date().toISOString() }).state).toBe('available');
      expect(evaluateAccess(data.securityModel, use.id, { context: 'new-device', unavailableRefs: ['fresh'], now: new Date().toISOString() }).state).toBe('unavailable');
      expect(evaluateAccess(data.securityModel, use.id, { context: 'all-devices-lost', now: new Date().toISOString() }).state).toBe('not-applicable');
      expect(securityModelIssues(data.securityModel, data.assets)).toEqual([]);
      expect(typedMapStatus(data, mapItems(data, 'ja').find(n => n.id === appId)!, 'ja').tone).toBe('recorded');
    });
  }
  it('a planned app and account sign-in cannot bypass vault reading, saved use or the erasure guard', () => {
    const f = phoneCloudFixture('nordpass', 'ios', 'ios'); let { data, appId } = finishCloud(f.data, f.vaultId);
    const key = Object.entries(data.deviceWorkflows[0].records).find(([, r]) => r.stepId === `cloud:${f.vaultId}:vault-open`)![0];
    data = undoPhoneRecord(data, 'phone-cloud', key) as CurrentDataset;
    expect(cloudInstallation(data, appId)?.controls?.loginUse).toBe('unknown');
    expect(phoneBlockingSteps(data, data.deviceWorkflows[0]).some(s => s.id === `cloud:${f.vaultId}:vault-open`)).toBe(true);
    const attempted = confirm(data, 'erase-old'); expect(attempted.securityModel.lifecycle.old?.state).not.toBe('retired');
    const use = data.securityModel.facts.filter(f => f.requiredRefs.includes(appId) && f.contexts.includes('new-device'));
    expect(use.filter(f => f.label.includes('Saved password')).every(f => f.state === 'unknown')).toBe(true);
  });
  it('reuses only the exact selected new app; another phone gets no confirmations and leaves the old receipts intact', () => {
    const f = phoneCloudFixture('proton-pass', 'ios', 'android'); const moved = finishCloud(f.data, f.vaultId);
    let data = answer(moved.data, `cloud-destination:${f.vaultId}`, `installation:${moved.appId}`);
    expect(data.deviceWorkflows[0].answers[`cloud-destination:${f.vaultId}`]).toBe(moved.appId);
    data.assets.push({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Another phone', importance: 'critical', operatingSystem: 'android' }), id: 'other-new' });
    data = answer(data, 'new-device', 'other-new'); data = answer(data, 'authenticator', 'none');
    data = answer(data, `cloud-use:${f.vaultId}`, 'new'); data = answer(data, `cloud-destination:${f.vaultId}`, 'add');
    const app = cloudInstallation(data, data.deviceWorkflows[0].answers[`cloud-destination:${f.vaultId}`])!;
    expect(app.id).not.toBe(moved.appId); expect(app.controls).toEqual({});
    expect(Object.values(data.deviceWorkflows[0].records).some(r => r.status === 'confirmed')).toBe(true);
  });
  it('keeps an already-open new app and never asks it to sign in or re-create a master again', () => {
    const f = phoneCloudFixture('nordpass', 'android', 'android'), moved = finishCloud(f.data, f.vaultId, 'open');
    const steps = cloudPhoneSteps(moved.data, moved.data.deviceWorkflows[0]).steps;
    expect(steps.some(s => s.id.endsWith(':credentials') || s.id.includes('master-set'))).toBe(false);
    expect(steps.some(s => s.id.endsWith(':vault-open'))).toBe(true);
  });
  it('keeps old-only use optional for retention but blocks selling that phone; unsupported OS/SSO remain unfinished', () => {
    const f = phoneCloudFixture('nordpass', 'ios', 'ios'); let data = answer(f.data, `cloud-use:${f.vaultId}`, 'old');
    expect(cloudPhoneSteps(data, data.deviceWorkflows[0]).steps.some(s => s.kind === 'blocked')).toBe(true);
    data.deviceWorkflows[0].answers['old-fate'] = 'spare';
    expect(cloudPhoneSteps(data, data.deviceWorkflows[0]).steps.some(s => s.kind === 'blocked')).toBe(false);
    data = answer(data, `cloud-use:${f.vaultId}`, 'new'); data = answer(data, `cloud-destination:${f.vaultId}`, 'add'); data = answer(data, 'cloud-phone-version', 'ios17');
    expect(cloudPhoneSteps(data, data.deviceWorkflows[0]).steps.some(s => s.id.endsWith(':version') && s.kind === 'blocked')).toBe(true);
    const main = data.guide; data = setCloudAnswer(data, f.rootId, 'method', 'sso') as CurrentDataset;
    expect(cloudPhoneSteps(data, data.deviceWorkflows[0]).steps.some(s => s.id.endsWith(':sso'))).toBe(true);
    expect(data.guide.accountId).toBe(main.accountId);
  });
  it('resumes encrypted records and keeps private aliases/raw answers out of manual help', async () => {
    const f = phoneCloudFixture('proton-pass', 'android', 'ios'), moved = finishCloud(f.data, f.vaultId);
    const data = jumpPhoneStep(moved.data, 'phone-cloud', `cloud:${f.vaultId}:test`) as CurrentDataset;
    const envelope = await createEncryptedVault('test-only storage phrase', data);
    expect(currentDatasetSchema.parse((await decryptVault(envelope.envelope, 'test-only storage phrase')).data)).toEqual(data);
    for (const language of ['ja', 'en'] as const) expect(phoneHelpPrompt(data, data.deviceWorkflows[0], 0, language)).not.toContain('PRIVATE');
    expect(currentPhoneStep(data, data.deviceWorkflows[0]).id).toBe(`cloud:${f.vaultId}:test`);
  });
  it('checks a named existing PC app without new-phone OS questions and preserves the main guide', () => {
    const f = phoneCloudFixture('proton-pass', 'ios', 'android'); let data = f.data;
    data.assets.push({ ...makeAsset({ kind: 'device', type: 'Computer', name: 'PRIVATE PC', importance: 'critical', operatingSystem: 'windows' }), id: 'pc' });
    data = chooseCloudDevice(data, f.vaultId, 'pc') as CurrentDataset; const appId = selectedCloudInstallation(data, f.vaultId)!.id;
    data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset;
    data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: 'PRIVATE PROFILE' } : e);
    const main = structuredClone(data.guide);
    data = answer(data, `cloud-use:${f.vaultId}`, 'elsewhere'); data = answer(data, `cloud-destination:${f.vaultId}`, `installation:${appId}`);
    data = answer(data, `cloud:${f.vaultId}:state`, 'open'); data = answer(data, `cloud:${f.vaultId}:target`, 'mail');
    const steps = cloudPhoneSteps(data, data.deviceWorkflows[0]).steps;
    expect(steps.some(s => s.id === 'cloud-phone-version')).toBe(false);
    for (const s of steps) if (s.kind === 'action') data = confirm(data, s.id);
    expect(data.guide).toEqual(main); expect(cloudInstallation(data, appId)?.controls?.loginUse).toBe('verified');
    const route = data.securityModel.routes.find(r => r.id.endsWith(':cloud:password-use:route'))!;
    expect(route.contexts).toEqual(['normal']); expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', unavailableRefs: ['old'], now: new Date().toISOString() }).state).toBe('available');
  });
  it('shares one new-phone screen-lock check across stores and withdraws both dependent uses when it is undone', () => {
    const f = phoneCloudFixture('proton-pass', 'ios', 'ios'); let data = makeCloudVault(f.data, 'nordpass', 'ja'); const nordVault = data.guide.managerId!;
    data = addCloudRoot(data, nordVault, 'personal', true) as CurrentDataset; const root = cloudVault(data, nordVault)!.authenticationAccountRef!;
    data = setCloudAnswer(data, root, 'method', 'direct') as CurrentDataset;
    data = setCloudAnswer(data, nordVault, 'usage', 'existing') as CurrentDataset;
    data = setCloudAnswer(data, nordVault, 'master', 'keep') as CurrentDataset;
    data = chooseCloudDevice(data, nordVault, 'old') as CurrentDataset; const oldApp = selectedCloudInstallation(data, nordVault)!.id;
    for (const [ref, control] of [[root, 'mfa'], [root, 'recovery'], [nordVault, 'recovery'], [nordVault, 'independentRoot'], [oldApp, 'opened']]) data = recordControl(data, ref, control, { id: `more:${ref}:${control}` }) as CurrentDataset;
    data = finishCloud(data, f.vaultId).data; const second = finishCloud(data, nordVault); data = second.data;
    const locks = Object.entries(data.deviceWorkflows[0].records).filter(([, r]) => r.extraControls?.some(c => c.targetRef === 'fresh' && c.controlId === 'screenLock'));
    expect(locks).toHaveLength(1);
    data = undoPhoneRecord(data, 'phone-cloud', locks[0][0]) as CurrentDataset;
    expect(cloudInstallation(data, second.appId)?.controls?.loginUse).toBe('unknown');
    expect(phoneBlockingSteps(data, data.deviceWorkflows[0]).some(s => s.id.startsWith(`cloud:${nordVault}:`))).toBe(true);
  });
  it('gates cloud-phone semantics from revision-1 readers even for an imported store kept only on the old phone', () => {
    const f = phoneCloudFixture('proton-pass', 'ios', 'android'); f.data.securityModel.revision = 1;
    const main = structuredClone(f.data.guide), next = answer(f.data, `cloud-use:${f.vaultId}`, 'old');
    expect(next.securityModel.revision).toBe(2); expect(next.guide).toEqual(main);
  });
  it('keeps an imported app ID beginning with installation: instead of interpreting that ID as a choice prefix', () => {
    const f = phoneCloudFixture('nordpass', 'ios', 'ios'); let data = answer(f.data, `cloud-use:${f.vaultId}`, 'new');
    data = answer(data, `cloud-destination:${f.vaultId}`, 'add'); const ref = data.deviceWorkflows[0].answers[`cloud-destination:${f.vaultId}`];
    data.securityModel.entities = data.securityModel.entities.map(e => e.id === ref ? { ...e, id: 'installation:imported-id' } : e);
    data.deviceWorkflows[0].answers[`cloud-destination:${f.vaultId}`] = 'installation:imported-id';
    data = answer(data, `cloud-destination:${f.vaultId}`, 'installation:installation:imported-id');
    data = answer(data, 'cloud-phone-version', 'ios18plus'); data = answer(data, `cloud:${f.vaultId}:state`, 'open'); data = answer(data, `cloud:${f.vaultId}:target`, 'mail');
    for (const step of cloudPhoneSteps(data, data.deviceWorkflows[0]).steps) if (step.kind === 'action') data = confirm(data, step.id);
    expect(data.deviceWorkflows[0].answers[`cloud-destination:${f.vaultId}`]).toBe('installation:imported-id');
    expect(cloudInstallation(data, 'installation:imported-id')?.controls?.loginUse).toBe('verified');
  });
});
