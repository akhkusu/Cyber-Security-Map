import { expect, it } from 'vitest';
import { currentDatasetSchema, makeAsset, newDataset } from './models';
import { recordControl } from './controlRecords';
import { startPhoneWorkflow } from './phoneEngine';
import { removeEntry } from './removeEntry';

it('removes only an unreferenced entry and its shared control baseline', () => {
  const data = newDataset('ja'); data.assets = [makeAsset({ kind: 'device', type: 'Smartphone', name: 'Phone', importance: 'critical', operatingSystem: 'ios' }), makeAsset({ kind: 'account', type: 'Primary email', name: 'Another account', importance: 'critical' })];
  const confirmed = recordControl(data, data.assets[0].id, 'backup', { id: 'confirmation' });
  const removed = currentDatasetSchema.parse(removeEntry(confirmed, data.assets[0].id));
  expect(removed.assets).toEqual([data.assets[1]]); expect(removed.actions).toEqual([]); expect(removed.securityModel.controlBaselines).toEqual({});
});

it('keeps typed references and workflow history intact when local deletion is not yet supported', () => {
  const data = newDataset('ja'); data.assets = [makeAsset({ kind: 'device', type: 'Smartphone', name: 'Phone', importance: 'critical', operatingSystem: 'ios' })];
  const workflow = startPhoneWorkflow(data, '/map', data.assets[0].id), snapshot = structuredClone(workflow);
  expect(removeEntry(workflow, data.assets[0].id)).toBeUndefined(); expect(workflow).toEqual(snapshot);
  data.securityModel.facts.push({ id: 'check', label: 'Observed access', state: 'available', evidence: 'user-confirmed', checkedAt: new Date().toISOString(), requiredRefs: [data.assets[0].id], contexts: ['new-device'], sourceIds: [] });
  expect(removeEntry(data, data.assets[0].id)).toBeUndefined(); expect(data.assets).toHaveLength(1);
});
