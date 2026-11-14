import { DataUpgradeConflict, guideSchema, makeAsset, upgradeDataset, type CurrentDataset, type Dataset, type Language } from './models';
import { nordSsoBinding, nordSsoBindingSchema, nordSsoReady, nordSsoSelected, nordSsoStore, nordSsoStoreSchema, type NordSsoBinding, type NordSsoStore } from './nordSsoSchemas';
import { securityEntitySchema } from './securityModel';
import type { GuideStep } from './guideCatalog';

const PREP = ['outside', 'open', 'settings', 'connections'];
function editable(data: Dataset): CurrentDataset {
  const next = upgradeDataset(data);
  if (next.securityModel.revision < 5 && (Object.hasOwn(next.securityModel, 'nordSsoV1') || [...next.securityModel.entities, ...next.securityModel.facts, ...next.securityModel.relations, ...next.securityModel.routes].some(r => Object.keys(r).some(k => k.startsWith('nordSso'))))) throw new DataUpgradeConflict();
  if (next.securityModel.revision < 5 && Object.keys(next.guide).some(k => k.startsWith('nordSso'))) throw new DataUpgradeConflict();
  if (next.securityModel.revision < 5 && Object.values(next.guide.steps).some(r => Object.keys(r).some(k => k.startsWith('nordSso')))) throw new DataUpgradeConflict();
  if (next.securityModel.revision >= 5 && Object.hasOwn(next.securityModel, 'nordSsoV1') && !nordSsoStoreSchema.safeParse(next.securityModel.nordSsoV1).success) throw new DataUpgradeConflict();
  return next;
}
function write(data: CurrentDataset, store: NordSsoStore): CurrentDataset {
  return { ...data, securityModel: { ...data.securityModel, revision: data.securityModel.revision >= 5 ? data.securityModel.revision : 5, nordSsoV1: store } };
}
const empty = () => nordSsoStoreSchema.parse({ version: 1 });
function writeBinding(data: CurrentDataset, binding: NordSsoBinding): CurrentDataset {
  const store = nordSsoStore(data) ?? empty();
  return write(data, { ...store, bindings: [...store.bindings.filter(b => b.id !== binding.id), binding] });
}
export function setNordSsoMethod(data: CurrentDataset, rootRef: string, method: 'direct' | 'sso' | 'unknown'): CurrentDataset {
  const store = nordSsoStore(data) ?? empty();
  return write(data, { ...store, methods: { ...store.methods, [rootRef]: method } });
}
export function setNordDirectPasswordUse(data: Dataset, rootRef: string, use: 'available' | 'not-used' | 'unknown'): Dataset {
  const next = editable(data), store = nordSsoStore(next) ?? empty();
  if (!next.assets.some(a => a.id === rootRef && a.kind === 'account' && a.provider === 'nord')) return data;
  return write(next, { ...store, directPasswords: { ...store.directPasswords, [rootRef]: use } });
}
export function selectNordSsoProvider(data: Dataset, rootRef: string, provider: 'google' | 'apple'): Dataset {
  if (!data.assets.some(a => a.id === rootRef && a.kind === 'account' && a.provider === 'nord' && a.purpose === 'personal')) return data;
  const next = editable(data), store = nordSsoStore(next) ?? empty(), previous = store.selections[rootRef];
  return write(next, { ...store, methods: { ...store.methods, [rootRef]: 'sso' }, selections: { ...store.selections, [rootRef]: previous?.provider === provider ? previous : { provider } } });
}
export function selectNordSsoAccount(data: Dataset, rootRef: string, providerRef?: string): Dataset {
  let next = editable(data); const store = nordSsoStore(next), selected = store?.selections[rootRef];
  if (!store || !selected) return data;
  let provider = next.assets.find(a => a.id === providerRef && a.kind === 'account' && a.provider === selected.provider);
  if (!providerRef) {
    provider = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: `${selected.provider === 'google' ? 'Google Account' : 'Apple Account'} · ${data.settings.language === 'ja' ? '個人用' : 'Personal'} ${data.assets.filter(a => a.provider === selected.provider).length + 1}`, importance: 'critical' }), provider: selected.provider, purpose: 'personal' };
    next = { ...next, assets: [...next.assets, provider] };
  }
  if (!provider || provider.id === rootRef) return data;
  const binding = store.bindings.find(b => b.rootRef === rootRef && b.providerRef === provider.id && b.provider === selected.provider) ?? nordSsoBindingSchema.parse({ id: crypto.randomUUID(), rootRef, providerRef: provider.id, provider: selected.provider, createdAt: new Date().toISOString() });
  return write(next, { ...store, selections: { ...store.selections, [rootRef]: { ...selected, bindingRef: binding.id } }, bindings: [...store.bindings.filter(b => b.id !== binding.id), binding] });
}
export function nordSsoChoiceRoute(data: Dataset, rootRef: string, vaultId: string): string | undefined {
  const selected = nordSsoSelected(data, rootRef), b = nordSsoBinding(data, rootRef);
  if (!selected) return `cloud-sso-provider/${vaultId}`;
  if (!b) return `cloud-sso-account/${vaultId}`;
  const provider = data.assets.find(a => a.id === b.providerRef);
  if (data.version === 2 && [rootRef, b.providerRef].some(ref => { const life = data.securityModel.lifecycle[ref]; return life?.evidence === 'user-confirmed' && ['revoked', 'deleted', 'unavailable', 'lost', 'retired', 'transferred'].includes(life.state); })) return `cloud-sso-unavailable/${vaultId}`;
  if (!provider?.purpose) return `cloud-sso-purpose/${vaultId}`;
  if (provider.purpose !== 'personal') return `cloud-sso-managed/${vaultId}`;
}
export function nordSsoSetupRoute(data: Dataset, rootRef: string, vaultId: string, appId: string): string | undefined {
  const choice = nordSsoChoiceRoute(data, rootRef, vaultId); if (choice) return choice;
  const b = nordSsoBinding(data, rootRef)!;
  const missing = PREP.find(id => !b.records[id]);
  if (missing) return `do/${appId}/cloud-sso-prepare:${b.id}/${missing}`;
  const provider = data.assets.find(a => a.id === b.providerRef)!;
  if (!['mfa', 'recovery'].every(key => ['implemented', 'verified'].includes(provider.controls[key]))) return `cloud-sso-security/${vaultId}`;
  if (!nordSsoReady(data, rootRef)) return `cloud-sso-state/${vaultId}`;
}
export function confirmNordSsoConnection(data: Dataset, rootRef: string, key?: string, now = new Date().toISOString(), created = false): Dataset {
  if (data.version !== 2) return data;
  const b = nordSsoBinding(data, rootRef), provider = data.assets.find(a => a.id === b?.providerRef);
  if (!b || !provider || nordSsoChoiceRoute(data, rootRef, '') || !PREP.every(id => b.records[id]) || !['mfa', 'recovery'].every(k => ['implemented', 'verified'].includes(provider.controls[k])) || provider.purpose !== 'personal') return data;
  const prior = b.grantRef ? data.securityModel.lifecycle[b.grantRef] : undefined;
  const grantRef = b.grantRef && !(prior?.evidence === 'user-confirmed' && ['revoked', 'deleted', 'retired', 'transferred'].includes(prior.state)) ? b.grantRef : crypto.randomUUID(), observationKey = key ?? `${b.id}:connection`;
  const old = data.securityModel.entities.find(e => e.id === grantRef);
  const grant = securityEntitySchema.parse({ ...old, id: grantRef, kind: 'grant', grantType: 'sso', grantorRef: provider.id, granteeRef: rootRef, targetRefs: [rootRef], permissions: ['sign-in'], label: `${b.provider === 'google' ? 'Google' : 'Apple'} → Nord Account`, createdAt: old?.createdAt ?? now, nordSsoGrant: 'v1', nordSsoBindingRef: b.id });
  const requiredGuideSteps = [...PREP.map(id => b.records[id].key), ...(created ? ['connect', 'provider-account', 'provider-auth'].flatMap(id => b.records[id] ? [b.records[id].key] : []) : [])];
  const meta = { nordSsoEvidence: 'v1', nordSsoBindingRef: b.id, nordSsoPurpose: 'connection', observationActionId: observationKey, requiredGuideSteps };
  const relations = [
    { id: `${b.id}:provider`, fromRef: provider.id, toRef: grantRef, kind: 'grants-access-to' as const },
    { id: `${b.id}:nord`, fromRef: grantRef, toRef: rootRef, kind: 'authenticates-to' as const },
  ].map(r => ({ ...data.securityModel.relations.find(e => e.id === r.id), ...r, ...meta, evidence: 'user-confirmed' as const, checkedAt: now, sourceIds: ['nordConnections', 'nordAlternatives'] }));
  const next = { ...data, securityModel: { ...data.securityModel, entities: [...data.securityModel.entities.filter(e => e.id !== grantRef), grant], relations: [...data.securityModel.relations.filter(r => !relations.some(e => e.id === r.id)), ...relations] } };
  return writeBinding(next, { ...b, grantRef, connectedAt: now, ...(created ? { connectionCreatedAt: b.connectionCreatedAt ?? now } : {}), records: { ...b.records, connection: { key: observationKey, at: now, requiredGuideSteps, requiredPhoneRecords: [] } } });
}
export function reportNordSsoDisconnected(data: Dataset, rootRef: string, now = new Date().toISOString()): Dataset {
  const b = nordSsoBinding(data, rootRef); if (data.version !== 2 || !b) return data;
  let next = b.records.connection ? undoNordSsoEvidence(data, b.records.connection.key) : data;
  if (next.version === 2 && b.grantRef) next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [b.grantRef]: { ...next.securityModel.lifecycle[b.grantRef], state: 'revoked', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now } } } };
  return next;
}
export function recordNordSsoPreparation(data: Dataset, key: string, appId: string, recipeId: string, step: GuideStep, requiredGuideSteps: string[], now: string): Dataset {
  if (data.version !== 2 || !/^cloud-sso-(prepare|add):/.test(recipeId)) return data;
  const app = data.securityModel.entities.find(e => e.id === appId && e.kind === 'installation'), vault = data.securityModel.entities.find(e => e.id === app?.vaultRef && e.kind === 'vault');
  const b = nordSsoBinding(data, typeof vault?.authenticationAccountRef === 'string' ? vault.authenticationAccountRef : undefined);
  if (!b || recipeId.split(':')[1] !== b.id) return data;
  let next = writeBinding(data, { ...b, records: { ...b.records, [step.id]: { key, at: now, requiredGuideSteps, requiredPhoneRecords: [] } } });
  if (step.id === 'outside') {
    const factId = `${b.id}:outside`, vaultRefs = data.securityModel.entities.filter(e => e.kind === 'vault' && e.productId === 'nordpass' && e.authenticationAccountRef === b.rootRef).map(e => e.id);
    const fact = { ...data.securityModel.facts.find(f => f.id === factId), id: factId, label: 'Provider access retrieved outside the dependent NordPass store', state: 'available' as const, evidence: 'user-confirmed' as const, checkedAt: now, requiredRefs: [b.providerRef], contexts: ['normal' as const], dependencyCompleteness: 'partial' as const, sourceIds: ['nordSso'], nordSsoEvidence: 'v1', nordSsoBindingRef: b.id, nordSsoPurpose: 'outside', independentOfVaultRefs: vaultRefs, observationActionId: key, requiredGuideSteps };
    next = { ...next, securityModel: { ...next.securityModel, facts: [...next.securityModel.facts.filter(f => f.id !== factId), fact] } };
  }
  if (recipeId.startsWith('cloud-sso-add:') && step.id === 'connected') return confirmNordSsoConnection(next, b.rootRef, key, now, true);
  return next;
}
export function undoNordSsoEvidence(data: Dataset, key: string): Dataset {
  if (data.version !== 2) return data;
  const store = nordSsoStore(data); if (!store) return data;
  const withdrawn = new Set([key]);
  let changed = true;
  while (changed) { changed = false; for (const b of store.bindings) for (const r of Object.values(b.records)) if (!withdrawn.has(r.key) && [...r.requiredGuideSteps, ...r.requiredPhoneRecords].some(k => withdrawn.has(k))) { withdrawn.add(r.key); changed = true; } }
  const bindings = store.bindings.map(b => ({ ...b, ...(['outside', 'connection'].some(id => b.records[id] && withdrawn.has(b.records[id].key)) ? { proofEpoch: crypto.randomUUID() } : {}), records: Object.fromEntries(Object.entries(b.records).filter(([, r]) => !withdrawn.has(r.key))) }));
  const remove = (r: Record<string, unknown>) => r.nordSsoEvidence === 'v1' && (typeof r.observationActionId === 'string' && withdrawn.has(r.observationActionId) || ['requiredGuideSteps', 'requiredPhoneRecords', 'requiredNordSsoRecords'].some(k => Array.isArray(r[k]) && (r[k] as unknown[]).some(v => typeof v === 'string' && withdrawn.has(v))));
  return write({ ...data, securityModel: { ...data.securityModel, relations: data.securityModel.relations.map(r => remove(r) ? { ...r, evidence: 'unknown' } : r), facts: data.securityModel.facts.map(f => remove(f) ? { ...f, state: 'unknown', evidence: 'unknown' } : f) } }, { ...store, bindings });
}
export function startNordSsoSession(data: Dataset, appRef: string, returnTo: string): { data: CurrentDataset; id?: string } {
  let next = editable(data); const app = next.securityModel.entities.find(e => e.id === appRef && e.kind === 'installation'), vault = next.securityModel.entities.find(e => e.id === app?.vaultRef && e.kind === 'vault');
  if (!app || !vault || vault.productId !== 'nordpass' || !/^\/(guide|map|phone\/[^?#]+|recover\/nord\/[^?#]+)$/.test(returnTo)) return { data: next };
  const store = nordSsoStore(next) ?? empty(), existing = store.sessions.find(s => s.appRef === appRef && s.returnTo === returnTo && !s.finished);
  if (existing) return { data: next, id: existing.id };
  const id = crypto.randomUUID(), guide = guideSchema.parse({ ...next.guide, nordSsoSessionV1: id, managerId: vault.id, answers: { ...next.guide.answers, [`${vault.id}:installation`]: appRef }, cursor: nordSsoChoiceRoute(next, typeof vault.authenticationAccountRef === 'string' ? vault.authenticationAccountRef : '', vault.id) ?? nordSsoSetupRoute(next, typeof vault.authenticationAccountRef === 'string' ? vault.authenticationAccountRef : '', vault.id, appRef) ?? `cloud-ready/${vault.id}` });
  next = write(next, { ...store, sessions: [...store.sessions, { id, appRef, vaultRef: vault.id, guide, returnTo, createdAt: new Date().toISOString(), finished: false }] });
  return { data: next, id };
}
export function saveNordSsoSession(data: Dataset, child: Dataset, id: string): Dataset {
  if (data.version !== 2 || child.version !== 2) return data;
  const store = nordSsoStore(child), session = store?.sessions.find(s => s.id === id); if (!store || !session) return data;
  const vault = child.securityModel.entities.find(e => e.id === session.vaultRef && e.kind === 'vault');
  // Preserve the original main guide. A deliberate correction to an existing
  // shared action is reflected in both guides instead of retaining two truths.
  const removed = Object.keys(data.guide.steps).filter(key => Object.hasOwn(guideSchema.parse(session.guide).steps, key) && !Object.hasOwn(child.guide.steps, key));
  const main = removed.length ? { ...data.guide, steps: Object.fromEntries(Object.entries(data.guide.steps).filter(([key]) => !removed.includes(key))) } : data.guide;
  let shared = { ...child, guide: main };
  const phoneId = session.returnTo.startsWith('/phone/') ? session.returnTo.slice('/phone/'.length) : undefined;
  if (phoneId && ((typeof vault?.authenticationAccountRef === 'string' && (store.methods[vault.authenticationAccountRef] ?? child.guide.answers[`${vault.authenticationAccountRef}:cloud-method`]) === 'direct') || nordSsoReady(child, typeof vault?.authenticationAccountRef === 'string' ? vault.authenticationAccountRef : undefined))) shared = { ...shared, deviceWorkflows: shared.deviceWorkflows.map(w => w.id === phoneId && w.cursor === `cloud:${session.vaultRef}:sso` ? { ...w, cursor: `cloud:${session.vaultRef}:recovery`, history: [...w.history, w.cursor] } : w) };
  return write(shared, { ...store, sessions: store.sessions.map(s => s.id === id ? { ...s, guide: child.guide, finished: (typeof vault?.authenticationAccountRef === 'string' && (store.methods[vault.authenticationAccountRef] ?? child.guide.answers[`${vault.authenticationAccountRef}:cloud-method`]) === 'direct') || nordSsoReady(child, typeof vault?.authenticationAccountRef === 'string' ? vault.authenticationAccountRef : undefined) } : s) });
}
export const nordSsoName = (provider: 'google' | 'apple', language: Language) => provider === 'google' ? language === 'ja' ? 'Google アカウント' : 'Google Account' : 'Apple Account';
