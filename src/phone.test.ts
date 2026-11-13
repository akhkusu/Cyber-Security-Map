import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault } from './crypto';
import { currentDatasetSchema, makeAsset, newDataset, type CurrentDataset } from './models';
import { PHONE_SOURCES, phoneSteps } from './phoneCatalog';
import { answerPhoneQuestion, confirmPhoneStep, currentPhoneStep, deferPhoneStep, phoneBlockingSteps, phoneHelpPrompt, phoneRecordKey, startPhoneWorkflow, undoPhoneRecord } from './phoneEngine';

const now = '2026-11-13T12:00:00Z';
function fixture(oldOs: 'ios' | 'android' = 'ios', newOs: 'ios' | 'android' = 'ios', setup = 'ready') {
  const data = newDataset('ja');
  const old = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Previous phone', importance: 'critical', operatingSystem: oldOs }), id: 'old' };
  const fresh = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'New phone', importance: 'critical', operatingSystem: newOs }), id: 'fresh' };
  data.assets = [old, fresh]; data.guide.cursor = 'device-select'; data.guide.history = ['start'];
  const next = startPhoneWorkflow(data, '/guide', 'old', 'workflow', now);
  Object.assign(next.deviceWorkflows[0], { oldDeviceRef: 'old', newDeviceRef: 'fresh', answers: { stage: 'new', availability: 'available', ownership: 'personal', setup, authenticator: 'none', 'special-apps': 'none', 'phone-line': 'no-line', 'old-fate': 'sell', 'ios-generation': '18', 'android-maker': 'pixel' } });
  return next;
}
const current = (data: CurrentDataset) => currentPhoneStep(data, data.deviceWorkflows[0]);
function confirmAt(data: CurrentDataset, stepId: string): CurrentDataset {
  const selected = { ...data, deviceWorkflows: data.deviceWorkflows.map(w => ({ ...w, cursor: stepId })) };
  return confirmPhoneStep(selected, 'workflow', now) as CurrentDataset;
}
function confirmBefore(data: CurrentDataset, until: string) {
  let next = data;
  for (const step of phoneSteps(data, data.deviceWorkflows[0])) {
    if (step.id === until) break;
    if (step.kind === 'action') next = confirmAt(next, step.id);
  }
  return next;
}

