import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault } from './crypto';
import { datasetSchema, makeAsset, newDataset, type Dataset } from './models';
import { addRelation, back, beginRecipe, completeStep, currentTask, deferStep, dependents, helpPrompt, move, selectAccount, taskCursor, undoStep } from './guideEngine';
import { deviceRecipe, emailRecipe, managerRecipe, passwordRecipe, recoveryRecipe, SOURCES } from './guideCatalog';
import { controlKey } from './checkupCatalog';
const email = () => selectAccount(newDataset('ja'), 'apple', 'ja');
const ready = () => {
  const d = email(); d.guide.answers[`${d.guide.accountId}:platform`] = 'ios';
  return beginRecipe(d, d.guide.accountId!, 'email-mfa');
};
const finishMfa = (d: Dataset) => completeStep(move(d, taskCursor(d.guide.accountId!, 'email-mfa', 'verify')));

describe('guide records and identity', () => {
  it('choosing a service or device does not complete configuration', () => {
    const d = ready(); expect(d.assets[0].controls.mfa).toBe('unknown'); expect(d.actions).toEqual([]); expect(d.dependencies).toEqual([]);
  });
  it('reuses only an explicitly selected account, keeping personal and work logins separate', () => {
    const a = email(); const id = a.guide.accountId!;
    const shared = selectAccount(a, 'apple', 'ja', id);
    expect(shared.assets).toHaveLength(1); expect(shared.guide.accountId).toBe(id);
    const separate = selectAccount(shared, 'apple', 'ja', undefined, 'work');
    expect(separate.assets).toHaveLength(2); expect(separate.guide.accountId).not.toBe(id);
    const done = finishMfa(separate);
    expect(done.assets.find(a => a.id === id)?.controls.mfa).toBe('unknown');
  });
  it('records completion and advances in one transition; repeated confirmation stays idempotent', () => {
    let d = ready(); const key = taskCursor(d.guide.accountId!, 'email-mfa', 'verify');
    d = completeStep(move(d, key));
    expect(d.guide.cursor).toBe(`auth-location/${d.guide.accountId}`);
    expect(d.assets[0].controls.mfa).toBe('verified'); expect(d.assets[0].controlEvidence.mfa).toBe('user-confirmed');
    expect(d.assessmentAnswers[controlKey('identity.primary-email-mfa', d.assets[0].id)]).toMatchObject({ response: 'yes', evidence: 'user-confirmed' });
    d = completeStep(move(d, key)); expect(d.actions.filter(a => a.id === key)).toHaveLength(1);
    d = undoStep(d, key); expect(d.assets[0].controls.mfa).toBe('unknown'); expect(d.actions).toHaveLength(0);
    expect(d.assessmentAnswers[controlKey('identity.primary-email-mfa', d.assets[0].id)]).toBeUndefined(); expect(d.guide.cursor).toBe(key);
  });
  it('undo restores earlier evidence rather than wiping a legacy record', () => {
    let d = ready(); d.assets[0].controls.mfa = 'implemented'; d.assets[0].controlEvidence.mfa = 'user-reported';
    const answerKey = controlKey('identity.primary-email-mfa', d.assets[0].id);
    const answer = { response: 'yes' as const, evidence: 'user-reported' as const, updatedAt: '2025-01-01' }; d.assessmentAnswers[answerKey] = answer;
    const key = taskCursor(d.assets[0].id, 'email-mfa', 'verify'); d = completeStep(move(d, key)); d = undoStep(d, key);
    expect(d.assets[0].controls.mfa).toBe('implemented'); expect(d.assessmentAnswers[answerKey]).toEqual(answer);
  });
  it('records an observed enabled state once and advances without asking for the same confirmation again', () => {
    const d = ready(),id=d.assets[0].id,state=move(d,taskCursor(id,'email-mfa','state'));
    const next=completeStep(state,'verify');expect(next.guide.cursor).toBe(`auth-location/${id}`);expect(next.assets[0].controls.mfa).toBe('verified');expect(next.assets[0].controls.recovery).toBe('unknown');
    expect(next.guide.steps[taskCursor(id,'email-mfa','state')]).toBeUndefined();expect(next.guide.steps[taskCursor(id,'email-mfa','verify')]?.status).toBe('done');expect(next.actions.filter(a=>a.controlId==='mfa')).toHaveLength(1);
    for(const step of ['enable','enroll','auth-scan','auth-confirm'])expect(next.guide.steps[taskCursor(id,'email-mfa',step)]).toBeUndefined();
  });
  it('preserves the precise step across encrypted save/reload, including deferral and back', async () => {
    const d = completeStep(ready()); const encrypted = await createEncryptedVault('a long storage-only phrase', d);
    const restored = (await decryptVault(encrypted.envelope, 'a long storage-only phrase')).data;
    expect(restored.guide.cursor).toBe(d.guide.cursor); expect(back(restored).guide.cursor).toContain('/open');
    const later = deferStep(restored); expect(later.guide.steps[d.guide.cursor].status).toBe('later'); expect(later.assets[0].controls.mfa).toBe('unknown');
  });
  it('retains old data, workflow progress, action IDs and encryption format', async () => {
    const d = ready(); d.assets[0].controls.mfa = 'verified'; d.workflowProgress = { old: ['step-1'] }; d.actions.push({ id: 'old-action', status: 'completed', completedAt: '2025-01-01' });
    const old = JSON.parse(JSON.stringify(d)); old.version = 1; delete old.securityModel; delete old.deviceWorkflows; delete old.guide; for (const a of old.assets) { delete a.provider; delete a.services; }
    const vault = await createEncryptedVault('a compatible backup phrase', datasetSchema.parse(old));
    const restored = (await decryptVault(vault.envelope, 'a compatible backup phrase')).data;
    expect(vault.envelope.format).toBe('personal-cyber-os-v1'); expect(restored.assets[0].id).toBe(d.assets[0].id);
    expect(restored.assets[0].controls.mfa).toBe('verified'); expect(restored.actions).toEqual(d.actions); expect(restored.workflowProgress).toEqual(d.workflowProgress); expect(restored.guide.cursor).toBe('start');
    const selected = selectAccount(restored, 'apple', 'ja', restored.assets[0].id);
    expect(beginRecipe(selected, selected.assets[0].id, 'email-mfa').guide.cursor).toContain('recorded/');
  });
  it('never permits a password change before recovery and manager MFA are recorded', () => {
    const d = ready(); expect(beginRecipe(d, d.assets[0].id, 'password').guide.cursor).toBe('password-prerequisite');
    expect(currentTask(beginRecipe(d, d.assets[0].id, 'recovery'))?.recipe.id).toBe('email-mfa');
  });
});
describe('map and exception help', () => {
  it('uses only confirmed links, deduplicates links and handles cycles', () => {
    const d = ready(); const phone = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Phone', importance: 'critical' });
    const other = makeAsset({ kind: 'account', type: 'Cloud', name: 'Cloud', importance: 'critical' }); d.assets.push(phone, other);
    expect(dependents(d, phone.id)).toEqual([]);
    let next = addRelation(d, d.assets[0].id, phone.id, 'authentication'); next = addRelation(next, d.assets[0].id, phone.id, 'authentication');
    expect(next.dependencies).toHaveLength(1);
    next = addRelation(next, other.id, d.assets[0].id, 'recovery-email'); next = addRelation(next, phone.id, other.id, 'backup');
    expect(dependents(next, phone.id).map(a => a.id)).toEqual([d.assets[0].id, other.id]);
    expect(addRelation(next, phone.id, phone.id, 'authentication').dependencies).toHaveLength(3);
  });
  it('exports only allowlisted service/OS labels; no names, notes or raw answers', () => {
    const d = ready(); d.assets[0].name = 'private@example.com'; d.assets[0].notes = 'recovery code: SECRET'; d.guide.answers[`${d.assets[0].id}:platform`] = 'private OS version secret';
    const prompt = helpPrompt(d, '画面が違う', 'ja');
    expect(prompt).toContain('Apple Account'); expect(prompt).toContain('最新の公式資料'); expect(prompt).toContain(SOURCES.appleMfa.url);
    expect(prompt).not.toContain('private@example'); expect(prompt).not.toContain('SECRET'); expect(prompt).not.toContain('private OS');
  });
});
describe('maintainable bilingual recipes', () => {
  it('has valid transitions and official sources for all platform and product branches', () => {
    const recipes = [...(['proton', 'fastmail', 'tuta', 'zoho', 'yahoo', 'startmail', 'mailcom', 'gmx'] as const).flatMap(p => [emailRecipe(p, 'web'), recoveryRecipe(p, 'web')]), emailRecipe('apple', 'ios'), emailRecipe('apple', 'macos'), emailRecipe('apple', 'web'), emailRecipe('google', 'web'), emailRecipe('microsoft', 'web'), recoveryRecipe('apple', 'web'), recoveryRecipe('google', 'web'), recoveryRecipe('microsoft','web'), managerRecipe('bitwarden', 'ios', 'eu'), managerRecipe('1password', 'windows', 'us'), ...['ios', 'macos', 'android', 'windows'].map(deviceRecipe)];
    const d = ready(); recipes.push(passwordRecipe('bitwarden', d.assets[0], 'ios'), passwordRecipe('1password', d.assets[0], 'macos'));
    for (const recipe of recipes) {
      expect(new Set(recipe.steps.map(s => s.id)).size).toBe(recipe.steps.length);
      for (const step of recipe.steps) {
        for (const text of [step.title, step.place, step.action, step.expected]) { expect(text.en.length).toBeGreaterThan(4); expect(text.ja.length).toBeGreaterThan(2); }
        expect(step.sources.length).toBeGreaterThan(0);
        for (const s of step.sources) { expect(SOURCES[s].checked).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(SOURCES[s].checked <= '2026-11-14').toBe(true); expect(SOURCES[s].url).toMatch(/^https:\/\//); }
        for (const choice of step.choices ?? []) expect(choice.next === '$complete' || recipe.steps.some(s => s.id === choice.next)).toBe(true);
      }
    }
  });
});

describe('extended provider completion boundaries', () => {
  it('does not record recovery twice after codes were already stored during enrollment', () => {
    let d = selectAccount(newDataset('ja'), 'proton', 'ja');
    const id = d.guide.accountId!;
    d = completeStep(move(d, taskCursor(id, 'email-mfa', 'save-codes')));
    expect(d.assets[0].controls.recovery).toBe('unknown');
    d = completeStep(move(d, taskCursor(id, 'email-mfa', 'verify')));
    d = beginRecipe(d, id, 'recovery');
    expect(currentTask(d)?.step.id).toBe('test');
    d = completeStep(d);
    expect(d.assets[0].controls.recovery).toBe('verified');
    expect(d.actions.filter(a => a.id.includes('/recovery/'))).toHaveLength(1);
  });
});
