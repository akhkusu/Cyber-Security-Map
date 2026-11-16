import type { Asset, Dataset } from './models';
import type { GuideStep, Recipe } from './guideCatalog';
import { nordSsoRecipe } from './nordSsoCatalog';
import { nordSsoBinding, nordSsoReady } from './nordSsoSchemas';
import { nordSsoChoiceRoute, nordSsoSetupRoute } from './nordSso';
import { cloudManagerRecipe } from './cloudManagerCatalog';
import { cloudRecoveryRecipe } from './cloudRecoveryCatalog';
import { cloudPasswordRecipe } from './cloudPasswordCatalog';
import { cloudMasterRecipe } from './cloudMasterCatalog';
import { protonExtraRecipe } from './protonPassExtraCatalog';
import { extraApplied, extraTaskRedirect } from './protonPassExtra';
import { cloudAnswer, cloudEnvironmentReady, cloudInstallation, cloudManagerReady, cloudMasterRecipeId, cloudMasterChanged, cloudSetupRoute, cloudVault } from './cloudManagers';

export function cloudRecipeFor(data: Dataset, asset: Asset, recipeId: string): Recipe | undefined {
  if (recipeId.startsWith('cloud-password:')) return cloudPasswordRecipe(data, asset, recipeId.slice('cloud-password:'.length));
  if (!recipeId.startsWith('cloud-')) return;
  return nordSsoRecipe(data, asset.id, recipeId) ?? protonExtraRecipe(data, asset.id, recipeId) ?? cloudManagerRecipe(data, asset.id, recipeId) ?? cloudRecoveryRecipe(data, asset.id, recipeId) ?? cloudMasterRecipe(data, asset.id, recipeId);
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
  if (!app || !vault || data.version !== 2 || data.securityModel.revision < 2) return 'manager-select';
  const root = data.assets.find(a => a.id === vault.authenticationAccountRef), device = data.assets.find(a => a.id === app.deviceRef);
  const context = { ...data, guide: { ...data.guide, managerId: vault.id, answers: { ...data.guide.answers, [`${vault.id}:installation`]: app.id } } };
  if (!root || root.purpose !== 'personal' || !device || !['ios', 'android', 'macos', 'windows', 'ubuntu', 'chromeos'].includes(device.operatingSystem ?? '')) return cloudSetupRoute(context, vault.id);
  const passwordApplied = recipe.id.startsWith('cloud-password:') && data.guide.steps[`do/${asset.id}/${recipe.id}/apply`]?.status === 'done';
  const sso = vault.productId === 'nordpass' && cloudAnswer(data, root.id, 'method') === 'sso', ssoRecipe = /^cloud-sso-(prepare|add):/.test(recipe.id);
  if (ssoRecipe) {
    const binding = nordSsoBinding(data, root.id);
    if (!sso || !binding || recipe.id.split(':')[1] !== binding.id) return cloudSetupRoute(context, vault.id);
    const choice = nordSsoChoiceRoute(data, root.id, vault.id); if (choice) return choice;
    if (recipe.id.startsWith('cloud-sso-add:')) { const prerequisite = nordSsoSetupRoute(data, root.id, vault.id, app.id); if (prerequisite && !prerequisite.startsWith('cloud-sso-state/')) return prerequisite; }
  } else if (!passwordApplied && vault.productId === 'nordpass' && cloudAnswer(data, root.id, 'method') !== 'direct' && !(sso && nordSsoReady(data, root.id))) return cloudSetupRoute(context, vault.id);
  if (!['ios', 'android'].includes(device.operatingSystem ?? '') && !app.profileLabel) return cloudSetupRoute(context, vault.id);
  if (!cloudEnvironmentReady(data, app.id)) return cloudSetupRoute(context, vault.id);
  const extraRedirect = extraTaskRedirect(data, app.id, recipe, step);
  if (extraRedirect) return extraRedirect;
  if (!ssoRecipe && recipe.id !== 'cloud-onboard' && !['opened', 'storageChecked'].every(c => app.controls?.[c] === 'verified')) return `do/${app.id}/cloud-onboard/open`;
  if (recipe.id.startsWith('cloud-master-change:') && cloudMasterChanged(data, vault.id)) return cloudSetupRoute(context, vault.id);
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
  const missing = cloudRequiredSteps(asset.id, recipe, step).filter(key => !(recipe.id.startsWith('cloud-extra-enable:') && extraApplied(data, app.id, recipe.id) && ['account', 'mfa', 'extra', 'read'].includes(step.id)) || ['account', 'mfa', 'extra'].includes(key.split('/').pop()!)).find(key => data.guide.steps[key]?.status !== 'done');
  if (missing) return missing;
}