describe('optional personal phone change', () => {
  it('keeps the main guide, resumes the side task after encrypted restore, and adds no completed controls for a selection', async () => {
    const original = newDataset('ja'); original.guide.cursor = 'manager-select'; original.guide.history = ['start', 'provider'];
    let data = startPhoneWorkflow(original, '/guide', undefined, 'workflow', now);
    data = answerPhoneQuestion(data, 'workflow', 'new') as CurrentDataset;
    data = answerPhoneQuestion(data, 'workflow', 'add:ios') as CurrentDataset;
    expect(data.assets).toHaveLength(1); expect(data.assets[0].controls.screenLock).toBe('unknown');
    expect(data.deviceWorkflows[0].cursor).toBe('availability'); expect(data.guide).toEqual(original.guide);
    const { envelope } = await createEncryptedVault('test app storage phrase', data);
    const restored = (await decryptVault(envelope, 'test app storage phrase')).data;
    expect(restored).toEqual(data); expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });

  it.each([['ios', 'ios', 'quick-start'], ['ios', 'android', 'android-copy-start'], ['android', 'ios', 'move-start'], ['android', 'android', 'android-copy-start']] as const)('selects the correct initial transfer for %s → %s', (oldOs, newOs, id) => {
    const data = fixture(oldOs, newOs, 'not-started');
    const steps = phoneSteps(data, data.deviceWorkflows[0]);
    expect(steps.some(s => s.id === id)).toBe(true);
    expect(steps.find(s => s.id === id)?.refs).toEqual(['old', 'fresh']);
    const ready = fixture(oldOs, newOs, 'ready');
    expect(phoneSteps(ready, ready.deviceWorkflows[0]).some(s => s.id === id)).toBe(false);
    expect(phoneSteps(ready, ready.deviceWorkflows[0]).find(s => s.id === 'already-ready')?.action?.en).toContain('Do not erase');
  });

  it('blocks destructive operations for deferred or unsupported migration work, including a direct cursor jump', () => {
    let data = fixture();
    data.deviceWorkflows[0].answers.authenticator = 'other';
    data = confirmBefore(data, 'handoff-gate');
    expect(phoneBlockingSteps(data, data.deviceWorkflows[0]).map(s => s.id)).toContain('other-authenticator');
    const gate = { ...data, deviceWorkflows: data.deviceWorkflows.map(w => ({ ...w, cursor: 'handoff-gate' })) };
    expect(confirmPhoneStep(gate, 'workflow', now)).toBe(gate);
    const erase = { ...data, deviceWorkflows: data.deviceWorkflows.map(w => ({ ...w, cursor: 'erase-old' })) };
    expect(confirmPhoneStep(erase, 'workflow', now)).toBe(erase);
    expect(data.securityModel.lifecycle.old).toBeUndefined();
  });

  it('lets the user keep a phone without any wipe or handover requirement', () => {
    let data = fixture(); data.deviceWorkflows[0].answers['old-fate'] = 'spare';
    expect(phoneSteps(data, data.deviceWorkflows[0]).some(s => s.id === 'erase-old')).toBe(false);
    expect(confirmAt(data, 'keep-old').securityModel.lifecycle.old).toBeUndefined();
    data = confirmBefore(data, 'keep-old');
    const next = confirmAt(data, 'keep-old');
    expect(next.securityModel.lifecycle.old).toMatchObject({ state: 'backup', evidence: 'user-confirmed' });
    expect(next.guide).toEqual(data.guide);
  });

  it.each(['lost', 'gone', 'broken'])('never uses accessible-old-phone sale instructions for %s', availability => {
    const data = fixture(); data.deviceWorkflows[0].answers.availability = availability;
    const steps = phoneSteps(data, data.deviceWorkflows[0]);
    expect(steps.some(s => s.id === 'erase-old')).toBe(false);
    expect(steps.some(s => s.kind === 'blocked')).toBe(true);
  });

  it('distinguishes two accounts with one provider and records sign-in separately from MFA setup', () => {
    let data = fixture();
    const a = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Personal Google', importance: 'critical' }), id: 'personal', provider: 'google' as const };
    data.assets.push(a, { ...a, id: 'second', name: 'Another Google' });
    Object.assign(data.deviceWorkflows[0].answers, { 'use:personal': 'yes', 'use:second': 'yes' });
    data = confirmAt(data, 'signin:personal');
    expect(data.assets.find(a => a.id === 'personal')?.controls.mfa).toBe('unknown');
    expect(data.securityModel.routes).toHaveLength(1);
    expect(data.securityModel.routes[0]).toMatchObject({ targetRef: 'personal', purpose: 'sign-in', contexts: ['new-device'] });
    expect(data.securityModel.facts[0].requiredRefs).toEqual(['personal', 'fresh']);
    expect(data.securityModel.routes.some(r => r.targetRef === 'second')).toBe(false);
    expect(currentDatasetSchema.safeParse(data).success).toBe(true);
  });

  it('does not reuse an access confirmation after changing the new phone', () => {
    let data = fixture(); const account = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Google', importance: 'critical' }), provider: 'google' as const };
    data.assets.push(account); data.deviceWorkflows[0].answers[`use:${account.id}`] = 'yes';
    data = confirmAt(data, `signin:${account.id}`);
    const oldKey = Object.keys(data.deviceWorkflows[0].records)[0];
    data.deviceWorkflows[0].cursor = 'new-device';
    const changed = answerPhoneQuestion(data, 'workflow', 'add:ios') as CurrentDataset;
    changed.deviceWorkflows[0].answers.setup = 'ready'; changed.deviceWorkflows[0].answers.authenticator = 'none'; changed.deviceWorkflows[0].answers[`use:${account.id}`] = 'yes';
    const newStep = phoneSteps(changed, changed.deviceWorkflows[0]).find(s => s.id === `signin:${account.id}`)!;
    expect(phoneRecordKey(changed.deviceWorkflows[0], newStep)).not.toBe(oldKey);
    expect(changed.deviceWorkflows[0].records[oldKey].status).toBe('confirmed');
    expect(changed.deviceWorkflows[0].records[phoneRecordKey(changed.deviceWorkflows[0], newStep)]).toBeUndefined();
  });

  it('does not revive old access when a real erasure record is corrected', () => {
    let data = confirmBefore(fixture(), 'handoff-gate');
    data = confirmAt(data, 'handoff-gate'); data = confirmAt(data, 'sync-warning'); data = confirmAt(data, 'apple-unpair-check'); data = confirmAt(data, 'apple-signout'); data = confirmAt(data, 'erase-old');
    expect(data.securityModel.lifecycle.old.state).toBe('retired');
    const key = Object.entries(data.deviceWorkflows[0].records).find(([, r]) => r.stepId === 'erase-old')![0];
    const corrected = undoPhoneRecord(data, 'workflow', key, now) as CurrentDataset;
    expect(corrected.deviceWorkflows[0].records[key]).toBeUndefined();
    expect(corrected.securityModel.lifecycle.old.state).toBe('retired');
    expect(currentDatasetSchema.safeParse(corrected).success).toBe(true);
  });

  it('copies only catalog context after problems, never names, IDs, raw answers or notes', () => {
    const data = fixture(); data.assets[0].name = 'someone@example.com'; data.assets[1].notes = 'secret notes';
    data.deviceWorkflows[0].answers.raw = 'private recovery code'; data.deviceWorkflows[0].cursor = 'new-backup-check';
    const prompt = phoneHelpPrompt(data, data.deviceWorkflows[0], 0, 'ja');
    expect(prompt).not.toContain('someone@example.com'); expect(prompt).not.toContain('secret notes'); expect(prompt).not.toContain('private recovery code');
    expect(prompt).toContain('最新の公式資料'); expect(prompt).toContain('新しいスマホ'); expect(prompt).toContain('https://support.apple.com/');
  });

  it('leaves a deferred operation unconfirmed while advancing its own cursor', () => {
    const data = fixture(); data.deviceWorkflows[0].cursor = 'new-lock';
    const step = current(data); expect(step.kind).toBe('action');
    const deferred = deferPhoneStep(data, 'workflow', now) as CurrentDataset;
    expect(deferred.deviceWorkflows[0].records[phoneRecordKey(data.deviceWorkflows[0], step)]?.status).toBe('later');
    expect(deferred.assets.find(a => a.id === 'fresh')?.controls.screenLock).toBe('unknown');
    expect(deferred.guide).toEqual(data.guide);
  });
});


