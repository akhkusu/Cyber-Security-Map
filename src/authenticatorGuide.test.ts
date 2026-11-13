import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault } from './crypto';
import { currentDatasetSchema, makeAsset, newDataset, type Dataset } from './models';
import { authenticator, authenticatorSetupRoute, chooseAuthenticator, configureAuthenticator, selectedAuthenticator, setAuthCursor, type AuthenticatorProduct } from './authenticatorGuide';
import { completeStep, currentTask, helpPrompt, move, undoStep } from './guideEngine';
import { mapConnections, mapItems, typedMapStatus } from './securityMapViews';

function fixture(product: AuthenticatorProduct = 'bitwarden-authenticator', os: 'ios' | 'android' = 'android') {
  let data: Dataset = newDataset('ja');
  data.assets = [{ ...makeAsset({ kind: 'account', type: 'Primary email', name: 'secret@example.com', importance: 'critical' }), id: 'email', provider: 'proton', purpose: 'personal', services: ['mail'] }, { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Private phone', importance: 'critical', operatingSystem: os }), id: 'phone' }];
  data.guide.accountId = 'email'; data.guide.cursor = 'do/email/email-mfa/scan';
  data = chooseAuthenticator(data, 'email', product, 'phone', data.guide.cursor);
  const id = selectedAuthenticator(data, 'email')!.id;
  data = configureAuthenticator(data, 'email', id, 'local');
  return { data, id };
}
function setup(data: Dataset) {
  let next = setAuthCursor(data, authenticatorSetupRoute(data, 'email'));
  for (let i = 0; i < 10 && currentTask(next)?.recipe.id.startsWith('authenticator-setup:'); i++) next = completeStep(next);
  return next;
}
function enrolled(data: Dataset) {
  const app = selectedAuthenticator(data, 'email')!;
  let next = { ...data, guide: { ...data.guide, answers: { ...data.guide.answers, [`auth:email:input:${app.id}`]: 'camera' } } };
  next = completeStep(move(next, 'do/email/email-mfa/scan'));
  next = completeStep(next); // Service-specific confirmation, not the app list.
  return completeStep(move(next, 'do/email/email-mfa/verify'));
}
describe('guided authenticator preparation and service enrollment', () => {
  it('asks for a product only when a new code must be registered, leaving legacy MFA records alone', () => {
    const data = newDataset('ja'); data.assets.push({ ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Email', importance: 'critical' }), id: 'email', provider: 'proton', purpose: 'personal' });
    expect(currentTask(move(data, 'do/email/email-mfa/scan'))?.redirectTo).toBe('authenticator-product/email');
    expect(currentTask(move(data, 'do/email/email-mfa/verify'))?.redirectTo).toBeUndefined();
    expect(completeStep(move(data, 'do/email/email-mfa/verify')).assets[0].controls.mfa).toBe('verified');
  });
  it.each((['google-authenticator', 'microsoft-authenticator', 'bitwarden-authenticator'] as const).flatMap(product => (['ios', 'android'] as const).map(os => [product, os] as const)))('prepares %s on %s without completing the account setting', (product, os) => {
    const f = fixture(product, os); const data = setup(f.data);
    expect(data.guide.cursor).toBe('authenticator-input/email');
    expect(data.assets[0].controls.mfa).toBe('unknown');
    expect(selectedAuthenticator(data, 'email')?.controls?.opened).toBe('verified');
    expect(data.assets[1].controls.screenLock).toBe('verified');
    expect(mapConnections(data).some(r => r.relation === 'installed-on')).toBe(true);
    if (product === 'microsoft-authenticator') expect(selectedAuthenticator(data, 'email')?.controls?.appLock).toBe('verified');
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it('records a value-free credential only after the app scan and the service confirmation, with no automatic login claim', () => {
    const f = fixture(); let data = setup(f.data);
    const app = selectedAuthenticator(data, 'email')!;
    data = { ...data, guide: { ...data.guide, answers: { ...data.guide.answers, [`auth:email:input:${app.id}`]: 'manual' } } };
    data = completeStep(move(data, 'do/email/email-mfa/scan'));
    expect(data.version === 2 && data.securityModel.entities.some(e => e.kind === 'credential')).toBe(false);
    const completed = enrolled(data);
    expect(completed.assets[0].controls.mfa).toBe('verified');
    expect(completed.guide.cursor).toBe('do/email/recovery/save');
    expect(completed.version === 2 && completed.securityModel.entities.find(e => e.kind === 'credential')).toMatchObject({ credentialType: 'totp', storageRef: f.id, subjectRef: 'email', roles: ['second-step'] });
    expect(completed.version === 2 && completed.securityModel.routes.every(r => r.purpose === 'second-step' && r.contexts.join() === 'enrollment')).toBe(true);
    expect(typedMapStatus(completed, mapItems(completed, 'ja').find(e => e.id === f.id)!, 'ja').label).toBe('コード登録の記録あり');
  });
  it('does not infer app registration from service state alone, or from a previous app’s scan', () => {
    const f = fixture(); const data = setup(f.data);
    const stateOnly = completeStep(move(data, 'do/email/email-mfa/verify'));
    expect(stateOnly.version === 2 && stateOnly.securityModel.entities.some(e => e.kind === 'credential')).toBe(false);
    let one = enrolled(data);
    one = chooseAuthenticator(one, 'email', 'microsoft-authenticator', 'phone', 'do/email/email-mfa/scan');
    one = configureAuthenticator(one, 'email', selectedAuthenticator(one, 'email')!.id, 'local');
    one = setup(one); one = completeStep(move(one, 'do/email/email-mfa/verify'));
    expect(selectedAuthenticator(one, 'email')?.controls?.codeAccepted).toBeUndefined();
  });
  it('withdraws derived app confirmation on scan undo without erasing the still-enabled service setting', () => {
    const f = fixture(); const data = enrolled(setup(f.data));
    const undone = undoStep(data, 'do/email/email-mfa/scan');
    expect(undone.assets[0].controls.mfa).toBe('verified');
    expect(selectedAuthenticator(undone, 'email')?.controls?.codeAccepted).toBe('unknown');
    expect(mapConnections(undone).some(r => r.relation === 'authenticates-to')).toBe(false);
    expect(currentDatasetSchema.safeParse(undone).success).toBe(true);
  });
  it('keeps separate Google storage profiles and does not copy confirmations to another backing account', () => {
    const f = fixture('google-authenticator'); const original = setup(f.data);
    const root = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: 'Google', importance: 'critical' }), id: 'google', provider: 'google' as const, purpose: 'personal' as const };
    const changed = configureAuthenticator({ ...original, assets: [...original.assets, root] }, 'email', f.id, 'account', 'google');
    expect(selectedAuthenticator(changed, 'email')?.id).not.toBe(f.id);
    expect(selectedAuthenticator(changed, 'email')?.controls).toEqual({});
    expect(authenticator(changed, f.id)?.codeStorage).toBe('local');
    expect(currentDatasetSchema.safeParse(changed).success).toBe(true);
  });
  it('reuses a prepared app across accounts while enrollment remains specific to each account', () => {
    const f = fixture(); const first = enrolled(setup(f.data));
    const secondAccount = { ...first.assets[0], id: 'second', controls: {}, controlEvidence: {} };
    const second = chooseAuthenticator({ ...first, assets: [...first.assets, secondAccount] }, 'second', 'bitwarden-authenticator', 'phone', 'do/second/email-mfa/scan');
    expect(selectedAuthenticator(second, 'second')?.id).toBe(f.id);
    expect(authenticatorSetupRoute(second, 'second')).toBe('authenticator-input/second');
    expect(second.version === 2 && second.securityModel.entities.some(e => e.kind === 'credential' && e.subjectRef === 'second')).toBe(false);
  });
  it('preserves the exact step through encryption and exports only catalog context to AI help', async () => {
    const f = fixture('google-authenticator', 'ios'); const data = setup(f.data);
    const saved = await createEncryptedVault('storage phrase for test only', data);
    expect((await decryptVault(saved.envelope, 'storage phrase for test only')).data).toEqual(data);
    const prompt = helpPrompt(move(data, `do/email/authenticator-setup:${f.id}/storage`), '画面が違う', 'ja');
    for (const value of ['secret@example.com', 'Private phone', f.id]) expect(prompt).not.toContain(value);
    expect(prompt).toContain('Google 認証システム');
  });
});

it('does not apply an old setup receipt to the currently selected different app', () => {
  const f = fixture(); let data = setup(f.data);
  data = chooseAuthenticator(data, 'email', 'microsoft-authenticator', 'phone', 'do/email/email-mfa/scan');
  data = configureAuthenticator(data, 'email', selectedAuthenticator(data, 'email')!.id, 'local');
  const old = move(data, `do/email/authenticator-setup:${f.id}/open`);
  const result = completeStep(old);
  expect(result.guide.steps[old.guide.cursor]).toEqual(old.guide.steps[old.guide.cursor]);
  expect(selectedAuthenticator(result, 'email')?.controls?.opened).toBeUndefined();
  expect(result.guide.cursor).toContain(`authenticator-setup:${selectedAuthenticator(result, 'email')!.id}`);
});
it('ignores prototype names as authenticator products', () => {
  const f = fixture(); if (f.data.version !== 2) throw new Error('fixture');
  f.data.securityModel.entities.push({ id: 'not-an-app', kind: 'installation', label: 'Unknown', createdAt: new Date().toISOString(), productId: 'toString', deviceRef: 'phone' });
  expect(authenticator(f.data, 'not-an-app')).toBeUndefined();
});
it('blocks a stale setup cursor when its storage account or device family is no longer applicable', () => {
  const f = fixture('google-authenticator');
  let data = f.data;
  if (data.version !== 2) throw new Error('fixture');
  data.securityModel.entities = data.securityModel.entities.map(e => e.id === f.id && e.kind === 'installation' ? { ...e, codeStorage: 'account', syncAccountRef: undefined } : e);
  const storage = move(data, `do/email/authenticator-setup:${f.id}/storage`);
  expect(completeStep(storage).guide.cursor).toBe('authenticator-root/email');
  expect(selectedAuthenticator(completeStep(storage), 'email')?.controls?.storageChecked).not.toBe('verified');
  data = { ...f.data, assets: f.data.assets.map(a => a.id === 'phone' ? { ...a, operatingSystem: 'windows' as const } : a) };
  expect(completeStep(move(data, `do/email/authenticator-setup:${f.id}/open`)).guide.cursor).toBe('authenticator-device/email');
});
it('reuses an explicitly chosen Google profile and keeps unconfirmed provisional IDs as aliases', () => {
  const f = fixture('google-authenticator'); let data = setup(f.data);
  data = chooseAuthenticator(data, 'email', 'google-authenticator', 'phone', 'do/email/email-mfa/scan', false);
  const pending = selectedAuthenticator(data, 'email')!.id;
  data = configureAuthenticator(data, 'email', pending, 'local');
  expect(selectedAuthenticator(data, 'email')?.id).toBe(f.id);
  expect(authenticator(data, pending)?.id).toBe(f.id);
  expect(mapItems(data, 'ja').filter(n => n.entityKind === 'installation')).toHaveLength(1);
  expect(currentDatasetSchema.safeParse(data).success).toBe(true);
});
it('keeps registration observations out of normal sign-in evaluation and withdraws them after confirmation undo', () => {
  const f = fixture(); let data = enrolled(setup(f.data));
  if (data.version !== 2) throw new Error('fixture');
  const route = data.securityModel.routes[0];
  data.securityModel.routes.push({ ...route, id: 'dependent-observation', requirements: { kind: 'route', routeId: route.id } });
  const undone = undoStep(data, 'do/email/email-mfa/confirm');
  expect(undone.version === 2 && undone.securityModel.facts[0].state).toBe('unknown');
  expect(undone.assets[0].controls.mfa).toBe('verified');
  expect(currentDatasetSchema.safeParse(undone).success).toBe(true);
});

import { requireAuthenticatorRoots, unprotectedAuthenticatorRoot } from './authenticatorGuide';
import { recordControl } from './controlRecords';
it('guides an unprotected synchronization root without changing the primary account and reuses completed root controls', () => {
  const f = fixture('google-authenticator');
  const root = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: 'Google root', importance: 'critical' }), id: 'root', provider: 'google' as const, purpose: 'personal' as const };
  let data = configureAuthenticator({ ...f.data, assets: [...f.data.assets, root] }, 'email', f.id, 'account', 'root');
  expect(unprotectedAuthenticatorRoot(data, 'email')).toBeUndefined();
  data = setup(data);
  expect(unprotectedAuthenticatorRoot(data, 'email')?.id).toBe('root');
  const pending = requireAuthenticatorRoots(data, 'email', 'manager-select'); expect(pending.guide.cursor).toBe('authenticator-root-security/email');
  expect(pending.guide.accountId).toBe('email');
  data = recordControl(data, 'root', 'mfa', { id: 'root-authentication' }); data = recordControl(data, 'root', 'recovery', { id: 'root-recovery' });
  expect(unprotectedAuthenticatorRoot(data, 'email')).toBeUndefined(); expect(requireAuthenticatorRoots(data, 'email', 'manager-select').guide.cursor).toBe('manager-select');
});
it('preserves unrelated records when a legacy ID occupies the generated code slot', () => {
  const f = fixture(); if (f.data.version !== 2) throw new Error('fixture');
  const original = { id: `auth-code:email:${f.id}`, kind: 'security-key' as const, label: 'Existing key', createdAt: new Date().toISOString(), transports: ['nfc' as const], opaque: 'preserved' };
  f.data.securityModel.entities.push(original);
  const data = enrolled(setup(f.data)); if (data.version !== 2) throw new Error('fixture');
  expect(data.securityModel.entities.find(e => e.id === original.id)).toEqual(original);
  expect(data.securityModel.entities.filter(e => e.kind === 'credential')).toHaveLength(1);
  expect(data.securityModel.entities.find(e => e.kind === 'credential')?.id).not.toBe(original.id);
  expect(currentDatasetSchema.safeParse(data).success).toBe(true);
});
it('makes older backup observations unknown after another code registration, retaining the backup and its history', async () => {
  const f = fixture(); const data = enrolled(setup(f.data)); if (data.version !== 2) throw new Error('fixture');
  const credential = data.securityModel.entities.find(e => e.kind === 'credential')!;
  data.securityModel.facts.push({ id: 'backup-tested', label: 'Previously tested code backup', state: 'available', evidence: 'user-confirmed', checkedAt: '2026-11-12T12:00:00Z', requiredRefs: [credential.id], contexts: ['all-devices-lost'], sourceIds: [] });
  data.securityModel.routes.push({ id: 'restore-older-copy', label: 'Previous code copy', targetRef: 'email', purpose: 'restore', contexts: ['all-devices-lost'], requirements: { kind: 'fact', factId: 'backup-tested' }, sourceIds: [] });
  const { evaluateAccess } = await import('./securityModel');
  expect(evaluateAccess(data.securityModel, 'restore-older-copy', { context: 'all-devices-lost', now: new Date().toISOString() }).state).toBe('available');
  const next = completeStep(completeStep(move(data, 'do/email/email-mfa/scan'))); if (next.version !== 2) throw new Error('fixture');
  expect(evaluateAccess(next.securityModel, 'restore-older-copy', { context: 'all-devices-lost', now: new Date().toISOString() }).state).toBe('unknown');
  expect(next.securityModel.facts.find(f => f.id === 'backup-tested')).toEqual(data.securityModel.facts.find(f => f.id === 'backup-tested'));
  const verified = completeStep(move(next, 'do/email/email-mfa/verify')); if (verified.version !== 2) throw new Error('fixture');
  const newRoute = verified.securityModel.routes.find(r => r.purpose === 'second-step')!;
  expect(evaluateAccess(verified.securityModel, newRoute.id, { context: 'enrollment', now: new Date().toISOString() }).state).toBe('available');
  expect(verified.securityModel.entities.filter(e => e.kind === 'credential')).toHaveLength(2);
  expect(currentDatasetSchema.safeParse(next).success).toBe(true);
});

it('does not turn a later enabled-state check into a fresh code acceptance or accept an unconfirmed new scan', () => {
  const f = fixture(); const data = enrolled(setup(f.data)); if (data.version !== 2) throw new Error('fixture');
  const fact = data.securityModel.facts[0];
  const checked = completeStep(move(data, 'do/email/email-mfa/verify')); if (checked.version !== 2) throw new Error('fixture');
  expect(checked.securityModel.facts[0].checkedAt).toBe(fact.checkedAt);
  expect(checked.securityModel.facts[0].proofFingerprint).toBe(fact.proofFingerprint);
  const scanned = completeStep(move(checked, 'do/email/email-mfa/scan'));
  const staleConfirmation = completeStep(move(scanned, 'do/email/email-mfa/verify')); if (staleConfirmation.version !== 2) throw new Error('fixture');
  expect(staleConfirmation.securityModel.facts).toEqual(checked.securityModel.facts);
});
