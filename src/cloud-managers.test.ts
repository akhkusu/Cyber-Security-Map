import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEncryptedVault, decryptVault } from './crypto';
import { makeAsset, newDataset, type CurrentDataset } from './models';
import { recordControl } from './controlRecords';
import { beginRecipe, completeStep, currentTask, helpPrompt, move, undoStep } from './guideEngine';
import { addCloudRoot, chooseCloudDevice, cloudInstallation, cloudManagerReady, cloudMasterRecipeId, cloudSetupRoute, cloudVault, configureCloudRoot, makeCloudVault, selectedCloudInstallation, setCloudAnswer, type CloudProduct } from './cloudManagers';
import { cloudRecipeFor } from './cloudRuntime';
import { evaluateAccess, securityModelIssues } from './securityModel';
import { mapItems, typedMapStatus } from './securityMapViews';
import { phoneBlockingSteps } from './phoneEngine';
import { startPhoneWorkflow } from './phoneEngine';

const time = '2026-11-13T12:00:00Z';
function recorded(data: CurrentDataset, id: string, control: string) { return recordControl(data, id, control, { id: `fixture:${id}:${control}` }, time) as CurrentDataset; }
function fixture(product: CloudProduct, os: 'ios' | 'android' | 'windows' = 'ios', usage = 'existing', sameProton = false) {
  let data = newDataset('ja');
  const mail = { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'PRIVATE MAIL LABEL', importance: 'critical' }), id: 'mail', provider: sameProton ? 'proton' as const : 'google' as const, purpose: 'personal' as const, services: ['mail' as const] };
  const device = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'PRIVATE DEVICE LABEL', importance: 'critical', operatingSystem: os }), id: 'device' };
  data.assets = [mail, device]; data.guide.accountId = mail.id; data.guide.cursor = 'manager-select';
  data = recorded(recorded(data, mail.id, 'mfa'), mail.id, 'recovery');
  data = makeCloudVault(data, product, 'ja'); const vaultId = data.guide.managerId!;
  data = (sameProton ? configureCloudRoot(data, vaultId, mail.id) : addCloudRoot(data, vaultId, 'personal', usage === 'existing')) as CurrentDataset;
  const rootId = cloudVault(data, vaultId)!.authenticationAccountRef!;
  data = recorded(recorded(data, rootId, 'mfa'), rootId, 'recovery');
  if (product === 'nordpass') data = setCloudAnswer(data, rootId, 'method', 'direct') as CurrentDataset;
  data = setCloudAnswer(data, vaultId, 'usage', usage) as CurrentDataset;
  data = chooseCloudDevice(data, vaultId, device.id) as CurrentDataset;
  const appId = selectedCloudInstallation(data, vaultId)!.id;
  if (os === 'ios') data = setCloudAnswer(data, appId, 'ios', 'ios18plus') as CurrentDataset;
  if (os === 'android' && product === 'nordpass') data = setCloudAnswer(data, appId, 'android', 'android9plus') as CurrentDataset;
  if (os === 'windows') {
    data = setCloudAnswer(data, appId, 'browser', 'chrome') as CurrentDataset;
    data.securityModel.entities = data.securityModel.entities.map(e => e.id === appId ? { ...e, profileLabel: 'PRIVATE PROFILE LABEL' } : e);
  }
  return { data, vaultId, rootId, appId };
}
function finishPhase(data: CurrentDataset) {
  let next = data;
  for (let count = 0; count < 30 && next.guide.cursor.startsWith('do/'); count++) {
    const task = currentTask(next); expect(task, next.guide.cursor).toBeDefined();
    expect(task!.redirectTo, next.guide.cursor).toBeUndefined(); expect(task!.needsPrerequisites).not.toBe(true);
    next = completeStep(next) as CurrentDataset;
  }
  expect(next.guide.cursor.startsWith('do/')).toBe(false); return next;
}
function prepare(f: ReturnType<typeof fixture>) {
  let data = move(f.data, cloudSetupRoute(f.data, f.vaultId)) as CurrentDataset;
  for (let count = 0; count < 20; count++) {
    const route = data.guide.cursor.split('/')[0];
    if (route === 'cloud-ready') return data;
    if (route === 'do') { data = finishPhase(data); continue; }
    const key = route === 'cloud-recovery' ? 'recovery' : route === 'cloud-master-review' ? 'master' : route.slice('cloud-'.length);
    const ref = ['recovery', 'master'].includes(key) ? f.vaultId : f.rootId;
    const value = key === 'reset' ? 'existing-email' : key === 'master' ? 'keep' : 'existing';
    data = setCloudAnswer(data, ref, key, value) as CurrentDataset;
    data = move(data, cloudSetupRoute(data, f.vaultId)) as CurrentDataset;
  }
  throw Error('Cloud setup did not reach the login task');
}

