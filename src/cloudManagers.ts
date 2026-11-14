import { makeAsset, type Asset, type Dataset, type Language, type OperatingSystem } from './models';
import { nordRecoveryMasterConfirmed, nordRecoveryPending } from './nordRecoverySchemas';
import { securityEntitySchema } from './securityModel';
import { addPasswordRoot, configurePasswordRoot, makePasswordVault, passwordInstallation, passwordVault, type StoreProduct } from './passwordStoreIdentity';

export const CLOUD_PRODUCTS = ['proton-pass', 'nordpass'] as const;
export type CloudProduct = (typeof CLOUD_PRODUCTS)[number];
export const CLOUD_NAMES = { 'proton-pass': { en: 'Proton Pass', ja: 'Proton Pass' }, nordpass: { en: 'NordPass', ja: 'NordPass' } };
export const CLOUD_STORE_PRODUCTS: readonly StoreProduct[] = CLOUD_PRODUCTS.map(id => ({ id, names: CLOUD_NAMES[id], provider: id === 'proton-pass' ? 'proton' : 'nord', accountName: id === 'proton-pass' ? 'Proton Account' : 'Nord Account', revision: 2 }));
export const cloudVault = (data: Dataset, id?: string) => passwordVault(data, id, CLOUD_STORE_PRODUCTS);
export const cloudInstallation = (data: Dataset, id?: string) => passwordInstallation(data, id, CLOUD_STORE_PRODUCTS);
export const selectedCloudInstallation = (data: Dataset, vaultId: string) => cloudInstallation(data, data.guide.answers[`${vaultId}:installation`]);
export const makeCloudVault = (data: Dataset, product: CloudProduct, language: Language) => makePasswordVault(data, CLOUD_STORE_PRODUCTS.find(p => p.id === product)!, language);
export const configureCloudRoot = (data: Dataset, vaultId: string, rootId: string) => configurePasswordRoot(data, vaultId, 'account', rootId, CLOUD_STORE_PRODUCTS);
export function addCloudRoot(data: Dataset, vaultId: string, purpose: 'personal' | 'work', existing: boolean): Dataset {
  const next = addPasswordRoot(data, vaultId, purpose, CLOUD_STORE_PRODUCTS);
  const vault = cloudVault(next, next.guide.managerId);
  return { ...next, guide: { ...next.guide, answers: { ...next.guide.answers, ...(vault?.authenticationAccountRef ? { [`${vault.authenticationAccountRef}:cloud-account`]: existing ? 'existing' : 'new', ...(!existing && vault.productId === 'nordpass' ? { [`${vault.authenticationAccountRef}:cloud-method`]: 'direct' } : {}) } : {}) } } };
}
export function chooseCloudDevice(data: Dataset, vaultId: string, deviceRef: string, existingInstallation?: string): Dataset {
  const vault = cloudVault(data, vaultId), device = data.assets.find(a => a.id === deviceRef && a.kind === 'device');
  if (data.version !== 2 || !vault || !device) return data;
  const existing = cloudInstallation(data, existingInstallation);
  if (existingInstallation && (!existing || existing.vaultRef !== vault.id || existing.deviceRef !== deviceRef)) return data;
  const root = data.assets.find(a => a.id === vault.authenticationAccountRef);
  const existingStore = data.securityModel.entities.some(e => e.kind === 'installation' && e.vaultRef === vault.id && e.controls?.opened === 'verified');
  const app = existing ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'installation', productId: vault.productId, vaultRef: vault.id, deviceRef, label: `${CLOUD_NAMES[vault.productId as CloudProduct][data.settings.language]} · ${device.name} ${data.securityModel.entities.filter(e => e.kind === 'installation' && e.deviceRef === deviceRef && e.vaultRef === vault.id).length + 1}`.slice(0, 80), createdAt: new Date().toISOString(), controls: {}, controlEvidence: {}, cloudSettings: { usage: existingStore ? 'existing' : cloudAnswer(data, vault.id, 'usage') ?? 'existing', account: root?.controls.accountAvailable === 'verified' ? 'existing' : cloudAnswer(data, root?.id ?? '', 'account') ?? 'existing' } });
  return { ...data, securityModel: { ...data.securityModel, entities: [...data.securityModel.entities.filter(e => e.id !== app.id), app] }, guide: { ...data.guide, managerId: vault.id, answers: { ...data.guide.answers, [`${vault.id}:installation`]: app.id } } };
}
export function addCloudDevice(data: Dataset, vaultId: string, operatingSystem: OperatingSystem): Dataset {
  const labels = { ios: 'iPhone / iPad', android: 'Android', macos: 'Mac', windows: 'Windows', ubuntu: 'Linux', chromeos: 'ChromeOS', other: 'Device', unknown: 'Device' };
  const device = makeAsset({ kind: 'device', type: ['ios', 'android'].includes(operatingSystem) ? 'Smartphone' : 'Computer', name: `${labels[operatingSystem]} ${data.assets.filter(a => a.kind === 'device').length + 1}`, importance: 'critical', operatingSystem });
  return chooseCloudDevice({ ...data, assets: [...data.assets, device] }, vaultId, device.id);
}
export function setCloudAnswer(data: Dataset, ref: string, key: string, answer: string): Dataset {
  const app = cloudInstallation(data, ref) ?? (key === 'usage' ? selectedCloudInstallation(data, ref) : undefined);
  if (app && data.version === 2 && ['usage', 'account', 'browser', 'ios', 'android'].includes(key)) {
    if (key === 'browser' && cloudAnswer(data, app.id, key) && cloudAnswer(data, app.id, key) !== answer && Object.keys(app.controls ?? {}).length) {
      const next = chooseCloudDevice(data, app.vaultRef!, app.deviceRef);
      return setCloudAnswer(next, selectedCloudInstallation(next, app.vaultRef!)!.id, key, answer);
    }
    const previous = app.cloudSettings && typeof app.cloudSettings === 'object' && !Array.isArray(app.cloudSettings) ? app.cloudSettings : {};
    return { ...data, securityModel: { ...data.securityModel, entities: data.securityModel.entities.map(e => e.id === app.id ? { ...e, cloudSettings: { ...previous, [key]: answer } } : e) } };
  }
  return { ...data, guide: { ...data.guide, answers: { ...data.guide.answers, ...(key === 'master' && answer === 'change' && (cloudAnswer(data, ref, key) !== 'change' || cloudMasterChanged(data, ref)) ? { [`${ref}:cloud-master-request`]: crypto.randomUUID() } : {}), [`${ref}:cloud-${key}`]: answer } } };
}
export const cloudAnswer = (data: Dataset, ref: string, key: string): string | undefined => {
  const app = cloudInstallation(data, ref), settings = app?.cloudSettings;
  const value = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : data.guide.answers[`${ref}:cloud-${key}`];
};
export function cloudSubject(data: Dataset, id: string): Asset | undefined {
  const install = cloudInstallation(data, id), vault = cloudVault(data, install?.vaultRef ?? id); if (!vault) return;
  const root = data.assets.find(a => a.id === vault.authenticationAccountRef);
  return { id: install?.id ?? vault.id, kind: 'account', type: 'Password vault', name: install?.label ?? vault.label, importance: 'critical', createdAt: vault.createdAt, updatedAt: vault.createdAt, provider: vault.productId === 'proton-pass' ? 'proton' : 'nord', purpose: root?.purpose, services: ['manager'], controls: (install ?? vault).controls ?? {}, controlEvidence: (install ?? vault).controlEvidence ?? {}, operatingSystem: data.assets.find(a => a.id === install?.deviceRef)?.operatingSystem };
}
const recorded = (a: { controls?: Asset['controls'] } | undefined, key: string) => ['verified', 'implemented'].includes(a?.controls?.[key] ?? 'unknown');
export function cloudEnvironmentReady(data: Dataset, appId: string): boolean {
  const app = cloudInstallation(data, appId), vault = cloudVault(data, app?.vaultRef), os = data.assets.find(a => a.id === app?.deviceRef)?.operatingSystem;
  if (!app || !vault || (data.version === 2 && data.securityModel.revision >= 4 && app.nordRecoverySurface === 'native-v1' && !['ios', 'android'].includes(os ?? ''))) return false;
  if (os === 'ios') return ['ios18plus', ...(vault.productId === 'proton-pass' ? ['ios17'] : [])].includes(cloudAnswer(data, app.id, 'ios') ?? '');
  if (os === 'android') return vault.productId === 'proton-pass' || cloudAnswer(data, app.id, 'android') === 'android9plus';
  const browser = cloudAnswer(data, app.id, 'browser') ?? '';
  return ['macos', 'windows', 'ubuntu', 'chromeos'].includes(os ?? '') && !!app.profileLabel?.trim() && ['chrome', 'firefox', 'edge', 'safari', 'brave', 'opera'].includes(browser) && (browser !== 'safari' || os === 'macos');
}
export const cloudMasterRecipeId = (data: Dataset, vaultId: string) => `cloud-master-change:${cloudAnswer(data, vaultId, 'master-request') ?? 'initial'}`;
export function cloudMasterChanged(data: Dataset, vaultId: string): boolean {
  const vault = cloudVault(data, vaultId), recipe = cloudMasterRecipeId(data, vaultId);
  return nordRecoveryMasterConfirmed(data, vaultId, cloudAnswer(data, vaultId, 'master-request')) || !!vault && recorded(vault, 'masterChanged') && data.actions.some(a => a.targetId === vault.id && a.controlId === 'masterChanged' && a.status === 'completed' && a.parentId?.includes(`/${recipe}/test`) && Array.isArray(a.requiredGuideSteps) && a.requiredGuideSteps.every(key => typeof key === 'string' && data.guide.steps[key]?.status === 'done'));
}
export function cloudManagerReady(data: Dataset, vaultId: string, installationId?: string): boolean {
  const vault = cloudVault(data, vaultId), app = installationId ? cloudInstallation(data, installationId) : selectedCloudInstallation(data, vaultId);
  const root = data.assets.find(a => a.id === vault?.authenticationAccountRef), device = data.assets.find(a => a.id === app?.deviceRef);
  if (nordRecoveryPending(data, vaultId) || data.version !== 2 || data.securityModel.revision < 2 || !vault || !app || app.vaultRef !== vault.id || !cloudEnvironmentReady(data, app.id) || root?.purpose !== 'personal' || (vault.productId === 'nordpass' && cloudAnswer(data, root.id, 'method') !== 'direct')) return false;
  const master = cloudAnswer(data, vault.id, 'master');
  const masterReady = vault.productId !== 'nordpass' || master === 'keep' || (master === 'change' ? cloudMasterChanged(data, vault.id) : recorded(vault, 'masterStrength'));
  return masterReady && ['opened', 'storageChecked', 'autofill'].every(c => recorded(app, c)) && recorded(device, 'screenLock') && ['mfa', 'recovery'].every(c => recorded(root, c)) && (vault.productId === 'nordpass' ? ['recovery', 'independentRoot'].every(c => recorded(vault, c)) : ['dataRecovery', 'passwordResetRecovery', 'recoveryFile'].every(c => recorded(root, c)));
}
export function cloudSetupRoute(data: Dataset, vaultId: string): string {
  const vault = cloudVault(data, vaultId); if (!vault) return 'manager-select';
  const root = data.assets.find(a => a.id === vault.authenticationAccountRef), app = selectedCloudInstallation(data, vault.id);
  if (nordRecoveryPending(data, vault.id)) return `cloud-recovery-pending/${vault.id}`;
  if (!root) return `cloud-root/${vault.id}`;
  if (!root.purpose) return `cloud-purpose/${vault.id}`;
  if (root.purpose === 'work') return `cloud-managed/${vault.id}`;
  if (vault.productId === 'nordpass' && !cloudAnswer(data, root.id, 'method')) return `cloud-account-method/${vault.id}`;
  if (vault.productId === 'nordpass' && cloudAnswer(data, root.id, 'method') !== 'direct') return `cloud-sso-unavailable/${vault.id}`;
  if (!cloudAnswer(data, vault.id, 'usage')) return `cloud-usage/${vault.id}`;
  if (!app) return `cloud-device/${vault.id}`;
  const device = data.assets.find(a => a.id === app.deviceRef);
  if (!device?.operatingSystem || !['ios', 'android', 'macos', 'windows', 'ubuntu', 'chromeos'].includes(device.operatingSystem)) return `cloud-device-os/${vault.id}`;
  if (data.version === 2 && data.securityModel.revision >= 4 && app.nordRecoverySurface === 'native-v1' && !['ios', 'android'].includes(device.operatingSystem)) return `cloud-device/${vault.id}`;
  if (!['ios', 'android'].includes(device.operatingSystem) && !['chrome', 'firefox', 'edge', 'safari', 'brave', 'opera', 'other'].includes(cloudAnswer(data, app.id, 'browser') ?? '')) return `cloud-browser/${vault.id}`;
  if (!['ios', 'android'].includes(device.operatingSystem) && cloudAnswer(data, app.id, 'browser') !== 'other' && !app.profileLabel) return `cloud-profile/${vault.id}`;
  if (device.operatingSystem === 'ios' && !['ios18plus', ...(vault.productId === 'proton-pass' ? ['ios17'] : []), 'other'].includes(cloudAnswer(data, app.id, 'ios') ?? '')) return `cloud-ios/${vault.id}`;
  if (vault.productId === 'nordpass' && device.operatingSystem === 'android' && !['android9plus', 'other'].includes(cloudAnswer(data, app.id, 'android') ?? '')) return `cloud-android/${vault.id}`;
  if (cloudAnswer(data, app.id, 'browser') === 'other' || cloudAnswer(data, app.id, 'ios') === 'other' || cloudAnswer(data, app.id, 'android') === 'other') return `cloud-unsupported/${vault.id}`;
  if (!cloudEnvironmentReady(data, app.id)) return `cloud-unsupported/${vault.id}`;
  if (!['opened', 'storageChecked'].every(c => recorded(app, c))) return `do/${app.id}/cloud-onboard/open`;
  if (vault.productId === 'nordpass' && !['recovery', 'independentRoot'].every(c => recorded(vault, c))) return cloudAnswer(data, vault.id, 'recovery') ? `do/${app.id}/cloud-recovery/open` : `cloud-recovery/${vault.id}`;
  if (vault.productId === 'nordpass' && !cloudAnswer(data, vault.id, 'master') && !recorded(vault, 'masterStrength')) return `cloud-master-review/${vault.id}`;
  if (!['mfa', 'recovery'].every(c => recorded(root, c))) return `cloud-prerequisites/${vault.id}`;
  if (vault.productId === 'nordpass' && cloudAnswer(data, vault.id, 'master') === 'change' && !cloudMasterChanged(data, vault.id)) return `do/${app.id}/${cloudMasterRecipeId(data, vault.id)}/open`;
  if (vault.productId === 'proton-pass') {
    for (const [control, phase] of [['dataRecovery', 'phrase'], ['passwordResetRecovery', 'reset'], ['recoveryFile', 'file']]) if (!recorded(root, control)) return cloudAnswer(data, root.id, phase) ? `do/${app.id}/cloud-${phase}/open` : `cloud-${phase}/${vault.id}`;
  }
  if (!recorded(app, 'autofill') || !recorded(device, 'screenLock')) return `do/${app.id}/cloud-autofill/open`;
  return `cloud-ready/${vault.id}`;
}
