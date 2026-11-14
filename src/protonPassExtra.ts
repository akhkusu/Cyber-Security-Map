import { DataUpgradeConflict, type Dataset } from './models';
import type { GuideStep, Recipe } from './guideCatalog';
import { cloudInstallation, cloudVault } from './cloudManagers';

export const extraCycle = (data: Dataset, appId: string) => data.guide.answers[`${appId}:proton-extra-cycle`];
export const extraRecipeId = (data: Dataset, appId: string, mode: string) => `cloud-extra-${mode}:${extraCycle(data, appId) ?? 'missing'}`;
export function startProtonExtra(data: Dataset, appId: string): Dataset {
  const app = cloudInstallation(data, appId), vault = cloudVault(data, app?.vaultRef);
  if (data.version !== 2 || !app || vault?.productId !== 'proton-pass') return data;
  if (data.securityModel.revision < 3 && Object.keys(data.guide.answers).some(key => key.startsWith(`${appId}:proton-extra-`))) throw new DataUpgradeConflict();
  const pending = data.guide.answers[`${appId}:proton-extra-pending`], cycle = crypto.randomUUID();
  const cursor = pending ?? `do/${app.id}/cloud-extra-inspect:${cycle}/open`;
  return { ...data, securityModel: { ...data.securityModel, revision: 3 }, guide: { ...data.guide, managerId: vault.id, history: [...data.guide.history, data.guide.cursor], cursor, answers: { ...data.guide.answers, [`${vault.id}:installation`]: app.id, ...(!pending ? { [`${appId}:proton-extra-cycle`]: cycle, [`${appId}:proton-extra-pending`]: cursor } : {}) } } };
}
export function extraSetting(data: Dataset, vaultId: string) {
  if (data.version !== 2) return;
  const rootRef = cloudVault(data, vaultId)?.authenticationAccountRef;
  return data.securityModel.facts.filter(f => f.protonPassExtraEvidence === 'v1' && !!rootRef && f.extraRootRef === rootRef && (!data.securityModel.lifecycle[vaultId]?.accessResetAt || Date.parse(f.checkedAt) >= Date.parse(data.securityModel.lifecycle[vaultId].accessResetAt!)) && !(typeof f.extraCredentialRef === 'string' && data.securityModel.lifecycle[f.extraCredentialRef]?.state === 'revoked') && ['enabled', 'disabled'].includes(String(f.extraState)) && f.evidence === 'user-confirmed' && f.state === 'available').reverse().sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
}
export const extraApplied = (data: Dataset, appId: string, recipeId: string) => data.version === 2 && data.securityModel.facts.some(f => f.protonPassExtraMutation === `do/${appId}/${recipeId}/apply`);
export function extraTaskRedirect(data: Dataset, appId: string, recipe: Recipe, step: GuideStep): string | undefined {
  if (!recipe.id.startsWith('cloud-extra-')) return;
  const app = cloudInstallation(data, appId), vault = cloudVault(data, app?.vaultRef);
  if (data.version !== 2 || data.securityModel.revision !== 3 || vault?.productId !== 'proton-pass' || !app) return 'manager-select';
  const [name, cycle] = recipe.id.split(':');
  if (cycle !== extraCycle(data, appId)) return `cloud-extra-state/${appId}`;
  if (name === 'cloud-extra-inspect') return;
  const state = data.guide.answers[`${appId}:proton-extra-state:${cycle}`];
  if (!extraApplied(data, appId, recipe.id) && state !== (name === 'cloud-extra-review' ? 'on' : 'off')) return `cloud-extra-state/${appId}`;
  if (name === 'cloud-extra-enable' && !extraApplied(data, appId, recipe.id)) {
    const root = data.assets.find(a => a.id === vault.authenticationAccountRef);
    if (!root || !['mfa', 'recovery', 'dataRecovery', 'passwordResetRecovery', 'recoveryFile'].every(c => ['verified', 'implemented'].includes(root.controls[c]))) return `cloud-extra-prerequisites/${appId}`;
  }
  // An accepted change must remain finishable even after a preparation record
  // is withdrawn. It cannot be undone by editing this app's history.
  if (name === 'cloud-extra-enable' && extraApplied(data, appId, recipe.id) && ['account', 'mfa', 'extra', 'read'].includes(step.id)) return;
}

