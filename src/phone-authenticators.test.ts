import { describe, expect, it } from 'vitest';
import { makeAsset, newDataset, currentDatasetSchema, type CurrentDataset } from './models';
import { chooseAuthenticator, authenticator, type AuthenticatorProduct } from './authenticatorGuide';
import { recordControl } from './controlRecords';
import { answerPhoneQuestion, confirmPhoneStep, currentPhoneStep, jumpPhoneStep, phoneHelpPrompt, phoneRecord, startPhoneWorkflow, undoPhoneRecord } from './phoneEngine';
import { moveTargets, needsGoogleTransfer } from './phoneAuthenticators';
import { phoneSteps } from './phoneCatalog';
import { createEncryptedVault, decryptVault } from './crypto';
import { evaluateAccess } from './securityModel';
import { mapItems, typedMapStatus } from './securityMapViews';

function fixture(product: AuthenticatorProduct = 'bitwarden-authenticator', oldOS: 'ios' | 'android' = 'ios', newOS: 'ios' | 'android' = oldOS) {
  let data = newDataset('ja');
  data.assets = [
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Private old phone', importance: 'critical', operatingSystem: oldOS }), id: 'old' },
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Private new phone', importance: 'critical', operatingSystem: newOS }), id: 'fresh' },
    ...(['email', 'other-email', 'apple', 'microsoft', 'bw1', 'bw2'] as const).map(id => ({ ...makeAsset({ kind: 'account', type: 'Primary email', name: id === 'email' ? 'private@example.com' : id, importance: 'critical' }), id, provider: id === 'apple' ? 'apple' as const : id === 'microsoft' ? 'microsoft' as const : id.startsWith('bw') ? 'bitwarden' as const : 'proton' as const, purpose: 'personal' as const })),
  ];
  data = chooseAuthenticator(data, 'email', product, 'old', 'do/email/email-mfa/scan');
  const sourceRef = data.guide.answers['auth:email:app'];
  data = recordControl(data, sourceRef, 'opened', { id: 'existing-app-open' }) as CurrentDataset;
  data = recordControl(data, 'email', 'mfa', { id: 'existing-mfa' }) as CurrentDataset;
  data.securityModel.entities.push({ id: 'old-code', kind: 'credential', label: 'Existing code', createdAt: new Date().toISOString(), credentialType: 'totp', roles: ['second-step'], subjectRef: 'email', storageRef: sourceRef });
  data.guide.cursor = 'device-select'; data.guide.history = ['start', 'manager-select']; data.guide.answers.private = 'Private main answer';
  data = startPhoneWorkflow(data, '/guide', 'old', 'move');
  Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'fresh', cursor: `auth:${sourceRef}:old-open`, answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none' } });
  data = confirmAt(data, 'prepare-recovery');
  data = jumpPhoneStep(data, 'move', `auth:${sourceRef}:old-open`) as CurrentDataset;
  return { data, sourceRef };
}
const w = (data: CurrentDataset) => data.deviceWorkflows[0];
function answerAt(data: CurrentDataset, id: string, value: string) {
  expect(phoneSteps(data, w(data)).some(s => s.id === id), id).toBe(true);
  return answerPhoneQuestion(jumpPhoneStep(data, 'move', id), 'move', value) as CurrentDataset;
}
function confirmAt(data: CurrentDataset, id: string) {
  expect(phoneSteps(data, w(data)).some(s => s.id === id), id).toBe(true);
  return confirmPhoneStep(jumpPhoneStep(data, 'move', id), 'move') as CurrentDataset;
}
function finishMoves(data: CurrentDataset, modes: Record<string, string> = {}, state = 'fresh', group = 'local') {
  let next = data;
  for (let i = 0; i < 180; i++) {
    const step = currentPhoneStep(next, w(next));
    if (step.id.startsWith('use:')) return next;
    if (step.kind === 'question') {
      const meta = step.authenticatorQuestion;
      let value = '';
      if (meta?.kind === 'destination') value = 'add';
      else if (meta?.kind === 'root') value = meta.provider === 'bitwarden' ? meta.index === 0 ? 'account:bw1' : meta.index === 1 && Object.values(modes).includes('both') ? 'account:bw2' : 'done' : `account:${meta.provider}`;
      else if (meta?.kind === 'target') value = meta.index === 0 && !moveTargets(next, meta.sourceRef!).length ? 'account:other-email' : 'done';
      else if (step.id.startsWith('auth-mode:')) value = modes[step.id.slice('auth-mode:'.length)] ?? (authenticator(next, step.id.slice('auth-mode:'.length))?.productId === 'bitwarden-authenticator' ? 'local' : 'totp');
      else if (step.id.includes(':group:')) value = group;
      else if (step.id.endsWith(':restore-state')) value = state;
      else if (step.id.endsWith(':backup-method')) value = 'cloud';
      else if (step.id.endsWith(':version') || step.id.endsWith(':sync-platform')) value = 'supported';
      else if (step.id.endsWith(':cross-share')) value = 'pixel';
      else throw new Error(`Unexpected question ${step.id}`);
      const changed = answerPhoneQuestion(next, 'move', value) as CurrentDataset;
      expect(changed).not.toBe(next); next = changed;
    } else if (step.kind === 'action') {
      const changed = confirmPhoneStep(next, 'move') as CurrentDataset;
      if (changed === next) throw new Error(`Action blocked unexpectedly: ${step.id}`);
      next = changed;
    } else throw new Error(`Unexpected step ${step.id}: ${step.kind}`);
  }
  throw new Error('Move loop did not finish');
}

