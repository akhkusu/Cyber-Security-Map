import type { CurrentDataset } from './models';
import { lineStoreSchema } from './lineSchemas';

export function lineIssues(data: Pick<CurrentDataset, 'assets' | 'securityModel' | 'deviceWorkflows'>): string[] {
  const m = data.securityModel;
  if (m.revision < 13) return data.assets.some(a => a.provider === 'line') ? ['line-requires-model-13'] : [];
  if (!Object.hasOwn(m, 'linePhoneV1')) return data.assets.some(a => a.provider === 'line') ? ['missing-line-store'] : [];
  const p = lineStoreSchema.safeParse(m.linePhoneV1); if (!p.success) return ['invalid-line-store'];
  const s = p.data, refs = new Set([...data.assets, ...m.entities].map(e => e.id)), ids = new Set<string>();
  for (const id of [...s.inventories.map(i => i.id), ...s.inventories.flatMap(i => i.items.map(x => x.id)), ...s.tasks.map(t => t.id), ...s.receipts.map(r => r.id)]) { if (ids.has(id) || refs.has(id)) return ['duplicate-line-record']; ids.add(id); }
  const device = (id?: string) => !!id && data.assets.some(a => a.id === id && a.kind === 'device');
  const account = (id?: string) => !!id && data.assets.some(a => a.id === id && a.kind === 'account' && a.provider === 'line');
  const app = (id: string | undefined, deviceRef: string | undefined, accountRef: string | undefined) => { const e = m.entities.find(e => e.id === id); return e?.kind === 'installation' && e.productId === 'line' && e.deviceRef === deviceRef && e.lineAccountRefV1 === accountRef; };
  const session = (id: string | undefined, appRef: string | undefined, accountRef: string | undefined) => { const e = m.entities.find(e => e.id === id); return e?.kind === 'session' && e.installationRef === appRef && e.accountRef === accountRef; };
  for (const i of s.inventories) {
    if (!data.deviceWorkflows.some(w => w.id === i.phoneRef) || !device(i.oldDeviceRef) || i.newDeviceRef && (!device(i.newDeviceRef) || i.oldDeviceRef === i.newDeviceRef)) return ['invalid-phone-inventory'];
    for (const item of i.items) if (item.taskRef && !s.tasks.some(t => t.id === item.taskRef && t.itemRef === item.id && t.inventoryRef === i.id && t.phoneRef === i.phoneRef && item.product === 'line')) return ['invalid-phone-product-task'];
  }
  for (const t of s.tasks) {
    const i = s.inventories.find(i => i.id === t.inventoryRef);
    if (!i || !i.items.some(x => x.id === t.itemRef && x.taskRef === t.id) || !device(t.oldDeviceRef) || t.newDeviceRef && (!device(t.newDeviceRef) || t.newDeviceRef === t.oldDeviceRef) || t.oldDeviceRef !== i.oldDeviceRef || t.newDeviceRef !== i.newDeviceRef || t.oldOS!==i.oldOS || t.newOS!==i.newOS || t.accountRef && !account(t.accountRef) || t.recoveryMailRef&&!data.assets.some(a=>a.id===t.recoveryMailRef&&a.kind==='account'&&a.provider!=='line')) return ['invalid-line-task-scope'];
    if (t.sourceAppRef && !app(t.sourceAppRef, t.oldDeviceRef, t.accountRef) || t.destinationAppRef && !app(t.destinationAppRef, t.newDeviceRef, t.accountRef) || t.sourceSessionRef && !session(t.sourceSessionRef, t.sourceAppRef, t.accountRef) || t.destinationSessionRef && !session(t.destinationSessionRef, t.destinationAppRef, t.accountRef)) return ['invalid-line-app-session'];
    for (const id of [t.dataRef, t.backupRef]) { const e = m.entities.find(e => e.id === id); if (id && (e?.kind !== 'data-set' || e.dataType !== 'messages' || e.ownerRef !== t.accountRef)) return ['invalid-line-data']; }
    if (Object.entries(t.records).some(([stepId, id]) => !s.receipts.some(r => r.id === id && r.taskRef === t.id && r.stepId === stepId))) return ['invalid-line-receipt-owner'];
    if (t.cutover && !t.newDeviceRef || t.cutover?.phase === 'applied' && (!t.cutover.appliedAt || !t.destinationAppRef || !t.destinationSessionRef)) return ['invalid-line-cutover'];
  }
  for (const r of s.receipts) if (!s.tasks.some(t => t.id === r.taskRef) || r.refs.some(ref => !refs.has(ref)) || r.requires.some(id => !s.receipts.some(other => other.id === id && other.taskRef === r.taskRef))) return ['invalid-line-receipt'];
  if (s.links.some(l => !m.relations.some(r => r.id === l.relationRef) || !s.receipts.some(r => r.id === l.receiptRef))) return ['invalid-line-link'];
  for (const proof of s.proofs) {
    const t = s.tasks.find(t => t.id === proof.taskRef), f = m.facts.find(f => f.id === proof.factRef);
    if (!t || !f || !s.receipts.some(r => r.id === proof.receiptRef && r.taskRef === t.id) || ![t.accountRef, t.newDeviceRef, t.destinationAppRef, t.destinationSessionRef].every(ref => !!ref && f.requiredRefs.includes(ref))) return ['invalid-line-proof'];
  }
  return [];
}
