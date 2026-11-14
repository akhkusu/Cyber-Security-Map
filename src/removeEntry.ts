import type { Dataset } from './models';
import { mapRecordStore } from './mapRecordSchemas';
import { securityModelIssues } from './securityModel';

// Refuse a local deletion that would silently remove or strand typed access
// records or another task. Ordinary v1 entries retain their existing behavior.
export function removeEntry(data: Dataset, id: string): Dataset | undefined {
  if (mapRecordStore(data)?.manualRefs.includes(id) || mapRecordStore(data)?.drafts.some(d => d.editRef === id) || mapRecordStore(data)?.archivedRefs.includes(id)) return undefined;
  if (!data.assets.some(a => a.id === id)) return data;
  if (data.version === 2 && data.deviceWorkflows.some(w => w.oldDeviceRef === id || w.newDeviceRef === id)) return undefined;
  const steps = Object.fromEntries(Object.entries(data.guide.steps).filter(([key]) => !key.split('/').includes(id)));
  const next = {
    ...data,
    assets: data.assets.filter(a => a.id !== id),
    actions: data.actions.filter(a => a.targetId !== id && !a.id.startsWith(`do/${id}/`) && !a.id.endsWith(`@${id}`)),
    assessmentAnswers: Object.fromEntries(Object.entries(data.assessmentAnswers).filter(([key]) => !key.endsWith(`@${id}`))),
    dependencies: data.dependencies.filter(d => d.assetId !== id && d.recoveryAssetId !== id),
    guide: { ...data.guide, steps, cursor: data.guide.cursor.split('/').includes(id) ? 'start' : data.guide.cursor,
      history: data.guide.history.filter(key => !key.split('/').includes(id)),
      accountId: data.guide.accountId === id ? undefined : data.guide.accountId,
      managerId: data.guide.managerId === id ? undefined : data.guide.managerId,
      deviceId: data.guide.deviceId === id ? undefined : data.guide.deviceId,
    },
  };
  if (next.version === 2) {
    next.securityModel = { ...next.securityModel,
      controlBaselines: Object.fromEntries(Object.entries(next.securityModel.controlBaselines).filter(([, b]) => b.targetRef !== id)),
      lifecycle: Object.fromEntries(Object.entries(next.securityModel.lifecycle).filter(([ref]) => ref !== id)),
    };
    if (securityModelIssues(next.securityModel, next.assets).length) return undefined;
  }
  return next;
}
