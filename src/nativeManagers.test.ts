import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault } from './crypto';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from './models';
import { addNativeRoot, chooseNativeDevice, configureNativeStorage, makeNativeVault, managerReady, nativeInstallation, nativeSetupRoute, nativeVault, selectedNativeInstallation, type NativeProduct } from './nativeManagers';
import { beginRecipe, completeStep, currentTask, helpPrompt, move, undoStep } from './guideEngine';
import { controlSubject } from './subjects';
import { evaluateAccess } from './securityModel';
import { mapConnections, mapItems, typedMapStatus } from './securityMapViews';
import { builtinManagerRecipe } from './nativeManagerCatalog';
import { recordControl } from './controlRecords';
import { nativeExceptionPrompt } from './NativeManagerHelp';

function fixture(product: NativeProduct = 'apple-passwords', os: 'ios' | 'macos' | 'android' | 'windows' = 'ios') {
  let data = newDataset('ja');
  const root = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Private nickname', importance: 'critical' }), provider: product === 'apple-passwords' ? 'apple' as const : 'google' as const, purpose: 'personal' as const, services: ['mail' as const] };

  const device = makeAsset({ kind: 'device', type: 'Smartphone', name: 'My device', importance: 'critical', operatingSystem: os });
  data.assets = [root, device]; data.guide.accountId = root.id;
  data = recordControl(data, root.id, 'mfa', { id: 'root-mfa' }) as CurrentDataset;
  data = recordControl(data, root.id, 'recovery', { id: 'root-recovery' }) as CurrentDataset;
  data = makeNativeVault(data, product, 'ja'); const vaultId = data.guide.managerId!;
  data = chooseNativeDevice(data, vaultId, device.id) as CurrentDataset;
  data = configureNativeStorage(data, vaultId, 'account', root.id) as CurrentDataset;
  const install = selectedNativeInstallation(data, vaultId)!;
  data.guide.answers[`${install.id}:version`] = os === 'ios' ? 'ios18plus' : 'mac15plus';
  return { data, vaultId, installId: install.id, rootId: root.id, deviceId: device.id };
}
function finishSetup(data: CurrentDataset, installId: string): CurrentDataset {
  let next = beginRecipe(data, installId, 'builtin-manager') as CurrentDataset;
  for (let i = 0; i < 20 && currentTask(next)?.recipe.id === 'builtin-manager'; i++) next = completeStep(next) as CurrentDataset;
  return next;
}
function confirmAt(data: CurrentDataset, id: string, recipe: string, step: string): CurrentDataset { return completeStep(move(data, `do/${id}/${recipe}/${step}`)) as CurrentDataset; }

