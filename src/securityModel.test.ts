import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault } from './crypto';
import { currentDatasetSchema, DataUpgradeConflict, legacyDatasetSchema, makeAsset, newDataset, upgradeDataset } from './models';
import { ACCESS_CONTEXTS, accessConditionSchema, emptySecurityModel, entityIndex, evaluateAccess, securityEntitySchema, securityModelIssues, type AccessCondition, type AccessFact, type AccessRoute, type SecurityModel } from './securityModel';

const now = '2026-11-13T12:00:00Z';
const context = { context: 'new-device' as const, now };
const legacy = [
  { id: 'account', name: 'Main account', kind: 'account' },
  { id: 'phone', name: 'Everyday phone', kind: 'device' },
  { id: 'spare-phone', name: 'Spare phone', kind: 'device' },
  { id: 'cloud', name: 'Sync account', kind: 'account' },
  { id: 'paper', name: 'Paper copy', kind: 'backup' },
];
const fact = (id: string, requiredRefs: string[] = []): AccessFact => ({ id, label: id, state: 'available', evidence: 'user-confirmed', checkedAt: now, requiredRefs, contexts: [...ACCESS_CONTEXTS], sourceIds: [] });
const route = (id: string, requirements: AccessCondition, purpose: AccessRoute['purpose'] = 'sign-in'): AccessRoute => ({ id, label: id, targetRef: 'account', purpose, contexts: [...ACCESS_CONTEXTS], requirements, sourceIds: [] });
const f = (factId: string): AccessCondition => ({ kind: 'fact', factId });
const r = (routeId: string): AccessCondition => ({ kind: 'route', routeId });
const model = (facts: AccessFact[], routes: AccessRoute[]): SecurityModel => ({ ...emptySecurityModel(), facts, routes });

describe('distinct records and safe versioned migration', () => {
  it('keeps physical devices, installations, account registrations and synced replicas distinct', () => {
    const data = emptySecurityModel();
    data.entities = [
      securityEntitySchema.parse({ id: 'vault', kind: 'vault', label: 'Passwords', productId: 'example-manager', authenticationAccountRef: 'account', createdAt: now }),
      securityEntitySchema.parse({ id: 'app-1', kind: 'installation', label: 'App on phone', productId: 'example-authenticator', deviceRef: 'phone', createdAt: now }),
      securityEntitySchema.parse({ id: 'app-2', kind: 'installation', label: 'App on spare', productId: 'example-authenticator', deviceRef: 'spare-phone', createdAt: now }),
      securityEntitySchema.parse({ id: 'passkey', kind: 'credential', label: 'Account passkey', credentialType: 'passkey', subjectRef: 'account', storageRef: 'vault', roles: ['sign-in'], replicaGroupId: 'same-synced-secret', createdAt: now }),
    ];
    expect(securityModelIssues(data, legacy)).toEqual([]);
    const index = entityIndex(data, legacy);
    expect(index.size).toBe(legacy.length + 4);
    expect(index.get('account')).toMatchObject({ legacy: true, kind: 'account' });
    expect(index.get('app-1')?.kind).toBe('installation');
    data.entities.push(securityEntitySchema.parse({ id: 'phone', kind: 'security-key', label: 'Incorrect duplicate', createdAt: now }));
    expect(securityModelIssues(data, legacy)).toContainEqual({ code: 'duplicate-id', recordId: 'phone', referenceId: 'phone' });
  });

  it('upgrades v1 only when a feature needs it, retaining IDs, cursor, work and opaque fields', async () => {
    const phone = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Old phone', importance: 'critical', operatingSystem: 'ios' });
    const old = legacyDatasetSchema.parse({
      version: 1, assets: [phone], dependencies: [], actions: [{ id: 'old-action', status: 'completed' }],
      workflowProgress: { old: ['already-done'] }, incidentProgress: {}, reviews: [],
      guide: { cursor: 'do/old-account/email-mfa/state', history: ['start'], answers: {}, steps: {} },
      onboarding: { complete: true, goals: [] }, settings: { language: 'ja', theme: 'light', mode: 'guided', autoLockMinutes: 10 },
      softwareInventory: [{ appName: 'Old inventory' }],
    });
    expect(old.version).toBe(1);
    const upgraded = upgradeDataset(old);
    expect(upgraded.version).toBe(2); expect(upgraded.assets[0].id).toBe(phone.id);
    expect(upgraded.guide).toEqual(old.guide); expect(upgraded.actions).toEqual(old.actions);
    expect(upgraded.workflowProgress).toEqual(old.workflowProgress); expect(upgraded.softwareInventory).toEqual(old.softwareInventory);
    const sealed = await createEncryptedVault('an independent storage phrase', upgraded);
    expect(sealed.envelope.format).toBe('personal-cyber-os-v1');
    const restored = (await decryptVault(sealed.envelope, 'an independent storage phrase')).data;
    expect(restored).toEqual(upgraded);
  });

  it('refuses to reinterpret opaque v1 fields whose names conflict with new features', () => {
    const raw = JSON.parse(JSON.stringify(newDataset('ja'))); raw.version = 1;
    raw.securityModel = { originalUserData: ['do not replace'] };
    const old = legacyDatasetSchema.parse(raw), snapshot = structuredClone(old);
    expect(() => upgradeDataset(old)).toThrow(DataUpgradeConflict);
    expect(old).toEqual(snapshot); expect(old.securityModel).toEqual(raw.securityModel);
  });

  it('rejects broken new references while leaving legacy records intact', () => {
    const data = newDataset('ja');
    data.securityModel.facts = [fact('requires-a-missing-phone', ['missing-phone'])];
    expect(currentDatasetSchema.safeParse(data).success).toBe(false);
    expect(data.securityModel.facts[0].requiredRefs).toEqual(['missing-phone']);
  });
});

