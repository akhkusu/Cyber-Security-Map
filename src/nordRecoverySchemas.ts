import { z } from 'zod';
import type { Dataset } from './models';

const ref = z.string().min(1);
export const nordRecoveryTaskSchema = z.object({
  id: ref, vaultRef: ref, rootRef: ref, targetRef: ref, sourceRef: ref.optional(), sourceDeviceRef: ref.optional(),
  cursor: ref.default('method'), answers: z.record(z.string(), z.string()).default({}), history: z.array(z.string()).default([]),
  status: z.enum(['active', 'deferred', 'completed', 'cancelled']).default('active'),
  returnTo: z.string().regex(/^\/(guide|map|phone\/[^?#]+)$/), originGuideCursor: z.string().optional(),
  originPhone: z.object({ id: ref, cursor: ref, snapshot: z.string() }).passthrough().optional(),
  masterRequestRef: z.string().optional(),
  initialCodeRef: ref.optional(), currentCodeRef: ref.optional(), usedCodeRef: ref.optional(), masterRef: ref.optional(), masterPaperRef: ref.optional(),
  records: z.record(z.string(), z.object({ stepId: ref, titleEn: z.string().optional(), titleJa: z.string().optional(), refs: z.array(ref), at: z.string().datetime({ offset: true }), requires: z.array(ref), controls: z.array(z.object({ targetRef: ref, controlId: ref })).default([]) }).passthrough()).default({}),
  mutations: z.record(z.string(), z.object({ kind: z.enum(['code', 'master']), ref, at: z.string().datetime({ offset: true }), sourceRef: ref.optional() }).passthrough()).default({}),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
}).passthrough();
export type NordRecoveryTask = z.infer<typeof nordRecoveryTaskSchema>;
export const nordRecoveryStoreSchema = z.object({ version: z.literal(1), tasks: z.array(nordRecoveryTaskSchema) }).passthrough();
export function nordRecoveryTasks(data: Dataset): NordRecoveryTask[] {
  if (data.version !== 2 || data.securityModel.revision < 4) return [];
  const parsed = nordRecoveryStoreSchema.safeParse(data.securityModel.nordRecoveryV1);
  return parsed.success ? parsed.data.tasks : [];
}
export function nordRecoveryStale(data: Dataset, task: NordRecoveryTask) {
  if (data.version !== 2) return false;
  const epoch = Date.parse(data.securityModel.lifecycle[task.vaultRef]?.accessResetAt ?? '1970-01-01T00:00:00Z');
  const base = Date.parse(task.mutations.apply?.at ?? task.createdAt);
  return base < epoch || (!nordRecoveryApplied(task) && !!task.currentCodeRef && ['revoked', 'deleted', 'retired', 'transferred'].includes(data.securityModel.lifecycle[task.currentCodeRef]?.state ?? ''));
}
export function nordRecoveryApplied(task: NordRecoveryTask) { return Object.values(task.mutations).some(m => m.kind === 'master'); }
export function nordRecoveryPending(data: Dataset, vaultId: string) {
  const tasks = nordRecoveryTasks(data).filter(t => t.vaultRef === vaultId && !nordRecoveryStale(data, t));
  const latest = tasks.filter(t => Object.values(t.mutations).length).sort((a, b) => Math.max(...Object.values(b.mutations).map(m => Date.parse(m.at))) - Math.max(...Object.values(a.mutations).map(m => Date.parse(m.at))))[0];
  return latest && !['completed', 'cancelled'].includes(latest.status) ? latest : undefined;
}
export function nordRecoveryMasterConfirmed(data: Dataset, vaultId: string, requestRef?: string) {
  if (data.version !== 2) return false;
  return nordRecoveryTasks(data).some(t => t.vaultRef === vaultId && t.masterRequestRef === requestRef && nordRecoveryApplied(t) && Object.values(t.records).some(r => r.stepId === 'master-test') && data.securityModel.facts.some(f => f.nordRecoveryEvidence === 'v1' && f.nordRecoveryTaskRef === t.id && f.nordRecoveryPurpose === 'master-read' && f.state === 'available' && f.evidence === 'user-confirmed' && Date.parse(f.checkedAt) > Date.parse(data.securityModel.lifecycle[vaultId]?.accessResetAt ?? '1970-01-01T00:00:00Z')));
}