describe('built-in password stores', () => {
  it('keeps one canonical account and device, with separate vault and installation records', async () => {
    const { data, rootId, deviceId, vaultId, installId } = fixture();
    expect(data.assets).toHaveLength(2); expect(nativeVault(data, vaultId)?.authenticationAccountRef).toBe(rootId);
    expect(nativeInstallation(data, installId)).toMatchObject({ deviceRef: deviceId, vaultRef: vaultId });
    expect(managerReady(data)).toBe(false); expect(mapConnections(data)).toEqual([]);
    expect(data.assets[0].services).toEqual(['mail']);
    expect(controlSubject(data, installId)?.controls).toEqual({});
    const encrypted = await createEncryptedVault('test storage phrase not manager', data);
    expect((await decryptVault(encrypted.envelope, 'test storage phrase not manager')).data).toEqual(data);
  });

  it.each([['apple-passwords', 'ios'], ['apple-passwords', 'macos'], ['google-password-manager', 'android'], ['google-password-manager', 'ios'], ['google-password-manager', 'windows']] as const)('can finish %s on %s without a new master password or duplicate MFA', (product, os) => {
    const f = fixture(product, os), rootBefore = structuredClone(f.data.assets[0]);
    const recipe = builtinManagerRecipe(f.data, f.installId)!;
    expect(recipe.steps.some(s => s.id.includes('master'))).toBe(false);
    const next = finishSetup(f.data, f.installId);
    expect(managerReady(next)).toBe(true); expect(next.assets.find(a => a.id === f.rootId)).toEqual(rootBefore);
    expect(next.guide.cursor).toBe(`do/${f.rootId}/native-password:${f.installId}/save-current`);
    expect(next.assets.find(a => a.id === f.deviceId)?.controls.screenLock).toBe('verified');
    expect(mapConnections(next).some(r => r.relation === 'synced-via')).toBe(true);
    expect(currentDatasetSchema.safeParse(next).success).toBe(true);
  });

  it('changing cloud account creates another vault and never inherits app confirmations', () => {
    const f = fixture(), next = finishSetup(f.data, f.installId);
    const changed = addNativeRoot(next, f.vaultId, 'personal') as CurrentDataset;
    expect(changed.guide.managerId).not.toBe(f.vaultId); expect(nativeVault(changed, f.vaultId)?.authenticationAccountRef).toBe(f.rootId);
    expect(changed.assets.filter(a => a.kind === 'device')).toHaveLength(1);
    expect(controlSubject(changed, f.installId)?.controls.opened).toBe('verified');
    expect(selectedNativeInstallation(changed, changed.guide.managerId!)?.controls).toEqual({});
    expect(managerReady(changed)).toBe(false); expect(currentDatasetSchema.safeParse(changed).success).toBe(true);
  });

  it('checks the next device separately and uses a separate password-use context', () => {
    const f = fixture(); let data = finishSetup(f.data, f.installId);
    data = confirmAt(data, f.rootId, `native-password:${f.installId}`, 'test');
    expect(controlSubject(data, f.installId)?.controls.loginUse).toBe('verified');
    const second = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Second', importance: 'critical', operatingSystem: 'ios' });
    data = chooseNativeDevice({ ...data, assets: [...data.assets, second] }, f.vaultId, second.id) as CurrentDataset;
    const secondInstall = selectedNativeInstallation(data, f.vaultId)!;
    data.guide.answers[`${secondInstall.id}:version`] = 'ios18plus';
    data = finishSetup(data, secondInstall.id);
    expect(data.guide.cursor).toBe(`do/${f.rootId}/native-password:${secondInstall.id}/save-current`);
    expect(controlSubject(data, secondInstall.id)?.controls.loginUse).toBeUndefined();
    expect(data.assets).toHaveLength(3);
  });

  it('shares a device control with another workflow and only restores it after the final undo', () => {
    const f = fixture();
    let data = confirmAt(f.data, f.installId, 'builtin-manager', 'device-lock');
    const key = `do/${f.installId}/builtin-manager/device-lock`;
    data = recordControl(data, f.deviceId, 'screenLock', { id: 'another-proof', origin: 'phone' }) as CurrentDataset;
    const undone = undoStep(data, key);
    expect(undone.assets.find(a => a.id === f.deviceId)?.controls.screenLock).toBe('verified');
    expect(undone.actions.some(a => a.parentId === key)).toBe(false);
    expect(currentDatasetSchema.safeParse(undone).success).toBe(true);
  });

  it('redirects to prerequisite work if account recovery is undone before a password change', () => {
    const f = fixture(); const data = finishSetup(f.data, f.installId);
    data.assets[0].controls.recovery = 'unknown';
    const atApply = move(data, `do/${f.rootId}/native-password:${f.installId}/apply`);
    expect(currentTask(atApply)?.needsPrerequisites).toBe(true);
    const blocked = completeStep(atApply);
    expect(blocked.guide.cursor).toBe('password-prerequisite');
    expect(blocked.guide.steps[atApply.guide.cursor]).toBeUndefined();
  });

  it('keeps login and store decryption as distinct observations after account password changes', () => {
    const f = fixture(); let data = finishSetup(f.data, f.installId);
    data = confirmAt(data, f.rootId, `native-password:${f.installId}`, 'test');
    const signIn = data.securityModel.routes.find(r => r.purpose === 'sign-in')!;
    const decrypt = data.securityModel.routes.find(r => r.purpose === 'decrypt')!;
    const future = new Date(Date.now() + 10000).toISOString();
    data.securityModel.lifecycle[f.rootId] = { state: 'in-use', evidence: 'user-confirmed', updatedAt: future, accessResetAt: future };
    expect(evaluateAccess(data.securityModel, signIn.id, { context: 'normal', now: future }).state).toBe('unknown');
    expect(evaluateAccess(data.securityModel, decrypt.id, { context: 'normal', now: future }).state).toBe('available');
    expect(evaluateAccess(data.securityModel, decrypt.id, { context: 'normal', now: future, unavailableRefs: [f.deviceId] }).state).toBe('unavailable');
  });

  it('withdraws a use confirmation without stranding a route that refers to its observation', () => {
    const f = fixture(); let data = finishSetup(f.data, f.installId);
    data = confirmAt(data, f.rootId, `native-password:${f.installId}`, 'test');
    const route = data.securityModel.routes[0];
    data.securityModel.routes.push({ ...route, id: 'another-route', requirements: { kind: 'route', routeId: route.id } });
    const key = `do/${f.rootId}/native-password:${f.installId}/test`;
    const undone = currentDatasetSchema.parse(undoStep(data, key));
    expect(controlSubject(undone, f.installId)?.controls.loginUse).toBe('unknown');
    expect(evaluateAccess(undone.securityModel, 'another-route', { context: 'normal', now: new Date().toISOString() }).state).toBe('unknown');
    expect(mapConnections(undone).some(r => r.relation === 'authenticates-to')).toBe(false);
  });

  it('does not infer all-device access by combining partial checks from different app instances', () => {
    const f = fixture(), data = f.data;
    const e = data.securityModel.entities.find(e => e.id === f.installId)!;
    if (e.kind !== 'installation') throw new Error('fixture');
    e.controls = { opened: 'verified', storageChecked: 'verified' };
    data.securityModel.entities.push({ ...e, id: 'other-app', controls: { autofill: 'verified', loginUse: 'verified' } });
    const node = mapItems(data, 'ja').find(n => n.id === f.vaultId)!;
    expect(typedMapStatus(data, node, 'ja').tone).toBe('unknown');
  });

  it('copies only product and step context, not account or device nicknames', () => {
    const f = fixture(); f.data.assets[0].name = 'personal@example.com';
    const data = beginRecipe(f.data, f.installId, 'builtin-manager');
    const prompt = helpPrompt(data, '画面が違う', 'ja');
    expect(prompt).toContain('Apple「パスワード」'); expect(prompt).not.toContain('Private nickname'); expect(prompt).not.toContain('personal@example.com'); expect(prompt).not.toContain('My device');
  });

  it('keeps local-profile backup and account recovery distinct', () => {
    const f = fixture('google-password-manager', 'windows');
    const local = configureNativeStorage(f.data, f.vaultId, 'local') as CurrentDataset;
    const id = local.guide.managerId!, install = selectedNativeInstallation(local, id)!;
    const recipe = builtinManagerRecipe(local, install.id)!;
    expect(recipe.steps.some(s => s.id === 'independent-root')).toBe(false);
    expect(recipe.steps.find(s => s.id === 'local-backup')?.control).toBe('localBackup');
    expect(nativeVault(local, id)?.authenticationAccountRef).toBeUndefined();
    expect(nativeSetupRoute(local, id)).toBe(`do/${install.id}/builtin-manager/open`);
  });
});

 it('copies only allowlisted native exception context, never saved labels, names or answers', () => {
  const f = fixture(); const data = f.data;
  data.securityModel.entities = data.securityModel.entities.map(e => ({ ...e, label: 'private-vault@example.com' }));
  data.guide.answers.secret = 'private recovery data';
  const prompt = nativeExceptionPrompt(data, f.vaultId, 'native-unsupported', 3, 'ja');
  for (const secret of ['private-vault@example.com', 'Private nickname', 'My device', 'private recovery data', f.vaultId, f.installId]) expect(prompt).not.toContain(secret);
  expect(prompt).toContain('最新の公式情報'); expect(prompt).toContain('https://support.apple.com/');
 });

