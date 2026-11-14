import { recordedUnavailable } from './recordAvailability';
import { recordProtonExtra } from './protonPassExtra';
import { AUTHENTICATORS, authSources, authenticatorPrerequisiteRoute, authenticatorConfirmation, authenticatorScan, authenticatorScanStep, authenticatorSetupRecipe, authenticatorSetupRoute, requireAuthenticatorRoots, selectedAuthenticator, type AuthenticatorProduct } from './authenticatorGuide';
import { recordAuthenticatorObservation, undoAuthenticatorObservation } from './authenticatorObservations';
import { makeAsset, type Asset, type Dataset, type Language, type RecoveryDependency } from './models';
import { controlKey, CHECKUP_CONTROLS } from './checkupCatalog';
import { recordNativeObservation, undoNativeObservation } from './nativeObservations';
import { guideSubject } from './subjects';
import { builtinManagerRecipe, builtinPasswordRecipe } from './nativeManagerCatalog';
import { NATIVE_NAMES, type NativeProduct, managerReady, nativeInstallation, nativeSetupRoute, nativeSubject, nativeVault, selectedNativeInstallation } from './nativeManagers';
import { recordControl, undoControl } from './controlRecords';
import { deviceRecipe, emailRecipe, managerRecipe, passwordRecipe, recoveryRecipe, PROVIDERS, isExtendedMail, type GuideStep, type Recipe } from './guideCatalog';
import { cloudInstallation, cloudSetupRoute, cloudSubject, cloudVault, selectedCloudInstallation } from './cloudManagers';
import { cloudRecipeFor, cloudRequiredSteps, cloudTaskRedirect } from './cloudRuntime';
import { nordAccountRecipe } from './nordAccountCatalog';
import { recordCloudObservation, undoCloudObservation } from './cloudObservations';
import { cloudHelpContext } from './cloudHelpContext';

