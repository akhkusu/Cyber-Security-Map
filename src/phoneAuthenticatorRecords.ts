import { makeAsset, type CurrentDataset } from './models';
import { securityEntitySchema } from './securityModel';
import { recordControl, undoControl } from './controlRecords';
import { authenticator, type AuthenticatorProduct } from './authenticatorGuide';
import { MOVE_PRODUCTS } from './phoneAuthenticators';
import type { PhoneWorkflow } from './phoneSchemas';
import type { PhoneStep } from './phoneCatalog';

export function answerAuthenticatorQuestion(data: CurrentDataset, workflow: PhoneWorkflow, step: PhoneStep, value: string, previousWorkflow = workflow): { data: CurrentDataset; workflow: PhoneWorkflow } {
  let next = data, w = { ...workflow, answers: { ...workflow.answers } };
  const source = (product: AuthenticatorProduct) => {
    const existing = next.securityModel.entities.find(e => e.kind === 'installation' && !e.mergedIntoRef && e.productId === product && e.deviceRef === w.oldDeviceRef);
    if (existing) return existing.id;
    const entity = securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'installation', productId: product, deviceRef: w.oldDeviceRef, label: `${product === 'microsoft-authenticator' ? 'Microsoft Authenticator' : 'Bitwarden Authenticator'} · ${next.assets.find(a => a.id === w.oldDeviceRef)?.name ?? 'Previous phone'}`.slice(0, 80), createdAt: new Date().toISOString(), controls: {}, controlEvidence: {}, createdBy: 'phone-authenticator' });
    next = { ...next, securityModel: { ...next.securityModel, entities: [...next.securityModel.entities, entity] } }; return entity.id;
  };
  if (step.id === 'authenticator' && Object.hasOwn(MOVE_PRODUCTS, value)) {
    const previous = authenticator(next, w.answers['auth-primary-ref']);
    const product = MOVE_PRODUCTS[value as keyof typeof MOVE_PRODUCTS];
    w.answers['auth-primary-ref'] = previous?.productId === product && previous.deviceRef === w.oldDeviceRef ? previous.id : source(product);
  }
  const meta = step.authenticatorQuestion;
  if (meta?.kind === 'product') {
    const index = meta.index!, key = `auth-add-ref:${index}`;
    for (const k of Object.keys(w.answers)) {
      const match = /^auth-add(?:-ref)?:(\d+)$/.exec(k); if (match && Number(match[1]) > index) delete w.answers[k];
    }
    if (Object.hasOwn(MOVE_PRODUCTS, value)) {
      const previous = authenticator(next, w.answers[key]), product = MOVE_PRODUCTS[value as keyof typeof MOVE_PRODUCTS];
      w.answers[key] = previous?.productId === product && previous.deviceRef === w.oldDeviceRef ? previous.id : source(product);
    } else delete w.answers[key];
  }
  if (meta?.kind === 'destination') {
    const original = authenticator(next, meta.sourceRef); if (!original || !w.newDeviceRef) return { data, workflow };
    if (value === 'add') {
      const previous = authenticator(next, previousWorkflow.answers[step.answerKey!]);
      // Going back to the same planned destination keeps its ID and records.
      const existing = previous?.deviceRef === w.newDeviceRef && previous.productId === original.productId ? previous : undefined;
      const entity = existing ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'installation', productId: original.productId, deviceRef: w.newDeviceRef, label: `${original.productId === 'microsoft-authenticator' ? 'Microsoft Authenticator' : 'Bitwarden Authenticator'} · ${next.assets.find(a => a.id === w.newDeviceRef)?.name ?? 'New phone'}`.slice(0, 80), createdAt: new Date().toISOString(), controls: {}, controlEvidence: {}, createdBy: 'phone-authenticator' });
      if (!existing) next = { ...next, securityModel: { ...next.securityModel, entities: [...next.securityModel.entities, entity] } };
      w.answers[step.answerKey!] = entity.id;
    } else if (value.startsWith('installation:')) w.answers[step.answerKey!] = value.slice('installation:'.length);
  }
  if (meta?.kind === 'root' && value !== 'done' && value !== 'work') {
    let ref = value.slice('account:'.length);
    if (value === 'add') {
      const provider = meta.provider!, root = { ...makeAsset({ kind: 'account', type: provider === 'bitwarden' ? 'Password manager' : 'Identity provider', name: `${provider === 'apple' ? 'Apple Account' : provider === 'microsoft' ? 'Microsoft Account' : 'Bitwarden'} ${next.assets.filter(a => a.provider === provider).length + 1}`, importance: 'critical' }), provider, purpose: 'personal' as const };
      next = { ...next, assets: [...next.assets, root] }; ref = root.id;
    }
    next = { ...next, assets: next.assets.map(a => a.id === ref && !a.purpose ? { ...a, purpose: 'personal', updatedAt: new Date().toISOString() } : a) };
    w.answers[step.answerKey!] = ref;
    for (const k of Object.keys(w.answers)) if (k.startsWith(`auth-root:${meta.sourceRef}:`) && Number(k.slice(`auth-root:${meta.sourceRef}:`.length)) > meta.index!) delete w.answers[k];
  }
  if (meta?.kind === 'target' && value.startsWith('account:')) w.answers[`auth-target-ref:${meta.sourceRef}:${meta.index}`] = value.slice('account:'.length);
  return { data: next, workflow: w };
}