it('retains backing identity when reselecting account storage, so a later account change cannot inherit records', () => {
  const f = fixture('google-password-manager', 'android');
  const data = finishSetup(f.data, f.installId);
  const selectedAgain = configureNativeStorage(data, f.vaultId, 'account') as CurrentDataset;
  expect(nativeVault(selectedAgain, f.vaultId)?.authenticationAccountRef).toBe(f.rootId);
  const changed = addNativeRoot(selectedAgain, f.vaultId, 'personal') as CurrentDataset;
  expect(changed.guide.managerId).not.toBe(f.vaultId);
  expect(selectedNativeInstallation(changed, changed.guide.managerId!)?.controls).toEqual({});
});
it('checks the actual app instance and its OS version even when another instance is selected', () => {
  const f = fixture();
  const mac = makeAsset({ kind: 'device', type: 'Computer', name: 'Another Mac', importance: 'critical', operatingSystem: 'macos' });
  const data = chooseNativeDevice({ ...f.data, assets: [...f.data.assets, mac] }, f.vaultId, mac.id) as CurrentDataset;
  const installation = selectedNativeInstallation(data, f.vaultId)!;
  data.guide.answers[`${installation.id}:version`] = 'ios18plus';
  expect(nativeSetupRoute(data, f.vaultId, installation.id)).toBe(`native-version/${f.vaultId}`);
  expect(nativeSetupRoute(data, f.vaultId, f.installId)).toBe(`do/${f.installId}/builtin-manager/open`);
  expect(beginRecipe(data, installation.id, 'builtin-manager').guide.cursor).toBe(`native-version/${f.vaultId}`);
});
it('does not fall back to another provider’s password-change menu for unsupported saved logins', () => {
  const f = fixture(); const data = finishSetup(f.data, f.installId);
  for (const provider of ['mailcom', 'gmx', 'other'] as const) {
    const changed = { ...data, assets: data.assets.map(a => a.id === f.rootId ? { ...a, provider } : a) };
    const next = beginRecipe(changed, f.rootId, 'password');
    expect(next.guide.cursor).toBe(`unsupported/${f.rootId}/native-password:${f.installId}`);
    expect(currentTask(next)).toBeUndefined();
  }
});

