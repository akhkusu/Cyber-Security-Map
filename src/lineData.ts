import {startLineAccess} from './lineAccessData';
import { DataUpgradeConflict, makeAsset, upgradeDataset, type Dataset, type CurrentDataset, type Asset } from './models';
import { securityEntitySchema, type SecurityEntity, type SecurityRelation } from './securityModel';
import { lineStore, lineStoreSchema, lineTaskSchema, lineRecorded, phoneInventory, linePhoneOS, type LineStore, type LineTask, type LineReceipt, type PhoneProduct } from './lineSchemas';

export function writableLine(data: Dataset): CurrentDataset {
  const next = upgradeDataset(data), m = next.securityModel;
  if (m.revision < 13 && Object.hasOwn(m, 'linePhoneV1') || m.revision >= 13 && Object.hasOwn(m, 'linePhoneV1') && !lineStoreSchema.safeParse(m.linePhoneV1).success) throw new DataUpgradeConflict();
  return { ...next, securityModel: { ...m, revision: m.revision >= 13 ? m.revision : 13 } };
}
export const lineStoreFor = (data: CurrentDataset): LineStore => lineStore(data) ?? lineStoreSchema.parse({ version: 1 });
export const putLineStore = (data: CurrentDataset, store: LineStore): CurrentDataset => ({ ...data, securityModel: { ...data.securityModel, revision: data.securityModel.revision >= 13 ? data.securityModel.revision : 13, linePhoneV1: store } });
export function updateLineTask(data: CurrentDataset, task: LineTask): CurrentDataset {
  const s = lineStoreFor(data); return putLineStore(data, { ...s, tasks: s.tasks.map(t => t.id === task.id ? task : t) });
}
export const lineApp = (data: CurrentDataset, id?: string) => data.securityModel.entities.find((e): e is Extract<SecurityEntity, { kind: 'installation' }> => e.id === id && e.kind === 'installation' && e.productId === 'line');
export const hasLineOnPhone = (data: Dataset, ref?: string) => data.version === 2 && !!ref && data.securityModel.entities.some(e => e.kind === 'installation' && e.productId === 'line' && e.deviceRef === ref && !['revoked', 'deleted', 'retired', 'transferred'].includes(data.securityModel.lifecycle[e.id]?.state ?? '') && !data.securityModel.entities.some(s => s.kind === 'session' && s.installationRef === e.id && ['revoked', 'deleted', 'retired'].includes(data.securityModel.lifecycle[s.id]?.state ?? '')));
export function startPhoneProducts(data: Dataset, phoneRef: string, at = new Date().toISOString()) {
  let next = writableLine(data), s = lineStoreFor(next); const phone = next.deviceWorkflows.find(w => w.id === phoneRef);
  if (!phone?.oldDeviceRef || !next.assets.some(a => a.id === phone.oldDeviceRef && a.kind === 'device')) throw new Error('missing-phone-product-source');
  let inventory = phoneInventory(next,phoneRef);
  if (!inventory && phone.newDeviceRef) {
    const prepared = s.inventories.find(i => i.phoneRef === phoneRef && i.oldDeviceRef === phone.oldDeviceRef && i.oldOS === linePhoneOS(next,phone.oldDeviceRef) && !i.newDeviceRef && i.items.every(x => !x.taskRef || !s.tasks.find(t => t.id === x.taskRef)?.cutover));
    if (prepared) {
      inventory = { ...prepared, newDeviceRef: phone.newDeviceRef, newOS: linePhoneOS(next,phone.newDeviceRef), updatedAt: at };
      s = { ...s, inventories: s.inventories.map(i => i.id === prepared.id ? inventory! : i), tasks: s.tasks.map(t => prepared.items.some(x => x.taskRef === t.id) ? { ...t, newDeviceRef: phone.newDeviceRef, newOS: inventory!.newOS, status: 'active', cursor: '', history: [], updatedAt: at } : t) };
    }
  }
  if (!inventory) {
    inventory = { id: crypto.randomUUID(), phoneRef, oldDeviceRef: phone.oldDeviceRef, newDeviceRef: phone.newDeviceRef, oldOS: linePhoneOS(next,phone.oldDeviceRef), newOS: phone.newDeviceRef ? linePhoneOS(next,phone.newDeviceRef) : undefined, items: [], createdAt: at, updatedAt: at };
    s = { ...s, inventories: [...s.inventories, inventory] };
  }
  next = putLineStore(next, s);
  if (hasLineOnPhone(next, phone.oldDeviceRef) && !inventory.items.some(x => !x.withdrawnAt && x.product === 'line')) next = addPhoneProduct(next, inventory.id, 'line', at);
  return { data: next, id: inventory.id };
}
export function addPhoneProduct(data: Dataset, inventoryRef: string, product: PhoneProduct, at = new Date().toISOString()): CurrentDataset {
  const next = writableLine(data), s = lineStoreFor(next), i = s.inventories.find(i => i.id === inventoryRef), phone = next.deviceWorkflows.find(w => w.id === i?.phoneRef);
  if (!i || !phone || phoneInventory(next,phone.id)?.id !== i.id) throw new Error('phone-product-context-changed');
  const taskRef = product === 'line' ? crypto.randomUUID() : undefined, item = { id: crypto.randomUUID(), product, taskRef };
  const t = taskRef ? lineTaskSchema.parse({ id: taskRef, phoneRef: i.phoneRef, inventoryRef: i.id, itemRef: item.id, oldDeviceRef: i.oldDeviceRef, newDeviceRef: i.newDeviceRef, oldOS:i.oldOS, newOS:i.newOS, createdAt: at, updatedAt: at }) : undefined;
  const saved=putLineStore(next, { ...s, inventories: s.inventories.map(v => v.id === i.id ? { ...v, reviewedAt: undefined, updatedAt: at, items: [...v.items, item] } : v), tasks: t ? [...s.tasks, t] : s.tasks });
  return taskRef?startLineAccess(saved,taskRef,at):saved;
}
export function reviewPhoneProducts(data: Dataset, id: string, at = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data; const s = lineStore(data), i = s?.inventories.find(i => i.id === id);
  if (!s || !i) return data;
  return putLineStore(data, { ...s, inventories: s.inventories.map(v => v.id === id ? { ...v, reviewedAt: at, updatedAt: at } : v) });
}
export function withdrawPhoneProduct(data: Dataset, inventoryRef: string, itemRef: string, at = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data; const s = lineStore(data), i = s?.inventories.find(i => i.id === inventoryRef), item = i?.items.find(x => x.id === itemRef), t = s?.tasks.find(t => t.id === item?.taskRef);
  if (!s || !i || !item || t && (t.sourceAppRef || t.cutover)) return data;
  return putLineStore(data, { ...s, inventories: s.inventories.map(v => v.id === i.id ? { ...v, updatedAt: at, reviewedAt: undefined, items: v.items.map(x => x.id === itemRef ? { ...x, withdrawnAt: at } : x) } : v) });
}
export function putLineEntity(data: CurrentDataset, entity: SecurityEntity): CurrentDataset {
  return { ...data, securityModel: { ...data.securityModel, entities: [...data.securityModel.entities.filter(e => e.id !== entity.id), entity] } };
}
export function lineLink(data: CurrentDataset, receipt: LineReceipt, fromRef: string, toRef: string, kind: SecurityRelation['kind'], sources: string[]): CurrentDataset {
  const id = crypto.randomUUID(), s = lineStoreFor(data);
  const r: SecurityRelation = { id, fromRef, toRef, kind, evidence: 'user-confirmed', checkedAt: receipt.at, sourceIds: sources };
  return putLineStore({ ...data, securityModel: { ...data.securityModel, relations: [...data.securityModel.relations, r] } }, { ...s, links: [...s.links, { relationRef: id, receiptRef: receipt.id }] });
}
export const lineAccountCandidate = (data: CurrentDataset, a: Asset) => a.kind === 'account' && (a.provider === 'line' || (!a.provider || a.provider === 'other') && !a.services.length && ['Messaging','Account','LINE'].includes(a.type) && a.id!==data.guide.accountId && a.id!==data.guide.managerId);
export function createLineAccount(data: CurrentDataset, at: string) {
  const account = { ...makeAsset({ kind: 'account', type: 'Messaging', name: `LINE ${data.assets.filter(a => a.provider === 'line').length + 1}`, importance: 'important' }), provider: 'line' as const, purpose: 'personal' as const, createdAt: at, updatedAt: at };
  return { data: { ...data, assets: [...data.assets, account] }, id: account.id };
}
export function ensureLineApp(data: CurrentDataset, deviceRef: string, accountRef: string, candidateRef: string | undefined, at: string, forceNew=false) {
  let app = lineApp(data, candidateRef);
  if (app && (app.deviceRef !== deviceRef || typeof app.lineAccountRefV1 === 'string' && app.lineAccountRefV1 !== accountRef)) throw new Error('wrong-line-app');
  if (!app && !forceNew) app = data.securityModel.entities.find((e): e is NonNullable<typeof app> => e.kind === 'installation' && e.productId === 'line' && e.deviceRef === deviceRef && e.lineAccountRefV1 === accountRef);
  app = securityEntitySchema.parse(app ? { ...app, lineAccountRefV1: accountRef } : { id: crypto.randomUUID(), kind: 'installation', productId: 'line', deviceRef, lineAccountRefV1: accountRef, label: `LINE · ${data.assets.find(d => d.id === deviceRef)?.name ?? 'Phone'}`.slice(0, 80), createdAt: at }) as NonNullable<typeof app>;
  return { data: putLineEntity(data, app), appRef: app.id };
}
export function lineSession(data: CurrentDataset, appRef: string, accountRef: string, at: string) {
  const app = lineApp(data, appRef)!;
  const previous = data.securityModel.entities.find(e => e.kind === 'session' && e.installationRef === appRef && e.accountRef === accountRef && e.lineSessionV1 === 1 && !['revoked', 'deleted', 'retired', 'unavailable'].includes(data.securityModel.lifecycle[e.id]?.state ?? ''));
  const entity = previous ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'session', accountRef, installationRef: appRef, deviceRef: app.deviceRef, lineSessionV1: 1, label: data.settings.language==='ja'?'LINE · メイン端末のログイン':'LINE · main-device session', createdAt: at });
  return { data: putLineEntity(data, entity), sessionRef: entity.id };
}
export function recordLineSource(data: CurrentDataset, task: LineTask, receipt: LineReceipt) {
  if (!task.accountRef) throw new Error('missing-line-account');
  const app = ensureLineApp(data, task.oldDeviceRef, task.accountRef!, task.answers['source-app']?.startsWith('app:') ? task.answers['source-app'].slice(4) : task.answers['source-app']==='new'?undefined:task.sourceAppRef, receipt.at, task.answers['source-app']==='new');
  const session = lineSession(app.data, app.appRef, task.accountRef, receipt.at); let next = session.data;
  task = { ...task, sourceAppRef: app.appRef, sourceSessionRef: session.sessionRef };
  next = updateLineTask(next, task);
  for (const [a, b, kind] of [[app.appRef, task.oldDeviceRef, 'installed-on'], [session.sessionRef, task.accountRef!, 'session-for'], [session.sessionRef, app.appRef, 'stored-in']] as const) next = lineLink(next, receipt, a, b, kind, ['lineQr', 'lineDevices']);
  return { data: next, task };
}
export function applyLineCutover(data: CurrentDataset, task: LineTask, at: string) {
  if (!task.cutover || !task.accountRef || !task.newDeviceRef) throw new Error('missing-line-cutover');
  // The already-used destination route may have no pre-transfer source receipt.
  // End only a previously recorded main session for this exact account and old phone.
  const knownOldSessions = data.securityModel.entities.filter(e => e.kind === 'session' && (e.lineSessionV1 === 1 || e.installationRef === task.sourceAppRef) && e.accountRef === task.accountRef && e.deviceRef === task.oldDeviceRef && data.securityModel.entities.some(app => app.id === e.installationRef && app.kind === 'installation' && app.productId === 'line' && app.lineAccountRefV1 === task.accountRef));
  const app = ensureLineApp(data, task.newDeviceRef, task.accountRef, task.destinationAppRef, at), session = lineSession(app.data, app.appRef, task.accountRef, at);
  task = { ...task, destinationAppRef: app.appRef, destinationSessionRef: session.sessionRef, cutover: { ...task.cutover, phase: 'applied', appliedAt: task.cutover.appliedAt ?? at } };
  let next = updateLineTask(session.data, task);
  for (const id of new Set([task.sourceSessionRef,...knownOldSessions.map(e=>e.id)].filter((v):v is string=>!!v))) {
    if (['revoked','deleted','retired'].includes(next.securityModel.lifecycle[id]?.state ?? '')) continue;
    next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [id]: { ...next.securityModel.lifecycle[id], state: 'revoked', evidence: 'user-confirmed', updatedAt: task.cutover!.appliedAt ?? at, accessResetAt: task.cutover!.appliedAt ?? at } } } };
  }
  return { data: next, task };
}
export function recordLineUse(data: CurrentDataset, task: LineTask, receipt: LineReceipt, kind: 'sign-in' | 'read') {
  const binding=kind==='sign-in'&&task.answers['key-login:result']==='passkey'&&lineRecorded(data,task,'key-login:result')?task.cutover?.passkeyBinding:undefined;
  const s = lineStoreFor(data), refs = [task.accountRef!, task.newDeviceRef!, task.destinationAppRef!, task.destinationSessionRef!,...(binding?[binding.keyRef,binding.storeRef,binding.rootRef,binding.appRef]:[])];
  const factRef = crypto.randomUUID(), routeRef = crypto.randomUUID();
  let next: CurrentDataset = { ...data, securityModel: { ...data.securityModel, facts: [...data.securityModel.facts, { id: factRef, label: data.settings.language==='ja' ? kind==='read'?'新端末で選んだLINE履歴を確認':'新端末で既存のLINEを利用' : kind === 'read' ? 'Selected LINE history read on new phone' : 'Existing LINE account open on new phone', state: 'available', evidence: 'user-confirmed', checkedAt: receipt.at, requiredRefs: refs, contexts: ['new-device'], ...(binding?{linePasskeyUseV1:binding.keyRef}:{}),sourceIds: [task.cutover?.passkeyBinding?'linePasskeyMove':'lineQr', 'lineData'] }], routes: [...data.securityModel.routes, { id: routeRef, label: data.settings.language==='ja'?'LINE · 新端末での現在の利用':'LINE · current new-phone session', targetRef: kind === 'read' ? task.dataRef! : task.accountRef!, purpose: kind === 'read' ? 'decrypt' : 'sign-in', contexts: ['new-device'], requirements: { kind: 'fact', factId: factRef }, sourceIds: ['lineQr', 'lineData'] }] } };
  next = putLineStore(next, { ...s, proofs: [...s.proofs, { factRef, receiptRef: receipt.id, taskRef: task.id, epoch: task.cutover!.epoch, kind }] });
  if (kind === 'sign-in') {
    next = lineLink(next, receipt, task.destinationAppRef!, task.newDeviceRef!, 'installed-on', ['lineQr']);
    next = lineLink(next, receipt, task.destinationSessionRef!, task.accountRef!, 'session-for', ['lineQr']);
    next = lineLink(next, receipt, task.destinationSessionRef!, task.destinationAppRef!, 'stored-in', ['lineQr']);
  } else next = lineLink(next, receipt, task.dataRef!, task.destinationAppRef!, 'stored-in', ['lineData']);
  return next;
}
export const linePrepared = (data: Dataset, task: LineTask) => ['source-account', 'future-access', 'coverage', 'backup-result'].every(id => lineRecorded(data, task, id));

export function reopenPhoneProducts(data: Dataset, id: string): Dataset {
  if(data.version!==2)return data;const s=lineStore(data);if(!s)return data;return putLineStore(data,{...s,inventories:s.inventories.map(i=>i.id===id?{...i,reviewedAt:undefined}:i)});
}
