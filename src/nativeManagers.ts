import { recordedUnavailable } from './recordAvailability';
import type { Asset, CurrentDataset, Dataset, Language } from './models';
import type { SecurityEntity } from './securityModel';
import { addPasswordRoot, choosePasswordDevice, configurePasswordRoot, makePasswordVault, passwordInstallation, passwordVault, type StoreProduct } from './passwordStoreIdentity';
import { guideSubject } from './subjects';
import { cloudManagerReady, cloudVault } from './cloudManagers';

export const NATIVE_PRODUCTS = ['apple-passwords', 'google-password-manager'] as const;
export type NativeProduct = (typeof NATIVE_PRODUCTS)[number];
export const NATIVE_NAMES: Record<NativeProduct, { en: string; ja: string }> = {
  'apple-passwords': { en: 'Apple Passwords', ja: 'Apple「パスワード」' },
  'google-password-manager': { en: 'Google Password Manager', ja: 'Google パスワード マネージャー' },
};
export type NativeVault = Extract<SecurityEntity, { kind: 'vault' }>;
export type NativeInstallation = Extract<SecurityEntity, { kind: 'installation' }>;
const STORE_PRODUCTS: StoreProduct[] = NATIVE_PRODUCTS.map(id => ({ id, names: NATIVE_NAMES[id], provider: id === 'apple-passwords' ? 'apple' : 'google', accountName: id === 'apple-passwords' ? 'Apple Account' : 'Google Account', local: id === 'google-password-manager' }));
export const nativeVault = (data: Dataset, id?: string): NativeVault | undefined => passwordVault(data, id, STORE_PRODUCTS);
export const nativeInstallation = (data: Dataset, id: string): NativeInstallation | undefined => passwordInstallation(data, id, STORE_PRODUCTS);
export const selectedNativeInstallation = (data: Dataset, vaultId: string): NativeInstallation | undefined => nativeInstallation(data, data.guide.answers[`${vaultId}:installation`] ?? '');
export const makeNativeVault = (data: Dataset, product: NativeProduct, language: Language): CurrentDataset => makePasswordVault(data, STORE_PRODUCTS.find(p => p.id === product)!, language);
export const chooseNativeDevice = (data: Dataset, vaultId: string, deviceId: string): Dataset => choosePasswordDevice(data, vaultId, deviceId, STORE_PRODUCTS);
export const configureNativeStorage = (data: Dataset, vaultId: string, mode: 'account' | 'local', rootId?: string): Dataset => configurePasswordRoot(data, vaultId, mode, rootId, STORE_PRODUCTS);
export const addNativeRoot = (data: Dataset, vaultId: string, purpose: 'personal' | 'work'): Dataset => addPasswordRoot(data, vaultId, purpose, STORE_PRODUCTS);
export function managerReady(data: Dataset, vaultId = data.guide.managerId, installationId?: string): boolean {
  if(recordedUnavailable(data,[vaultId]))return false;
  if (cloudVault(data, vaultId)) return cloudManagerReady(data, vaultId!, installationId);
  const vault = nativeVault(data, vaultId);
  if (!vault) return ['implemented', 'verified'].includes(data.assets.find(a => a.id === data.guide.managerId)?.controls.mfa ?? 'unknown');
  const installation = installationId ? nativeInstallation(data, installationId) : selectedNativeInstallation(data, vault.id);
  const device = data.assets.find(a => a.id === installation?.deviceRef);
  if (recordedUnavailable(data,[installation?.id,vault?.id]))return false;
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
