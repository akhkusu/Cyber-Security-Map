import { describe, expect, it } from 'vitest';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from './models';
import { recordControl } from './controlRecords';
import { chooseNativeDevice, configureNativeStorage, makeNativeVault, nativeInstallation, nativeVault, selectedNativeInstallation, type NativeProduct } from './nativeManagers';
import { answerPhoneQuestion, confirmPhoneStep, currentPhoneStep, phoneBlockingSteps, phoneHelpPrompt, startPhoneWorkflow, undoPhoneRecord } from './phoneEngine';
import { phoneSteps } from './phoneCatalog';
import { evaluateAccess } from './securityModel';

const now = '2026-11-13T20:40:00Z';
function fixture(product: NativeProduct = 'apple-passwords', newOs: 'ios' | 'android' = 'ios', local = false) {
  let data = newDataset('ja');
  data.assets = [
    { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'private@example.com', importance: 'critical' }), id: 'root', provider: product === 'apple-passwords' ? 'apple' : 'google', purpose: 'personal', services: ['mail'] },
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Private old phone', importance: 'critical', operatingSystem: product === 'apple-passwords' ? 'ios' : 'android' }), id: 'old' },
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Private new phone', importance: 'critical', operatingSystem: newOs }), id: 'fresh' },
  ];
  data.guide.accountId = 'root';
  data = recordControl(data, 'root', 'mfa', { id: 'existing-mfa' }) as CurrentDataset;
  data = recordControl(data, 'root', 'recovery', { id: 'existing-recovery' }) as CurrentDataset;
  data = makeNativeVault(data, product, 'ja'); const vaultId = data.guide.managerId!;
  data = chooseNativeDevice(data, vaultId, 'old') as CurrentDataset;
  data = configureNativeStorage(data, vaultId, local ? 'local' : 'account', local ? undefined : 'root') as CurrentDataset;
  const chosenVault = data.guide.managerId!, oldInstallId = selectedNativeInstallation(data, chosenVault)!.id;
  data = recordControl(data, oldInstallId, 'opened', { id: 'old-opened' }) as CurrentDataset;
  data.guide.cursor = 'device-select'; data.guide.history = ['start', 'manager-select']; data.guide.answers.keep = 'a saved main answer';
  data = startPhoneWorkflow(data, '/guide', 'old', 'workflow', now);
  Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'fresh', cursor: `native-use:${chosenVault}`, answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'use:root': 'yes', 'special-apps': 'none', 'phone-line': 'no-line', 'old-fate': 'sell', 'ios-generation': '18', 'android-maker': 'pixel' } });
  return { data, vaultId: chosenVault, oldInstallId };
}
const workflow = (data: CurrentDataset) => data.deviceWorkflows[0];
function answer(data: CurrentDataset, cursor: string, value: string) {
  return answerPhoneQuestion({ ...data, deviceWorkflows: data.deviceWorkflows.map(w => ({ ...w, cursor })) }, 'workflow', value) as CurrentDataset;
}
function confirm(data: CurrentDataset, cursor: string) {
  return confirmPhoneStep({ ...data, deviceWorkflows: data.deviceWorkflows.map(w => ({ ...w, cursor })) }, 'workflow', now) as CurrentDataset;
}
function prepare(product: NativeProduct = 'apple-passwords', newOs: 'ios' | 'android' = 'ios') {
  const f = fixture(product, newOs); let data = answer(f.data, `native-use:${f.vaultId}`, 'yes');
  if (product === 'apple-passwords') data = answer(data, `native-version:${f.vaultId}`, 'ios18plus');
  workflow(data).answers[`native-test-account:${f.vaultId}`] = 'root';
  return { ...f, data, installId: workflow(data).answers[`native-install:${f.vaultId}`] };
}

