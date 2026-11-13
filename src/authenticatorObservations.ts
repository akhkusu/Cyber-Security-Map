import type { Dataset } from './models';
import { recordControl } from './controlRecords';
import { AUTHENTICATORS, authSources, authenticatorConfirmation, authenticatorReady, authenticatorScan, selectedAuthenticator, type AuthenticatorProduct } from './authenticatorGuide';
import type { GuideStep } from './guideCatalog';

export function recordAuthenticatorObservation(data: Dataset, key: string, accountId: string, recipe: string, step: GuideStep, now: string): Dataset {
  const app = selectedAuthenticator(data, accountId); if (!app || data.version !== 2) return data;
  let next = data;
  const sourceIds = [...new Set([...step.sources, ...authSources(app.productId as AuthenticatorProduct)])];
  const model = data.securityModel, relations = [...model.relations];
  const edge = (suffix: string, fromRef: string, toRef: string, kind: 'installed-on' | 'stored-in' | 'authenticates-to' | 'synced-via') => {
    const id = `${key}:auth:${suffix}`;
    const value = { ...relations.find(r => r.id === id), id, fromRef, toRef, kind, evidence: 'user-confirmed' as const, checkedAt: now, sourceIds, observationActionId: key };
    const index = relations.findIndex(r => r.id === id); if (index < 0) relations.push(value); else relations[index] = value;
  };
  if (recipe.startsWith('authenticator-setup:') && step.id === 'open') edge('installed', app.id, app.deviceRef, 'installed-on');
  if (recipe.startsWith('authenticator-setup:') && step.id === 'storage' && app.codeStorage === 'account' && app.syncAccountRef) edge('sync', app.id, app.syncAccountRef, 'synced-via');
  next = { ...next, securityModel: { ...next.securityModel, relations } };
  const taskKey = data.guide.answers[`auth:${accountId}:enrollment`], receipt = data.guide.steps[taskKey];
  const confirmationKey = data.guide.answers[`auth:${accountId}:confirmation`], confirmation = data.guide.steps[confirmationKey];
  const requiredGuideSteps = [taskKey, confirmationKey];
  const matchedEnrollment = receipt?.status === 'done' && receipt.authenticatorRef === app.id && !!receipt.authenticatorEnrollment && confirmation?.status === 'done' && confirmation.authenticatorRef === app.id && confirmation.authenticatorEnrollment === receipt.authenticatorEnrollment;
  if (authenticatorConfirmation(recipe, step.id) && authenticatorReady(data, app) && matchedEnrollment) {
    // A registration change makes older copies uncertain; it does not prove
    // that every previous method was revoked. Correction cannot undo the real change.
    const lifecycle = { ...next.securityModel.lifecycle };
    for (const entity of next.securityModel.entities) if (entity.kind === 'credential' && entity.credentialType === 'totp' && entity.subjectRef === accountId) lifecycle[entity.id] = { ...lifecycle[entity.id], state: lifecycle[entity.id]?.state ?? 'unknown', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now };
    next = { ...next, securityModel: { ...next.securityModel, lifecycle } };
  }
  const accepted = authenticatorReady(data, app) && matchedEnrollment && step.control === 'mfa' && authenticatorScan(taskKey?.split('/')[2], taskKey?.split('/')[3]);
  if (!accepted) return next;
  const slotId = `auth-code:${accountId}:${app.id}`;
  const existing = model.entities.find(e => e.kind === 'credential' && e.createdBy === 'guided-authenticator' && e.credentialType === 'totp' && e.subjectRef === accountId && e.storageRef === app.id && e.enrollmentRef === receipt.authenticatorEnrollment);
  const credentialId = existing?.id ?? ([...data.assets, ...model.entities, ...model.relations, ...model.facts, ...model.routes].some(e => e.id === slotId) ? crypto.randomUUID() : slotId);
  const account = data.assets.find(a => a.id === accountId);
  const entity = { ...existing, id: credentialId, kind: 'credential' as const, createdBy: 'guided-authenticator', enrollmentRef: receipt.authenticatorEnrollment, label: `${account?.name ?? 'Account'} · ${data.settings.language === 'ja' ? '認証コード' : 'verification code'}`.slice(0, 80), createdAt: existing?.createdAt ?? now, credentialType: 'totp' as const, subjectRef: accountId, storageRef: app.id, roles: ['second-step' as const] };
  const factId = `${key}:auth:accepted`, routeId = `${factId}:route`;
  const proofFingerprint = receipt.authenticatorEnrollment;
  const previousFact = model.facts.find(f => f.id === factId);
  const checkedAt = confirmation.updatedAt;
  edge('stored', credentialId, app.id, 'stored-in'); edge('registered', credentialId, accountId, 'authenticates-to');
  for (const relation of relations) if (relation.observationActionId === key) Object.assign(relation, { requiredGuideSteps, checkedAt, proofFingerprint });
  next = { ...next, securityModel: { ...next.securityModel, relations, entities: [...next.securityModel.entities.filter(e => e.id !== credentialId), entity] } };
  const fact = { ...next.securityModel.facts.find(f => f.id === factId), id: factId, label: 'Service accepted authenticator registration', state: 'available' as const, evidence: 'user-confirmed' as const, checkedAt, proofFingerprint, requiredRefs: [app.id, app.deviceRef, credentialId, accountId], contexts: ['enrollment' as const], sourceIds, observationActionId: key, requiredGuideSteps };
  const route = { ...next.securityModel.routes.find(r => r.id === routeId), id: routeId, label: 'Registered code; sign-in test is separate', targetRef: accountId, purpose: 'second-step' as const, contexts: ['enrollment' as const], requirements: { kind: 'fact' as const, factId }, sourceIds, observationActionId: key };
  next = { ...next, securityModel: { ...next.securityModel, facts: [...next.securityModel.facts.filter(f => f.id !== factId), fact], routes: [...next.securityModel.routes.filter(r => r.id !== routeId), route] } };
  if (previousFact?.proofFingerprint !== proofFingerprint && next.securityModel.lifecycle[credentialId]) next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [credentialId]: { ...next.securityModel.lifecycle[credentialId], state: 'in-use', evidence: 'user-confirmed', updatedAt: now } } } };
  next = recordControl(next, app.id, 'codeAccepted', { id: `${key}#${app.id}#codeAccepted`, parentId: key, requiredGuideSteps, origin: 'guide', titleEn: AUTHENTICATORS[app.productId as AuthenticatorProduct].en, titleJa: AUTHENTICATORS[app.productId as AuthenticatorProduct].ja }, checkedAt) as typeof next;
  return next;
}
export function undoAuthenticatorObservation(data: Dataset, key: string): Dataset {
  if (data.version !== 2) return data;
  return { ...data, securityModel: { ...data.securityModel, facts: data.securityModel.facts.map(f => f.observationActionId === key || (Array.isArray(f.requiredGuideSteps) && f.requiredGuideSteps.includes(key)) ? { ...f, state: 'unknown', evidence: 'unknown' } : f), relations: data.securityModel.relations.filter(r => r.observationActionId !== key && !(Array.isArray(r.requiredGuideSteps) && r.requiredGuideSteps.includes(key))) } };
}