export const taskCursor = (assetId: string, recipeId: string, stepId: string) => `do/${assetId}/${recipeId}/${stepId}`;
export const isRecorded = (asset: { controls: Asset['controls'] } | undefined, control: string) => !!asset && ['implemented', 'verified'].includes(asset.controls[control]);
export function move(data: Dataset, cursor: string): Dataset {
  if (cursor === data.guide.cursor) return data;
  return { ...data, guide: { ...data.guide, cursor, history: [...data.guide.history, data.guide.cursor].slice(-200) } };
}
export function back(data: Dataset): Dataset {
  const history = [...data.guide.history];
  const cursor = history.pop();
  return cursor ? { ...data, guide: { ...data.guide, cursor, history } } : data;
}
function baseRecipeFor(data: Dataset, asset: Asset, recipeId: string): Recipe | undefined {
  if (recipeId.startsWith('cloud-')) return cloudRecipeFor(data, asset, recipeId);
  if (asset.provider === 'nord' && ['email-mfa', 'recovery'].includes(recipeId)) return nordAccountRecipe(recipeId === 'recovery', asset.id);
  if (recipeId.startsWith('native-password:')) return builtinPasswordRecipe(data, asset, recipeId.slice('native-password:'.length));
  if (recipeId === 'builtin-manager') return builtinManagerRecipe(data, asset.id);
  const platform = data.guide.answers[`${asset.id}:platform`] ?? asset.operatingSystem ?? 'web';
  if (recipeId === 'email-mfa' && (['apple', 'google', 'microsoft'].includes(asset.provider ?? '') || isExtendedMail(asset.provider))) return emailRecipe(asset.provider, platform);
  if (recipeId === 'recovery' && (['apple', 'google', 'microsoft'].includes(asset.provider ?? '') || isExtendedMail(asset.provider))) return recoveryRecipe(asset.provider, platform);
  if (recipeId === 'manager' && ['bitwarden', '1password'].includes(asset.provider ?? '')) return managerRecipe(asset.provider, platform, data.guide.answers[`${asset.id}:region`] ?? 'us');
  if (recipeId === 'password') {
    if (asset.provider === 'mailcom' || asset.provider === 'gmx') return undefined;
    if (nativeVault(data, data.guide.managerId)) return builtinPasswordRecipe(data, asset);
    const manager = data.assets.find(a => a.id === data.guide.managerId);
    if (manager && (['apple', 'google', 'microsoft'].includes(asset.provider ?? '') || isExtendedMail(asset.provider))) return passwordRecipe(manager.provider, asset, data.guide.answers[`${asset.id}:platform`] ?? 'web');
  }
  if (recipeId === 'device' && ['ios', 'android', 'macos', 'windows'].includes(platform)) return deviceRecipe(platform);
}
export function recipeFor(data: Dataset, asset: Asset, recipeId: string): Recipe | undefined {
  if (recipeId.startsWith('authenticator-setup:')) {
    const recipe = authenticatorSetupRecipe(data, asset);
    return recipe;
  }
  const recipe = baseRecipeFor(data, asset, recipeId), app = selectedAuthenticator(data, asset.id);
  if (!recipe || !app) return recipe;
  const steps = recipe.steps.flatMap(step => {
    if (!authenticatorScan(recipeId, step.id)) return [step];
    const scan = authenticatorScanStep(data, asset, step);
    if (recipeId !== 'manager') return [scan];
    const bw = asset.provider === 'bitwarden';
    return [scan, { id: 'auth-activate', title: { en: 'Confirm the code on the service', ja: 'サービス側でコードを確認する' }, place: step.place, action: { en: bw ? 'In Bitwarden, enter the current code from the selected authenticator and select Enable. Keep this session open.' : 'In 1Password select Next, enter the current code from the selected authenticator, then Confirm. Keep this session open.', ja: bw ? 'Bitwardenの画面に、選んだ認証アプリの現在のコードを入力し、「Enable」を選んでください。このログインは残します。' : '1Passwordの「Next」で、選んだ認証アプリの現在のコードを入力し、「Confirm」を選んでください。このログインは残します。' }, expected: { en: 'The official service accepts this code and enables the authenticator.', ja: '正規のサービスが今回のコードを受け付け、認証アプリが有効になること。' }, sources: step.sources, button: { en: 'The code was accepted', ja: 'コードが受け付けられました' } }];
  });
  return { ...recipe, steps };
}
export function currentTask(data: Dataset): { asset: Asset; recipe: Recipe; step: GuideStep; index: number; needsPrerequisites?: boolean; redirectTo?: string } | undefined {
  const [kind, assetId, recipeId, stepId] = data.guide.cursor.split('/');
  if (kind !== 'do') return;
  const asset = cloudSubject(data, assetId) ?? nativeSubject(data, assetId) ?? guideSubject(data, assetId);
  if (!asset) return;
  const recipe = recipeFor(data, asset, recipeId);
  const index = recipe?.steps.findIndex(s => s.id === stepId) ?? -1;
  if (recipe && recipeId.startsWith('authenticator-setup:') && recipe.id !== recipeId) return { asset, recipe, step: recipe.steps[0], index: 0, redirectTo: authenticatorSetupRoute(data, assetId) };
  if (!recipe || index < 0) return;
  const contextRef = recipeId==='password'?data.guide.managerId:recipeId.startsWith('cloud-password:') || recipeId.startsWith('native-password:') || recipeId.startsWith('authenticator-setup:') ? recipeId.split(':')[1] : undefined;
  const loginApp=cloudInstallation(data,recipeId.startsWith('cloud-password:')?recipeId.split(':')[1]:assetId);
  const loginVault=cloudVault(data,loginApp?.vaultRef), onlineStep=recipeId==='cloud-onboard'&&(/^(sign-in|sso-)/.test(stepId));
  const unavailable = recordedUnavailable(data,[assetId,contextRef,...(onlineStep?[loginVault?.authenticationAccountRef]:[])]);
  if(unavailable)return {asset,recipe,step:recipe.steps[index],index,redirectTo:`record-unavailable/${unavailable}`};
  const cloudRedirect = cloudTaskRedirect(data, asset, recipe, recipe.steps[index]);
  if (cloudRedirect) return { asset, recipe, step: recipe.steps[index], index, ...(cloudRedirect === 'password-prerequisite' ? { needsPrerequisites: true } : { redirectTo: cloudRedirect }) };
  if (recipeId.startsWith('authenticator-setup:')) { const prerequisite = authenticatorPrerequisiteRoute(data, assetId); if (prerequisite) return { asset, recipe, step: recipe.steps[index], index, redirectTo: prerequisite }; }
  const bound = recipeId.startsWith('native-password:') ? nativeInstallation(data, recipeId.slice('native-password:'.length)) : undefined;
  const needsPrerequisites = (recipeId === 'password' || recipeId.startsWith('native-password:')) && (!isRecorded(asset, 'recovery') || !managerReady(data, bound?.vaultRef, bound?.id));
  if (authenticatorScan(recipeId, stepId)) {
    const route = authenticatorSetupRoute(data, assetId, data.guide.cursor);
    return { asset, recipe, step: recipe.steps[index], index, redirectTo: route !== data.guide.cursor ? route : undefined };
  }
  const setup = recipeId === 'builtin-manager' ? nativeSetupRoute(data, nativeInstallation(data, assetId)?.vaultRef ?? '', assetId) : undefined;
  return { asset, recipe, step: recipe.steps[index], index, needsPrerequisites, redirectTo: setup && !setup.startsWith('do/') ? setup : undefined };
}
export function beginRecipe(data: Dataset, assetId: string, recipeId: string, revisit = false): Dataset {
  const asset = cloudSubject(data, assetId) ?? nativeSubject(data, assetId) ?? guideSubject(data, assetId);
  if (!asset) return move(data, 'start');
  if (recipeId.startsWith('cloud-')) {
    const app = cloudInstallation(data, recipeId.startsWith('cloud-password:') ? recipeId.slice('cloud-password:'.length) : assetId);
    if (app) data = { ...data, guide: { ...data.guide, managerId: app.vaultRef, answers: { ...data.guide.answers, [`${app.vaultRef}:installation`]: app.id } } };
  }
  if (recipeId === 'password' && cloudVault(data, data.guide.managerId)) { const app = selectedCloudInstallation(data, data.guide.managerId!); return app ? move(data, `cloud-password-choice/${app.id}/${assetId}`) : move(data, cloudSetupRoute(data, data.guide.managerId!)); }
  if (recipeId === 'password' && nativeVault(data, data.guide.managerId)) { const install = selectedNativeInstallation(data, data.guide.managerId!); return install ? beginRecipe(data, assetId, `native-password:${install.id}`, revisit) : move(data, nativeSetupRoute(data, data.guide.managerId!)); }
  if (recipeId === 'builtin-manager') { const install = nativeInstallation(data, assetId); if (!install) return move(data, 'manager-select'); const setup = nativeSetupRoute(data, install.vaultRef!, assetId); if (!setup.startsWith('do/')) return move(data, setup); }
  if (asset.purpose === 'work' && data.guide.answers[`${asset.id}:managedAllowed`] !== 'yes') return move(data, `managed/${asset.id}`);
  if (recipeId === 'device' && asset.operatingSystem === 'windows' && data.guide.answers[`${asset.id}:version`] !== 'windows11') return move(data, `device-version/${asset.id}`);
  if (recipeId === 'device' && asset.operatingSystem === 'macos' && data.guide.answers[`${asset.id}:version`] !== 'mac13plus') return move(data, `device-version/${asset.id}`);
  if (recipeId === 'recovery' && !isRecorded(asset, 'mfa')) return beginRecipe(data, assetId, 'email-mfa', revisit);
  if (recipeId === 'password' || recipeId.startsWith('native-password:')) {
    const native = recipeId.startsWith('native-password:') ? nativeInstallation(data, recipeId.slice('native-password:'.length)) : undefined;
    if (!isRecorded(asset, 'recovery') || !managerReady(data, native?.vaultRef, native?.id)) return move(data, 'password-prerequisite');
  }
  const recipe = recipeFor(data, asset, recipeId);
  if (!recipe) return move(data, `unsupported/${assetId}/${recipeId}`);
  if (recipeId.startsWith('cloud-')) {
    const redirect = cloudTaskRedirect(data, asset, recipe, recipe.steps[0]);
    if (redirect === 'password-prerequisite' && recipeId.startsWith('cloud-password:')) return move({ ...data, guide: { ...data.guide, answers: { ...data.guide.answers, 'cloud-password:target': asset.id, 'cloud-password:installation': recipeId.slice('cloud-password:'.length), 'cloud-password:return': taskCursor(asset.id, recipe.id, recipe.steps[0].id) } } }, redirect);
    if (redirect) return move(data, redirect);
  }
  // Existing work is preserved. Content edits never invalidate control records.
  if (!revisit && recipeId.startsWith('native-password:') && isRecorded(asset, 'uniquePassword') && nativeInstallation(data, recipeId.slice('native-password:'.length))?.controls?.loginUse === 'verified') return move(data, `recorded/${assetId}/${recipeId}`);
  const control = recipeId === 'email-mfa' ? 'mfa' : recipeId === 'recovery' ? 'recovery' : recipeId === 'password' ? 'uniquePassword' : undefined;
  if (!revisit && control && isRecorded(asset, control)) return move(data, `recorded/${assetId}/${recipeId}`);
  if (!revisit && recipeId === 'recovery' && isExtendedMail(asset.provider)) {
    const storedInEnrollment = ['proton', 'startmail'].includes(asset.provider)
      ? data.guide.steps[taskCursor(asset.id, 'email-mfa', 'save-codes')]?.status === 'done'
      : ['mailcom', 'gmx'].includes(asset.provider) ? data.guide.steps[taskCursor(asset.id, 'email-mfa', 'save-key')]?.status === 'done'
      : asset.provider === 'tuta' && data.guide.steps[taskCursor(asset.id, 'email-mfa', 'ready')]?.status === 'done';
    if (storedInEnrollment) return move(data, taskCursor(assetId, recipeId, 'test'));
  }
  return move(data, taskCursor(assetId, recipeId, recipe.steps[0].id));
}
export function afterRecipe(data: Dataset, asset: Asset, recipeId: string): Dataset {
  const returnKey = `return/${asset.id}/${recipeId}`, returnTo = data.guide.answers[returnKey];
  if (returnTo?.startsWith('cloud-password-resume/')) {
    const appId = returnTo.split('/')[1], answers = { ...data.guide.answers }; delete answers[returnKey];
    const next = { ...data, guide: { ...data.guide, answers } };
    if (!isRecorded(asset, 'mfa') || !isRecorded(asset, 'recovery')) {
      const pending = isRecorded(asset, 'mfa') ? 'recovery' : 'email-mfa';
      return beginRecipe({ ...next, guide: { ...next.guide, answers: { ...answers, [`return/${asset.id}/${pending}`]: `cloud-password-resume/${appId}` } } }, asset.id, pending);
    }
    return requireAuthenticatorRoots(next, asset.id, answers['cloud-password:return'] ?? taskCursor(asset.id, `cloud-password:${appId}`, 'save-current'));
  }
  if (returnTo?.startsWith('cloud-sso-resume/')) { const answers = { ...data.guide.answers }; delete answers[returnKey]; const next = { ...data, guide: { ...data.guide, answers } }; const resume = cloudSetupRoute(next, returnTo.split('/')[1]), current = next.assets.find(a => a.id === asset.id); return current && ['mfa', 'recovery'].every(c => isRecorded(current, c)) ? requireAuthenticatorRoots(next, current.id, resume) : move(next, resume); }
  if (returnTo?.startsWith('cloud-resume/')) { const answers = { ...data.guide.answers }; delete answers[returnKey]; const next = { ...data, guide: { ...data.guide, answers } }; const resume = cloudSetupRoute(next, returnTo.split('/')[1]); return ['mfa', 'recovery'].every(c => isRecorded(asset, c)) ? requireAuthenticatorRoots(next, asset.id, resume) : move(next, resume); }
  if (returnTo?.startsWith('authenticator-root-security/')) { const answers = { ...data.guide.answers }; delete answers[returnKey]; const origin = returnTo.split('/')[1]; const next = { ...data, guide: { ...data.guide, answers } }; return requireAuthenticatorRoots(next, origin, answers[`auth:${origin}:security-return`] ?? 'manager-select'); }
  if (returnTo?.startsWith('native-resume/')) { const answers = { ...data.guide.answers }; delete answers[returnKey]; return move({ ...data, guide: { ...data.guide, answers } }, nativeSetupRoute(data, returnTo.split('/')[1])); }
  if (recipeId.startsWith('authenticator-setup:')) return move(data, authenticatorSetupRoute(data, asset.id));
  if (recipeId.startsWith('cloud-sso-prepare:')) { const vaultId = cloudInstallation(data, asset.id)?.vaultRef; const route = cloudSetupRoute(data, vaultId ?? ''); return move(data, route.startsWith('cloud-sso-security/') || route.startsWith('cloud-sso-managed/') || route.startsWith('cloud-sso-unavailable/') ? route : `cloud-sso-state/${vaultId}`); }
  if (recipeId.startsWith('cloud-extra-')) {
    const answers = { ...data.guide.answers };
    const cursor = recipeId.startsWith('cloud-extra-inspect:') ? `cloud-extra-state/${asset.id}` : `cloud-ready/${cloudInstallation(data, asset.id)?.vaultRef}`;
    if (recipeId.startsWith('cloud-extra-inspect:')) answers[`${asset.id}:proton-extra-pending`] = cursor; else delete answers[`${asset.id}:proton-extra-pending`];
    return move({ ...data, guide: { ...data.guide, answers } }, cursor);
  }
  if (recipeId.startsWith('cloud-password:')) return move(data, 'device-select');
  if (recipeId.startsWith('cloud-')) { const app = cloudInstallation(data, asset.id); if (app) return move(data, cloudSetupRoute({ ...data, guide: { ...data.guide, managerId: app.vaultRef, answers: { ...data.guide.answers, [`${app.vaultRef}:installation`]: app.id } } }, app.vaultRef!)); }
  if (recipeId === 'builtin-manager') { const email = data.assets.find(a => a.id === data.guide.accountId); return email ? beginRecipe(data, email.id, 'password') : move(data, 'start'); }
  if (recipeId === 'email-mfa') return selectedAuthenticator(data, asset.id) ? beginRecipe(data, asset.id, 'recovery') : move(data, `auth-location/${asset.id}`);
  if (recipeId === 'recovery') return move(data, `recovery-location/${asset.id}`);
  if (recipeId === 'manager') { const email = data.assets.find(a => a.id === data.guide.accountId); if (!selectedAuthenticator(data, asset.id)) return move(data, `auth-location/${asset.id}`); const next = email ? beginRecipe(data, email.id, 'password') : move(data, 'device-select'); return requireAuthenticatorRoots(next, asset.id, next.guide.cursor); }
  if (recipeId === 'password' || recipeId.startsWith('native-password:')) return move(data, 'device-select');
  if (recipeId === 'device') return move(data, `backup-location/${asset.id}`);
  return move(data, 'finish');
}
export function completeStep(data: Dataset, jump?: string): Dataset {
  const task = currentTask(data);
  if (!task) return data;
  if (task.redirectTo) return move(data, task.redirectTo);
  if (task.needsPrerequisites) return move(data, 'password-prerequisite');
  const { asset, recipe, step, index } = task;
  const now = new Date().toISOString();
  const key = data.guide.cursor;
  const requiredGuideSteps = recipe.id.startsWith('cloud-') ? cloudRequiredSteps(asset.id, recipe, step) : [];
  const definition = CHECKUP_CONTROLS.find(c => c.assetKind === asset.kind && c.assetControl === step.control);
  const answerKey = definition ? controlKey(definition.id, asset.id) : undefined;
  const old = data.guide.steps[key];
  const selectedApp = selectedAuthenticator(data, asset.id);
  const enrollment = data.guide.steps[data.guide.answers[`auth:${asset.id}:enrollment`]];
  const record = { ...old, ...(((recipe.id === 'cloud-onboard' && step.id === 'sso-state') || (recipe.id.startsWith('cloud-password:') && step.id === 'manager-reopen-state')) && jump ? { nordSsoChoice: 'v1', nextStepId: jump } : {}), ...(selectedApp && (authenticatorScan(recipe.id, step.id) || authenticatorConfirmation(recipe.id, step.id)) ? { authenticatorRef: selectedApp.id } : {}), status: 'done' as const, updatedAt: now, ...(step.control ? {
    beforeControl: old?.beforeControl ?? asset.controls[step.control] ?? 'unknown',
    beforeEvidence: old?.beforeEvidence ?? asset.controlEvidence[step.control] ?? 'not-assessed',
    beforeAnswer: old ? old.beforeAnswer : (answerKey ? data.assessmentAnswers[answerKey] : undefined),
  } : {}) };
  if (selectedApp && authenticatorScan(recipe.id, step.id)) record.authenticatorEnrollment = crypto.randomUUID();
  if (selectedApp && authenticatorConfirmation(recipe.id, step.id)) record.authenticatorEnrollment = enrollment?.authenticatorRef === selectedApp.id ? enrollment.authenticatorEnrollment : undefined;
  let next: Dataset = { ...data, guide: { ...data.guide, ...(selectedApp && authenticatorScan(recipe.id, step.id) ? { answers: { ...data.guide.answers, [`auth:${asset.id}:task`]: key, [`auth:${asset.id}:enrollment`]: key } } : {}), steps: { ...data.guide.steps, [key]: record } } };
  if (selectedApp && authenticatorConfirmation(recipe.id, step.id)) next = { ...next, guide: { ...next.guide, answers: { ...next.guide.answers, [`auth:${asset.id}:confirmation`]: key } } };
  if (step.control) {
    next = recordControl(next, asset.id, step.control, { id: key, origin: 'guide', titleEn: step.title.en, titleJa: step.title.ja, assetName: asset.name, ...(requiredGuideSteps.length ? { requiredGuideSteps } : {}) }, now);
  }
  for (const effect of step.extraControls ?? []) next = recordControl(next, effect.targetRef, effect.controlId, { id: `${key}#${effect.targetRef}#${effect.controlId}`, parentId: key, origin: 'guide', titleEn: step.title.en, titleJa: step.title.ja, ...(requiredGuideSteps.length ? { requiredGuideSteps } : {}) }, now);
  if (next.version === 2 && (recipe.id === 'password' || recipe.id.startsWith('native-password:') || recipe.id.startsWith('cloud-password:')) && step.id === 'apply') next = { ...next, securityModel: { ...next.securityModel, lifecycle: { ...next.securityModel.lifecycle, [asset.id]: { ...next.securityModel.lifecycle[asset.id], state: 'in-use', evidence: 'user-confirmed', updatedAt: now, accessResetAt: now } } } };
  next = recordNativeObservation(next, key, asset.id, recipe.id, step, now);
  next = recordAuthenticatorObservation(next, key, asset.id, recipe.id, step, now);
  next = recordCloudObservation(next, key, asset.id, recipe.id, step, requiredGuideSteps, now);
  next = recordProtonExtra(next, key, asset.id, recipe.id, step.id, requiredGuideSteps, now);
  const nextStep = jump ? recipe.steps.find(s => s.id === jump) : recipe.steps[index + 1];
  if (nextStep && recipe.id.startsWith('cloud-extra-')) next = { ...next, guide: { ...next.guide, answers: { ...next.guide.answers, [`${asset.id}:proton-extra-pending`]: taskCursor(asset.id, recipe.id, nextStep.id) } } };
  return nextStep ? move(next, taskCursor(asset.id, recipe.id, nextStep.id)) : afterRecipe(next, asset, recipe.id);
}
export function undoStep(data: Dataset, key: string): Dataset {
  const record = data.guide.steps[key];
  if (!record || record.status !== 'done') return data;
  const task = currentTask({ ...data, guide: { ...data.guide, cursor: key } });
  const steps = { ...data.guide.steps }; delete steps[key];
  let next: Dataset = { ...data, guide: { ...data.guide, steps }, actions: data.actions.filter(a => a.id !== key) };
  if (task?.step.control) {
    const control = task.step.control;
    next = undoControl(next, key, task.asset.id, control, { state: record.beforeControl ?? 'unknown', evidence: record.beforeEvidence ?? 'not-assessed', answer: record.beforeAnswer });
  }
  for (const action of data.actions.filter(a => a.parentId === key)) if (action.targetId && action.controlId) next = undoControl(next, action.id, action.targetId, action.controlId, { state: 'unknown', evidence: 'not-assessed' });
  for (const action of data.actions.filter(a => Array.isArray(a.requiredGuideSteps) && a.requiredGuideSteps.includes(key))) if (action.targetId && action.controlId) next = undoControl(next, action.id, action.targetId, action.controlId, { state: 'unknown', evidence: 'not-assessed' });
  return move(undoCloudObservation(undoAuthenticatorObservation(undoNativeObservation(next, key), key), key), key);
}
export function deferStep(data: Dataset): Dataset {
  const task = currentTask(data);
  const key = data.guide.cursor;
  const next = { ...data, guide: { ...data.guide, steps: { ...data.guide.steps, [key]: data.guide.steps[key]?.status === 'done' ? data.guide.steps[key] : { status: 'later' as const, updatedAt: new Date().toISOString() } } } };
  if (task?.recipe.id.startsWith('cloud-extra-')) return move({ ...next, guide: { ...next.guide, answers: { ...next.guide.answers, [`${task.asset.id}:proton-extra-pending`]: key } } }, `cloud-ready/${cloudInstallation(data, task.asset.id)?.vaultRef}`);
  if (task) return move(next, task.recipe.id === 'email-mfa' || task.recipe.id === 'recovery' ? 'manager-select' : task.recipe.id === 'manager' || task.recipe.id === 'builtin-manager' || task.recipe.id.startsWith('cloud-') || task.recipe.id.startsWith('authenticator-setup:') || (task.recipe.id === 'password' || task.recipe.id.startsWith('native-password:')) ? 'device-select' : 'finish');
  return move(next, key.startsWith('device') ? 'finish' : 'device-select');
}
export function selectAccount(data: Dataset, provider: NonNullable<Asset['provider']>, language: Language, existingId?: string, purpose?: 'personal' | 'work'): Dataset {
  const existing = data.assets.find(a => a.id === existingId);
  const chosenPurpose = purpose ?? existing?.purpose ?? 'personal';
  const asset = existing ? { ...existing, provider, purpose: chosenPurpose, services: [...new Set([...existing.services, 'mail' as const])] } : {
    ...makeAsset({ kind: 'account', type: 'Primary email', name: `${PROVIDERS[provider]} · ${language === 'ja' ? chosenPurpose === 'work' ? '仕事用' : '個人用' : chosenPurpose === 'work' ? 'Work' : 'Personal'} ${data.assets.filter(a => a.provider === provider).length + 1}`, importance: 'critical' }), provider, purpose: chosenPurpose, services: ['mail' as const],
  };
  const next = { ...data, assets: existing ? data.assets.map(a => a.id === existing.id ? asset : a) : [...data.assets, asset], guide: { ...data.guide, accountId: asset.id } };
  return provider === 'apple' ? move(next, `platform/${asset.id}/email-mfa`) : beginRecipe(next, asset.id, 'email-mfa');
}
export function addRelation(data: Dataset, assetId: string, recoveryAssetId: string, relationType: NonNullable<RecoveryDependency['relationType']>): Dataset {
  if (assetId === recoveryAssetId || !data.assets.some(a => a.id === assetId) || !data.assets.some(a => a.id === recoveryAssetId)) return data;
  if (data.dependencies.some(d => d.assetId === assetId && d.recoveryAssetId === recoveryAssetId && d.relationType === relationType)) return data;
  const dep: RecoveryDependency = { id: crypto.randomUUID(), assetId, recoveryAssetId, relationType, relation: relationType, createdAt: new Date().toISOString() };
  return { ...data, dependencies: [...data.dependencies, dep] };
}
export function dependents(data: Dataset, missingId: string): Asset[] {
  const affected = new Set<string>([missingId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of data.dependencies) if (affected.has(d.recoveryAssetId) && !affected.has(d.assetId)) { affected.add(d.assetId); changed = true; }
  }
  return data.assets.filter(a => a.id !== missingId && affected.has(a.id));
}
export function helpPrompt(data: Dataset, problem: string, language: Language): string {
  const task = currentTask(data);
  const cloudHelp = cloudHelpContext(data, task?.asset.id, task?.recipe.id);
  const asset = task?.asset ?? data.assets.find(a => a.id === data.guide.cursor.split('/')[1]);
  // Only allowlisted catalog labels are exported. No nicknames, notes, raw answers or credentials.
  const native = nativeVault(data, nativeInstallation(data, asset?.id ?? '')?.vaultRef ?? data.guide.managerId);
  const authApp = asset && selectedAuthenticator(data, asset.id);
  const authOS = data.assets.find(a => a.id === authApp?.deviceRef)?.operatingSystem;
  const authLabel = authApp && AUTHENTICATORS[authApp.productId as AuthenticatorProduct];
  const managerLabel = cloudHelp?.product ?? (native && NATIVE_NAMES[native.productId as NativeProduct]);
  const managerTask = !!managerLabel && ((!task && !!cloudHelp) || task?.recipe.id === 'builtin-manager' || (!!task?.recipe.id.startsWith('cloud-') && !task.recipe.id.startsWith('cloud-password:')));
  const service = managerTask ? managerLabel![language] : asset?.provider ? PROVIDERS[asset.provider] : 'Unspecified';
  const platform = cloudHelp?.os ?? (asset ? data.guide.answers[`${asset.id}:platform`] ?? asset.operatingSystem ?? 'unknown' : 'unknown');
  const attempted = data.guide.cursor.split('/')[2];
  const attemptedTask = attempted === 'password' || attempted?.startsWith('native-password:') ? { en: 'Generate, save and use this account’s password', ja: 'このアカウントのパスワードを生成・保存して使う' } : attempted === 'device' ? { en: 'Protect this device', ja: 'この端末の対策を進める' } : { en: 'Find supported authentication instructions', ja: '対応する認証手順を確認する' };
  const sourceIds = [...new Set([...(task?.step.sources ?? cloudHelp?.sources ?? (asset ? recipeFor(data, asset, 'email-mfa')?.steps[0].sources ?? [] : [])), ...(authApp ? authSources(authApp.productId as AuthenticatorProduct) : [])])];
  const allowedPlatforms = ['ios', 'macos', 'android', 'windows', 'web', 'ubuntu', 'chromeos'];
  return language === 'ja' ? [
    '最新の公式資料を確認し、一度に一つの質問または操作だけを案内してください。最新情報を確認できない場合は、その旨を明示してください。秘密情報の入力・共有は求めないでください。',
    `サービス: ${service}`, ...(authLabel ? [`認証アプリ: ${authLabel.ja}`, `認証アプリの端末OS: ${authOS === 'ios' || authOS === 'android' ? authOS : '未確認'}（詳細版は未確認）`] : []), ...(managerLabel ? [`パスワード管理: ${managerLabel.ja}`] : []), ...(cloudHelp?.connectedProvider ? [`Connected sign-in: ${cloudHelp.connectedProvider}`] : []), ...(cloudHelp?.browser ? [`ブラウザー: ${cloudHelp.browser}（版は未確認）`] : []), ...(cloudHelp?.osRange ? [`確認したOSの世代: ${cloudHelp.osRange}`] : []), `端末・OSの種類: ${allowedPlatforms.includes(platform) ? platform : '未確認'}（詳細バージョンは未確認。必要なら質問してください）`,
    `作業: ${task?.recipe.title.ja ?? cloudHelp?.title.ja ?? attemptedTask.ja}`, `現在のステップ: ${task?.step.title.ja ?? cloudHelp?.title.ja ?? 'この環境に対応する手順がない'}`, `想定される表示: ${task?.step.expected.ja ?? cloudHelp?.expected.ja ?? '未確認'}`, `困りごと: ${problem}`,
    '根拠となる公式資料:', ...sourceIds.map(s => `${s}: ${sourcelink(s)}`),
    'パスワード・認証コード・復旧コード・個人情報は共有しません。既存の認証方法を削除する前に、復旧手段と新しい方法の動作を確認してください。',
  ].join('\n') : [
    'Check current official documentation. Guide me through one question or action at a time. Say explicitly if you cannot check current information. Never request secrets or personal data.',
    `Service: ${service}`, ...(authLabel ? [`Authenticator: ${authLabel.en}`, `Authenticator device OS: ${authOS === 'ios' || authOS === 'android' ? authOS : 'unknown'} (exact version unconfirmed)`] : []), ...(managerLabel ? [`Password manager: ${managerLabel.en}`] : []), ...(cloudHelp?.connectedProvider ? [`Connected sign-in: ${cloudHelp.connectedProvider}`] : []), ...(cloudHelp?.browser ? [`Browser: ${cloudHelp.browser} (version unconfirmed)`] : []), ...(cloudHelp?.osRange ? [`Confirmed OS range: ${cloudHelp.osRange}`] : []), `Device / OS family: ${allowedPlatforms.includes(platform) ? platform : 'unknown'} (exact version unknown; ask if needed)`,
    `Task: ${task?.recipe.title.en ?? cloudHelp?.title.en ?? attemptedTask.en}`, `Current step: ${task?.step.title.en ?? cloudHelp?.title.en ?? 'Unsupported environment'}`, `Expected display: ${task?.step.expected.en ?? cloudHelp?.expected.en ?? 'Unknown'}`, `Problem: ${problem}`,
    'Official sources:', ...sourceIds.map(s => `${s}: ${sourcelink(s)}`),
    'Keep existing authentication until recovery and a new method have been tested. I will not share passwords, authentication codes, recovery codes or personal data.',
  ].join('\n');
}
import { SOURCES, type SourceId } from './guideCatalog';
const sourcelink = (id: SourceId) => `${SOURCES[id].url} (checked ${SOURCES[id].checked})`;