describe('built-in password stores during a personal phone change', () => {
  it('creates a separate new-phone instance without changing any main-guide answer or confirming installation', () => {
    const f = fixture(), original = structuredClone(f.data.guide);
    const data = answer(f.data, `native-use:${f.vaultId}`, 'yes');
    const installId = workflow(data).answers[`native-install:${f.vaultId}`];
    expect(data.guide).toEqual(original); expect(installId).not.toBe(f.oldInstallId);
    expect(nativeInstallation(data, installId)).toMatchObject({ deviceRef: 'fresh', vaultRef: f.vaultId, controls: {} });
    expect(data.securityModel.relations).toEqual([]); expect(data.securityModel.facts).toEqual([]);
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });

  it.each([['apple-passwords', 'ios'], ['google-password-manager', 'android'], ['google-password-manager', 'ios']] as const)('keeps the cursor stable for %s on %s and does not repeat the same screen-lock action', (product, os) => {
    const f = prepare(product, os); let data = f.data;
    const before = structuredClone(data.guide);
    data = confirm(data, `native:${f.vaultId}:open`);
    expect(currentPhoneStep(data, workflow(data)).id).toBe(`native:${f.vaultId}:device-lock`);
    data = confirmPhoneStep(data, 'workflow', now) as CurrentDataset;
    expect(currentPhoneStep(data, workflow(data)).id).toBe(`native:${f.vaultId}:${product === 'apple-passwords' ? 'storage-open' : 'storage-check'}`);
    const steps = phoneSteps(data, workflow(data));
    expect(steps.some(s => s.id === `native:${f.vaultId}:device-lock`)).toBe(true);
    expect(steps.some(s => s.id === 'new-lock')).toBe(false);
    expect(data.assets.find(a => a.id === 'fresh')?.controls.screenLock).toBe('verified');
    expect(nativeInstallation(data, f.oldInstallId)?.controls?.opened).toBe('verified');
    expect(nativeInstallation(data, f.installId)?.controls?.loginUse).toBeUndefined();
    expect(data.guide).toEqual(before);
    const key = Object.keys(workflow(data).records).find(k => workflow(data).records[k].stepId.endsWith(':device-lock'))!;
    data = undoPhoneRecord(data, 'workflow', key) as CurrentDataset;
    expect(data.assets.find(a => a.id === 'fresh')?.controls.screenLock).toBe('unknown');
    expect(phoneSteps(data, workflow(data)).some(s => s.id === 'new-lock')).toBe(true);
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });

  it('records actual saved-password use separately from login selection and withdraws only that proof on undo', () => {
    const f = prepare(); let data = f.data;
    data = answer(data, `native-test-account:${f.vaultId}`, 'root');
    expect(data.securityModel.facts).toHaveLength(0);
    data = confirm(data, `native-test:${f.vaultId}:root`);
    expect(nativeInstallation(data, f.installId)?.controls?.loginUse).toBe('verified');
    const route = data.securityModel.routes.find(r => r.purpose === 'decrypt')!;
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now }).state).toBe('available');
    expect(evaluateAccess(data.securityModel, route.id, { context: 'new-device', now }).state).toBe('not-applicable');
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now, unavailableRefs: ['fresh'] }).state).toBe('unavailable');
    data.securityModel.routes.push({ ...route, id: 'dependent-route', requirements: { kind: 'route', routeId: route.id } });
    const key = Object.keys(workflow(data).records).find(k => workflow(data).records[k].stepId.startsWith('native-test:'))!;
    const undone = undoPhoneRecord(data, 'workflow', key) as CurrentDataset;
    expect(evaluateAccess(undone.securityModel, 'dependent-route', { context: 'normal', now }).state).toBe('unknown');
    expect(undone.securityModel.relations.some(r => r.kind === 'stored-in')).toBe(false);
    expect(currentDatasetSchema.safeParse(undone).success).toBe(true);
  });

  it.each(['cross-product', 'local-store'] as const)('blocks erasure for an unresolved %s transfer', variant => {
    const f = variant === 'cross-product' ? fixture('apple-passwords', 'android') : fixture('google-password-manager', 'android', true);
    let data = answer(f.data, `native-use:${f.vaultId}`, 'yes');
    const blockedId = `native-${variant === 'cross-product' ? 'cross' : 'local'}:${f.vaultId}`;
    expect(phoneBlockingSteps(data, workflow(data)).map(s => s.id)).toContain(blockedId);
    data = confirm(data, 'erase-old');
    expect(data.securityModel.lifecycle.old).toBeUndefined();
    expect(Object.values(workflow(data).records).some(r => r.physicalEffect)).toBe(false);
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });

  it('does not inherit completion after selecting a different new phone and retains old records', () => {
    const f = prepare(); let data = confirm(f.data, `native:${f.vaultId}:open`);
    const before = structuredClone(data.guide);
    data = answer(data, 'new-device', 'add:ios');
    Object.assign(workflow(data).answers, { stage: 'using', authenticator: 'none', 'use:root': 'yes' });
    data = answer(data, `native-use:${f.vaultId}`, 'yes');
    const newId = workflow(data).answers[`native-install:${f.vaultId}`];
    expect(newId).not.toBe(f.installId); expect(nativeInstallation(data, newId)?.controls).toEqual({});
    expect(nativeInstallation(data, f.installId)?.controls?.opened).toBe('verified');
    expect(data.guide).toEqual(before); expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });

  it('sanitizes typed vault and app labels in exception prompts', () => {
    const f = prepare(); const data = f.data;
    data.securityModel.entities = data.securityModel.entities.map(e => e.id === f.vaultId || e.id === f.installId ? { ...e, label: 'secret contact address' } : e);
    workflow(data).cursor = `native:${f.vaultId}:open`;
    const prompt = phoneHelpPrompt(data, workflow(data), 0, 'ja');
    for (const secret of ['secret contact address', 'private@example.com', 'Private old phone', 'Private new phone', 'a saved main answer', f.vaultId, f.installId]) expect(prompt).not.toContain(secret);
    expect(prompt).toContain('https://support.apple.com/');
    expect(nativeVault(data, f.vaultId)?.authenticationAccountRef).toBe('root');
  });
});
