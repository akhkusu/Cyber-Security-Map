import { describe, expect, it } from 'vitest';
import { recordControl, undoControl } from './controlRecords';
import { currentDatasetSchema, makeAsset, newDataset, type Dataset } from './models';

const now = '2026-11-13T12:00:00Z';
const fallback = { state: 'unknown' as const, evidence: 'not-assessed' as const };
function fixture() {
  const phone = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Phone', importance: 'critical', operatingSystem: 'ios' });
  const another = { ...phone, id: 'another-phone' };
  return { ...newDataset('ja'), assets: [phone, another] };
}
const confirm = (data: Dataset, id: string) => recordControl(data, data.assets[0].id, 'backup', { id, origin: id.startsWith('guide') ? 'guide' : 'phone' }, now);
const undo = (data: Dataset, id: string) => undoControl(data, id, data.assets[0].id, 'backup', fallback, now);

describe('shared work records', () => {
  it.each([['guide-a', 'phone-b'], ['phone-b', 'guide-a']])('restores the original state only after the last confirmation is undone: %s first', (first, second) => {
    const original = fixture();
    const twice = confirm(confirm(original, 'guide-a'), 'phone-b');
    const once = undo(twice, first);
    expect(once.assets[0].controls.backup).toBe('verified');
    const last = currentDatasetSchema.parse(undo(once, second));
    expect(last.assets[0].controls.backup).toBe('unknown');
    expect(last.securityModel.controlBaselines).toEqual({});
    expect(last.actions).toEqual([]);
    expect(last.assets[1]).toEqual(original.assets[1]);
  });

  it('restores a prior reported state and its opaque answer fields', () => {
    const original = fixture(), id = original.assets[0].id;
    original.assets[0].controls.backup = 'implemented'; original.assets[0].controlEvidence.backup = 'user-reported';
    const key = `data.device-backup@${id}`;
    // Resolve the actual assessment key from the first confirmation's baseline.
    const once = currentDatasetSchema.parse(confirm(original, 'guide-a'));
    const baseline = Object.values(once.securityModel.controlBaselines)[0];
    const answerKey = baseline.answerKey ?? key;
    original.assessmentAnswers[answerKey] = { response: 'yes', evidence: 'user-reported', updatedAt: now, opaque: { retained: true } };
    const last = undo(confirm(confirm(original, 'guide-a'), 'phone-b'), 'guide-a');
    const restored = undo(last, 'phone-b');
    expect(restored.assets[0].controls.backup).toBe('implemented');
    expect(restored.assets[0].controlEvidence.backup).toBe('user-reported');
    expect(restored.assessmentAnswers).toEqual(original.assessmentAnswers);
  });

  it('does not overwrite a later explicit correction or lose the shared baseline early', () => {
    const data = currentDatasetSchema.parse(confirm(confirm(fixture(), 'guide-a'), 'phone-b'));
    data.assets[0].controls.backup = 'needs-improvement'; data.assets[0].controlEvidence.backup = 'user-reported';
    const once = currentDatasetSchema.parse(undo(data, 'guide-a'));
    expect(Object.keys(once.securityModel.controlBaselines)).toHaveLength(1);
    const last = currentDatasetSchema.parse(undo(once, 'phone-b'));
    expect(last.assets[0].controls.backup).toBe('needs-improvement');
    expect(last.securityModel.controlBaselines).toEqual({});
  });

  it('is idempotent for the same action ID and keeps unknown action fields', () => {
    const data = fixture(); data.actions.push({ id: 'guide-a', status: 'remind-me-later', opaque: ['retained'] });
    const once = confirm(data, 'guide-a'), twice = confirm(once, 'guide-a');
    expect(twice).toBe(once); expect(twice.actions).toHaveLength(1);
    expect(twice.actions[0].opaque).toEqual(['retained']);
    expect(currentDatasetSchema.safeParse(twice).success).toBe(true);
  });
});
