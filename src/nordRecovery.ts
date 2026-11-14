import { DataUpgradeConflict, makeAsset, upgradeDataset, type CurrentDataset, type Dataset, type Language } from './models';
import { recordControl, undoControl } from './controlRecords';
import { cloudAnswer, cloudInstallation, cloudVault, chooseCloudDevice, selectedCloudInstallation, setCloudAnswer } from './cloudManagers';
import { securityEntitySchema, type AccessFact } from './securityModel';
import { nordRecoveryApplied, nordRecoveryStoreSchema, nordRecoveryStale, nordRecoveryTasks, nordRecoveryTaskSchema, type NordRecoveryTask } from './nordRecoverySchemas';
import { nordBiometricEligible, nordRecoverySteps, type NordStep } from './nordRecoveryCatalog';
import { confirmPhoneStep, jumpPhoneStep, phoneRecordKey, phoneStepBlockers, undoPhoneRecord } from './phoneEngine';
import { phoneSteps } from './phoneCatalog';

const label = (data: Dataset, en: string, ja: string) => data.settings.language === 'ja' ? ja : en;
const timeAfter = (data: CurrentDataset, now: string) => new Date(Math.max(Date.parse(now), ...Object.values(data.securityModel.lifecycle).map(l => Date.parse(l.accessResetAt ?? '1970-01-01T00:00:00Z') + 1))).toISOString();
const snapshot = (w: CurrentDataset['deviceWorkflows'][number]) => JSON.stringify([w.oldDeviceRef, w.newDeviceRef, w.answers, w.cursor]);
function write(data: CurrentDataset, task: NordRecoveryTask): CurrentDataset {
  const parsed = nordRecoveryStoreSchema.safeParse(data.securityModel.nordRecoveryV1);
  const store = parsed.success ? parsed.data : { version: 1 as const, tasks: [] };
  return { ...data, securityModel: { ...data.securityModel, revision: 4, nordRecoveryV1: { ...store, tasks: [...store.tasks.filter(t => t.id !== task.id), task] } } };
}
export function startNordRecovery(data: Dataset, appId: string, returnTo: string = '/guide', phoneId?: string, now = new Date().toISOString()): CurrentDataset {
  let next = upgradeDataset(data);
  if ((next.securityModel.revision < 4 && Object.hasOwn(next.securityModel, 'nordRecoveryV1')) || (next.securityModel.revision >= 4 && Object.hasOwn(next.securityModel, 'nordRecoveryV1') && !nordRecoveryStoreSchema.safeParse(next.securityModel.nordRecoveryV1).success)) throw new DataUpgradeConflict();
  if (next.securityModel.revision < 4 && [...next.securityModel.entities, ...next.securityModel.facts, ...next.securityModel.relations, ...next.securityModel.routes].some(record => Object.keys(record).some(key => key.startsWith('nordRecovery')))) throw new DataUpgradeConflict();
  const app = cloudInstallation(next, appId), vault = cloudVault(next, app?.vaultRef), root = next.assets.find(a => a.id === vault?.authenticationAccountRef);
  if (!app || vault?.productId !== 'nordpass' || root?.purpose !== 'personal' || vault.storageMode !== 'account' || !/^\/(guide|map|phone\/[^?#]+)$/.test(returnTo)) return next;
  const existing = nordRecoveryTasks(next).find(t => t.targetRef === app.id && !nordRecoveryStale(next, t) && t.status !== 'completed' && t.status !== 'cancelled' && (!phoneId || t.originPhone?.id === phoneId));
  if (existing) return write(next, { ...existing, status: 'active' });
  const phone = phoneId ? next.deviceWorkflows.find(w => w.id === phoneId) : undefined;
  const task = nordRecoveryTaskSchema.parse({ id: crypto.randomUUID(), vaultRef: vault.id, rootRef: root.id, targetRef: app.id, returnTo, originGuideCursor: data.guide.cursor, masterRequestRef: cloudAnswer(data, vault.id, 'master-request'), ...(phone ? { originPhone: { id: phone.id, cursor: phone.cursor, snapshot: snapshot(phone) } } : {}), createdAt: now, updatedAt: now });
  return write(next, task);
}
export function startPhoneNordRecovery(data: Dataset, phoneId: string, vaultId: string): CurrentDataset {
  let next = upgradeDataset(data); const w = next.deviceWorkflows.find(w => w.id === phoneId), vault = cloudVault(next, vaultId);
  if (!w?.newDeviceRef || vault?.productId !== 'nordpass' || w.answers[`cloud-use:${vaultId}`] !== 'new') return next;
  const selected = cloudInstallation(next, w.answers[`cloud-destination:${vaultId}`]);
  const prepared = chooseCloudDevice(next, vaultId, w.newDeviceRef, selected?.deviceRef === w.newDeviceRef && selected.vaultRef === vaultId ? selected.id : undefined);
  const app = selectedCloudInstallation(prepared, vaultId);
  if (!app || prepared.version !== 2) return next;
  next = { ...prepared, guide: data.guide, deviceWorkflows: prepared.deviceWorkflows.map(p => p.id === phoneId ? { ...p, answers: { ...p.answers, [`cloud-destination:${vaultId}`]: app.id } } : p) };
  next = setCloudAnswer(next, app.id, 'usage', 'existing') as CurrentDataset;
  next = setCloudAnswer(next, app.id, 'account', 'existing') as CurrentDataset;
  const version = w.answers['cloud-phone-version'];
  if (version) next = setCloudAnswer(next, app.id, next.assets.find(a => a.id === app.deviceRef)?.operatingSystem === 'ios' ? 'ios' : 'android', version) as CurrentDataset;
  return startNordRecovery(next, app.id, `/phone/${phoneId}`, phoneId);
}
export function currentNordStep(data: Dataset, task: NordRecoveryTask): NordStep | undefined {
  const steps = nordRecoverySteps(data, task), index = steps.findIndex(s => s.id === task.cursor);
  const end = index < 0 ? steps.length - 1 : index;
  // A route or stale cursor cannot skip unrecorded preparation or a question.
  for (const s of steps.slice(0, end)) if (s.kind === 'blocked' || (s.kind === 'question' ? !task.answers[s.id] : s.kind !== 'finished' && !task.records[s.id])) return s;
  return steps[end];
}
function advance(data: CurrentDataset, task: NordRecoveryTask, previous: string, now: string) {
  const steps = nordRecoverySteps(data, task), index = steps.findIndex(s => s.id === previous);
  const removedNext: Record<string, string> = { 'bio-code': 'code-copy', 'backup-code': 'backup-copy', apply: 'master-test', 'target-version': 'method', source: 'bio-open', 'source-surface': 'bio-open' };
  const cursor = index < 0 ? (removedNext[previous] ?? (nordRecoveryApplied(task) ? 'master-test' : task.sourceRef ? 'bio-open' : 'method')) : steps[index + 1]?.id ?? previous;
  return write(data, { ...task, cursor, status: cursor === 'finished' ? 'completed' : 'active', history: [...task.history, previous], updatedAt: now });
}
export function answerNordRecovery(data: Dataset, taskId: string, value: string, now = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data;
  let task = nordRecoveryTasks(data).find(t => t.id === taskId), next = data;
  const step = task && currentNordStep(data, task);
  if (!task || step?.kind !== 'question' || !step.choicesNord?.some(o => o.value === value)) return data;
  task = { ...task, answers: { ...task.answers, [step.id]: value } };
  if (step.id === 'target-version') {
    const app = cloudInstallation(next, task.targetRef)!;
    next = setCloudAnswer(next, app.id, next.assets.find(a => a.id === app.deviceRef)?.operatingSystem === 'ios' ? 'ios' : 'android', value) as CurrentDataset;
  }
  if (step.id === 'source' && value.startsWith('app:')) {
    const app = cloudInstallation(data, value.slice(4)); if (!app || app.vaultRef !== task.vaultRef || !nordBiometricEligible(data, app.id)) return data;
    task = { ...task, sourceRef: app.id, sourceDeviceRef: app.deviceRef };
  }
  if (step.id === 'source-device') {
    let ref = value.slice(value.indexOf(':') + 1);
    if (value.startsWith('new:')) {
      const os = ref as 'ios' | 'android' | 'windows' | 'macos';
      const device = makeAsset({ kind: 'device', type: ['ios', 'android'].includes(os) ? 'Smartphone' : 'Computer', name: `NordPass · ${os} ${next.assets.filter(a => a.kind === 'device').length + 1}`, importance: 'critical', operatingSystem: os });
      next = { ...next, assets: [...next.assets, device] }; ref = device.id;
    }
    task = { ...task, sourceDeviceRef: ref };
  }
  if (step.id === 'source-surface' && task.sourceDeviceRef) {
    const prepared = chooseCloudDevice(next, task.vaultRef, task.sourceDeviceRef), app = selectedCloudInstallation(prepared, task.vaultRef)!;
    if (prepared.version !== 2 || !app) return data;
    next = { ...prepared, guide: data.guide, securityModel: { ...prepared.securityModel, entities: prepared.securityModel.entities.map(e => e.id === app.id ? { ...e, ...(value === 'native' ? { nordRecoverySurface: 'native-v1' } : { profileLabel: `Recovery profile ${prepared.securityModel.entities.filter(e => e.kind === 'installation' && e.deviceRef === task!.sourceDeviceRef).length}`, cloudSettings: { ...(typeof e.cloudSettings === 'object' ? e.cloudSettings : {}), browser: value } }) } : e) } };
    task = { ...task, sourceRef: app.id };
  }
  return advance(next, task, step.id, now);
}
function putEntity(data: CurrentDataset, value: unknown) {
  const entity = securityEntitySchema.parse(value);
  return { ...data, securityModel: { ...data.securityModel, entities: [...data.securityModel.entities.filter(e => e.id !== entity.id), entity] } };
}
function codeEntity(data: CurrentDataset, task: NordRecoveryTask, suffix: string, now: string) {
  const ref = `${task.id}:code:${suffix}`;
  const next = putEntity(data, { id: ref, kind: 'credential', credentialType: 'recovery-code', label: label(data, 'NordPass vault Recovery Code (value not stored)', 'NordPass保管庫の復旧コード（値は保存しません）'), subjectRef: task.vaultRef, roles: ['restore'], createdAt: now, nordRecoveryCredential: 'v1', nordRecoveryTaskRef: task.id });
  return { next, ref };
}
function resetAccess(data: CurrentDataset, refs: string[], now: string, revoked = false): CurrentDataset {
  const lifecycle = { ...data.securityModel.lifecycle };
  for (const ref of refs) { const previous = lifecycle[ref]; lifecycle[ref] = { ...previous, state: revoked && !['deleted', 'retired', 'transferred'].includes(previous?.state ?? '') ? 'revoked' : previous?.state ?? 'unknown', evidence: revoked && !['deleted', 'retired', 'transferred'].includes(previous?.state ?? '') ? 'user-confirmed' : previous?.evidence ?? 'unknown', updatedAt: revoked && !['deleted', 'retired', 'transferred'].includes(previous?.state ?? '') ? now : previous?.updatedAt ?? now, accessResetAt: now }; }
  return { ...data, securityModel: { ...data.securityModel, lifecycle } };
}
function replaceCode(data: CurrentDataset, task: NordRecoveryTask, suffix: string, now: string) {
  // Only our marked credentials or the exact old cloud-recovery relationship
  // are recognized. Account MFA backup codes and opaque imported fields are not.
  const stores = new Set(data.securityModel.entities.filter(e => e.kind === 'vault' && e.productId === 'nordpass' && e.authenticationAccountRef === task.rootRef).map(e => e.id));
  const revoked = data.securityModel.entities.filter(e => e.kind === 'credential' && e.credentialType === 'recovery-code' && stores.has(e.subjectRef) && (e.nordRecoveryCredential === 'v1' || (e.cloudRecoveryPhase === 'cloud-recovery' && data.securityModel.relations.some(r => r.fromRef === e.id && r.toRef === e.subjectRef && r.id.endsWith(':cloud:recovery') && r.sourceIds.includes('nordRecovery'))))).map(e => e.id);
  const made = codeEntity(resetAccess(data, revoked, now, true), task, suffix, now);
  return { next: made.next, task: { ...task, currentCodeRef: made.ref, mutations: { ...task.mutations, [suffix]: { kind: 'code' as const, ref: made.ref, at: now, sourceRef: suffix === 'bio-code' ? task.sourceRef : task.targetRef } } } };
}
function observe(data: CurrentDataset, task: NordRecoveryTask, step: NordStep, refs: string[], now: string, purpose: string, routePurpose?: 'decrypt' | 'restore'): CurrentDataset {
  const id = `${task.id}:fact:${step.id}`, fact: AccessFact = { id, label: step.title.en.slice(0, 80), state: 'available', evidence: 'user-confirmed', checkedAt: now, requiredRefs: refs, contexts: task.originPhone ? ['new-device', 'normal'] : ['normal'], dependencyCompleteness: 'partial', sourceIds: step.sources, nordRecoveryEvidence: 'v1', nordRecoveryTaskRef: task.id, nordRecoveryPurpose: purpose };
  if (step.id === 'master-test') Object.assign(fact, { observedWithoutRefs: data.securityModel.entities.filter(e => e.kind === 'credential' && e.subjectRef === task.vaultRef && e.credentialType === 'recovery-code' && (e.nordRecoveryCredential === 'v1' || e.cloudRecoveryPhase === 'cloud-recovery')).map(e => e.id) });
  if (task.originPhone && step.id === 'master-test') { const old = data.deviceWorkflows.find(w => w.id === task.originPhone!.id)?.oldDeviceRef; if (old) Object.assign(fact, { cloudPhoneObservation: 'v1', observedWithoutRefs: [...(Array.isArray(fact.observedWithoutRefs) ? fact.observedWithoutRefs : []), old] }); }
  const relations = [...data.securityModel.relations];
  const edge = (suffix: string, fromRef: string, toRef: string, kind: 'installed-on' | 'decrypts' | 'stored-in' | 'recovers') => {
    const edgeId = `${task.id}:edge:${step.id}:${suffix}`, old = relations.find(r => r.id === edgeId);
    const value = { ...old, id: edgeId, fromRef, toRef, kind, evidence: 'user-confirmed' as const, checkedAt: now, sourceIds: step.sources, nordRecoveryEvidence: 'v1', nordRecoveryTaskRef: task.id, nordRecoveryStep: step.id };
    const index = relations.findIndex(r => r.id === edgeId); if (index < 0) relations.push(value); else relations[index] = value;
  };
  if (step.id === 'master-test' && task.masterRef && task.masterPaperRef) { const app = cloudInstallation(data, task.targetRef)!; edge('device', app.id, app.deviceRef, 'installed-on'); edge('master', task.masterRef, task.vaultRef, 'decrypts'); edge('paper', task.masterRef, task.masterPaperRef, 'stored-in'); }
  if (step.id === 'bio-open' && task.sourceRef) { const source = cloudInstallation(data, task.sourceRef)!; edge('device', source.id, source.deviceRef, 'installed-on'); edge('vault', source.id, task.vaultRef, 'decrypts'); }
  if (['code-copy', 'backup-copy'].includes(step.id) && task.currentCodeRef) { const code = data.securityModel.entities.find(e => e.id === task.currentCodeRef && e.kind === 'credential'); edge('recovery', task.currentCodeRef, task.vaultRef, 'recovers'); if (code?.storageRef && typeof code.storageRef === 'string') edge('paper', task.currentCodeRef, code.storageRef, 'stored-in'); }
  const routes = routePurpose ? [...data.securityModel.routes.filter(r => r.id !== `${id}:route`), { id: `${id}:route`, label: step.title.en.slice(0, 80), targetRef: task.vaultRef, purpose: routePurpose, contexts: fact.contexts, requirements: { kind: 'fact' as const, factId: id }, sourceIds: step.sources }] : data.securityModel.routes;
  return { ...data, securityModel: { ...data.securityModel, relations, facts: [...data.securityModel.facts.filter(f => f.id !== id), fact], routes } };
}
export function confirmNordRecovery(data: Dataset, taskId: string, now = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data;
  let task = nordRecoveryTasks(data).find(t => t.id === taskId), next: CurrentDataset = data;
  const step = task && currentNordStep(data, task);
  if (!task || !step || step.kind) return data;
  now = timeAfter(data, now);
  const app = cloudInstallation(data, task.targetRef)!, refs = [task.vaultRef, app.id, app.deviceRef];
  const steps = nordRecoverySteps(data, task), previous = steps.slice(0, steps.findIndex(s => s.id === step.id)).filter(s => !s.kind).map(s => s.id);
  const controls: { targetRef: string; controlId: string }[] = [];
  if (step.id === 'bio-code' && !task.mutations[step.id]) ({ next, task } = replaceCode(next, task, step.id, now));
  if (step.id === 'code-copy' && !task.currentCodeRef) {
    const made = codeEntity(next, task, 'existing', now); next = made.next; task = { ...task, initialCodeRef: made.ref, currentCodeRef: made.ref };
  }
  if (step.id === 'use-code' && task.currentCodeRef) {
    task = { ...task, usedCodeRef: task.currentCodeRef };
    next = observe(next, task, step, [...refs, task.currentCodeRef!], now, 'code-accepted', 'restore');
  }
  if (step.id === 'apply' && !nordRecoveryApplied(task)) {
    const stores = new Set(data.securityModel.entities.filter(e => e.kind === 'vault' && e.productId === 'nordpass' && e.authenticationAccountRef === task!.rootRef).map(e => e.id));
    next = resetAccess(next, next.securityModel.entities.filter(e => stores.has(e.id) || (e.kind === 'installation' && !!e.vaultRef && stores.has(e.vaultRef))).map(e => e.id), now);
    const ref = `${task.id}:master`, paperRef = `${task.id}:master-paper`;
    next = putEntity(next, { id: paperRef, kind: 'data-set', dataType: 'other', label: label(data, 'Private NordPass master paper (no secret stored)', 'NordPassマスターの私的な紙の控え'), createdAt: now, ownerRef: task.rootRef, nordRecoveryPaper: 'v1', nordRecoveryTaskRef: task.id });
    next = putEntity(next, { id: ref, kind: 'credential', credentialType: 'password', subjectRef: task.vaultRef, storageRef: paperRef, roles: ['decrypt'], label: label(data, 'Recovered NordPass Master Password (value not stored)', '復旧後のNordPassマスター（値は保存しません）'), createdAt: now, nordRecoveryCredential: 'v1', nordRecoveryTaskRef: task.id });
    task = { ...task, masterRef: ref, masterPaperRef: paperRef, mutations: { ...task.mutations, apply: { kind: 'master', ref, at: now } } };
  }
  if (step.id === 'master-test' && task.masterRef && nordRecoveryApplied(task)) {
    next = observe(next, task, step, [...refs, task.masterRef, task.masterPaperRef!], now, 'master-read', 'decrypt');
    controls.push(...['opened', 'storageChecked'].map(controlId => ({ targetRef: app.id, controlId })), { targetRef: task.vaultRef, controlId: 'masterStrength' });
  }
  if (step.id === 'backup-code' && !task.mutations[step.id]) ({ next, task } = replaceCode(next, task, step.id, now));
  if (['code-copy', 'backup-copy'].includes(step.id)) {
    if (!task.currentCodeRef) return data;
    const paperRef = `${task.id}:code-paper:${task.currentCodeRef}`;
    next = putEntity(next, { id: paperRef, kind: 'data-set', dataType: 'other', label: label(data, 'Private NordPass recovery copy (no code stored)', 'NordPass復旧コードの私的な控え'), ownerRef: task.rootRef, createdAt: now, nordRecoveryPaper: 'v1', nordRecoveryTaskRef: task.id });
    next = { ...next, securityModel: { ...next.securityModel, entities: next.securityModel.entities.map(e => e.id === task!.currentCodeRef ? { ...e, storageRef: paperRef } : e) } };
    next = observe(next, task, step, [task.vaultRef, task.currentCodeRef, paperRef], now, 'code-copy');
    if (step.id === 'backup-copy') controls.push({ targetRef: task.vaultRef, controlId: 'recovery' }, { targetRef: task.vaultRef, controlId: 'independentRoot' });
  }
  if (step.id === 'bio-open' && task.sourceRef) {
    const source = cloudInstallation(data, task.sourceRef)!;
    next = observe(next, task, step, [task.vaultRef, source.id, source.deviceRef], now, 'biometric-read', 'decrypt');
    controls.push(...['opened', 'storageChecked'].map(controlId => ({ targetRef: source.id, controlId })));
  }
  for (const control of controls) next = recordControl(next, control.targetRef, control.controlId, { id: `${task.id}:${step.id}:${control.targetRef}:${control.controlId}`, origin: `nord-recovery:${task.id}`, titleEn: step.title.en, titleJa: step.title.ja, nordRecoveryTaskRef: task.id, requiredNordRecoveryRecords: previous }, now) as CurrentDataset;
  task = { ...task, records: { ...task.records, [step.id]: { stepId: step.id, titleEn: step.title.en, titleJa: step.title.ja, refs, at: now, requires: previous, controls } } };
  next = advance(next, task, step.id, now);
  if (step.id === 'backup-copy') next = applyPhoneReceipts(next, { ...task, status: 'completed' }, now);
  return next;
}
function applyPhoneReceipts(data: CurrentDataset, task: NordRecoveryTask, now: string): CurrentDataset {
  const origin = task.originPhone, phone = data.deviceWorkflows.find(w => w.id === origin?.id);
  if (!origin || !phone || snapshot(phone) !== origin.snapshot) return data;
  let next = { ...data, deviceWorkflows: data.deviceWorkflows.map(w => w.id === origin.id ? { ...w, answers: { ...w.answers, [`cloud:${task.vaultRef}:state`]: 'open', 'cloud-phone-version': cloudAnswer(data, task.targetRef, data.assets.find(a => a.id === cloudInstallation(data, task.targetRef)?.deviceRef)?.operatingSystem === 'ios' ? 'ios' : 'android') ?? w.answers['cloud-phone-version'] } } : w) };
  const prefix = `cloud:${task.vaultRef}:`;
  for (const suffix of ['recovery', 'account-mfa', 'vault-secret', 'vault-recovery', 'open', 'vault-open', 'storage-check']) {
    const w = next.deviceWorkflows.find(w => w.id === origin.id)!, step = phoneSteps(next, w).find(s => s.id === `${prefix}${suffix}`);
    if (!step || step.kind !== 'action' || phoneStepBlockers(next, w, step).length) continue;
    // Recovery has checked these exact prerequisites and the same new app. It
    // has not used a saved service password or configured any new MFA/autofill.
    next = confirmPhoneStep(jumpPhoneStep(next, w.id, step.id), w.id, now) as CurrentDataset;
    const updated = next.deviceWorkflows.find(w => w.id === origin.id)!, key = phoneRecordKey(updated, step);
    if (updated.records[key]) next = { ...next, deviceWorkflows: next.deviceWorkflows.map(p => p.id === w.id ? { ...p, records: { ...p.records, [key]: { ...p.records[key], nordRecoveryTaskRef: task.id } } } : p) };
  }
  // The destination and supported version were observed by this workflow.
  next = { ...next, deviceWorkflows: next.deviceWorkflows.map(w => w.id === origin.id ? { ...w, answers: { ...w.answers, [`cloud:${task.vaultRef}:state`]: 'open', 'cloud-phone-version': cloudAnswer(next, task.targetRef, next.assets.find(a => a.id === cloudInstallation(next, task.targetRef)?.deviceRef)?.operatingSystem === 'ios' ? 'ios' : 'android') ?? w.answers['cloud-phone-version'] } } : w) };
  // Any action not established by recovery remains in the phone guide.
  const w = next.deviceWorkflows.find(w => w.id === origin.id)!, pending = phoneSteps(next, w).find(s => s.id.startsWith(prefix) && s.kind === 'action' && !w.records[phoneRecordKey(w, s)]);
  return pending ? jumpPhoneStep(next, w.id, pending.id) as CurrentDataset : next;
}
export function undoNordRecovery(data: Dataset, taskId: string, stepId: string, now = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data;
  const task = nordRecoveryTasks(data).find(t => t.id === taskId); if (!task?.records[stepId]) return data;
  const removed = new Set([stepId]);
  let changed = true; while (changed) { changed = false; for (const [id, r] of Object.entries(task.records)) if (!removed.has(id) && r.requires.some(ref => removed.has(ref))) { removed.add(id); changed = true; } }
  let next: CurrentDataset = data;
  for (const id of [...removed].reverse()) for (const control of task.records[id].controls) next = undoControl(next, `${task.id}:${id}:${control.targetRef}:${control.controlId}`, control.targetRef, control.controlId, { state: 'unknown', evidence: 'not-assessed' }, now) as CurrentDataset;
  for (const w of next.deviceWorkflows) for (const [key, record] of Object.entries(w.records)) if (record.nordRecoveryTaskRef === task.id) next = undoPhoneRecord(next, w.id, key, now) as CurrentDataset;
  const factIds = new Set([...removed].map(id => `${task.id}:fact:${id}`));
  next = { ...next, securityModel: { ...next.securityModel, relations: next.securityModel.relations.map(r => r.nordRecoveryEvidence === 'v1' && r.nordRecoveryTaskRef === task.id && typeof r.nordRecoveryStep === 'string' && removed.has(r.nordRecoveryStep) ? { ...r, evidence: 'unknown' } : r), facts: next.securityModel.facts.map(f => factIds.has(f.id) ? { ...f, state: 'unknown', evidence: 'unknown' } : f) } };
  const records = { ...task.records }; for (const id of removed) delete records[id];
  return write(next, { ...task, records, status: 'active', cursor: nordRecoveryApplied(task) ? 'master-test' : stepId, updatedAt: now });
}
export function navigateNordRecovery(data: Dataset, taskId: string, mode: 'back' | 'defer' | 'method'): Dataset {
  if (data.version !== 2) return data;
  const task = nordRecoveryTasks(data).find(t => t.id === taskId); if (!task) return data;
  if (mode === 'defer') return task.status === 'completed' ? data : write(data, { ...task, status: 'deferred' });
  if (mode === 'method' && Object.keys(task.mutations).length) return data;
  return write(data, { ...task, cursor: mode === 'method' ? 'method' : task.history.at(-1) ?? task.cursor, history: mode === 'back' ? task.history.slice(0, -1) : task.history });
}
export function nordRecoveryPrompt(data: Dataset, task: NordRecoveryTask, problem: number, language: Language) {
  const step = currentNordStep(data, task), app = cloudInstallation(data, task.targetRef), device = data.assets.find(a => a.id === app?.deviceRef), sourceApp = cloudInstallation(data, task.sourceRef), sourceOS = data.assets.find(a => a.id === sourceApp?.deviceRef)?.operatingSystem;
  const problems = language === 'ja' ? ['画面が違う', '項目が見つからない', '生体認証・コードが使えない', '権限・管理の制限がある'] : ['Screen differs', 'Item missing', 'Biometrics/code unavailable', 'Permission/management restriction'];
  // Deliberately exclude labels, notes, identifiers and free text from saved data.
  return [language === 'ja' ? '最新の公式情報を確認し、一度に一つの質問または操作で案内してください。確認できなければ明示してください。秘密情報・個人情報は求めないでください。' : 'Check current official documentation and guide one question or action at a time. State if you cannot verify it. Do not request secrets or personal information.', 'Service: NordPass personal vault', `OS: ${['ios', 'android', 'macos', 'windows', 'ubuntu', 'chromeos'].includes(device?.operatingSystem ?? '') ? device?.operatingSystem : 'unknown'}; browser: ${['chrome', 'firefox', 'edge', 'safari', 'brave', 'opera'].includes(cloudAnswer(data, app?.id ?? '', 'browser') ?? '') ? cloudAnswer(data, app?.id ?? '', 'browser') : 'native mobile / unknown'}`, `Biometric source OS: ${['ios', 'android', 'windows', 'macos'].includes(sourceOS ?? '') ? sourceOS : 'not selected / unknown'}; surface: ${sourceApp?.nordRecoverySurface === 'native-v1' ? 'native app' : ['windows', 'macos'].includes(sourceOS ?? '') ? 'browser extension' : 'mobile app / unknown'}`, `Task: recover forgotten Master Password; method: ${['code', 'biometric', 'none'].includes(task.answers.method) ? task.answers.method : 'not selected'}`, `Step: ${step?.title[language] ?? 'unknown'}`, `Expected: ${step?.expected[language] ?? ''}`, `Problem: ${problems[problem] ?? problems[0]}`, ...NORD_PROMPT_URLS].join('\n');
}
const NORD_PROMPT_URLS = ['https://support.nordpass.com/hc/en-us/articles/360002376657-What-if-I-forgot-my-NordPass-Master-Password', 'https://support.nordpass.com/hc/en-us/articles/360002378758-Forgot-your-NordPass-Master-password-and-no-recovery-code', 'https://support.nordpass.com/hc/en-us/articles/360002376557-How-to-generate-a-new-Recovery-Code', 'https://support.nordpass.com/hc/en-us/articles/360005811298-How-to-enable-biometric-unlock-in-the-NordPass-Extension'];
