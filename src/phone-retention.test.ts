import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault } from './crypto';
import { makeAsset, newDataset, type CurrentDataset } from './models';
import { phoneSteps } from './phoneCatalog';
import { confirmPhoneStep, phoneRecordKey, startPhoneWorkflow, undoPhoneRecord } from './phoneEngine';

const now = '2026-11-13T12:00:00Z';
function fixture(os: 'ios' | 'android' = 'ios', fate = 'spare') {
  let data = newDataset('ja');
  data.assets = ['old', 'fresh'].map(id => ({ ...makeAsset({ kind: 'device', type: 'Smartphone', name: id, importance: 'critical', operatingSystem: os }), id }));
  data.guide.cursor = 'manager-select'; data.guide.history = ['provider'];
  data = startPhoneWorkflow(data, '/guide', 'old', 'move', now);
  Object.assign(data.deviceWorkflows[0], { newDeviceRef: 'fresh', answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'special-apps': 'none', 'phone-line': 'no-line', 'old-fate': fate } });
  return data;
}
function confirm(data: CurrentDataset, id: string, workflowId = 'move', date = now) {
  const selected = { ...data, deviceWorkflows: data.deviceWorkflows.map(w => w.id === workflowId ? { ...w, cursor: id } : w) };
  return confirmPhoneStep(selected, workflowId, date) as CurrentDataset;
}
function prepared(data: CurrentDataset, workflowId = 'move', date = now) {
  let next = confirm(data, 'old-backup-check', workflowId, date);
  const workflow = next.deviceWorkflows.find(w => w.id === workflowId)!;
  for (const step of phoneSteps(next, workflow).filter(s => s.id.startsWith('keep-') && s.kind === 'action')) next = confirm(next, step.id, workflowId, date);
  return next;
}
const recordKey = (data: CurrentDataset, id: string, workflowId = 'move') => {
  const w = data.deviceWorkflows.find(w => w.id === workflowId)!;
  return phoneRecordKey(w, phoneSteps(data, w).find(s => s.id === id)!);
};

