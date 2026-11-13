import { makeAsset, upgradeDataset, type CurrentDataset, type Dataset, type Language } from './models';
import { recordControl, undoControl } from './controlRecords';
import { phoneWorkflowSchema, type PhoneWorkflow } from './phoneSchemas';
import { PHONE_SOURCES, phoneName, phoneSteps, type PhoneStep } from './phoneCatalog';
import { PROVIDERS } from './guideCatalog';

export const getPhoneWorkflows = (data: Dataset): PhoneWorkflow[] => data.version === 2 ? data.deviceWorkflows : [];
export const phoneRecordKey = (workflow: PhoneWorkflow, step: PhoneStep) => JSON.stringify([workflow.id, step.id, step.refs, step.variant ?? '']);
export const phoneRecord = (workflow: PhoneWorkflow, step: PhoneStep) => workflow.records[phoneRecordKey(workflow, step)];
export function startPhoneWorkflow(data: Dataset, returnTo: '/guide' | '/map', oldDeviceRef?: string, id: string = crypto.randomUUID(), now = new Date().toISOString()): CurrentDataset {
  const next = upgradeDataset(data);
  const old = next.assets.find(a => a.id === oldDeviceRef && a.kind === 'device' && ['ios', 'android'].includes(a.operatingSystem ?? ''));
  const workflow = phoneWorkflowSchema.parse({ id, kind: 'phone-change', createdAt: now, updatedAt: now, returnTo, oldDeviceRef: old?.id });
  return { ...next, deviceWorkflows: [...next.deviceWorkflows, workflow] };
}
function updateWorkflow(data: CurrentDataset, workflow: PhoneWorkflow): CurrentDataset {
  return { ...data, deviceWorkflows: data.deviceWorkflows.map(w => w.id === workflow.id ? { ...workflow, updatedAt: new Date().toISOString() } : w) };
}
export function currentPhoneStep(data: Dataset, workflow: PhoneWorkflow): PhoneStep {
  const steps = phoneSteps(data, workflow);
  return steps.find(s => s.id === workflow.cursor) ?? steps[steps.length - 1];
}
function advance(data: CurrentDataset, workflow: PhoneWorkflow, previousId: string): CurrentDataset {
  const steps = phoneSteps(data, workflow), index = steps.findIndex(s => s.id === previousId);
  const cursor = steps[index + 1]?.id ?? previousId;
  return updateWorkflow(data, { ...workflow, cursor, history: [...workflow.history, previousId] });
}
export function answerPhoneQuestion(data: Dataset, workflowId: string, value: string): Dataset {
  if (data.version !== 2) return data;
  const workflow = data.deviceWorkflows.find(w => w.id === workflowId);
  if (!workflow) return data;
  const step = currentPhoneStep(data, workflow);
  if (step.kind !== 'question' || !step.choices?.some(c => c.value === value) || !step.answerKey) return data;
  let next = data, updated = { ...workflow, answers: { ...workflow.answers, [step.answerKey]: value } };
  if (step.id === 'old-device' || step.id === 'new-device') {
    let ref = value;
    if (value === 'add:ios' || value === 'add:android') {
      const os = value === 'add:ios' ? 'ios' : 'android';
      const a = makeAsset({ kind: 'device', type: 'Smartphone', name: `${phoneName(os)} ${data.assets.filter(a => a.kind === 'device').length + 1}`, importance: 'critical', operatingSystem: os });
      next = { ...data, assets: [...data.assets, a] }; ref = a.id;
    }
    if (step.id === 'old-device') {
      if (ref !== workflow.oldDeviceRef) updated = { ...updated, oldDeviceRef: ref, newDeviceRef: undefined, answers: { stage: workflow.answers.stage, 'old-device': ref } };
      else updated = { ...updated, oldDeviceRef: ref, answers: { ...updated.answers, 'old-device': ref } };
    } else if (ref !== workflow.newDeviceRef) {
      const retained = ['stage', 'old-device', 'availability', 'ownership'];
      updated = { ...updated, newDeviceRef: ref, answers: { ...Object.fromEntries(Object.entries(workflow.answers).filter(([key]) => retained.includes(key))), 'new-device': ref } };
    }
  }
  if (step.id === 'availability' && value !== workflow.answers.availability) {
    updated = { ...updated, answers: { stage: workflow.answers.stage, 'old-device': workflow.oldDeviceRef ?? '', availability: value } };
    if (workflow.oldDeviceRef && value !== 'available') {
      const now = new Date().toISOString(), ref = workflow.oldDeviceRef;
      next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [ref]: { ...next.securityModel.lifecycle[ref], state: value === 'lost' ? 'lost' : value === 'gone' ? 'retired' : 'unavailable', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now } } } };
    }
  }
  return advance(next, updated, step.id);
}
export function phoneBlockingSteps(data: Dataset, workflow: PhoneWorkflow, beforeId = 'handoff-gate'): PhoneStep[] {
  const steps = phoneSteps(data, workflow), index = steps.findIndex(s => s.id === beforeId);
  if (index < 0) return [];
  return steps.slice(0, index).filter(s => s.kind === 'blocked' || ((s.kind === 'action' || s.kind === 'gate') && phoneRecord(workflow, s)?.status !== 'confirmed'));
}
export function confirmPhoneStep(data: Dataset, workflowId: string, now = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data;
  const workflow = data.deviceWorkflows.find(w => w.id === workflowId);
  if (!workflow) return data;
  const step = currentPhoneStep(data, workflow);
  if (!['action', 'gate'].includes(step.kind)) return data;
  if ((step.kind === 'gate' || step.physicalEffect) && phoneBlockingSteps(data, workflow, step.id).length) return data;
  const key = phoneRecordKey(workflow, step);
  let next: CurrentDataset = data;
  if (step.control) next = recordControl(next, step.control.targetRef, step.control.id, { id: key, titleEn: step.title.en, titleJa: step.title.ja, origin: `phone:${workflow.id}` }, now) as CurrentDataset;
  const factIds: string[] = [];
  if (step.access) {
    const factId = `${key}:observation`, routeId = `${key}:route`; factIds.push(factId);
    const fact = { ...next.securityModel.facts.find(f => f.id === factId), id: factId, label: step.access.purpose === 'decrypt' ? 'Vault opened on new phone' : 'New-phone sign-in accepted', state: 'available' as const, evidence: 'user-confirmed' as const, checkedAt: now, requiredRefs: step.refs, contexts: ['new-device' as const], sourceIds: step.sources };
    const route = { ...next.securityModel.routes.find(r => r.id === routeId), id: routeId, label: fact.label, targetRef: step.access.targetRef, purpose: step.access.purpose, contexts: ['new-device' as const], requirements: { kind: 'fact' as const, factId }, sourceIds: step.sources };
    next = { ...next, securityModel: { ...next.securityModel, facts: [...next.securityModel.facts.filter(f => f.id !== factId), fact], routes: [...next.securityModel.routes.filter(r => r.id !== routeId), route] } };
  }
  if (step.id === 'erase-old' && workflow.oldDeviceRef) next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [workflow.oldDeviceRef]: { ...next.securityModel.lifecycle[workflow.oldDeviceRef], state: 'retired', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now } } } };
  if (step.id === 'handoff-check' && workflow.oldDeviceRef) next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [workflow.oldDeviceRef]: { ...next.securityModel.lifecycle[workflow.oldDeviceRef], state: 'transferred', evidence: 'user-confirmed', updatedAt: now, accessResetAt: next.securityModel.lifecycle[workflow.oldDeviceRef]?.accessResetAt ?? now } } } };
  if (step.id === 'keep-old' && workflow.oldDeviceRef) next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [workflow.oldDeviceRef]: { ...next.securityModel.lifecycle[workflow.oldDeviceRef], state: workflow.answers['old-fate'] === 'spare' ? 'backup' : 'in-use', evidence: 'user-confirmed', updatedAt: now } } } };
  const records = { ...workflow.records, [key]: { ...workflow.records[key], stepId: step.id, titleEn: step.title.en, titleJa: step.title.ja, status: 'confirmed' as const, updatedAt: now, targetRef: step.control?.targetRef ?? (step.physicalEffect ? workflow.oldDeviceRef : undefined), controlId: step.control?.id, factIds, sourceIds: step.sources, physicalEffect: !!step.physicalEffect } };
  return advance(next, { ...workflow, records }, step.id);
}
export function deferPhoneStep(data: Dataset, workflowId: string, now = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data;
  const workflow = data.deviceWorkflows.find(w => w.id === workflowId);
  if (!workflow) return data;
  const step = currentPhoneStep(data, workflow);
  if (!['action', 'blocked'].includes(step.kind)) return data;
  const key = phoneRecordKey(workflow, step);
  const records = phoneRecord(workflow, step)?.status === 'confirmed' ? workflow.records : { ...workflow.records, [key]: { stepId: step.id, titleEn: step.title.en, titleJa: step.title.ja, status: 'later' as const, updatedAt: now, factIds: [], sourceIds: step.sources, physicalEffect: false } };
  return advance(data, { ...workflow, records }, step.id);
}
export function jumpPhoneStep(data: Dataset, workflowId: string, stepId: string): Dataset {
  if (data.version !== 2) return data;
  const workflow = data.deviceWorkflows.find(w => w.id === workflowId);
  if (!workflow || !phoneSteps(data, workflow).some(s => s.id === stepId)) return data;
  return updateWorkflow(data, { ...workflow, cursor: stepId, history: [...workflow.history, workflow.cursor] });
}
export function backPhoneStep(data: Dataset, workflowId: string): Dataset {
  if (data.version !== 2) return data;
  const workflow = data.deviceWorkflows.find(w => w.id === workflowId);
  if (!workflow?.history.length) return data;
  return updateWorkflow(data, { ...workflow, cursor: workflow.history[workflow.history.length - 1], history: workflow.history.slice(0, -1) });
}
export function undoPhoneRecord(data: Dataset, workflowId: string, key: string, now = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data;
  const workflow = data.deviceWorkflows.find(w => w.id === workflowId), record = workflow?.records[key];
  if (!workflow || !record) return data;
  let next: CurrentDataset = data;
  if (record.controlId && record.targetRef) next = undoControl(next, key, record.targetRef, record.controlId, { state: 'unknown', evidence: 'not-assessed' }, now) as CurrentDataset;
  const facts = next.securityModel.facts.filter(f => !record.factIds.includes(f.id));
  const routes = next.securityModel.routes.filter(r => r.id !== `${key}:route`);
  const records = { ...workflow.records }; delete records[key];
  // A corrected record cannot undo a real wipe or revive an old authentication
  // device. Keep it retired until its current role has been explicitly checked.
  let physicalTarget = record.targetRef;
  if (record.physicalEffect && !physicalTarget) {
    // Early v2 records encoded the original subjects only in their stable key.
    // Recover that original subject, never the workflow's currently selected phone.
    try { const subjects: unknown = JSON.parse(key); if (Array.isArray(subjects) && Array.isArray(subjects[2]) && typeof subjects[2][0] === 'string') physicalTarget = subjects[2][0]; } catch { /* Leave an unidentifiable subject unchanged. */ }
  }
  if (record.physicalEffect && physicalTarget && next.assets.some(a => a.id === physicalTarget && a.kind === 'device')) next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [physicalTarget]: { ...next.securityModel.lifecycle[physicalTarget], state: 'retired', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now } } } };
  next = { ...next, securityModel: { ...next.securityModel, facts, routes } };
  return updateWorkflow(next, { ...workflow, records, cursor: record.stepId, history: [...workflow.history, workflow.cursor] });
}
export function phoneHelpPrompt(data: Dataset, workflow: PhoneWorkflow, problemIndex: number, language: Language): string {
  const step = currentPhoneStep(data, workflow), problems = language === 'ja' ? ['画面が違う', '項目が見つからない', '権限がない', '旧端末・復旧方法が使えない', '対応する手順がない'] : ['The screen differs', 'The item is missing', 'I lack permission', 'The old device or recovery method is unavailable', 'No supported recipe'];
  const old = data.assets.find(a => a.id === workflow.oldDeviceRef), fresh = data.assets.find(a => a.id === workflow.newDeviceRef);
  // Never copy nicknames, free text, IDs or raw saved answers to an external AI.
  const safeData = { ...data, assets: data.assets.map(a => ({ ...a, name: a.provider ? PROVIDERS[a.provider] : a.kind === 'device' ? phoneName(a.operatingSystem) : 'Selected account' })) };
  const safeStep = phoneSteps(safeData, workflow).find(s => s.id === step.id) ?? step;
  return [language === 'ja' ? '最新の公式資料を確認し、一度に一つの質問または操作を案内してください。確認できない最新情報は、その旨を明示してください。秘密情報を求めず、新しい手段が使える前に既存の方法を削除させないでください。' : 'Check current official documentation. Guide one question or action at a time. State if you cannot verify current information. Do not request secrets or remove old access before new access works.',
    `Task: ${language === 'ja' ? 'スマホの機種変更' : 'Move to a new phone'}`, `Current step: ${safeStep.title[language]}`,
    `Where: ${safeStep.place?.[language] ?? 'Official settings on the selected phone'}`,
    `OS: ${old?.operatingSystem === 'ios' ? 'iOS' : old?.operatingSystem === 'android' ? 'Android' : 'unconfirmed'} → ${fresh?.operatingSystem === 'ios' ? 'iOS' : fresh?.operatingSystem === 'android' ? 'Android' : 'unconfirmed'} (version unconfirmed)`,
    `Expected: ${safeStep.expected?.[language] ?? safeStep.text?.[language] ?? 'A supported migration path'}`,
    `Problem: ${problems[problemIndex] ?? problems[0]}`, 'Official sources:', ...step.sources.map(s => PHONE_SOURCES[s]?.url).filter(Boolean),
  ].join('\n');
}
