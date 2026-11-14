import { makeAsset, upgradeDataset, type Asset, type CurrentDataset, type Dataset, type Language } from './models';
import { securityEntitySchema, type SecurityEntity } from './securityModel';

export type PasswordVault = Extract<SecurityEntity, { kind: 'vault' }>;
export type PasswordInstallation = Extract<SecurityEntity, { kind: 'installation' }>;
export type StoreProduct = { id: string; names: Record<Language, string>; provider: NonNullable<Asset['provider']>; accountName: string; local?: boolean; revision?: 2 };
export function resolvePasswordEntity(data: Dataset, id: string | undefined, kind: 'vault' | 'installation'): SecurityEntity | undefined {
  if (data.version !== 2) return;
  const seen = new Set<string>(); let ref = id;
  while (ref && !seen.has(ref)) {
    seen.add(ref);
    const entity = data.securityModel.entities.find(e => e.id === ref && e.kind === kind);
    if (!entity) return;
    if (!entity.mergedIntoRef) return entity;
    ref = typeof entity.mergedIntoRef === 'string' ? entity.mergedIntoRef : undefined;
  }
}
export function passwordVault(data: Dataset, id: string | undefined, products: readonly StoreProduct[]): PasswordVault | undefined {
  const vault = resolvePasswordEntity(data, id, 'vault');
  return vault?.kind === 'vault' && products.some(p => p.id === vault.productId) ? vault : undefined;
}
export function passwordInstallation(data: Dataset, id: string | undefined, products: readonly StoreProduct[]): PasswordInstallation | undefined {
  const app = resolvePasswordEntity(data, id, 'installation');
  return app?.kind === 'installation' && passwordVault(data, app.vaultRef, products) ? app : undefined;
}
export function makePasswordVault(data: Dataset, product: StoreProduct, language: Language): CurrentDataset {
  const next = upgradeDataset(data), now = new Date().toISOString();
  const count = next.securityModel.entities.filter(e => e.kind === 'vault' && e.productId === product.id).length;
  const vault = securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'vault', productId: product.id, label: `${product.names[language]} ${count + 1}`, createdAt: now, controls: {}, controlEvidence: {}, ...(!product.local ? { storageMode: 'account' } : {}), ...(product.revision ? { storeScope: 'personal-account-store' } : {}) });
  return { ...next, securityModel: { ...next.securityModel, revision: next.securityModel.revision === 3 ? 3 : product.revision ?? next.securityModel.revision, entities: [...next.securityModel.entities, vault] }, guide: { ...next.guide, managerId: vault.id } };
}
export function choosePasswordDevice(data: Dataset, vaultId: string, deviceId: string, products: readonly StoreProduct[]): Dataset {
  const vault = passwordVault(data, vaultId, products), device = data.assets.find(a => a.id === deviceId && a.kind === 'device');
  if (data.version !== 2 || !vault || !device) return data;
  const config = products.find(p => p.id === vault.productId)!;
  const existing = data.securityModel.entities.find(e => e.kind === 'installation' && !e.mergedIntoRef && e.productId === vault.productId && e.vaultRef === vault.id && e.deviceRef === deviceId);
  const app = existing ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'installation', label: `${config.names[data.settings.language]} · ${device.name}`.slice(0, 80), productId: vault.productId, deviceRef: deviceId, vaultRef: vault.id, createdAt: new Date().toISOString(), controls: {}, controlEvidence: {} });
  return { ...data, securityModel: { ...data.securityModel, entities: [...data.securityModel.entities.filter(e => e.id !== app.id).map(e => e.id === vault.id ? { ...e, primaryDeviceRef: deviceId } : e), app] }, guide: { ...data.guide, managerId: vault.id, answers: { ...data.guide.answers, [`${vault.id}:installation`]: app.id } } };
}
function containsReference(value: unknown, ids: string[]): boolean {
  const pending: unknown[] = [value], seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    // Inspect raw strings, including cursors, so quotes/backslashes in imported
    // IDs cannot disappear behind JSON escaping and permit an unsafe merge.
    if (typeof item === 'string' && ids.some(id => item.includes(id))) return true;
    if (item && typeof item === 'object' && !seen.has(item)) { seen.add(item); pending.push(...Object.keys(item), ...Object.values(item)); }
  }
  return false;
}
export function configurePasswordRoot(data: Dataset, vaultId: string, mode: 'account' | 'local', rootId: string | undefined, products: readonly StoreProduct[]): Dataset {
  if (data.version !== 2) return data;
  const vault = passwordVault(data, vaultId, products); if (!vault) return data;
  const config = products.find(p => p.id === vault.productId)!;
  if (mode === 'local' && !config.local) return data;
  if (rootId && !data.assets.some(a => a.id === rootId && a.kind === 'account' && a.provider === config.provider)) return data;
  const selected = passwordInstallation(data, data.guide.answers[`${vault.id}:installation`], products)?.deviceRef ?? vault.primaryDeviceRef;
  const matching = mode === 'account' && rootId ? data.securityModel.entities.find(e => e.kind === 'vault' && !e.mergedIntoRef && e.id !== vault.id && e.productId === vault.productId && e.storageMode === mode && e.authenticationAccountRef === rootId && e.storeScope === vault.storeScope) : undefined;
  if (matching?.kind === 'vault') {
    let next = selected && !config.revision ? choosePasswordDevice(data, matching.id, selected, products) : { ...data, guide: { ...data.guide, managerId: matching.id } };
    if (next.version !== 2 || vault.authenticationAccountRef) return next;
    const provisional = next.securityModel.entities.filter(e => e.id === vault.id || (e.kind === 'installation' && e.vaultRef === vault.id)), ids = provisional.map(e => e.id);
    const observed = { actions: next.actions, steps: next.guide.steps, dependencies: next.dependencies, workflows: next.deviceWorkflows, model: { ...next.securityModel, entities: next.securityModel.entities.filter(e => !ids.includes(e.id)) } };
    if (provisional.some(e => (e.kind === 'installation' || e.kind === 'vault') && Object.keys(e.controls ?? {}).length > 0) || containsReference(observed, ids)) return next;
    const model = next.securityModel;
    next = { ...next, securityModel: { ...model, entities: model.entities.map(e => {
      if (e.id === vault.id) return { ...e, mergedIntoRef: matching.id };
      if (e.kind !== 'installation' || e.vaultRef !== vault.id) return e;
      const app = model.entities.find(i => i.kind === 'installation' && !i.mergedIntoRef && i.vaultRef === matching.id && i.deviceRef === e.deviceRef);
      return app ? { ...e, mergedIntoRef: app.id } : e;
    }) } };
    return next;
  }
  let next: Dataset = data, chosen = vault.id;
  if ((vault.authenticationAccountRef && rootId && vault.authenticationAccountRef !== rootId) || (vault.storageMode && vault.storageMode !== mode)) {
    next = makePasswordVault(data, config, data.settings.language); chosen = next.guide.managerId!;
    if (selected && !config.revision) next = choosePasswordDevice(next, chosen, selected, products);
  }
  if (next.version !== 2) return data;
  return { ...next, securityModel: { ...next.securityModel, entities: next.securityModel.entities.map(e => e.id === chosen && e.kind === 'vault' ? { ...e, storageMode: mode, authenticationAccountRef: mode === 'account' ? rootId ?? e.authenticationAccountRef : undefined } : e) }, guide: { ...next.guide, managerId: chosen } };
}
export function addPasswordRoot(data: Dataset, vaultId: string, purpose: 'personal' | 'work', products: readonly StoreProduct[]): Dataset {
  const vault = passwordVault(data, vaultId, products), config = products.find(p => p.id === vault?.productId); if (!vault || !config) return data;
  const account = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: `${config.accountName} · ${purpose === 'personal' ? data.settings.language === 'ja' ? '個人用' : 'Personal' : data.settings.language === 'ja' ? '仕事用' : 'Work'} ${data.assets.filter(a => a.provider === config.provider).length + 1}`, importance: 'critical' }), provider: config.provider, purpose, services: [] };
  return configurePasswordRoot({ ...data, assets: [...data.assets, account] }, vault.id, 'account', account.id, products);
}
