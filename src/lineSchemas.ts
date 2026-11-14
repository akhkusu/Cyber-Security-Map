import { z } from 'zod';
import type { Dataset, CurrentDataset } from './models';
import type { SecurityModel, AccessFact } from './securityModel';

const ref = z.string().min(1), time = z.string().datetime({ offset: true });
const phoneOS = z.enum(['ios', 'android', 'unknown']);
export const linePhoneOS = (data: Dataset, id?: string) => {
  const os = data.assets.find(a => a.id === id && a.kind === 'device')?.operatingSystem;
  return os === 'ios' || os === 'android' ? os : 'unknown';
};
export const PHONE_PRODUCTS = ['line', 'signal', 'whatsapp', 'bank', 'payment', 'transit', 'eid', 'work', 'other', 'unknown'] as const;
export type PhoneProduct = typeof PHONE_PRODUCTS[number];
const itemSchema = z.object({ id: ref, product: z.enum(PHONE_PRODUCTS), taskRef: ref.optional(), withdrawnAt: time.optional() }).passthrough();
export const lineReceiptSchema = z.object({
  id: ref, taskRef: ref, stepId: ref, at: time, requires: z.array(ref), refs: z.array(ref),
  titleEn: z.string(), titleJa: z.string(), revokedAt: time.optional(),
}).passthrough();
export type LineReceipt = z.infer<typeof lineReceiptSchema>;
export const lineTaskSchema = z.object({
  id: ref, phoneRef: ref, inventoryRef: ref, itemRef: ref, oldDeviceRef: ref, newDeviceRef: ref.optional(),
  oldOS: phoneOS, newOS: phoneOS.optional(),
  accountRef: ref.optional(), recoveryMailRef: ref.optional(), sourceAppRef: ref.optional(), sourceSessionRef: ref.optional(),
  destinationAppRef: ref.optional(), destinationSessionRef: ref.optional(), dataRef: ref.optional(), backupRef: ref.optional(),
  cursor: z.string().default('account'), history: z.array(z.string()).default([]), answers: z.record(z.string(), z.string()).default({}),
  records: z.record(z.string(), ref).default({}), status: z.enum(['active', 'deferred', 'completed']).default('active'),
  cutover: z.object({ phase: z.enum(['requested', 'applied']), requestedAt: time, appliedAt: time.optional(), epoch: ref }).passthrough().optional(),
  createdAt: time, updatedAt: time,
}).passthrough();
export type LineTask = z.infer<typeof lineTaskSchema>;
export const lineStoreSchema = z.object({
  version: z.literal(1),
  inventories: z.array(z.object({ id: ref, phoneRef: ref, oldDeviceRef: ref, newDeviceRef: ref.optional(),
    oldOS: phoneOS, newOS: phoneOS.optional(),
    reviewedAt: time.optional(), items: z.array(itemSchema).default([]), createdAt: time, updatedAt: time }).passthrough()).default([]),
  tasks: z.array(lineTaskSchema).default([]), receipts: z.array(lineReceiptSchema).default([]),
  links: z.array(z.object({ relationRef: ref, receiptRef: ref }).passthrough()).default([]),
  proofs: z.array(z.object({ factRef: ref, receiptRef: ref, taskRef: ref, epoch: ref, kind: z.enum(['sign-in', 'read']) }).passthrough()).default([]),
}).passthrough();
export type LineStore = z.infer<typeof lineStoreSchema>;
export type PhoneInventory = LineStore['inventories'][number];
export function lineStore(data: Dataset | Pick<CurrentDataset, 'securityModel'>): LineStore | undefined {
  if ('version' in data && data.version !== 2 || !('securityModel' in data) || data.securityModel.revision < 13) return;
  const p = lineStoreSchema.safeParse(data.securityModel.linePhoneV1); return p.success ? p.data : undefined;
}
export const lineTask = (data: Dataset, id?: string) => lineStore(data)?.tasks.find(t => t.id === id);
export const lineDeviceContextCurrent = (data: Dataset, task: LineTask) => task.oldOS === linePhoneOS(data, task.oldDeviceRef) && task.newOS === (task.newDeviceRef ? linePhoneOS(data, task.newDeviceRef) : undefined);
export function lineReceiptCurrent(store: LineStore, id: string): boolean {
  const pending = [id], seen = new Set<string>(), visiting = new Set<string>(), stack: [string, boolean][] = pending.map(id => [id, false]);
  const receipts = new Map(store.receipts.map(r => [r.id, r])), tasks = new Map(store.tasks.map(t => [t.id, t])); let count = 0;
  while (stack.length) {
    if (++count > 8192) return false;
    const [id, leaving] = stack.pop()!; if (leaving) { visiting.delete(id); seen.add(id); continue; }
    if (seen.has(id)) continue; const r = receipts.get(id), t = r && tasks.get(r.taskRef);
    if (!r || r.revokedAt || !t || t.records[r.stepId] !== id || visiting.has(id)) return false;
    visiting.add(id); stack.push([id, true]); for (const required of r.requires) stack.push([required, false]);
  }
  return true;
}
export const lineRecorded = (data: Dataset, task: LineTask, step: string) => {
  const s = lineStore(data), id = task.records[step]; return !!s && !!id && lineReceiptCurrent(s, id);
};
export function lineLinkCurrent(model: SecurityModel, id: string): boolean {
  const s = lineStore({ securityModel: model }), l = s?.links.find(l => l.relationRef === id);
  return !l || !!s && lineReceiptCurrent(s, l.receiptRef);
}
export function lineFactCurrent(model: SecurityModel, fact: AccessFact): boolean {
  const s = lineStore({ securityModel: model }), p = s?.proofs.find(p => p.factRef === fact.id);
  if(s?.tasks.some(t=>t.cutover?.phase==='requested'&&t.sourceSessionRef&&fact.requiredRefs.includes(t.sourceSessionRef)))return false;
  if (!p) return true; const t = s?.tasks.find(t => t.id === p.taskRef);
  return !!s && !!t && t.cutover?.phase === 'applied' && t.cutover.epoch === p.epoch && lineReceiptCurrent(s, p.receiptRef);
}
export function lineMoveReady(data: Dataset, task: LineTask): boolean {
  if (data.version !== 2 || !lineDeviceContextCurrent(data, task) || task.cutover?.phase !== 'applied' || !task.newDeviceRef || !task.accountRef || !task.recoveryMailRef || !task.destinationAppRef || !task.destinationSessionRef) return false;
  const refs = [task.newDeviceRef, task.accountRef, task.destinationAppRef, task.destinationSessionRef,task.recoveryMailRef];
  if (refs.some(id => ['lost', 'unavailable', 'revoked', 'deleted', 'retired', 'transferred'].includes(data.securityModel.lifecycle[id]?.state ?? ''))) return false;
  const records = ['new-account', 'data-read', 'future-access', 'old-session'];
  return records.every(id => lineRecorded(data, task, id)) && refs.every(id => {
    const reset = data.securityModel.lifecycle[id]?.accessResetAt;
    return !reset || records.every(step => Date.parse(lineStore(data)!.receipts.find(r => r.id === task.records[step])!.at) > Date.parse(reset));
  });
}
export function phoneInventory(data: Dataset, phoneRef: string) {
  if (data.version !== 2) return; const p = data.deviceWorkflows.find(w => w.id === phoneRef);
  return p && lineStore(data)?.inventories.find(i => i.phoneRef === phoneRef && i.oldDeviceRef === p.oldDeviceRef && i.newDeviceRef === p.newDeviceRef && i.oldOS === linePhoneOS(data, p.oldDeviceRef) && i.newOS === (p.newDeviceRef ? linePhoneOS(data, p.newDeviceRef) : undefined));
}
export function unmatchedLineApps(data: Dataset, phoneRef: string) {
  const i = phoneInventory(data, phoneRef); if (data.version !== 2 || !i) return [];
  return data.securityModel.entities.filter(e => e.kind === 'installation' && e.productId === 'line' && e.deviceRef === i.oldDeviceRef && !['deleted','revoked','retired','transferred'].includes(data.securityModel.lifecycle[e.id]?.state ?? '')).filter(app => {
    const sessions = data.securityModel.entities.filter(e => e.kind === 'session' && e.installationRef === app.id);
    if (sessions.length && sessions.every(e => ['revoked','deleted','retired'].includes(data.securityModel.lifecycle[e.id]?.state ?? ''))) return false;
    return !i.items.some(x => !x.withdrawnAt && x.product === 'line' && lineTask(data,x.taskRef)?.sourceAppRef === app.id && lineMoveReady(data,lineTask(data,x.taskRef)!));
  });
}
export function phoneProductsReady(data: Dataset, phoneRef: string): boolean {
  const i = phoneInventory(data, phoneRef); if (!i?.reviewedAt) return false;
  if (unmatchedLineApps(data,phoneRef).length) return false;
  return i.items.filter(x => !x.withdrawnAt).every(x => { const t = lineTask(data, x.taskRef); return x.product === 'line' && !!t && lineMoveReady(data, t); });
}
export function lineDependencyCurrent(model:SecurityModel,id:string):boolean{
  if(!lineLinkCurrent(model,id))return false;const store=lineStore({securityModel:model});if(!store?.links.some(l=>l.relationRef===id))return true;
  const r=model.relations.find(r=>r.id===id);if(!r)return false;
  return [r.fromRef,r.toRef].every(ref=>!['revoked','deleted','retired','transferred','unavailable','lost'].includes(model.lifecycle[ref]?.state??'')&&!store.tasks.some(t=>t.cutover?.phase==='requested'&&t.sourceSessionRef===ref));
}
