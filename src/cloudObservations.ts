import type { Dataset } from './models';
import type { GuideStep } from './guideCatalog';
import type { AccessContext, SecurityRelation } from './securityModel';
import { recordNordSsoPreparation, undoNordSsoEvidence } from './nordSso';
import { nordSsoBinding } from './nordSsoSchemas';
import { cloudAnswer, cloudInstallation, cloudVault } from './cloudManagers';

export function recordCloudObservation(data: Dataset, key: string, subjectRef: string, recipeId: string, step: GuideStep, requiredGuideSteps: string[], now: string, phone?: { context: AccessContext; requiredPhoneRecords: string[]; observedWithoutRefs?: string[]; sourceIds: string[] }): Dataset {
  if (data.version !== 2 || !recipeId.startsWith('cloud-')) return data;
  const app = cloudInstallation(data, recipeId.startsWith('cloud-password:') ? recipeId.slice('cloud-password:'.length) : subjectRef), vault = cloudVault(data, app?.vaultRef);
  if (!app || !vault) return data;
  if (/^cloud-sso-(prepare|add):/.test(recipeId)) return recordNordSsoPreparation(data, key, app.id, recipeId, step, requiredGuideSteps, now);
  if (phone && data.securityModel.revision < 2) data = { ...data, securityModel: { ...data.securityModel, revision: 2 } };
  if (recipeId.startsWith('cloud-master-change:') && step.id === 'apply') return { ...data, securityModel: { ...data.securityModel, lifecycle: { ...data.securityModel.lifecycle, [vault.id]: { ...data.securityModel.lifecycle[vault.id], state: data.securityModel.lifecycle[vault.id]?.state ?? 'unknown', evidence: data.securityModel.lifecycle[vault.id]?.evidence ?? 'unknown', updatedAt: data.securityModel.lifecycle[vault.id]?.updatedAt ?? now, accessResetAt: now } } } };
  const binding = vault.productId === 'nordpass' && cloudAnswer(data, vault.authenticationAccountRef ?? '', 'method') === 'sso' ? nordSsoBinding(data, vault.authenticationAccountRef) : undefined;
  const ssoLogin = binding?.grantRef && recipeId === 'cloud-onboard' && ['sign-in', 'sso-auth'].includes(step.id) ? binding : undefined;
  const ssoProof = ssoLogin ? { nordSsoEvidence: 'v1', nordSsoBindingRef: ssoLogin.id, nordSsoPurpose: step.id === 'sso-auth' ? 'provider-auth' : 'nord-auth', requiredNordSsoRecords: ['outside', 'connection'].flatMap(id => ssoLogin.records[id] ? [ssoLogin.records[id].key] : []) } : {};
  const model = data.securityModel, entities = [...model.entities], relations = [...model.relations], facts = [...model.facts], routes = [...model.routes];
  const proof = { requiredGuideSteps, ...(phone ? { requiredPhoneRecords: phone.requiredPhoneRecords, cloudPhoneObservation: 'v1' } : {}) }, sourceIds = phone?.sourceIds ?? step.sources;
  const edge = (suffix: string, fromRef: string, toRef: string, kind: SecurityRelation['kind']) => {
    const id = `${key}:cloud:${suffix}`, old = relations.find(r => r.id === id);
    const value = { ...old, id, fromRef, toRef, kind, evidence: 'user-confirmed' as const, checkedAt: now, sourceIds, observationActionId: key, ...proof };
    const index = relations.findIndex(r => r.id === id); if (index < 0) relations.push(value); else relations[index] = value;
  };
  const observed = (suffix: string, targetRef: string, purpose: 'sign-in' | 'decrypt', label: string, requiredRefs: string[], contexts: AccessContext[] = ['normal']) => {
    const factId = `${key}:cloud:${suffix}`, routeId = `${factId}:route`;
    const useContexts = phone ? [phone.context] : contexts;
    const stores = ssoLogin ? new Set(data.securityModel.entities.filter(e => e.kind === 'vault' && e.productId === 'nordpass' && e.authenticationAccountRef === ssoLogin.rootRef).map(e => e.id)) : new Set<string>();
    const independentVaults = ssoLogin ? data.securityModel.entities.filter(e => stores.has(e.id) || (e.kind === 'credential' && stores.has(e.subjectRef)) || (e.kind === 'grant' && e.nordSsoGrant === 'v1' && e.nordSsoBindingRef === ssoLogin.id && e.id !== ssoLogin.grantRef)).map(e => e.id) : [];
    const value = { ...facts.find(f => f.id === factId), id: factId, label, state: 'available' as const, evidence: 'user-confirmed' as const, checkedAt: now, requiredRefs, contexts: useContexts, dependencyCompleteness: 'partial' as const, sourceIds, observationActionId: key, ...proof, ...ssoProof, ...(ssoLogin || phone?.observedWithoutRefs ? { observedWithoutRefs: [...independentVaults, ...(phone?.observedWithoutRefs ?? [])] } : {}) };
    const route = { ...routes.find(r => r.id === routeId), id: routeId, label, targetRef, purpose, contexts: useContexts, requirements: { kind: 'fact' as const, factId }, sourceIds, observationActionId: key };
    const index = facts.findIndex(f => f.id === factId); if (index < 0) facts.push(value); else facts[index] = value;
    const routeIndex = routes.findIndex(r => r.id === routeId); if (routeIndex < 0) routes.push(route); else routes[routeIndex] = route;
  };
  if (recipeId === 'cloud-onboard' && step.id === 'open') edge('device', app.id, app.deviceRef, 'installed-on');
  if (recipeId === 'cloud-onboard' && step.id === 'sign-in' && vault.authenticationAccountRef) observed('account-signin', vault.authenticationAccountRef, 'sign-in', 'Cloud manager account sign-in accepted', [app.id, app.deviceRef, vault.authenticationAccountRef, ...(ssoLogin?.grantRef ? [ssoLogin.providerRef, ssoLogin.grantRef] : [])]);
  if (ssoLogin?.grantRef && step.id === 'sso-auth') observed('provider-auth', ssoLogin.providerRef, 'sign-in', 'Connected provider accepted this Nord sign-in', [app.id, app.deviceRef, ssoLogin.providerRef, ssoLogin.rootRef, ssoLogin.grantRef]);
  if (recipeId === 'cloud-onboard' && step.id === 'vault-open') observed('vault-read', vault.id, 'decrypt', 'Opened the intended cloud password store', [app.id, app.deviceRef, vault.id]);
  if (recipeId.startsWith('cloud-master-change:') && step.id === 'test') observed('master-unlock', vault.id, 'decrypt', 'The changed Master Password opened the same vault', [app.id, app.deviceRef, vault.id]);
  if (recipeId === 'cloud-onboard' && step.id === 'storage-check' && vault.authenticationAccountRef) { edge('store', app.id, vault.id, 'unlocks'); edge('sync', vault.id, vault.authenticationAccountRef, 'synced-via'); }
  if (recipeId.startsWith('cloud-password:') && step.id === 'test') {
    const epoch = model.lifecycle[subjectRef]?.accessResetAt ?? '';
    const existing = entities.find(e => e.kind === 'credential' && e.cloudObservationOwner === key && e.credentialType === 'password' && e.subjectRef === subjectRef && e.storageRef === vault.id && e.cloudPasswordEpoch === epoch);
    const credential = existing ?? { id: crypto.randomUUID(), kind: 'credential' as const, credentialType: 'password' as const, subjectRef, storageRef: vault.id, roles: ['sign-in' as const], label: `${data.assets.find(a => a.id === subjectRef)?.name ?? 'Account'} · ${data.settings.language === 'ja' ? '保存したログイン' : 'saved login'}`.slice(0, 80), createdAt: now, cloudObservationOwner: key, cloudPasswordEpoch: epoch, cloudInstallationRef: app.id };
    if (!existing) entities.push(credential);
    edge('saved', credential.id, vault.id, 'stored-in'); edge('used', credential.id, subjectRef, 'authenticates-to');
    observed('password-use', subjectRef, 'sign-in', 'Saved password accepted at its official service', [app.id, app.deviceRef, vault.id, credential.id, subjectRef]);
    observed('read-saved', vault.id, 'decrypt', 'Read the saved login from this password store', [app.id, app.deviceRef, vault.id, credential.id]);
  }
  const recoveryControl = step.extraControls?.find(e => ['dataRecovery', 'recoveryFile', 'recovery'].includes(e.controlId));
  if (recoveryControl && ['cloud-phrase', 'cloud-file', 'cloud-recovery'].includes(recipeId)) {
    let credential = entities.find(e => e.kind === 'credential' && e.cloudObservationOwner === key && e.subjectRef === recoveryControl.targetRef);
    if (!credential) { credential = { id: crypto.randomUUID(), kind: 'credential', credentialType: 'recovery-key', subjectRef: recoveryControl.targetRef, roles: ['restore'], label: data.settings.language === 'ja' ? recipeId === 'cloud-phrase' ? 'Protonの復旧フレーズ' : recipeId === 'cloud-file' ? 'Protonの復旧ファイル' : 'NordPassの保管庫用Recovery Code' : recipeId === 'cloud-phrase' ? 'Proton recovery phrase' : recipeId === 'cloud-file' ? 'Proton recovery file' : 'NordPass vault Recovery Code', createdAt: now, cloudObservationOwner: key, cloudInstallationRef: app.id, cloudRecoveryPhase: recipeId }; entities.push(credential); }
    edge('recovery', credential.id, recoveryControl.targetRef, 'recovers');
    // Preparation is not evidence of a successful restore or an all-devices-lost test.
  }
  return { ...data, securityModel: { ...model, entities, relations, facts, routes } };
}
export function undoCloudObservation(data: Dataset, key: string): Dataset {
  if (data.version !== 2) return data;
  data = undoNordSsoEvidence(data, key);
  if (data.version !== 2) return data;
  const withdrawn = (entry: { [key: string]: unknown }) => entry.observationActionId === key || (Array.isArray(entry.requiredGuideSteps) && entry.requiredGuideSteps.includes(key)) || (Array.isArray(entry.requiredPhoneRecords) && entry.requiredPhoneRecords.includes(key));
  return { ...data, securityModel: { ...data.securityModel, relations: data.securityModel.relations.map(r => withdrawn(r) ? { ...r, evidence: 'unknown' } : r), facts: data.securityModel.facts.map(f => withdrawn(f) ? { ...f, state: 'unknown', evidence: 'unknown' } : f) } };
}
