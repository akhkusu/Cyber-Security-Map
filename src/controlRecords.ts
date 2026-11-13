import { CHECKUP_CONTROLS, controlKey } from './checkupCatalog';
import type { Asset, Dataset, SecurityActionRecord } from './models';
import type { AssessmentAnswer, ControlEvidence, ControlState } from './recordSchemas';

const baselineKey = (targetId: string, controlId: string) => JSON.stringify([targetId, controlId]);
const answerKeyFor = (asset: Asset, controlId: string) => {
  const definition = CHECKUP_CONTROLS.find(c => c.assetKind === asset.kind && c.assetControl === controlId);
  return definition ? controlKey(definition.id, asset.id) : undefined;
};
function setControl(data: Dataset, targetId: string, controlId: string, state: ControlState, evidence: ControlEvidence, answerKey: string | undefined, answer: AssessmentAnswer | undefined, now: string): Dataset {
  const answers = { ...data.assessmentAnswers };
  if (answerKey) { if (answer) answers[answerKey] = answer; else delete answers[answerKey]; }
  return {
    ...data, assessmentAnswers: answers,
    assets: data.assets.map(a => a.id === targetId ? { ...a, updatedAt: now, controls: { ...a.controls, [controlId]: state }, controlEvidence: { ...a.controlEvidence, [controlId]: evidence } } : a),
  };
}

// A confirmation is shared across guide and side workflows. The first tracked
// confirmation captures the original state; undoing another workflow cannot
// erase a still-present confirmation or resurrect a previously undone one.
export function recordControl(data: Dataset, targetId: string, controlId: string, action: SecurityActionRecord, now = new Date().toISOString()): Dataset {
  const asset = data.assets.find(a => a.id === targetId);
  if (!asset) return data;
  if (data.actions.some(a => a.id === action.id && a.status === 'completed' && a.targetId === targetId && a.controlId === controlId)) return data;
  const answerKey = answerKeyFor(asset, controlId);
  let next = data;
  if (data.version === 2) {
    const key = baselineKey(targetId, controlId);
    const active = data.actions.some(a => a.targetId === targetId && a.controlId === controlId && a.status === 'completed');
    const baseline = active && data.securityModel.controlBaselines[key] ? data.securityModel.controlBaselines[key] : {
      targetRef: targetId, controlId, state: asset.controls[controlId] ?? 'unknown', evidence: asset.controlEvidence[controlId] ?? 'not-assessed',
      answerKey, answer: answerKey ? data.assessmentAnswers[answerKey] : undefined,
    };
    next = { ...data, securityModel: { ...data.securityModel, controlBaselines: { ...data.securityModel.controlBaselines, [key]: baseline } } };
  }
  const previousAction = next.actions.find(a => a.id === action.id);
  next = { ...next, actions: [...next.actions.filter(a => a.id !== action.id), { ...previousAction, ...action, targetId, controlId, completedAt: now, updatedAt: now, status: 'completed' }] };
  return setControl(next, targetId, controlId, 'verified', 'user-confirmed', answerKey, { ...(answerKey ? data.assessmentAnswers[answerKey] : {}), response: 'yes', evidence: 'user-confirmed', updatedAt: now }, now);
}

export function undoControl(data: Dataset, actionId: string, targetId: string, controlId: string, fallback: { state: ControlState; evidence: ControlEvidence; answer?: AssessmentAnswer }, now = new Date().toISOString()): Dataset {
  const asset = data.assets.find(a => a.id === targetId);
  if (!asset) return data;
  let next: Dataset = { ...data, actions: data.actions.filter(a => a.id !== actionId) };
  const remaining = next.actions.filter(a => a.targetId === targetId && a.controlId === controlId && a.status === 'completed');
  const currentIsConfirmation = asset.controls[controlId] === 'verified' && asset.controlEvidence[controlId] === 'user-confirmed';
  if (remaining.length) {
    // A later explicit correction wins over old confirmations. Keep their
    // shared baseline until the last confirmation has actually been undone.
    if (!currentIsConfirmation) return next;
    const latest = remaining[remaining.length - 1];
    const answerKey = answerKeyFor(asset, controlId);
    return setControl(next, targetId, controlId, 'verified', 'user-confirmed', answerKey, { ...(answerKey ? data.assessmentAnswers[answerKey] : {}), response: 'yes', evidence: 'user-confirmed', updatedAt: latest.completedAt ?? now }, now);
  }
  const key = baselineKey(targetId, controlId);
  const baseline = data.version === 2 ? data.securityModel.controlBaselines[key] : undefined;
  if (next.version === 2 && baseline) {
    const baselines = { ...next.securityModel.controlBaselines }; delete baselines[key];
    next = { ...next, securityModel: { ...next.securityModel, controlBaselines: baselines } };
  }
  if (!currentIsConfirmation) return next;
  return setControl(next, targetId, controlId, baseline?.state ?? fallback.state, baseline?.evidence ?? fallback.evidence, baseline ? baseline.answerKey : answerKeyFor(asset, controlId), baseline ? baseline.answer : fallback.answer, now);
}