export function recordPhoneAuthenticator(data: CurrentDataset, workflow: PhoneWorkflow, step: PhoneStep, key: string, requiredPhoneRecords: string[], now: string): CurrentDataset {
  const effect = step.authenticatorEffect; if (!effect) return data;
  const source = authenticator(data, effect.sourceRef), app = authenticator(data, effect.installationRef); if (!source) return data;
  let next = data;
  const relations = [...data.securityModel.relations];
  const edge = (suffix: string, fromRef: string, toRef: string, kind: 'installed-on' | 'restores-from' | 'stored-in' | 'authenticates-to' | 'synced-via' | 'backs-up' | 'requires-for-restore') => {
    const id = `${key}:auth:${suffix}`, value = { ...relations.find(r => r.id === id), id, fromRef, toRef, kind, evidence: 'user-confirmed' as const, checkedAt: now, sourceIds: step.sources, observationActionId: key, requiredPhoneRecords };
    const index = relations.findIndex(r => r.id === id); if (index < 0) relations.push(value); else relations[index] = value;
  };
  if (effect.kind === 'open' && app) edge('installed', app.id, app.deviceRef, 'installed-on');
  if (effect.kind === 'items' && app) edge('origin', app.id, source.id, 'restores-from');
  if (effect.kind === 'sync' && app && effect.rootRef) edge(`sync:${effect.rootRef}`, app.id, effect.rootRef, 'synced-via');
  if (effect.kind === 'backup' && effect.rootRef) edge('restore-account', source.id, effect.rootRef, 'requires-for-restore');
  if (effect.kind === 'export') {
    const existing = next.securityModel.entities.find(e => e.createdBy === 'authenticator-export' && e.observationActionId === key && next.securityModel.lifecycle[e.id]?.state !== 'deleted');
    const entity = existing ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'data-set', dataType: 'other', label: data.settings.language === 'ja' ? '認証コードの一時JSON' : 'Temporary authenticator JSON', createdAt: now, createdBy: 'authenticator-export', observationActionId: key, workflowRef: workflow.id, sourceInstallationRef: source.id, storageProtection: 'readable' });
    if (!existing) next = { ...next, securityModel: { ...next.securityModel, entities: [...next.securityModel.entities, entity] } };
    edge('export', entity.id, source.id, 'backs-up');
  }
  if (effect.kind === 'cleanup') {
    const lifecycle = { ...next.securityModel.lifecycle };
    for (const entity of next.securityModel.entities) if (entity.createdBy === 'authenticator-export' && entity.sourceInstallationRef === source.id && entity.workflowRef === workflow.id) lifecycle[entity.id] = { ...lifecycle[entity.id], state: 'deleted', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now };
    next = { ...next, securityModel: { ...next.securityModel, lifecycle } };
  }
  if (effect.kind === 'code' && app && effect.accountRef) {
    const existing = next.securityModel.entities.find(e => e.kind === 'credential' && e.createdBy === 'phone-authenticator' && e.observationActionId === key);
    const credential = existing ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'credential', credentialType: 'totp', roles: ['second-step'], subjectRef: effect.accountRef, storageRef: app.id, label: `${next.assets.find(a => a.id === effect.accountRef)?.name ?? 'Account'} · ${data.settings.language === 'ja' ? '新端末の認証コード' : 'code on new phone'}`.slice(0, 80), createdAt: now, createdBy: 'phone-authenticator', observationActionId: key });
    if (!existing) next = { ...next, securityModel: { ...next.securityModel, entities: [...next.securityModel.entities, credential] } };
    const id = `${key}:auth:code-use`, routeId = `${id}:route`;
    const fact = { ...next.securityModel.facts.find(f => f.id === id), id, label: 'New-phone authenticator code accepted', state: 'available' as const, evidence: 'user-confirmed' as const, checkedAt: now, requiredRefs: [...new Set([...step.refs, credential.id])], contexts: ['new-device' as const], sourceIds: step.sources, observationActionId: key, requiredPhoneRecords };
    const route = { ...next.securityModel.routes.find(r => r.id === routeId), id: routeId, label: fact.label, targetRef: effect.accountRef, purpose: 'second-step' as const, contexts: ['new-device' as const], requirements: { kind: 'fact' as const, factId: id }, sourceIds: step.sources, observationActionId: key };
    next = { ...next, securityModel: { ...next.securityModel, facts: [...next.securityModel.facts.filter(f => f.id !== id), fact], routes: [...next.securityModel.routes.filter(r => r.id !== routeId), route] } };
    edge('stored', credential.id, app.id, 'stored-in'); edge('used', credential.id, effect.accountRef, 'authenticates-to');
    if (effect.rootRef) edge('code-sync', credential.id, effect.rootRef, 'synced-via');
    next = recordControl(next, app.id, 'codeUse', { id: `${key}#codeUse`, parentId: key, requiredPhoneRecords, origin: `phone:${workflow.id}` }, now) as CurrentDataset;
  }
  return { ...next, securityModel: { ...next.securityModel, relations } };
}

export function undoPhoneAuthenticator(data: CurrentDataset, key: string, now: string): CurrentDataset {
  let next = data;
  for (const action of data.actions) if ((action.parentId === key || (Array.isArray(action.requiredPhoneRecords) && action.requiredPhoneRecords.includes(key))) && action.targetId && action.controlId) next = undoControl(next, action.id, action.targetId, action.controlId, { state: 'unknown', evidence: 'not-assessed' }, now) as CurrentDataset;
  const affected = (r: { [key: string]: unknown }) => r.observationActionId === key || (Array.isArray(r.requiredPhoneRecords) && r.requiredPhoneRecords.includes(key));
  return { ...next, securityModel: { ...next.securityModel, relations: next.securityModel.relations.filter(r => !affected(r)), facts: next.securityModel.facts.map(f => affected(f) ? { ...f, state: 'unknown', evidence: 'unknown' } : f) } };
}