it('keeps unsupported or untested Google Authenticator entries in the handover gate', () => {
  const data = fixture(); Object.assign(data.deviceWorkflows[0].answers, { authenticator: 'google', 'google-auth-mode': 'local', 'google-auth-coverage': 'registered' });
  const steps = phoneSteps(data, data.deviceWorkflows[0]);
  expect(steps.find(s => s.id === 'google-auth-export')?.action?.ja).toContain('アカウントのエクスポート');
  expect(steps.find(s => s.id === 'google-auth-import')?.action?.ja).toContain('アカウントのインポート');
  expect(steps.find(s => s.id === 'unchecked-codes')?.kind).toBe('blocked');
  const android = fixture('android', 'android'); Object.assign(android.deviceWorkflows[0].answers, data.deviceWorkflows[0].answers);
  expect(phoneSteps(android, android.deviceWorkflows[0]).find(s => s.id === 'google-auth-export')?.action?.ja).toContain('コードをエクスポート');
});

it('requires acceptance of a transferred authenticator code and retains completion across copy-only updates', () => {
  const data = fixture(); const account = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Google', importance: 'critical' }), provider: 'google' as const };
  data.assets.push(account); Object.assign(data.deviceWorkflows[0].answers, { authenticator: 'google', 'google-auth-mode': 'sync', 'google-auth-coverage': 'registered', [`use:${account.id}`]: 'yes', [`auth-code:${account.id}`]: 'yes' });
  const step = phoneSteps(data, data.deviceWorkflows[0]).find(s => s.id === `signin:${account.id}`)!;
  expect(step.expected?.en).toContain('accepts the authenticator code');
  const correctedCopy = { ...step, title: { en: 'Reworded title', ja: '説明の更新' } };
  expect(phoneRecordKey(data.deviceWorkflows[0], correctedCopy)).toBe(phoneRecordKey(data.deviceWorkflows[0], step));
});

