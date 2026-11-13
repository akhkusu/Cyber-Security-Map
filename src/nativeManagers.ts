import { makeAsset, upgradeDataset, type Asset, type CurrentDataset, type Dataset, type Language } from './models';
import { securityEntitySchema, type SecurityEntity } from './securityModel';
import { guideSubject } from './subjects';

export const NATIVE_PRODUCTS = ['apple-passwords', 'google-password-manager'] as const;
export type NativeProduct = (typeof NATIVE_PRODUCTS)[number];
export const NATIVE_NAMES: Record<NativeProduct, { en: string; ja: string }> = {
  'apple-passwords': { en: 'Apple Passwords', ja: 'Apple「パスワード」' },
  'google-password-manager': { en: 'Google Password Manager', ja: 'Google パスワード マネージャー' },
};
export type NativeVault = Extract<SecurityEntity, { kind: 'vault' }>;
export type NativeInstallation = Extract<SecurityEntity, { kind: 'installation' }>;
export function nativeVault(data: Dataset, id?: string): NativeVault | undefined {
  const vault = data.version === 2 ? data.securityModel.entities.find(e => e.id === id && e.kind === 'vault' && NATIVE_PRODUCTS.includes(e.productId as NativeProduct)) : undefined;
  return vault?.kind === 'vault' ? vault : undefined;
}
export function nativeInstallation(data: Dataset, id: string): NativeInstallation | undefined {
  const e = data.version === 2 ? data.securityModel.entities.find(e => e.id === id && e.kind === 'installation') : undefined;
  return e?.kind === 'installation' && nativeVault(data, e.vaultRef) ? e : undefined;
}
export function selectedNativeInstallation(data: Dataset, vaultId: string): NativeInstallation | undefined {
  return nativeInstallation(data, data.guide.answers[`${vaultId}:installation`] ?? '');
}
export function makeNativeVault(data: Dataset, product: NativeProduct, language: Language): CurrentDataset {
  const next = upgradeDataset(data), now = new Date().toISOString();
  const count = next.securityModel.entities.filter(e => e.kind === 'vault' && e.productId === product).length;
  const vault = securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'vault', productId: product, label: `${NATIVE_NAMES[product][language]} ${count + 1}`, createdAt: now, controls: {}, controlEvidence: {}, ...(product === 'apple-passwords' ? { storageMode: 'account' } : {}) });
  return { ...next, securityModel: { ...next.securityModel, entities: [...next.securityModel.entities, vault] }, guide: { ...next.guide, managerId: vault.id } };
}
export function chooseNativeDevice(data: Dataset, vaultId: string, deviceId: string): Dataset {
  if (data.version !== 2 || !nativeVault(data, vaultId) || !data.assets.some(a => a.id === deviceId && a.kind === 'device')) return data;
  const vault = nativeVault(data, vaultId)!;
  const existing = data.securityModel.entities.find(e => e.kind === 'installation' && e.productId === vault.productId && e.vaultRef === vaultId && e.deviceRef === deviceId);
  const installation = existing ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'installation', label: `${NATIVE_NAMES[vault.productId as NativeProduct][data.settings.language]} · ${data.assets.find(a => a.id === deviceId)!.name}`.slice(0, 80), productId: vault.productId, deviceRef: deviceId, vaultRef: vaultId, createdAt: new Date().toISOString(), controls: {}, controlEvidence: {} });
  return { ...data, securityModel: { ...data.securityModel, entities: [...data.securityModel.entities.filter(e => e.id !== installation.id).map(e => e.id === vaultId ? { ...e, primaryDeviceRef: deviceId } : e), installation] }, guide: { ...data.guide, managerId: vaultId, answers: { ...data.guide.answers, [`${vaultId}:installation`]: installation.id } } };
}
export function configureNativeStorage(data: Dataset, vaultId: string, mode: 'account' | 'local', rootId?: string): Dataset {
  if (data.version !== 2) return data;
  const vault = nativeVault(data, vaultId); if (!vault) return data;
  const provider = vault.productId === 'apple-passwords' ? 'apple' : 'google';
  if (mode === 'account' && rootId && !data.assets.some(a => a.id === rootId && a.kind === 'account' && a.provider === provider)) return data;
  if (vault.productId === 'apple-passwords' && mode === 'local') return data;
  // A different cloud account is a different vault. Preserve the old vault and
  // all its observations rather than transferring its completion flags.
  let next: Dataset = data, chosenId = vaultId;
  if ((vault.authenticationAccountRef && rootId && vault.authenticationAccountRef !== rootId) || (vault.storageMode && vault.storageMode !== mode)) {
    next = makeNativeVault(data, vault.productId as NativeProduct, data.settings.language); chosenId = next.guide.managerId!;
    if (vault.primaryDeviceRef) next = chooseNativeDevice(next, chosenId, vault.primaryDeviceRef);
  }
  if (next.version !== 2) return data;
  return { ...next, securityModel: { ...next.securityModel, entities: next.securityModel.entities.map(e => e.id === chosenId && e.kind === 'vault' ? { ...e, storageMode: mode, authenticationAccountRef: mode === 'account' ? rootId ?? e.authenticationAccountRef : undefined } : e) }, guide: { ...next.guide, managerId: chosenId } };
}
export function addNativeRoot(data: Dataset, vaultId: string, purpose: 'personal' | 'work'): Dataset {
  const vault = nativeVault(data, vaultId); if (!vault) return data;
  const provider = vault.productId === 'apple-passwords' ? 'apple' : 'google';
  const account = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: `${provider === 'apple' ? 'Apple Account' : 'Google Account'} · ${purpose === 'personal' ? data.settings.language === 'ja' ? '個人用' : 'Personal' : data.settings.language === 'ja' ? '仕事用' : 'Work'} ${data.assets.filter(a => a.provider === provider).length + 1}`, importance: 'critical' }), provider: provider as Asset['provider'], purpose, services: [] };
  return configureNativeStorage({ ...data, assets: [...data.assets, account] }, vaultId, 'account', account.id);
}
export function managerReady(data: Dataset, vaultId = data.guide.managerId, installationId?: string): boolean {
  const vault = nativeVault(data, vaultId);
  if (!vault) return ['implemented', 'verified'].includes(data.assets.find(a => a.id === data.guide.managerId)?.controls.mfa ?? 'unknown');
  const installation = installationId ? nativeInstallation(data, installationId) : selectedNativeInstallation(data, vault.id);
  const device = data.assets.find(a => a.id === installation?.deviceRef);
  if (!installation || installation.vaultRef !== vault.id || !['opened', 'autofill', 'storageChecked'].every(c => installation.controls?.[c] === 'verified') || !['implemented', 'verified'].includes(device?.controls.screenLock ?? 'unknown')) return false;
  if (vault.storageMode === 'local') return installation.controls?.localBackup === 'verified';
  const root = data.assets.find(a => a.id === vault.authenticationAccountRef);
  return !!root && root.purpose !== 'work' && ['mfa', 'recovery'].every(c => ['implemented', 'verified'].includes(root.controls[c])) && installation.controls?.independentRoot === 'verified';
}
export function nativeSetupRoute(data: Dataset, vaultId: string, installationId?: string): string {
  const vault = nativeVault(data, vaultId); if (!vault) return 'manager-select';
  const installation = installationId ? nativeInstallation(data, installationId) : selectedNativeInstallation(data, vaultId);
  if (!installation || installation.vaultRef !== vault.id) return `native-device/${vaultId}`;
  const device = data.assets.find(a => a.id === installation.deviceRef);
  const supported = vault.productId === 'apple-passwords' ? ['ios', 'macos'] : ['ios', 'android', 'macos', 'windows', 'ubuntu', 'chromeos'];
  if (!device?.operatingSystem || !supported.includes(device.operatingSystem)) return `native-device-os/${vaultId}`;
  if (vault.productId === 'apple-passwords' && (installation.platformVariant ?? data.guide.answers[`${installation.id}:version`]) !== (device.operatingSystem === 'ios' ? 'ios18plus' : 'mac15plus')) return `native-version/${vaultId}`;
  if (!vault.storageMode) return `native-storage/${vaultId}`;
  if (vault.storageMode === 'account' && !vault.authenticationAccountRef) return `native-root/${vaultId}`;
  const root = data.assets.find(a => a.id === vault.authenticationAccountRef);
  if (root && !root.purpose) return `native-root-purpose/${vaultId}`;
  if (root?.purpose === 'work') return `native-managed/${vaultId}`;
  if (root && !['mfa', 'recovery'].every(c => ['implemented', 'verified'].includes(root.controls[c]))) return `native-prerequisites/${vaultId}`;
  return `do/${installation.id}/builtin-manager/open`;
}
export function nativeSubject(data: Dataset, id: string): Asset | undefined {
  const install = nativeInstallation(data, id); if (!install) return guideSubject(data, id);
  const vault = nativeVault(data, install.vaultRef)!;
  const view = guideSubject(data, vault.id)!;
  return { ...view, id: install.id, name: install.label, controls: install.controls ?? {}, controlEvidence: install.controlEvidence ?? {}, operatingSystem: data.assets.find(a => a.id === install.deviceRef)?.operatingSystem };
}

export function setNativeVariant(data: Dataset, installationId: string, variant: 'ios18plus' | 'mac15plus'): Dataset {
  if (data.version !== 2) return data;
  return { ...data, securityModel: { ...data.securityModel, entities: data.securityModel.entities.map(e => e.id === installationId && e.kind === 'installation' ? { ...e, platformVariant: variant } : e) } };
}
