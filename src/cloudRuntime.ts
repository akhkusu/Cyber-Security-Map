import type { Asset, Dataset } from './models';
import type { GuideStep, Recipe } from './guideCatalog';
import { cloudManagerRecipe } from './cloudManagerCatalog';
import { cloudRecoveryRecipe } from './cloudRecoveryCatalog';
import { cloudPasswordRecipe } from './cloudPasswordCatalog';
import { cloudMasterRecipe } from './cloudMasterCatalog';
import { cloudAnswer, cloudEnvironmentReady, cloudInstallation, cloudManagerReady, cloudMasterRecipeId, cloudSetupRoute, cloudVault } from './cloudManagers';

export function cloudRecipeFor(data: Dataset, asset: Asset, recipeId: string): Recipe | undefined {
  if (recipeId.startsWith('cloud-password:')) return cloudPasswordRecipe(data, asset, recipeId.slice('cloud-password:'.length));
  if (!recipeId.startsWith('cloud-')) return;
  return cloudManagerRecipe(data, asset.id, recipeId) ?? cloudRecoveryRecipe(data, asset.id, recipeId) ?? cloudMasterRecipe(data, asset.id, recipeId);
}
export function cloudRequiredSteps(assetId: string, recipe: Recipe, step: GuideStep): string[] {
  const found = new Set<string>(), pending = [...(step.requires ?? [])];
  while (pending.length) {
    const id = pending.pop()!;
    if (found.has(id) || id === step.id) continue;
    found.add(id); pending.push(...(recipe.steps.find(s => s.id === id)?.requires ?? []));
  }
  return [...found].map(id => `do/${assetId}/${recipe.id}/${id}`);
}
export function cloudTaskRedirect(data: Dataset, asset: Asset, recipe: Recipe, step: GuideStep): string | undefined {
  if (!recipe.id.startsWith('cloud-')) return;
  const app = cloudInstallation(data, recipe.id.startsWith('cloud-password:') ? recipe.id.slice('cloud-password:'.length) : asset.id), vault = cloudVault(data, app?.vaultRef);
  if (!app || !vault || data.version !== 2 || data.securityModel.revision !== 2) return 'manager-select';
  const root = data.assets.find(a => a.id === vault.authenticationAccountRef), device = data.assets.find(a => a.id === app.deviceRef);
  const context = { ...data, guide: { ...data.guide, managerId: vault.id, answers: { ...data.guide.answers, [`${vault.id}:installation`]: app.id } } };
  if (!root || root.purpose !== 'personal' || !device || !['ios', 'android', 'macos', 'windows', 'ubuntu', 'chromeos'].includes(device.operatingSystem ?? '')) return cloudSetupRoute(context, vault.id);
  if (vault.productId === 'nordpass' && cloudAnswer(data, root.id, 'method') !== 'direct') return cloudSetupRoute(context, vault.id);
  if (!['ios', 'android'].includes(device.operatingSystem ?? '') && !app.profileLabel) return cloudSetupRoute(context, vault.id);
  if (!cloudEnvironmentReady(data, app.id)) return cloudSetupRoute(context, vault.id);
  if (recipe.id !== 'cloud-onboard' && !['opened', 'storageChecked'].every(c => app.controls?.[c] === 'verified')) return `do/${app.id}/cloud-onboard/open`;
  if (recipe.id.startsWith('cloud-master-change:') && (recipe.id !== cloudMasterRecipeId(data, vault.id) || cloudAnswer(data, vault.id, 'master') !== 'change' || !['recovery', 'independentRoot'].every(c => vault.controls?.[c] === 'verified') || !['mfa', 'recovery'].every(c => root.controls[c] === 'verified'))) return cloudSetupRoute(context, vault.id);
  const choice = recipe.id === 'cloud-recovery' ? ['recovery', vault.id] : ['cloud-phrase', 'cloud-file', 'cloud-reset'].includes(recipe.id) ? [recipe.id.slice('cloud-'.length), root.id] : undefined;
  if (choice) {
    const mode = cloudAnswer(data, choice[1], choice[0]);
    const valid = choice[0] === 'reset' ? ['existing-email', 'existing-sms', 'new-email', 'new-sms'] : ['existing', 'new'];
    if (!valid.includes(mode ?? '')) return `cloud-${choice[0]}/${vault.id}`;
  }
  if (recipe.id.startsWith('cloud-password:')) {
    const alreadyApplied = data.guide.steps[`do/${asset.id}/${recipe.id}/apply`]?.status === 'done';
    // After a real password change, always let the user finish saving it. A
    // subsequently withdrawn setup check must not strand the accepted password.
    if ((!cloudManagerReady(data, vault.id, app.id) || !['verified', 'implemented'].includes(asset.controls.recovery)) && !alreadyApplied) return 'password-prerequisite';
  }
  const missing = cloudRequiredSteps(asset.id, recipe, step).find(key => data.guide.steps[key]?.status !== 'done');
  if (missing) return missing;
}