it('all action variants have bilingual instructions, known sources and stable subject references', () => {
  for (const oldOs of ['ios', 'android'] as const) for (const newOs of ['ios', 'android'] as const) {
    const data = fixture(oldOs, newOs, 'not-started');
    Object.assign(data.deviceWorkflows[0].answers, { authenticator: 'google', 'google-auth-mode': 'local', 'google-auth-coverage': 'registered' });
    for (const step of phoneSteps(data, data.deviceWorkflows[0])) {
      expect(step.title.en && step.title.ja).toBeTruthy();
      if (step.kind === 'action') expect(step.action?.en && step.action.ja && step.place?.en && step.place.ja && step.expected?.en && step.expected.ja).toBeTruthy();
      for (const id of step.sources) expect(PHONE_SOURCES[id]?.url).toMatch(/^https:\/\//u);
      for (const ref of step.refs) expect(data.assets.some(a => a.id === ref)).toBe(true);
    }
  }
});


it('rechecks a code used elsewhere when either its method or new phone changes', () => {
  const data = fixture(); const a = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Google', importance: 'critical' }), provider: 'google' as const };
  data.assets.push(a); const w = data.deviceWorkflows[0];
  Object.assign(w.answers, { authenticator: 'google', 'google-auth-mode': 'sync', [`use:${a.id}`]: 'elsewhere', [`auth-code:${a.id}`]: 'no' });
  const step = () => phoneSteps(data, w).find(s => s.id === `elsewhere:${a.id}`)!;
  const originalKey = phoneRecordKey(w, step()); w.answers[`auth-code:${a.id}`] = 'yes';
  const codeKey = phoneRecordKey(w, step()); expect(codeKey).not.toBe(originalKey);
  expect(step().expected?.en).toContain('accepts');
  data.assets.push({ ...data.assets[1], id: 'another-new-phone' }); w.newDeviceRef = 'another-new-phone';
  expect(phoneRecordKey(w, step())).not.toBe(codeKey);
});

it('corrects a historical erasure on its original phone after another old phone is selected', () => {
  let data = confirmBefore(fixture(), 'handoff-gate');
  for (const id of ['handoff-gate', 'sync-warning', 'apple-unpair-check', 'apple-signout', 'erase-old']) data = confirmAt(data, id);
  const key = Object.entries(data.deviceWorkflows[0].records).find(([, r]) => r.stepId === 'erase-old')![0];
  expect(data.deviceWorkflows[0].records[key].targetRef).toBe('old');
  data.assets.push({ ...data.assets[0], id: 'different-old' }); data.deviceWorkflows[0].oldDeviceRef = 'different-old';
  const corrected = undoPhoneRecord(data, 'workflow', key, now) as CurrentDataset;
  expect(corrected.securityModel.lifecycle.old.state).toBe('retired');
  expect(corrected.securityModel.lifecycle['different-old']).toBeUndefined();
  expect(currentDatasetSchema.safeParse(corrected).success).toBe(true);
});


it('reuses a legacy phone without an OS instead of registering another physical device', () => {
  const original = newDataset('ja'); const old = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Saved phone', importance: 'critical' });
  old.controls.backup = 'implemented'; original.assets = [old];
  let data = startPhoneWorkflow(original, '/guide', old.id, 'workflow', now);
  data = answerPhoneQuestion(data, 'workflow', 'using') as CurrentDataset;
  expect(current(data).choices?.some(c => c.value === old.id)).toBe(true);
  data = answerPhoneQuestion(data, 'workflow', old.id) as CurrentDataset;
  expect(current(data).id).toBe('old-os');
  data = answerPhoneQuestion(data, 'workflow', 'ios') as CurrentDataset;
  expect(current(data).id).toBe('availability'); expect(data.assets).toHaveLength(1);
  expect(data.assets[0].id).toBe(old.id); expect(data.assets[0].operatingSystem).toBe('ios');
  expect(data.assets[0].controls).toEqual(old.controls); expect(data.guide).toEqual(original.guide);
  expect(currentDatasetSchema.safeParse(data).success).toBe(true);
});


it('saves a terminal exception without repeatedly adding the same step to back history', () => {
  const data = fixture(); data.deviceWorkflows[0].answers.availability = 'lost'; data.deviceWorkflows[0].cursor = 'unavailable-old';
  const before = [...data.deviceWorkflows[0].history];
  const saved = deferPhoneStep(data, 'workflow', now) as CurrentDataset;
  expect(saved.deviceWorkflows[0].cursor).toBe('unavailable-old'); expect(saved.deviceWorkflows[0].history).toEqual(before);
  expect(Object.values(saved.deviceWorkflows[0].records)[0].status).toBe('later');
});