export function recordProtonExtra(data: Dataset, key: string, appId: string, recipeId: string, stepId: string, requiredGuideSteps: string[], now: string): Dataset {
  if (data.version !== 2 || !recipeId.startsWith('cloud-extra-')) return data;
  const app = cloudInstallation(data, appId), vault = cloudVault(data, app?.vaultRef);
  if (!app || vault?.productId !== 'proton-pass') return data;
  const rootRef = vault.authenticationAccountRef;
  const model = data.securityModel, entities = [...model.entities], facts = [...model.facts], routes = [...model.routes], relations = [...model.relations], lifecycle = { ...model.lifecycle };
  const cycle = recipeId.split(':')[1];
  const resetAccess = (ref: string, revoke = false) => {
    const previous = lifecycle[ref], preserve = !revoke || ['deleted', 'retired', 'transferred'].includes(previous?.state ?? '');
    lifecycle[ref] = { ...previous, state: preserve ? previous?.state ?? 'unknown' : 'revoked', evidence: preserve ? previous?.evidence ?? 'unknown' : 'user-confirmed', updatedAt: now, accessResetAt: now };
  };
  const stamp = { checkedAt: now, sourceIds: ['protonPassExtra'], observationActionId: key, requiredGuideSteps, protonPassExtraEvidence: 'v1', extraRootRef: rootRef };
  const putFact = (suffix: string, value: Record<string, unknown>) => {
    const id = `${key}:proton-extra:${suffix}`, previous = facts.find(f => f.id === id);
    const fact = { ...previous, id, label: 'Proton Pass extra-password observation', state: 'available' as const, evidence: 'user-confirmed' as const, requiredRefs: [app.id, vault.id], contexts: ['normal' as const], ...stamp, ...value };
    const index = facts.findIndex(f => f.id === id); if (index < 0) facts.push(fact); else facts[index] = fact;
    return fact;
  };
  const observeAccess = (suffix: string, targetRef: string, purpose: 'sign-in' | 'decrypt', requiredRefs: string[], label: string) => {
    const f = putFact(suffix, { requiredRefs, label, contexts: ['normal', 'no-existing-session'], dependencyCompleteness: 'partial' });
    const id = `${f.id}:route`, route = { ...routes.find(r => r.id === id), id, label, targetRef, purpose, contexts: f.contexts, requirements: { kind: 'fact' as const, factId: f.id }, sourceIds: ['protonPassExtra'], observationActionId: key };
    const index = routes.findIndex(r => r.id === id); if (index < 0) routes.push(route); else routes[index] = route;
  };
  const edge = (suffix: string, fromRef: string, toRef: string, kind: 'stored-in' | 'authenticates-to') => {
    const id = `${key}:proton-extra:${suffix}`, value = { ...relations.find(r => r.id === id), id, fromRef, toRef, kind, evidence: 'user-confirmed' as const, ...stamp };
    const index = relations.findIndex(r => r.id === id); if (index < 0) relations.push(value); else relations[index] = value;
  };
  const credential = () => {
    let item = entities.find(e => e.kind === 'credential' && e.protonPassExtraCredential === 'v1' && e.protonPassExtraCycle === cycle && e.subjectRef === rootRef);
    if (!item && !recipeId.startsWith('cloud-extra-enable:')) { const current = extraSetting(data, vault.id); item = entities.find(e => e.id === current?.extraCredentialRef && e.kind === 'credential' && e.protonPassExtraCredential === 'v1' && e.subjectRef === rootRef); }
    if (!item) { item = { id: crypto.randomUUID(), kind: 'credential', credentialType: 'password', subjectRef: rootRef ?? vault.id, roles: ['sign-in'], label: data.settings.language === 'ja' ? 'Proton Passの追加パスワード' : 'Proton Pass extra password', createdAt: now, protonPassExtraCredential: 'v1', protonPassExtraCycle: cycle, protonPassExtraAccount: rootRef, cloudInstallationRef: app.id }; entities.push(item); }
    return item;
  };
  if (stepId === 'paper' && !extraApplied(data, appId, recipeId)) {
    const c = credential();
    let paper = entities.find(e => e.kind === 'data-set' && e.protonPassExtraPaperVersion === 'v1' && (e.protonPassExtraPaper === cycle || relations.some(r => r.fromRef === c.id && r.toRef === e.id && r.kind === 'stored-in' && r.evidence === 'user-confirmed')));
    if (!paper) { paper = { id: crypto.randomUUID(), kind: 'data-set', dataType: 'other', label: data.settings.language === 'ja' ? '追加パスワードの紙の控え' : 'Paper copy of the extra password', createdAt: now, protonPassExtraPaperVersion: 'v1', protonPassExtraPaper: cycle, cloudInstallationRef: app.id }; entities.push(paper); }
    edge('paper', c.id, paper.id, 'stored-in');
  }
  if (['verify-off', 'verify-existing'].includes(stepId)) {
    const previous = extraSetting(data, vault.id)?.extraState, current = stepId === 'verify-off' ? 'disabled' : 'enabled';
    if (previous && previous !== current) {
      const stores = new Set(entities.filter(e => e.kind === 'vault' && e.productId === 'proton-pass' && e.authenticationAccountRef === rootRef).map(e => e.id));
      for (const item of entities) if (stores.has(item.id) || (item.kind === 'installation' && item.vaultRef && stores.has(item.vaultRef))) resetAccess(item.id);
    }
    if (current === 'disabled') for (const item of entities) if (item.kind === 'credential' && item.protonPassExtraCredential === 'v1' && item.protonPassExtraAccount === rootRef) resetAccess(item.id, true);
  }
  if (recipeId.startsWith('cloud-extra-enable:') && stepId === 'apply') {
    const already = facts.some(f => f.protonPassExtraMutation === key);
    if (!already) {
      const stores = new Set(entities.filter(e => e.kind === 'vault' && e.productId === 'proton-pass' && e.authenticationAccountRef === rootRef).map(e => e.id));
      for (const item of entities) if (stores.has(item.id) || (item.kind === 'installation' && item.vaultRef && stores.has(item.vaultRef)) || (item.kind === 'credential' && item.protonPassExtraCredential === 'v1' && item.protonPassExtraAccount === rootRef && item.protonPassExtraCycle && item.protonPassExtraCycle !== cycle)) resetAccess(item.id, item.kind === 'credential');
    }
    putFact('applied', { label: 'Extra password configured; fresh sign-in not yet checked', extraVaultRef: vault.id, extraState: 'enabled', extraCredentialRef: credential().id, protonPassExtraMutation: key });
  }
  if (stepId === 'verify-off') putFact('setting', { label: 'Extra password was not configured at inspection', extraVaultRef: vault.id, extraState: 'disabled' });
  if (stepId === 'verify-existing') {
    putFact('setting', { label: 'Existing extra-password setting and private copy checked; fresh use untested', extraVaultRef: vault.id, extraState: 'enabled', extraCredentialRef: credential().id });
    edge('configured', credential().id, vault.id, 'authenticates-to');
  }
  if (recipeId.startsWith('cloud-extra-enable:') && ['mfa', 'extra', 'read'].includes(stepId)) {
    const c = credential();
    if (stepId === 'mfa' && vault.authenticationAccountRef) observeAccess('account', vault.authenticationAccountRef, 'sign-in', [app.id, app.deviceRef, vault.authenticationAccountRef], 'Backing account accepted authentication before the extra-password prompt');
    if (stepId === 'extra') { edge('accepted', c.id, vault.id, 'authenticates-to'); observeAccess('extra-use', vault.id, 'sign-in', [app.id, app.deviceRef, vault.id, c.id], 'Fresh sign-in accepted the Proton Pass extra password'); }
    if (stepId === 'read') { observeAccess('read', vault.id, 'decrypt', [app.id, app.deviceRef, vault.id, c.id], 'Read existing Pass items after fresh extra-password sign-in'); putFact('setting', { extraVaultRef: vault.id, extraState: 'enabled', extraCredentialRef: c.id }); }
  }
  return { ...data, securityModel: { ...model, revision: 3, entities, relations, facts, routes, lifecycle } };
}
