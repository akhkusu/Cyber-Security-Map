import type { Dataset } from './models';
import type { GuideStep } from './guideCatalog';
import { nativeInstallation, nativeVault } from './nativeManagers';
import type { SecurityRelation } from './securityModel';

export function recordNativeObservation(data: Dataset, key: string, subjectId: string, recipeId: string, step: GuideStep, now: string): Dataset {
  if (data.version !== 2) return data;
  const install = nativeInstallation(data, recipeId.startsWith('native-password:') ? recipeId.slice('native-password:'.length) : subjectId);
  const vault = nativeVault(data, install?.vaultRef); if (!install || !vault) return data;
  const model = data.securityModel, relations = [...model.relations];
  const edge = (suffix: string, fromRef: string, toRef: string, kind: SecurityRelation['kind']) => {
    const id = `${key}:native:${suffix}`;
    const previous = relations.find(r => r.id === id);
    const record = { ...previous, id, fromRef, toRef, kind, evidence: 'user-confirmed' as const, checkedAt: now, sourceIds: step.sources, observationActionId: key };
    const index = relations.findIndex(r => r.id === id); if (index < 0) relations.push(record); else relations[index] = record;
  };
  if (recipeId === 'builtin-manager' && step.control === 'opened') edge('device', install.id, install.deviceRef, 'installed-on');
  if (recipeId === 'builtin-manager' && step.control === 'storageChecked') {
    edge('store', install.id, vault.id, 'unlocks');
    if (vault.storageMode === 'account' && vault.authenticationAccountRef) edge('sync', vault.id, vault.authenticationAccountRef, 'synced-via');
  }
  if (!recipeId.startsWith('native-password:') || step.id !== 'test') return { ...data, securityModel: { ...model, relations } };
  const credentialId = `native-login:${vault.id}:${subjectId}`;
  const existing = model.entities.find(e => e.id === credentialId);
  const credential = { ...existing, id: credentialId, kind: 'credential' as const, label: `${data.assets.find(a => a.id === subjectId)?.name ?? 'Account'} · ${data.settings.language === 'ja' ? '保存パスワード' : 'saved password'}`.slice(0, 80), createdAt: existing?.createdAt ?? now, credentialType: 'password' as const, subjectRef: subjectId, storageRef: vault.id, roles: ['sign-in' as const] };
  edge('stored', credentialId, vault.id, 'stored-in'); edge('login', credentialId, subjectId, 'authenticates-to');
  const factId = `${key}:native:use`, routeId = `${factId}:login`, decryptId = `${factId}:decrypt`;
  const fact = { ...model.facts.find(f => f.id === factId), id: factId, label: 'Used a password from this store', state: 'available' as const, evidence: 'user-confirmed' as const, checkedAt: now, requiredRefs: [install.id, install.deviceRef, vault.id, credentialId, subjectId], contexts: ['normal' as const], sourceIds: step.sources, observationActionId: key };
  const decryptFact = { ...fact, ...model.facts.find(f => f.id === `${factId}:read`), id: `${factId}:read`, label: 'Read a saved password from this store', requiredRefs: [install.id, install.deviceRef, vault.id, credentialId], state: 'available' as const, evidence: 'user-confirmed' as const, checkedAt: now };
  const routes = [{ id: routeId, label: 'Saved-password sign-in', targetRef: subjectId, purpose: 'sign-in' as const }, { id: decryptId, label: 'Read password-store contents', targetRef: vault.id, purpose: 'decrypt' as const }].map(r => ({ ...model.routes.find(old => old.id === r.id), ...r, contexts: ['normal' as const], requirements: { kind: 'fact' as const, factId: r.purpose === 'decrypt' ? decryptFact.id : factId }, sourceIds: step.sources, observationActionId: key }));
  return { ...data, securityModel: { ...model, entities: [...model.entities.filter(e => e.id !== credentialId), credential], relations, facts: [...model.facts.filter(f => f.id !== factId && f.id !== decryptFact.id), fact, decryptFact], routes: [...model.routes.filter(r => !routes.some(next => next.id === r.id)), ...routes] } };
}
export function undoNativeObservation(data: Dataset, key: string): Dataset {
  if (data.version !== 2) return data;
  return { ...data, securityModel: { ...data.securityModel, relations: data.securityModel.relations.filter(r => r.observationActionId !== key), facts: data.securityModel.facts.map(f => f.observationActionId === key ? { ...f, state: 'unknown', evidence: 'unknown' } : f) } };
}