describe('cloud password managers', () => {
  for (const product of ['proton-pass', 'nordpass'] as const) for (const os of ['ios', 'android', 'windows'] as const) for (const usage of ['new', 'existing']) {
    it(`${product} / ${os} / ${usage}: distinct identity, recovery, real saved-password use and correct loss context`, () => {
      const f = fixture(product, os, usage), mainAccount = f.data.guide.accountId;
      expect(f.data.securityModel.revision).toBe(2); expect(cloudManagerReady(f.data, f.vaultId)).toBe(false);
      let data = prepare(f);
      expect(cloudManagerReady(data, f.vaultId)).toBe(true); expect(data.guide.accountId).toBe(mainAccount);
      expect(data.assets.filter(a => a.provider === (product === 'proton-pass' ? 'proton' : 'nord'))).toHaveLength(1);
      expect(data.assets.some(a => a.type === 'Password manager')).toBe(false);
      const node = mapItems(data, 'ja').find(n => n.id === f.vaultId)!; expect(typedMapStatus(data, node, 'ja').tone).toBe('unknown');
      data = setCloudAnswer(data, 'mail', `password:${f.appId}`, 'keep') as CurrentDataset;
      data = beginRecipe(data, 'mail', `cloud-password:${f.appId}`) as CurrentDataset;
      data = finishPhase(data);
      expect(data.assets.find(a => a.id === 'mail')!.controls.uniquePassword).toBe('verified');
      expect(data.guide.cursor).toBe('device-select'); expect(data.guide.accountId).toBe(mainAccount);
      expect(typedMapStatus(data, mapItems(data, 'ja').find(n => n.id === f.vaultId)!, 'ja').tone).toBe('recorded');
      const route = data.securityModel.routes.find(r => r.targetRef === 'mail' && r.purpose === 'sign-in')!;
      expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString() }).state).toBe('available');
      expect(evaluateAccess(data.securityModel, route.id, { context: 'all-devices-lost', now: new Date().toISOString() }).state).toBe('not-applicable');
      expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString(), unavailableRefs: ['device'] }).state).toBe('unavailable');
      expect(evaluateAccess(data.securityModel, route.id, { context: 'normal', now: new Date().toISOString(), unavailableRefs: ['another-authenticator-phone'] }).state).toBe('unknown');
      expect(securityModelIssues(data.securityModel, data.assets)).toEqual([]);
    });
  }

  it('reuses the exact Proton email identity and its MFA/recovery without creating a Pass account', async () => {
    const f = fixture('proton-pass', 'ios', 'existing', true); let data = prepare(f);
    expect(data.assets.filter(a => a.kind === 'account')).toHaveLength(1);
    expect(cloudVault(data, f.vaultId)!.authenticationAccountRef).toBe('mail');
    expect(data.guide.steps['do/mail/email-mfa/open']).toBeUndefined();
    data = setCloudAnswer(data, 'mail', `password:${f.appId}`, 'change') as CurrentDataset;
    const recipe = cloudRecipeFor(data, data.assets[0], `cloud-password:${f.appId}`)!;
    expect(recipe.steps.find(s => s.id === 'change-open')!.requires).toEqual(['independent-candidate']);
    expect(recipe.steps.find(s => s.id === 'save-new')!.requires).toEqual(['manager-reopen']);
    data = finishPhase(beginRecipe(data, 'mail', recipe.id) as CurrentDataset);
    const { envelope } = await createEncryptedVault('private app-storage phrase for tests', data);
    expect((await decryptVault(envelope, 'private app-storage phrase for tests')).data).toEqual(data);
    // Frozen 174c13a reader contract: model revision was exactly literal(1).
    // Older readers reject the new semantics before they can interpret cursors.
    expect(z.object({ revision: z.literal(1) }).passthrough().safeParse(data.securityModel).success).toBe(false);
  });

  it('retains the working login before generation, blocks skipped prerequisites and withdraws derived use on undo', () => {
    const f = fixture('nordpass'); let data = prepare(f);
    data = setCloudAnswer(data, 'mail', `password:${f.appId}`, 'change') as CurrentDataset;
    const recipeId = `cloud-password:${f.appId}`, testKey = `do/mail/${recipeId}/test`, candidateKey = `do/mail/${recipeId}/save-candidate`;
    const jumped = { ...data, guide: { ...data.guide, cursor: testKey } };
    expect(currentTask(jumped)?.redirectTo).toBeDefined(); expect((completeStep(jumped).assets[0].controls.uniquePassword ?? 'unknown')).toBe('unknown');
    data = finishPhase(beginRecipe(data, 'mail', recipeId) as CurrentDataset);
    const fact = data.securityModel.facts.find(f => f.observationActionId === testKey)!;
    expect(fact.requiredGuideSteps).toContain(candidateKey);
    data = undoStep(data, candidateKey) as CurrentDataset;
    expect(data.assets[0].controls.uniquePassword).toBe('unknown');
    expect(cloudInstallation(data, f.appId)!.controls?.loginUse).toBe('unknown');
    expect(data.securityModel.facts.find(f => f.id === fact.id)!.state).toBe('unknown');
    expect(data.securityModel.lifecycle.mail.accessResetAt).toBeDefined();
    expect(securityModelIssues(data.securityModel, data.assets)).toEqual([]);
  });

  it('keeps an already accepted service password saveable after a setup confirmation is withdrawn', () => {
    const f = fixture('proton-pass'); let data = prepare(f);
    data = setCloudAnswer(data, 'mail', `password:${f.appId}`, 'change') as CurrentDataset;
    data = beginRecipe(data, 'mail', `cloud-password:${f.appId}`) as CurrentDataset;
    for (let count = 0; count < 15 && currentTask(data)?.step.id !== 'save-new'; count++) data = completeStep(data) as CurrentDataset;
    expect(currentTask(data)?.step.id).toBe('save-new');
    data = undoStep(data, `do/${f.appId}/cloud-autofill/autofill-check`) as CurrentDataset;
    data = move(data, `do/mail/cloud-password:${f.appId}/save-new`) as CurrentDataset;
    expect(currentTask(data)?.needsPrerequisites).not.toBe(true); expect(currentTask(data)?.redirectTo).toBeUndefined();
    const next = completeStep(data) as CurrentDataset; expect(next.guide.steps[`do/mail/cloud-password:${f.appId}/save-new`]?.status).toBe('done');
  });

  it('does not carry app proofs to another browser profile or a separate account and keeps original IDs', () => {
    const f = fixture('proton-pass', 'windows'); let data = prepare(f); const original = structuredClone(cloudInstallation(data, f.appId));
    data = chooseCloudDevice(data, f.vaultId, 'device') as CurrentDataset; const other = selectedCloudInstallation(data, f.vaultId)!;
    expect(other.id).not.toBe(f.appId); expect(other.controls).toEqual({}); expect(cloudManagerReady(data, f.vaultId, other.id)).toBe(false);
    expect(cloudInstallation(data, f.appId)).toEqual(original);
    data = addCloudRoot(data, f.vaultId, 'personal', true) as CurrentDataset;
    expect(data.guide.managerId).not.toBe(f.vaultId); expect(cloudInstallation(data, f.appId)).toEqual(original);
    expect(data.assets.filter(a => a.provider === 'proton')).toHaveLength(2);
  });

  it('keeps SSO and missing mobile-version unfinished; requires the guided weak-master change', () => {
    const f = fixture('nordpass'); let data = prepare(f);
    data = setCloudAnswer(data, f.rootId, 'method', 'sso') as CurrentDataset;
    expect(cloudSetupRoute(data, f.vaultId)).toMatch(/^cloud-sso-unavailable/); expect(cloudManagerReady(data, f.vaultId)).toBe(false);
    data = setCloudAnswer(data, f.rootId, 'method', 'direct') as CurrentDataset;
    data = setCloudAnswer(data, f.vaultId, 'master', 'change') as CurrentDataset;
    expect(cloudSetupRoute(data, f.vaultId)).toBe(`do/${f.appId}/${cloudMasterRecipeId(data, f.vaultId)}/open`); expect(cloudManagerReady(data, f.vaultId)).toBe(false);
    data = finishPhase(move(data, cloudSetupRoute(data, f.vaultId)) as CurrentDataset);
    expect(cloudManagerReady(data, f.vaultId)).toBe(true);
    expect(data.securityModel.lifecycle[f.vaultId]?.accessResetAt).toBeDefined();
    data = undoStep(data, `do/${f.appId}/${cloudMasterRecipeId(data, f.vaultId)}/paper`) as CurrentDataset;
    expect(cloudManagerReady(data, f.vaultId)).toBe(false);
    expect(data.securityModel.lifecycle[f.vaultId]?.accessResetAt).toBeDefined();
    data = setCloudAnswer(data, f.vaultId, 'master', 'keep') as CurrentDataset;
    data = setCloudAnswer(data, f.appId, 'ios', 'other') as CurrentDataset;
    expect(cloudSetupRoute(data, f.vaultId)).toMatch(/^cloud-unsupported/);
    expect(cloudManagerReady(data, f.vaultId)).toBe(false);
  });

  it('does not infer that account sign-in alone migrated a cloud vault before old-phone erasure', () => {
    const f = fixture('nordpass'); let data = prepare(f);
    const fresh = { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'New phone', importance: 'critical', operatingSystem: 'ios' }), id: 'fresh' };
    data.assets.push(fresh); data = startPhoneWorkflow(data, '/map', 'device', 'move');
    Object.assign(data.deviceWorkflows[0], { newDeviceRef: fresh.id, answers: { stage: 'using', availability: 'available', ownership: 'personal', authenticator: 'none', 'use:mail': 'yes', [`use:${f.rootId}`]: 'yes', 'special-apps': 'none', 'phone-line': 'no-line', 'old-fate': 'sell', 'ios-generation': '18' } });
    expect(phoneBlockingSteps(data, data.deviceWorkflows[0]).some(s => s.id === `cloud-store-move:${f.vaultId}` && s.kind === 'blocked')).toBe(true);
  });

  it('requires explicit recovery choices even when a saved cursor jumps into code replacement', () => {
    const f = fixture('nordpass'); const data = finishPhase(move(f.data, cloudSetupRoute(f.data, f.vaultId)) as CurrentDataset);
    const jumped = move(data, `do/${f.appId}/cloud-recovery/replace`) as CurrentDataset;
    expect(currentTask(jumped)?.redirectTo).toBe(`cloud-recovery/${f.vaultId}`);
    expect(completeStep(jumped).guide.steps[jumped.guide.cursor]).toBeUndefined();
  });

  it('does not manufacture another app or copy profile proofs when changing the backing Account', () => {
    const f = fixture('nordpass', 'windows'); const data = prepare(f);
    const changed = addCloudRoot(data, f.vaultId, 'personal', false);
    expect(selectedCloudInstallation(changed, changed.guide.managerId!)).toBeUndefined();
    expect(cloudSetupRoute(changed, changed.guide.managerId!)).toMatch(/^cloud-usage\//);
    expect(cloudInstallation(changed, f.appId)).toEqual(cloudInstallation(data, f.appId));
  });

  it('treats another weak-master report as a fresh change, retaining the previous history', () => {
    const f = fixture('nordpass'); let data = prepare(f);
    data = setCloudAnswer(data, f.vaultId, 'master', 'change') as CurrentDataset;
    const originalRecipe = cloudMasterRecipeId(data, f.vaultId);
    data = finishPhase(move(data, cloudSetupRoute(data, f.vaultId)) as CurrentDataset);
    expect(cloudManagerReady(data, f.vaultId)).toBe(true);
    data = setCloudAnswer(data, f.vaultId, 'master', 'keep') as CurrentDataset;
    data = setCloudAnswer(data, f.vaultId, 'master', 'change') as CurrentDataset;
    expect(cloudMasterRecipeId(data, f.vaultId)).not.toBe(originalRecipe);
    expect(cloudManagerReady(data, f.vaultId)).toBe(false);
    expect(data.guide.steps[`do/${f.appId}/${originalRecipe}/test`]?.status).toBe('done');
    const jumped = move(data, `do/${f.appId}/${cloudMasterRecipeId(data, f.vaultId)}/test`) as CurrentDataset;
    expect(currentTask(jumped)?.redirectTo).toBeDefined();
  });

  it('does not alias a provisional store referenced by a raw step key containing quotes or backslashes', () => {
    const f = fixture('proton-pass'); let data = makeCloudVault(f.data, 'proton-pass', 'ja');
    const provisional = data.guide.managerId!, importedId = 'imported-"quoted"-\\store';
    data.securityModel.entities = data.securityModel.entities.map(e => e.id === provisional ? { ...e, id: importedId } : e);
    data.guide.managerId = importedId; data.guide.steps[`legacy/${importedId}/checked`] = { status: 'done', updatedAt: time };
    data = configureCloudRoot(data, importedId, f.rootId) as CurrentDataset;
    expect(data.guide.managerId).toBe(f.vaultId);
    expect(data.securityModel.entities.find(e => e.id === importedId)?.mergedIntoRef).toBeUndefined();
    expect(cloudVault(data, importedId)?.id).toBe(importedId);
  });

  it('exports only allowlisted environment labels and the known OS range in manual AI help', () => {
    const f = fixture('nordpass'); let data = move(f.data, cloudSetupRoute(f.data, f.vaultId)) as CurrentDataset;
    for (const language of ['ja', 'en'] as const) {
      const prompt = helpPrompt(data, language === 'ja' ? '画面が違う' : 'The screen differs', language);
      expect(prompt).toContain('iOS / iPadOS 18+'); expect(prompt).toContain('NordPass'); expect(prompt).not.toContain('PRIVATE');
    }
    const desktop = fixture('proton-pass', 'windows'); data = move(desktop.data, cloudSetupRoute(desktop.data, desktop.vaultId)) as CurrentDataset;
    data.securityModel.entities = data.securityModel.entities.map(e => e.id === desktop.appId ? { ...e, cloudSettings: { browser: 'TEST-ONLY RAW BROWSER VALUE' } } : e);
    expect(helpPrompt(data, 'The screen differs', 'en')).not.toContain('TEST-ONLY');
    expect(helpPrompt(data, 'The screen differs', 'en')).not.toContain('PRIVATE');
  });

  it('reviews an already created account and master without asking for another secret or resetting the vault', () => {
    const f = fixture('nordpass', 'ios', 'new'); const data = prepare(f);
    const review = move(data, `do/${f.appId}/cloud-onboard/master-phrase`) as CurrentDataset;
    expect(currentTask(review)?.step.action.ja).toContain('新しいマスターを作ったり');
    expect(currentTask(review)?.step.download).toBeUndefined();
    expect(currentTask(review)?.step.action.ja).not.toContain('サイコロを5回');
    const corrected = setCloudAnswer(data, f.vaultId, 'usage', 'existing');
    expect(selectedCloudInstallation(corrected, f.vaultId)?.id).toBe(f.appId);
    expect(cloudRecipeFor(corrected, { ...data.assets[0], id: f.appId }, 'cloud-onboard')?.steps.find(s => s.id === 'master-set')?.title.ja).toBe('設定済みの保管庫用マスターを維持する');
  });
});