it.each(['apple-passwords', 'google-password-manager'] as const)('reuses the actual %s cloud store after selecting its same backing account', product => {
  const f = fixture(product, product === 'apple-passwords' ? 'ios' : 'android');
  let data = finishSetup(f.data, f.installId);
  data = makeNativeVault(data, product, 'ja'); const pending = data.guide.managerId!;
  data = chooseNativeDevice(data, pending, f.deviceId) as CurrentDataset;
  const pendingInstall = selectedNativeInstallation(data, pending)!;
  data = configureNativeStorage(data, pending, 'account', f.rootId) as CurrentDataset;
  expect(data.guide.managerId).toBe(f.vaultId);
  expect(selectedNativeInstallation(data, f.vaultId)?.id).toBe(f.installId);
  expect(nativeVault(data, pending)?.id).toBe(f.vaultId);
  expect(nativeInstallation(data, pendingInstall.id)?.id).toBe(f.installId);
  expect(mapItems(data, 'ja').filter(n => n.entityKind === 'vault')).toHaveLength(1);
  expect(managerReady(data)).toBe(true);
  expect(currentDatasetSchema.safeParse(data).success).toBe(true);
});
it('keeps the actual main-guide device when choosing a different account after a phone move', () => {
  const f = fixture(); let data = finishSetup(f.data, f.installId);
  const fresh = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Replacement', importance: 'critical', operatingSystem: 'ios' });
  const originalGuide = data.guide;
  data = chooseNativeDevice({ ...data, assets: [...data.assets, fresh] }, f.vaultId, fresh.id) as CurrentDataset;
  data.guide = originalGuide;
  const changed = addNativeRoot(data, f.vaultId, 'personal') as CurrentDataset;
  expect(selectedNativeInstallation(changed, changed.guide.managerId!)?.deviceRef).toBe(f.deviceId);
  expect(nativeInstallation(changed, f.installId)?.controls?.opened).toBe('verified');
});
it('does not combine local profiles or hide an unbound store that has observations', () => {
  const f = fixture('google-password-manager', 'android');
  let data = makeNativeVault(f.data, 'google-password-manager', 'ja'); const localId = data.guide.managerId!;
  data = chooseNativeDevice(data, localId, f.deviceId) as CurrentDataset;
  data = configureNativeStorage(data, localId, 'local') as CurrentDataset;
  expect(data.guide.managerId).toBe(localId);
  data = makeNativeVault(data, 'google-password-manager', 'ja'); const pending = data.guide.managerId!;
  data = chooseNativeDevice(data, pending, f.deviceId) as CurrentDataset;
  data = recordControl(data, selectedNativeInstallation(data, pending)!.id, 'opened', { id: 'pending-opened' }) as CurrentDataset;
  data = configureNativeStorage(data, pending, 'account', f.rootId) as CurrentDataset;
  expect(data.guide.managerId).toBe(f.vaultId);
  expect(data.securityModel.entities.find(e => e.id === pending)?.mergedIntoRef).toBeUndefined();
  expect(currentDatasetSchema.safeParse(data).success).toBe(true);
});
it('rejects cyclic aliases and aliases to a different entity type, physical device or store', () => {
  const f = fixture();
  for (const mode of ['cycle', 'different-kind', 'different-device', 'different-store'] as const) {
    const data = structuredClone(f.data);
    const original = data.securityModel.entities.find(e => e.id === f.installId)!;
    if (mode === 'cycle') Object.assign(original, { mergedIntoRef: f.installId });
    if (mode === 'different-kind') Object.assign(original, { mergedIntoRef: f.vaultId });
    if (mode === 'different-device') {
      const second = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Another phone', importance: 'critical', operatingSystem: 'ios' });
      data.assets.push(second);
      data.securityModel.entities.push({ ...original, id: 'another-installation', deviceRef: second.id } as typeof original);
      Object.assign(original, { mergedIntoRef: 'another-installation' });
    }
    if (mode === 'different-store') {
      data.assets.push({ ...data.assets.find(a => a.id === f.rootId)!, id: 'other-root' });
      data.securityModel.entities.push({ ...data.securityModel.entities.find(e => e.id === f.vaultId)!, id: 'another-vault', authenticationAccountRef: 'other-root' } as typeof original);
      data.securityModel.entities.push({ ...original, id: 'another-installation', vaultRef: 'another-vault' } as typeof original);
      Object.assign(original, { mergedIntoRef: 'another-installation' });
    }
    expect(currentDatasetSchema.safeParse(data).success).toBe(false);
  }
});