describe('keeping the previous personal phone', () => {
  it.each([['ios', 'spare'], ['ios', 'keep'], ['android', 'spare'], ['android', 'keep']] as const)('checks %s %s without inventing account recovery or changing the main guide', (os, fate) => {
    const data = fixture(os, fate), originalGuide = structuredClone(data.guide);
    const skipped = confirm(data, 'keep-old');
    expect(skipped.securityModel.lifecycle.old).toBeUndefined();
    const final = prepared(data);
    expect(final.securityModel.lifecycle.old.state).toBe(fate === 'spare' ? 'backup' : 'in-use');
    expect(final.assets[0].controls).toMatchObject({ screenLock: 'verified', updates: 'verified' });
    expect(final.assets[1].controls.screenLock).toBe('unknown');
    expect(final.securityModel.routes).toEqual([]); expect(final.securityModel.facts).toEqual([]);
    expect(final.guide).toEqual(originalGuide);
    expect(phoneSteps(final, final.deviceWorkflows[0]).some(s => s.physicalEffect)).toBe(false);
  });

  it('does not turn a broken phone or an undecided role into an available spare', () => {
    let data = fixture(); data.deviceWorkflows[0].answers.availability = 'broken';
    data.securityModel.lifecycle.old = { state: 'unavailable', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now };
    expect(phoneSteps(data, data.deviceWorkflows[0]).find(s => s.id === 'keep-unavailable')?.kind).toBe('blocked');
    expect(phoneSteps(data, data.deviceWorkflows[0]).some(s => s.id === 'keep-old')).toBe(false);
    expect(confirm(data, 'keep-old').securityModel.lifecycle.old.state).toBe('unavailable');
    data.deviceWorkflows[0].answers['old-fate'] = 'undecided';
    data = confirm(data, 'keep-undecided');
    expect(data.securityModel.lifecycle.old.state).toBe('unavailable');
  });

  it('retains a prior completed summary and opaque fields without manufacturing detailed confirmations', async () => {
    const data = fixture(), w = data.deviceWorkflows[0];
    const key = JSON.stringify([w.id, 'keep-old', ['old'], '']);
    w.records[key] = { stepId: 'keep-old', titleEn: 'Old summary', titleJa: '以前の確認', status: 'confirmed', updatedAt: now, factIds: [], sourceIds: [], physicalEffect: false, extra: { preserve: true } };
    w.cursor = 'finished'; data.securityModel.lifecycle.old = { state: 'backup', evidence: 'user-confirmed', updatedAt: now };
    const steps = phoneSteps(data, w);
    expect(steps.some(s => s.id === 'keep-lock')).toBe(false);
    expect(data.assets[0].controls.screenLock).toBe('unknown');
    const { envelope } = await createEncryptedVault('test storage phrase only', data);
    expect((await decryptVault(envelope, 'test storage phrase only')).data).toEqual(data);
    expect(w.records[key].extra).toEqual({ preserve: true });
  });

  it('withdraws the derived spare role when its actual-use check is undone, preserving the earlier role and fields', () => {
    let data = fixture();
    const baseline = { state: 'in-use' as const, evidence: 'user-confirmed' as const, updatedAt: '2026-11-12T12:00:00Z', opaque: { keep: true } };
    data.securityModel.lifecycle.old = baseline;
    data = prepared(data); const finalKey = recordKey(data, 'keep-old');
    data = undoPhoneRecord(data, 'move', recordKey(data, 'keep-spare-use')) as CurrentDataset;
    expect(data.deviceWorkflows[0].records[finalKey]).toBeUndefined();
    expect(data.securityModel.lifecycle.old).toEqual(baseline);
    expect(data.guide.cursor).toBe('manager-select');
  });

  it.each([true, false])('keeps another task’s role confirmation and restores the original baseline, older first: %s', olderFirst => {
    let data = prepared(fixture()); const firstKey = recordKey(data, 'keep-old');
    data = startPhoneWorkflow(data, '/map', 'old', 'other', now);
    Object.assign(data.deviceWorkflows[1], { newDeviceRef: 'fresh', answers: { ...data.deviceWorkflows[0].answers } });
    data = prepared(data, 'other', '2026-11-13T13:00:00Z'); const secondKey = recordKey(data, 'keep-old', 'other');
    data = undoPhoneRecord(data, olderFirst ? 'move' : 'other', olderFirst ? firstKey : secondKey) as CurrentDataset;
    expect(data.securityModel.lifecycle.old.state).toBe('backup');
    data = undoPhoneRecord(data, olderFirst ? 'other' : 'move', olderFirst ? secondKey : firstKey) as CurrentDataset;
    expect(data.securityModel.lifecycle.old).toBeUndefined();
  });

  it('never revives a phone erased after its retention confirmation', () => {
    let data = prepared(fixture()); const key = recordKey(data, 'keep-old');
    data.securityModel.lifecycle.old = { ...data.securityModel.lifecycle.old, state: 'retired', updatedAt: '2026-11-13T13:00:00Z', accessResetAt: '2026-11-13T13:00:00Z' };
    data = undoPhoneRecord(data, 'move', key) as CurrentDataset;
    expect(data.securityModel.lifecycle.old.state).toBe('retired');
    expect(data.securityModel.lifecycle.old.accessResetAt).toBe('2026-11-13T13:00:00Z');
  });

  it('does not restore a role from before erasure when a later reuse confirmation is undone', () => {
    let data = prepared(fixture());
    data.securityModel.lifecycle.old = { ...data.securityModel.lifecycle.old, state: 'retired', updatedAt: '2026-11-13T13:00:00Z', accessResetAt: '2026-11-13T13:00:00Z' };
    const retired = structuredClone(data.securityModel.lifecycle.old);
    data = startPhoneWorkflow(data, '/map', 'old', 'reuse', now);
    Object.assign(data.deviceWorkflows[1], { newDeviceRef: 'fresh', answers: { ...data.deviceWorkflows[0].answers } });
    data = prepared(data, 'reuse', '2026-11-13T14:00:00Z');
    data = undoPhoneRecord(data, 'reuse', recordKey(data, 'keep-old', 'reuse')) as CurrentDataset;
    expect(data.securityModel.lifecycle.old).toEqual(retired);
  });

  it('keeps the detailed branch after changing the role of a phone with an earlier summary record', () => {
    let data = fixture('ios', 'keep'); const w = data.deviceWorkflows[0];
    w.records[JSON.stringify([w.id, 'keep-old', ['old'], ''])] = { stepId: 'keep-old', titleEn: 'Old summary', titleJa: '以前の確認', status: 'confirmed', updatedAt: now, factIds: [], sourceIds: [], physicalEffect: false };
    data.securityModel.lifecycle.old = { state: 'in-use', evidence: 'user-confirmed', updatedAt: now };
    w.answers['old-fate'] = 'spare'; data = prepared(data);
    expect(phoneSteps(data, data.deviceWorkflows[0]).some(s => s.id === 'keep-spare-use')).toBe(true);
  });
});