describe('authenticator moves outside the main guide', () => {
  it.each([['ios', 'ios'], ['android', 'android'], ['ios', 'android'], ['android', 'ios']] as const)('moves Bitwarden local codes %s → %s and tests the new app, without depending on the old phone', (oldOS, newOS) => {
    const f = fixture('bitwarden-authenticator', oldOS, newOS), main = structuredClone(f.data.guide);
    const data = finishMoves(f.data);
    const destination = w(data).answers[`auth-destination:${f.sourceRef}`];
    expect(destination).not.toBe(f.sourceRef); expect(data.guide).toEqual(main);
    expect(authenticator(data, destination)?.controls?.codeUse).toBe('verified');
    expect(data.assets.find(a => a.id === 'email')?.controls.mfa).toBe('verified');
    const route = data.securityModel.routes.find(r => r.purpose === 'second-step')!;
    const now = new Date().toISOString();
    expect(evaluateAccess(data.securityModel, route.id, { context: 'new-device', now, unavailableRefs: ['old'] }).state).toBe('available');
    expect(evaluateAccess(data.securityModel, route.id, { context: 'new-device', now, unavailableRefs: ['fresh'] }).state).toBe('unavailable');
    expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now }).state).toBe('not-applicable');
    expect(data.securityModel.entities.find(e => e.createdBy === 'authenticator-export')?.storageProtection).toBe('readable');
    const exportEntity = data.securityModel.entities.find(e => e.createdBy === 'authenticator-export')!;
    expect(data.securityModel.lifecycle[exportEntity.id].state).toBe('deleted');
    expect(typedMapStatus(data, mapItems(data, 'ja').find(e => e.id === destination)!, 'ja').label).toBe('新端末でコード利用の記録あり');
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it.each(['ios', 'android'] as const)('restores Microsoft changing codes on %s, keeping its actual recovery account and other data intact', os => {
    const f = fixture('microsoft-authenticator', os), main = structuredClone(f.data.guide);
    const data = finishMoves(f.data);
    expect(w(data).answers[`auth-root:${f.sourceRef}:0`]).toBe(os === 'ios' ? 'apple' : 'microsoft');
    expect(data.guide).toEqual(main); expect(authenticator(data, f.sourceRef)?.codeStorage).toBeUndefined();
    expect(data.assets).toHaveLength(8);
    expect(data.securityModel.relations.find(r => r.kind === 'requires-for-restore')).toMatchObject({ fromRef: f.sourceRef, toRef: os === 'ios' ? 'apple' : 'microsoft' });
    expect(phoneSteps(data, w(data)).some(s => s.id === `auth:${f.sourceRef}:restore`)).toBe(true);
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it.each(['microsoft-authenticator', 'bitwarden-authenticator'] as const)('checks an already present %s copy without making or restoring another backup', product => {
    const f = fixture(product); const data = finishMoves(f.data, {}, 'present');
    const steps = phoneSteps(data, w(data));
    expect(steps.some(s => /:(export|restore|backup)$/.test(s.id))).toBe(false);
    expect(data.securityModel.relations.some(r => r.kind === 'restores-from')).toBe(false);
    expect(data.securityModel.routes.some(r => r.purpose === 'second-step')).toBe(true);
  });
  it('includes known apps despite a no-other-app answer and makes adding a manual product a plan, never a completion', () => {
    const f = fixture(); let data = answerAt(f.data, 'authenticator', 'microsoft');
    const second = w(data).answers['auth-primary-ref'];
    expect(authenticator(data, second)?.controls).toEqual({});
    expect(data.securityModel.facts).toEqual([]); expect(data.guide).toEqual(f.data.guide);
    data = answerAt(data, 'auth-add:0', 'none');
    expect(phoneSteps(data, w(data)).some(s => s.id === `auth:${f.sourceRef}:old-open`)).toBe(true);
    expect(phoneSteps(data, w(data)).some(s => s.id === `auth:${second}:old-open`)).toBe(false); // reached after the first app’s questions
    const complete = finishMoves(jumpPhoneStep(data, 'move', `auth:${f.sourceRef}:old-open`) as CurrentDataset);
    expect(complete.securityModel.routes.filter(r => r.purpose === 'second-step')).toHaveLength(2);
  });
  it('keeps local and multiple vault-synced Bitwarden groups separate, with no invented single storage mode', () => {
    const f = fixture(); const data = finishMoves(f.data, { [f.sourceRef]: 'both' });
    expect(w(data).answers[`auth-root:${f.sourceRef}:0`]).toBe('bw1'); expect(w(data).answers[`auth-root:${f.sourceRef}:1`]).toBe('bw2');
    expect(data.securityModel.relations.filter(r => r.kind === 'synced-via' && r.fromRef === w(data).answers[`auth-destination:${f.sourceRef}`]).map(r => r.toRef)).toEqual(['bw1', 'bw2']);
    expect(authenticator(data, f.sourceRef)?.codeStorage).toBeUndefined();
    expect(data.assets.filter(a => a.provider === 'bitwarden')).toHaveLength(2);
    expect(phoneSteps(data, w(data)).some(s => s.id.includes(':root:bw1:decrypt:'))).toBe(true);
    const codeFact = data.securityModel.facts.find(f => f.label === 'New-phone authenticator code accepted')!;
    expect(codeFact.requiredRefs).not.toContain('bw1'); expect(codeFact.requiredRefs).not.toContain('bw2');
  });
  it('uses only the confirmed vault group for a synced code’s dependencies', () => {
    const f = fixture(); const data = finishMoves(f.data, { [f.sourceRef]: 'both' }, 'fresh', 'root:bw1');
    const fact = data.securityModel.facts.find(f => f.label === 'New-phone authenticator code accepted')!;
    expect(fact.requiredRefs).toContain('bw1'); expect(fact.requiredRefs).not.toContain('bw2');
  });
  it('keeps observed apps but stops using stale planned extras after a no-other-app correction', () => {
    const f = fixture();
    w(f.data).answers['auth-add:0'] = 'google';
    w(f.data).answers.authenticator = 'bitwarden'; w(f.data).answers['auth-primary-ref'] = f.sourceRef;
    expect(needsGoogleTransfer(f.data, w(f.data))).toBe(true);
    const data = answerAt(f.data, 'authenticator', 'none');
    expect(needsGoogleTransfer(data, w(data))).toBe(false);
    expect(phoneSteps(data, w(data)).some(s => s.id === `auth:${f.sourceRef}:old-open`)).toBe(true);
  });
  it('withdraws transitive code-use proofs when an export receipt is corrected, retaining referenced routes and real file cleanup', () => {
    const f = fixture(), complete = finishMoves(f.data), main = structuredClone(complete.guide);
    const key = Object.keys(w(complete).records).find(k => w(complete).records[k].stepId === `auth:${f.sourceRef}:export`)!;
    const route = complete.securityModel.routes.find(r => r.purpose === 'second-step')!;
    complete.securityModel.routes.push({ ...route, id: 'dependent', requirements: { kind: 'route', routeId: route.id } });
    const data = undoPhoneRecord(complete, 'move', key) as CurrentDataset;
    const destination = w(data).answers[`auth-destination:${f.sourceRef}`];
    expect(authenticator(data, destination)?.controls?.codeUse).toBe('unknown');
    expect(evaluateAccess(data.securityModel, 'dependent', { context: 'new-device', now: new Date().toISOString() }).state).toBe('unknown');
    const newCode = phoneSteps(data, w(data)).find(s => s.id === `auth:${f.sourceRef}:code:email`)!;
    const blocked = confirmAt(data, newCode.id);
    expect(blocked.securityModel.facts).toEqual(data.securityModel.facts);
    expect(data.guide).toEqual(main); expect(data.assets.find(a => a.id === 'email')?.controls.mfa).toBe('verified');
    expect(Object.values(data.securityModel.lifecycle).some(l => l.state === 'deleted')).toBe(true);
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });
  it('changes the item confirmation identity when the actual code groups change', () => {
    const f = fixture(), complete = finishMoves(f.data);
    const oldStep = phoneSteps(complete, w(complete)).find(s => s.id === `auth:${f.sourceRef}:items`)!;
    expect(phoneRecord(w(complete), oldStep)?.status).toBe('confirmed');
    let data = answerAt(complete, `auth-mode:${f.sourceRef}`, 'both');
    data = answerAt(data, `auth-root:${f.sourceRef}:0`, 'account:bw1');
    data = answerAt(data, `auth-root:${f.sourceRef}:1`, 'done');
    const changed = phoneSteps(data, w(data)).find(s => s.id === oldStep.id)!;
    expect(phoneRecord(w(data), changed)).toBeUndefined();
  });
  it('blocks cross-OS Microsoft restoration and a different Android backup version without prescribing reset or uninstall', () => {
    const f = fixture('microsoft-authenticator', 'ios', 'android');
    let data = answerAt(f.data, `auth-destination:${f.sourceRef}`, 'add');
    data = answerAt(data, `auth-mode:${f.sourceRef}`, 'totp');
    expect(phoneSteps(data, w(data)).find(s => s.id === `auth:${f.sourceRef}:cross-os`)?.kind).toBe('blocked');
    const android = fixture('microsoft-authenticator', 'android');
    let second = answerAt(android.data, `auth-destination:${android.sourceRef}`, 'add');
    second = answerAt(second, `auth-mode:${android.sourceRef}`, 'totp');
    second = answerAt(second, `auth:${android.sourceRef}:restore-state`, 'fresh');
    second = answerAt(second, `auth-root:${android.sourceRef}:0`, 'account:microsoft');
    second = answerAt(second, `auth:${android.sourceRef}:backup-method`, 'google-one');
    expect(phoneSteps(second, w(second)).find(s => s.id.endsWith(':backup-method-blocked'))?.kind).toBe('blocked');
  });
  it('keeps the exact encrypted resume point and copies only product/OS/procedure context to help', async () => {
    const f = fixture('bitwarden-authenticator', 'android');
    let data = answerAt(f.data, `auth-destination:${f.sourceRef}`, 'add');
    data = answerAt(data, `auth-mode:${f.sourceRef}`, 'local');
    data = answerAt(data, `auth:${f.sourceRef}:restore-state`, 'fresh');
    data = jumpPhoneStep(data, 'move', `auth:${f.sourceRef}:export`) as CurrentDataset;
    const saved = await createEncryptedVault('test storage phrase only', data);
    expect((await decryptVault(saved.envelope, 'test storage phrase only')).data).toEqual(data);
    const prompt = phoneHelpPrompt(data, w(data), 0, 'ja');
    for (const privateValue of ['private@example.com', 'Private old phone', 'Private new phone', 'Private main answer', f.sourceRef]) expect(prompt).not.toContain(privateValue);
    expect(prompt).toContain('https://bitwarden.com/help/authenticator-import-export/');
  });
  it('retains the previous destination and its proof, but does not carry it to a different new phone', () => {
    const f = fixture(), complete = finishMoves(f.data), main = structuredClone(complete.guide);
    const firstRef = w(complete).answers[`auth-destination:${f.sourceRef}`];
    const data = answerAt(complete, 'new-device', 'add:ios');
    let changed = answerAt(data, 'authenticator', 'none');
    changed = answerAt(changed, `auth-destination:${f.sourceRef}`, 'add');
    const secondRef = w(changed).answers[`auth-destination:${f.sourceRef}`];
    expect(secondRef).not.toBe(firstRef); expect(authenticator(changed, secondRef)?.controls).toEqual({});
    expect(authenticator(changed, firstRef)?.controls?.codeUse).toBe('verified');
    expect(changed.guide).toEqual(main); expect(Object.keys(w(changed).records)).toEqual(Object.keys(w(complete).records));
  });
  it('guides every recorded account in a large authenticator instead of repeatedly stopping at a fixed small limit', () => {
    const f = fixture();
    for (let i = 0; i < 70; i++) {
      const id = `extra-account-${i}`;
      f.data.assets.push({ ...makeAsset({ kind: 'account', type: 'Primary email', name: `Account ${i}`, importance: 'important' }), id, provider: 'proton', purpose: 'personal' });
      f.data.securityModel.entities.push({ id: `extra-code-${i}`, kind: 'credential', credentialType: 'totp', subjectRef: id, storageRef: f.sourceRef, roles: ['second-step'], label: `Code ${i}`, createdAt: new Date().toISOString() });
    }
    const data = finishMoves(f.data);
    expect(data.securityModel.routes.filter(r => r.purpose === 'second-step')).toHaveLength(71);
    expect(phoneSteps(data, w(data)).some(s => s.id.endsWith(':coverage-limit'))).toBe(false);
  });
  it('records a new readable file when an export is recreated after cleanup, preserving the deleted copy’s history', () => {
    const f = fixture(), complete = finishMoves(f.data);
    const oldFile = complete.securityModel.entities.find(e => e.createdBy === 'authenticator-export')!;
    const changed = confirmAt(complete, `auth:${f.sourceRef}:export`);
    expect(changed.securityModel.lifecycle[oldFile.id].state).toBe('deleted');
    expect(changed.securityModel.entities.filter(e => e.createdBy === 'authenticator-export')).toHaveLength(2);
    const newFile = changed.securityModel.entities.find(e => e.createdBy === 'authenticator-export' && e.id !== oldFile.id)!;
    expect(changed.securityModel.lifecycle[newFile.id]?.state).not.toBe('deleted');
  });
});
