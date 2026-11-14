import {enteStore} from './enteSchemas';
import {twofasStore} from './twofasSchemas';
import { accessPlanStore } from './accessPlanSchemas';
import {protectionStore} from './deviceProtectionSchemas';
import {recordedActors} from './recordAvailability';
import type { Dataset } from './models';
import { keyTasks } from './hardwareKeySchemas';
import { mapRecordStore } from './mapRecordSchemas';
import { securityModelIssues } from './securityModel';

// Refuse a local deletion that would silently remove or strand typed access
// records or another task. Ordinary v1 entries retain their existing behavior.
export function removeEntry(data: Dataset, id: string): Dataset | undefined {
  if (mapRecordStore(data)?.manualRefs.includes(id) || mapRecordStore(data)?.drafts.some(d => d.editRef === id) || mapRecordStore(data)?.archivedRefs.includes(id)) return undefined;
  if (keyTasks(data).some(t => [t.accountRef,t.deviceRef,t.browserRef,t.vaultRef,...t.keyRefs,...t.registrationRefs,...Object.values(t.records).flatMap(r=>r.refs)].includes(id))) return undefined;
  const protection=protectionStore(data);
  if(protection?.tasks.some(t=>[...recordedActors(data,[t.deviceRef,t.accountRef,t.environmentRef,t.environmentDeviceRef,t.sessionRef,t.lineRef,...t.managementUsedRefs]),...[...Object.values(t.records),...t.recordHistory.map(h=>h.record)].flatMap(r=>[...r.refs,...r.withoutRefs,...Object.keys(r.actorEpochs),...Object.keys(r.actorSignatures)])].includes(id))||protection?.history.some(e=>e.deviceRef===id||e.accountRef===id))return undefined;
  for(const owned of [twofasStore(data),enteStore(data)])if(owned){const references=(v:unknown):boolean=>typeof v==='string'?v===id:Array.isArray(v)?v.some(references):!!v&&typeof v==='object'&&Object.values(v).some(references);if(references(owned))return undefined;}
  const store=accessPlanStore(data);
  if(store){const contains=(v:unknown):boolean=>typeof v==='string'?v===id:Array.isArray(v)?v.some(contains):!!v&&typeof v==='object'&&Object.values(v).some(contains);if(contains(store))return undefined;}
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