describe('recorded access requirements and loss scenarios', () => {
  it('requires both factors for ALL, but preserves an independent available ANY alternative', () => {
    const data = model([fact('password', ['paper']), fact('phone-code', ['phone']), fact('backup-key', ['paper'])], [
      route('login', { kind: 'all', conditions: [f('password'), { kind: 'any', conditions: [f('phone-code'), f('backup-key')] }] }),
      route('phone-only', { kind: 'all', conditions: [f('password'), f('phone-code')] }),
    ]);
    expect(securityModelIssues(data, legacy)).toEqual([]);
    expect(evaluateAccess(data, 'login', { ...context, unavailableRefs: ['phone'] })).toMatchObject({ state: 'available', usedFactIds: ['password', 'backup-key'] });
    expect(evaluateAccess(data, 'phone-only', { ...context, unavailableRefs: ['phone'] }).state).toBe('unavailable');
    expect(evaluateAccess(data, 'login', { ...context, unavailableRefs: ['paper'] }).state).toBe('unavailable');
  });

  it('keeps authentication success separate from vault decryption and local unlock', () => {
    const decrypt = { ...fact('can-decrypt'), state: 'unknown' as const };
    const data = model([fact('server-accepted-login'), decrypt, { ...fact('cached-unlock', ['phone']), contexts: ['normal'] }], [
      route('sign-in', f('server-accepted-login')),
      route('decrypt-vault', f('can-decrypt'), 'decrypt'),
      { ...route('local-unlock', f('cached-unlock'), 'local-unlock'), contexts: ['normal'] },
    ]);
    expect(evaluateAccess(data, 'sign-in', context).state).toBe('available');
    expect(evaluateAccess(data, 'decrypt-vault', context).state).toBe('unknown');
    expect(evaluateAccess(data, 'local-unlock', context).state).toBe('not-applicable');
    expect(evaluateAccess(data, 'local-unlock', { ...context, context: 'normal' }).state).toBe('available');
  });

  it('does not turn self-reported or missing facts into confirmed access', () => {
    const data = model([{ ...fact('said-yes'), evidence: 'user-reported' }], [route('reported', f('said-yes')), route('missing', f('not-recorded'))]);
    expect(evaluateAccess(data, 'reported', context)).toMatchObject({ state: 'unknown', reasons: [{ code: 'reported-only', referenceId: 'said-yes' }] });
    expect(evaluateAccess(data, 'missing', context)).toMatchObject({ state: 'unknown', reasons: [{ code: 'missing-reference', referenceId: 'not-recorded' }] });
  });

  it('does not call two apps on one lost phone independent recovery', () => {
    const data = model([fact('app-a-code', ['phone']), fact('app-b-code', ['phone'])], [route('either-app', { kind: 'any', conditions: [f('app-a-code'), f('app-b-code')] }, 'restore')]);
    expect(evaluateAccess(data, 'either-app', context).state).toBe('available');
    expect(evaluateAccess(data, 'either-app', { ...context, unavailableRefs: ['phone'] }).state).toBe('unavailable');
  });

  it('includes shared-cloud requirements even when credential copies are on different phones', () => {
    const data = model([fact('new-phone-restore', ['phone', 'cloud']), fact('spare-restore', ['spare-phone', 'cloud'])], [route('restore', { kind: 'any', conditions: [f('new-phone-restore'), f('spare-restore')] }, 'restore')]);
    expect(evaluateAccess(data, 'restore', { ...context, unavailableRefs: ['phone'] }).state).toBe('available');
    expect(evaluateAccess(data, 'restore', { ...context, unavailableRefs: ['cloud'] }).state).toBe('unavailable');
  });

  it('handles cycles as unknown and still finds an independent alternate path', () => {
    const data = model([], [route('a', r('b')), route('b', r('a'))]);
    expect(securityModelIssues(data, legacy)).toEqual([]);
    expect(evaluateAccess(data, 'a', context)).toMatchObject({ state: 'unknown', reasons: [{ code: 'cycle', referenceId: 'a' }] });
    data.facts.push(fact('paper-recovery', ['paper']));
    data.routes[0].requirements = { kind: 'any', conditions: [r('b'), f('paper-recovery')] };
    expect(evaluateAccess(data, 'a', context).state).toBe('available');
    expect(evaluateAccess(data, 'b', context).state).toBe('available');
    expect(evaluateAccess(data, 'a', { ...context, unavailableRefs: ['paper'] }).state).toBe('unknown');
  });

  it('keeps a waiting contact unavailable and never treats elapsed time alone as confirmation', () => {
    const pending = { ...fact('contact-help'), state: 'unknown' as const, availableAt: '2026-11-20T12:00:00Z' };
    const data = model([pending], [route('contact', f('contact-help'), 'restore')]);
    expect(evaluateAccess(data, 'contact', context)).toMatchObject({ state: 'unavailable', reasons: [{ code: 'waiting', referenceId: 'contact-help' }] });
    const later = { ...context, now: '2026-11-21T12:00:00Z' };
    expect(evaluateAccess(data, 'contact', later).state).toBe('unknown');
    data.facts[0].state = 'available';
    expect(evaluateAccess(data, 'contact', later).state).toBe('available');
  });

  it('retains historical facts but stops counting a confirmed retired or revoked resource', () => {
    const data = model([fact('code', ['phone'])], [route('login', f('code'))]);
    const before = structuredClone(data.facts);
    data.lifecycle.phone = { state: 'transferred', evidence: 'user-confirmed', updatedAt: now };
    expect(evaluateAccess(data, 'login', context).state).toBe('unavailable');
    expect(data.facts).toEqual(before);
    data.lifecycle = {}; data.facts[0].expiresAt = now;
    expect(evaluateAccess(data, 'login', context)).toMatchObject({ state: 'unavailable', reasons: [{ code: 'expired', referenceId: 'code' }] });
  });

  it('bounds deeply nested condition input without exhausting the parser', () => {
    let condition: AccessCondition = f('original');
    for (let n = 0; n < 100; n++) condition = { kind: 'all', conditions: [condition] };
    expect(accessConditionSchema.safeParse(condition).success).toBe(false);
  });
});


it('does not revive an old observation merely because a lost phone is returned to use', () => {
  const data = model([fact('old-signin', ['phone'])], [route('login', f('old-signin'))]);
  data.lifecycle.phone = { state: 'lost', evidence: 'user-confirmed', updatedAt: '2026-11-14T12:00:00Z', accessResetAt: '2026-11-14T12:00:00Z' };
  const scenario = { ...context, now: '2026-11-15T12:00:00Z' };
  expect(evaluateAccess(data, 'login', scenario).state).toBe('unavailable');
  data.lifecycle.phone.state = 'in-use';
  expect(evaluateAccess(data, 'login', scenario).state).toBe('unknown');
  data.facts[0].checkedAt = scenario.now;
  expect(evaluateAccess(data, 'login', scenario).state).toBe('available');
});
