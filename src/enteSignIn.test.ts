import { beforeAll, describe, expect, it } from 'vitest';
import { newDataset, makeAsset, currentDatasetSchema, type CurrentDataset } from './models';
import { createEnteApp, createEnteRoot, startEnteTask, putEnteTask, putEnteEntity, enteTask } from './enteData';
import { enteStore, entePrepared, enteReceiptCurrent, entePasswordPending } from './enteSchemas';
import { answerEnte, confirmEnte, currentEnteStep, beginEnteChild, restartEnteSignIn, enteAccountReady, navigateEnte, enteHelpPrompt } from './enteEngine';
import { finishEnte } from './enteIntegration';
import { evaluateAccess } from './securityModel';
import { createEncryptedVault, decryptVault } from './crypto';

let tick = 0;
// Each scenario runs a complete workflow with schema checks at every transition.
const workflowTimeout = 30_000;
const at = () => new Date(Date.parse('2026-11-14T08:00:00Z') + ++tick * 1000).toISOString();
const valid = (data: CurrentDataset) => { const parsed = currentDatasetSchema.safeParse(data); if (!parsed.success) throw Error(JSON.stringify(parsed.error.issues)); return data; };
function drive(data: CurrentDataset, id: string, answers: Record<string, string> = {}, until?: string): CurrentDataset {
  for (let n = 0; n < 220; n++) {
    const task = enteTask(data, id)!; if (task.status === 'completed') return valid(data);
    const step = currentEnteStep(data, task); if (step.id === until) return valid(data);
    let next;
    if (step.child) { const child = beginEnteChild(data, id); next = finishEnte(drive(child.data, child.id, answers), child.id); }
    else if (step.kind === 'question') {
      const defaults: Record<string, string> = {
        version: 'supported', state: 'account', 'lock-mode': 'device',
        'file-choice': 'new', 'backup-kind': 'manual', 'file-secret-mode': 'new', 'save-place': 'external', 'file-location': 'add',
        'root-password-state': 'known', 'root-key-copy': 'new', 'root-email-mode': 'off', 'root-mail': 'account:mail', 'root-mfa': 'passkey', 'root-passkey-record': 'add', 'root-factor-store': 'local',
        'recovery-purpose': 'forgot', 'recovery-place': 'app', 'recovery-photos': 'no', 'recovery-locker': 'no', 'recovery-key-state': 'available', 'recovery-paper': 'new', 'recovery-result': 'uncertain', 'recovery-mail': 'account:mail', 'recovery-device': 'device:web',
        'signin/root/browser': 'chrome', 'signin/root/session': 'login', 'signin/root/entry': 'password', 'signin/root/after-password': 'passkey', 'signin/root/after-factor': 'data',
        'signin/recovery/browser': 'chrome', 'signin/recovery/session': 'login', 'signin/recovery/entry': 'password', 'signin/recovery/after-password': 'passkey', 'signin/recovery/after-factor': 'data', 'signin/recovery/mail': 'account:mail',
      };
      const value = answers[step.id] ?? (step.id.endsWith('/credential') ? step.choices![0].value : defaults[step.id]);
      if (!value) throw Error('Missing sign-in choice ' + step.id);
      next = answerEnte(data, id, value, at());
    } else if (step.kind === 'action') next = confirmEnte(data, id, at());
    else throw Error('Blocked sign-in ' + step.id);
    if (next === data) throw Error('No progress at ' + step.id);
    data = valid(next as CurrentDataset);
    if (step.kind === 'action' && currentEnteStep(data, enteTask(data, id)!).id === step.id) throw Error('The sign-in check is still unconfirmed: ' + step.id);
  }
  throw Error('Sign-in did not finish');
}
type Fixture = { data: CurrentDataset; appRef: string; rootRef: string; passkeyRef: string };
let baseline: Fixture;
beforeAll(() => {
  let data = newDataset('ja');
  data.assets = [
    { ...makeAsset({ kind: 'device', type: 'Smartphone', name: 'Original phone', operatingSystem: 'ios', importance: 'critical' }), id: 'phone' },
    { ...makeAsset({ kind: 'device', type: 'Computer', name: 'Current Mac', operatingSystem: 'macos', importance: 'critical' }), id: 'web' },
    { ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Private mailbox label', importance: 'critical' }), id: 'mail', provider: 'proton', purpose: 'personal' },
  ];
  data.guide = { ...data.guide, cursor: 'manager-select', answers: { private: 'preserve all main answers' }, history: ['start', 'provider'] };
  const app = createEnteApp(data, 'phone', undefined, at()), root = createEnteRoot(app.data, undefined, at());
  const prep = startEnteTask(root.data, { kind: 'prepare', appRef: app.appRef, rootRef: root.rootRef, origin: 'map' }, at()); data = drive(prep.data, prep.id);
  expect(entePrepared(data, app.appRef)).toBe(true);
  data = putEnteEntity(data, { id: 'other-code', kind: 'credential', credentialType: 'totp', subjectRef: 'mail', storageRef: app.appRef, roles: ['second-step'], label: 'Other service code', createdAt: at() });
  // A previously completed guide is a real compatibility fixture, not a newly upgraded task.
  const old = startEnteTask(data, { kind: 'account', appRef: app.appRef, rootRef: root.rootRef, origin: 'map' }, at());
  data = putEnteTask(old.data, { ...enteTask(old.data, old.id)!, stepwiseSignInV1: undefined, browserOpeningV1: undefined }); data = drive(data, old.id);
  const passkey = data.securityModel.entities.find(e => e.kind === 'credential' && e.subjectRef === root.rootRef && e.credentialType === 'passkey')!;
  baseline = { data, appRef: app.appRef, rootRef: root.rootRef, passkeyRef: passkey.id };
}, 20000);
const fixture = () => structuredClone(baseline);
const account = (f: Fixture) => startEnteTask(f.data, { kind: 'account', appRef: f.appRef, rootRef: f.rootRef, origin: 'map' }, at(), true);
const recover = (f: Fixture) => startEnteTask(f.data, { kind: 'recovery', appRef: f.appRef, rootRef: f.rootRef, origin: 'map' }, at(), true);
const addTotp = (f: Fixture, passkeyAlso = false) => {
  f.data = putEnteEntity(f.data, { id: 'known-root-totp', kind: 'credential', credentialType: 'totp', subjectRef: f.rootRef, storageRef: f.appRef, roles: ['second-step'], label: 'Existing Account TOTP', createdAt: at() });
  if (!passkeyAlso) f.data.securityModel.lifecycle[f.passkeyRef] = { state: 'revoked', evidence: 'user-confirmed', updatedAt: at() };
  return f;
};
const readProof = (data: CurrentDataset, id: string) => {
  const task = enteTask(data, id)!, receipt = task.records[task.kind === 'account' ? 'root-data-read' : 'recovery-data-read'];
  return enteStore(data)!.proofs.find(p => p.kind === 'account-read' && p.directReceiptRef === receipt)!;
};
const factFor = (data: CurrentDataset, id: string) => data.securityModel.facts.find(f => f.id === readProof(data, id).factRef)!;

describe('Ente actual-screen sign-in without repeated completed authentication', () => {
  for (const scenario of [
    { name: 'password then passkey', answers: {}, factorFirst: false, email: false },
    { name: 'password then the method-choice screen', answers: { 'signin/root/after-password': 'choice' }, factorFirst: false, email: false },
    { name: 'email then passkey then password', answers: { 'root-email-mode': 'on', 'signin/root/entry': 'email', 'signin/root/after-email': 'passkey', 'signin/root/after-factor': 'password' }, factorFirst: true, email: true },
    { name: 'email then the method-choice screen then password', answers: { 'root-email-mode': 'on', 'signin/root/entry': 'email', 'signin/root/after-email': 'choice', 'signin/root/after-factor': 'password' }, factorFirst: true, email: true },
    { name: 'the real screen differs from the earlier email setting', answers: { 'root-email-mode': 'on', 'signin/root/entry': 'password' }, factorFirst: false, email: false },
  ]) it(scenario.name, () => {
    const f = fixture(), started = account(f), done = drive(started.data, started.id, scenario.answers as Record<string, string>), task = enteTask(done, started.id)!, history = task.history;
    expect(task.stepwiseSignInV1).toBe(1); expect(task.status).toBe('completed'); expect(enteAccountReady(done, f.appRef)).toBe(true);
    expect(history.filter(s => s === 'root-factor-use')).toHaveLength(1); expect(history.filter(s => s === 'root-login-open')).toHaveLength(1);
    expect(history.includes('root-passkey-create')).toBe(false); expect(done.guide).toEqual(f.data.guide);
    const factorIndex = history.indexOf('root-factor-use'), passwordIndex = history.indexOf('signin/root/password'); expect(factorIndex < passwordIndex).toBe(scenario.factorFirst);
    expect(factFor(done, started.id).requiredRefs.includes('mail')).toBe(scenario.email);
    expect(done.securityModel.entities.find(e => e.id === 'other-code')).toEqual(f.data.securityModel.entities.find(e => e.id === 'other-code'));
  }, workflowTimeout);

  it('only re-enters the password when Ente actually asks again, without a second MFA test', () => {
    const f = fixture(), t = account(f), done = drive(t.data, t.id, { 'signin/root/after-factor': 'password' }), history = enteTask(done, t.id)!.history;
    expect(history.indexOf('signin/root/password')).toBeLessThan(history.indexOf('root-factor-use')); expect(history.indexOf('signin/root/password-again')).toBeGreaterThan(history.indexOf('root-factor-use')); expect(history.filter(s => s === 'root-factor-use')).toHaveLength(1);
  }, workflowTimeout);

  for (const emailFirst of [false, true]) for (const methodChoice of [false, true]) it(`uses the actual TOTP entry: email-first=${emailFirst}, method-choice=${methodChoice}`, () => {
    const f = addTotp(fixture(), methodChoice), t = account(f);
    const answers: Record<string, string> = { 'root-mfa': 'totp', 'root-factor-store': `store:${f.appRef}`, 'signin/root/entry': emailFirst ? 'email' : 'password', 'signin/root/after-password': methodChoice ? 'choice' : 'totp', 'signin/root/after-email': methodChoice ? 'choice' : 'totp', 'signin/root/after-factor': emailFirst ? 'password' : 'data' };
    const done = drive(t.data, t.id, answers), task = enteTask(done, t.id)!, fact = factFor(done, t.id);
    expect(task.status).toBe('completed'); expect(task.resources.factorCredential).toBe('known-root-totp'); expect(fact.requiredRefs).toContain('known-root-totp'); expect(fact.requiredRefs).not.toContain(f.passkeyRef);
    expect(task.history.filter(id => id === 'root-factor-use')).toHaveLength(1); expect(task.history.includes('signin/root/method-select')).toBe(methodChoice); expect(fact.requiredRefs.includes('mail')).toBe(emailFirst);
  }, workflowTimeout);

  it('records an unrecorded existing TOTP only when Ente accepts that code', () => {
    const f = fixture(), t = account(f), answers = { 'root-mfa': 'totp', 'root-factor-store': `store:${f.appRef}`, 'signin/root/after-password': 'totp' };
    const before = drive(t.data, t.id, answers, 'root-factor-use'); expect(before.securityModel.entities.some(e => e.kind === 'credential' && e.subjectRef === f.rootRef && e.credentialType === 'totp')).toBe(false);
    const done = drive(before, t.id, answers), task = enteTask(done, t.id)!, ref = task.resources.factorCredential!;
    expect(task.status).toBe('completed'); expect(done.securityModel.entities.find(e => e.id === ref)).toMatchObject({ kind: 'credential', credentialType: 'totp', subjectRef: f.rootRef, storageRef: f.appRef }); expect(factFor(done, t.id).requiredRefs).toContain(ref);
  }, workflowTimeout);

  it('does not count a password-only screen or another factor as the selected passkey', () => {
    const f = fixture();
    for (const display of ['data', 'totp']) {
      const t = account(f), before = drive(t.data, t.id, {}, 'signin/root/after-password'), next = answerEnte(before, t.id, display, at()) as CurrentDataset;
      expect(currentEnteStep(next, enteTask(next, t.id)!).kind).toBe('blocked'); expect(enteTask(next, t.id)!.status).toBe('active'); expect(enteTask(next, t.id)!.records['root-data-read']).toBeUndefined(); expect(enteTask(next, t.id)!.records['root-factor-use']).toBeUndefined();
      expect(next.securityModel.entities.find(e => e.id === f.passkeyRef)).toEqual(f.data.securityModel.entities.find(e => e.id === f.passkeyRef));
    }
  });

  it('restarts an expired attempt without repeating registration or mixing the old factor receipt into a new read proof', () => {
    const f = fixture(), t = account(f), before = drive(t.data, t.id, {}, 'signin/root/after-factor'), oldFactor = enteTask(before, t.id)!.records['root-factor-use'], expired = answerEnte(before, t.id, 'expired', at()), restarted = restartEnteSignIn(expired, t.id, at()) as CurrentDataset;
    expect(currentEnteStep(restarted, enteTask(restarted, t.id)!).id).toBe('signin/root/browser'); expect(enteReceiptCurrent(enteStore(restarted)!, oldFactor)).toBe(false);
    const done = drive(restarted, t.id), newFactor = enteTask(done, t.id)!.records['root-factor-use']; expect(newFactor).not.toBe(oldFactor); expect(readProof(done, t.id).receiptRefs).toContain(newFactor); expect(readProof(done, t.id).receiptRefs).not.toContain(oldFactor); expect(enteTask(done, t.id)!.records['root-passkey-create']).toBeUndefined(); expect(done.guide).toEqual(f.data.guide);
  }, workflowTimeout);

  it('preserves a completed legacy guide and opaque data through the existing encrypted format', async () => {
    const f = fixture(), old = enteStore(f.data)!.tasks.find(t => t.kind === 'account')!, current = currentEnteStep(f.data, old); expect(current.kind).toBe('finished'); expect(old.stepwiseSignInV1).toBeUndefined();
    const t = account(f); const data = drive(t.data, t.id, { 'signin/root/entry': 'email', 'signin/root/after-email': 'passkey' }, 'signin/root/after-factor');
    const opaque = putEnteTask(data, { ...enteTask(data, t.id)!, futureSignInField: { keep: ['opaque'] } });
    const sealed = await createEncryptedVault('application encryption fixture phrase', opaque), opened = (await decryptVault(sealed.envelope, 'application encryption fixture phrase')).data;
    expect(opened).toEqual(opaque); expect(currentEnteStep(opened, enteTask(opened, t.id)!).id).toBe('signin/root/after-factor'); expect(enteStore(opened)!.tasks.find(t => t.id === old.id)).toEqual(old); expect(opened.guide).toEqual(f.data.guide);
  }, workflowTimeout);
});

describe('Ente new-password verification in the same sign-in', () => {
  for (const emailFirst of [false, true]) it(`verifies the new password with the actual TOTP method, email-first=${emailFirst}`, () => {
    const f = addTotp(fixture(), true), t = recover(f);
    const answers: Record<string, string> = { 'signin/recovery/entry': emailFirst ? 'email' : 'password', 'signin/recovery/after-email': 'choice', 'signin/recovery/after-password': 'choice', 'signin/recovery/method': 'totp', 'signin/recovery/credential': 'credential:known-root-totp', 'signin/recovery/after-factor': emailFirst ? 'password' : 'data' };
    const done = drive(t.data, t.id, answers), task = enteTask(done, t.id)!, fact = factFor(done, t.id);
    expect(task.status).toBe('completed'); expect(fact.requiredRefs).toContain('known-root-totp'); expect(fact.requiredRefs).not.toContain(f.passkeyRef); expect(fact.requiredRefs.includes('mail')).toBe(emailFirst);
    expect(task.history.filter(id => id === 'signin/recovery/factor-use')).toHaveLength(1); expect(task.history.filter(id => id === 'recovery-password-request')).toHaveLength(1);
    expect(enteStore(done)!.tasks.some(child => child.kind === 'account' && child.createdAt > task.createdAt)).toBe(false);
  }, workflowTimeout);
  for (const emailFirst of [false, true]) it(emailFirst ? 'accepts the candidate after the actual email and factor screens' : 'accepts the candidate before the factor and reads data without a second sign-in', () => {
    const f = fixture(), t = recover(f), before = drive(t.data, t.id, {}, 'recovery-password-request'), candidate = enteTask(before, t.id)!.recoveryStateV1!.password!.candidateRef, old = enteStore(before)!.roots[0].passwordRef;
    const requested = confirmEnte(before, t.id, at()) as CurrentDataset; expect(entePasswordPending(requested.securityModel, f.rootRef)).toBe(true);
    const answers: Record<string, string> = emailFirst ? { 'signin/recovery/entry': 'email', 'signin/recovery/after-email': 'passkey', 'signin/recovery/after-factor': 'password' } : {};
    const done = drive(requested, t.id, answers), task = enteTask(done, t.id)!, root = enteStore(done)!.roots[0];
    expect(root.passwordRef).toBe(candidate); expect(root.passwordRef).not.toBe(old); expect(task.status).toBe('completed'); expect(enteAccountReady(done, f.appRef)).toBe(true);
    expect(task.history.filter(s => s === 'recovery-password-request')).toHaveLength(1); expect(task.history.filter(s => s === 'signin/recovery/open')).toHaveLength(1); expect(task.history.filter(s => s === 'signin/recovery/factor-use')).toHaveLength(1);
    expect(enteStore(done)!.tasks.some(t => t.kind === 'account' && t.createdAt > task.createdAt)).toBe(false);
    const fact = factFor(done, t.id), route = done.securityModel.routes.find(r => r.requirements.kind === 'fact' && r.requirements.factId === fact.id)!;
    expect(fact.requiredRefs).toContain(candidate); expect(fact.requiredRefs).toContain(f.passkeyRef); expect(fact.requiredRefs.includes('mail')).toBe(emailFirst); expect(evaluateAccess(done.securityModel, route.id, { context: 'no-existing-session', now: at() }).state).toBe('available');
  }, workflowTimeout);

  it('does not confirm an unknown change from a code list reached without using the candidate', () => {
    const f = fixture(), t = recover(f), before = drive(t.data, t.id, { 'signin/recovery/entry': 'email' }, 'signin/recovery/after-email'), next = answerEnte(before, t.id, 'data', at()) as CurrentDataset;
    expect(currentEnteStep(next, enteTask(next, t.id)!).id).toBe('signin/recovery/password-not-used'); expect(enteTask(next, t.id)!.recoveryStateV1!.password!.phase).toBe('requested'); expect(entePasswordPending(next.securityModel, f.rootRef)).toBe(true);
    const restarted = restartEnteSignIn(next, t.id, at()) as CurrentDataset; expect(enteTask(restarted, t.id)!.records['recovery-password-request']).toBe(enteTask(next, t.id)!.records['recovery-password-request']); expect(enteStore(restarted)!.roots[0].passwordRef).toBe(enteStore(f.data)!.roots[0].passwordRef); expect(enteTask(restarted, t.id)!.answers['signin/recovery/mail']).toBeUndefined(); expect(enteTask(restarted, t.id)!.resources.recoveryMail).toBeUndefined();
    const done = drive(restarted, t.id); expect(enteTask(done, t.id)!.history.filter(s => s === 'recovery-password-request')).toHaveLength(1); expect(enteTask(done, t.id)!.status).toBe('completed');
  }, workflowTimeout);

  it('records an unrecorded passkey only after actual acceptance and binds local storage to the real web device', () => {
    const f = fixture(); f.data.securityModel.lifecycle.phone = { state: 'lost', evidence: 'user-confirmed', updatedAt: at() }; f.data.securityModel.lifecycle[f.appRef] = { state: 'unavailable', evidence: 'user-confirmed', updatedAt: at() };
    const t = recover(f), answers = { 'recovery-place': 'web', 'recovery-entry': 'password', 'recovery-screen': 'key', 'signin/recovery/credential': 'record', 'signin/recovery/store': 'local' };
    const before = drive(t.data, t.id, answers, 'signin/recovery/factor-use'); expect(enteTask(before, t.id)!.resources.recoveryFactor).toBeUndefined();
    const confirmed = confirmEnte(before, t.id, at()) as CurrentDataset, ref = enteTask(confirmed, t.id)!.resources.recoveryFactor!, credential = confirmed.securityModel.entities.find(e => e.id === ref)!;
    expect(credential).toMatchObject({ kind: 'credential', credentialType: 'passkey', subjectRef: f.rootRef, storageRef: 'web' });
    const done = drive(confirmed, t.id, answers), fact = factFor(done, t.id); expect(enteTask(done, t.id)!.status).toBe('completed'); expect(fact.requiredRefs).toContain('web'); expect(fact.requiredRefs).toContain(ref); expect(fact.requiredRefs).not.toContain('phone'); expect(fact.requiredRefs).not.toContain(f.appRef); expect(fact.observedWithoutRefs).toContain(f.appRef); expect(done.securityModel.lifecycle.phone.state).toBe('lost'); expect(done.securityModel.lifecycle[f.appRef].state).toBe('unavailable'); expect(done.guide).toEqual(f.data.guide);
  }, workflowTimeout);
});

describe('Ente separate browser opening without discarding working access', () => {
  it('includes only an allowed browser name in help, excluding private labels and arbitrary answers', () => {
    const f = fixture(); f.data.assets.find(d => d.id === 'phone')!.name = 'PRIVATE DEVICE LABEL'; const t = account(f), data = drive(t.data, t.id, {}, 'root-login-open'), task = enteTask(data, t.id)!; task.answers.private = 'PRIVATE ANSWER';
    const prompt = enteHelpPrompt(data, task, 0, 'en'); expect(prompt).toContain('Browser: Chrome'); expect(prompt).toContain('OS: ios'); expect(prompt).toContain('support.google.com/chrome/answer/95464'); expect(prompt).not.toMatch(/PRIVATE DEVICE LABEL|PRIVATE ANSWER/);
    for (const value of ['PRIVATE BROWSER VALUE', '__proto__', 'constructor']) { const untrusted = { ...task, answers: { ...task.answers, 'signin/root/browser': value } }; const prompt = enteHelpPrompt(data, untrusted, 0, 'en'); expect(prompt).not.toContain(value); expect(prompt).not.toContain('\nBrowser:'); }
  }, workflowTimeout);

  for (const variant of ['more', 'tabs', 'ipad'] as const) it(`uses the actual Safari ${variant} controls before opening the official address`, () => {
    const f = fixture(), t = account(f), answers = { 'signin/root/browser': 'safari', 'signin/root/safari-device': variant === 'ipad' ? 'ipad' : 'iphone', 'signin/root/safari-layout': variant };
    const target = variant === 'tabs' ? 'signin/root/browser-tabs' : 'signin/root/browser-menu';
    const before = drive(t.data, t.id, answers, target), step = currentEnteStep(before, enteTask(before, t.id)!);
    expect(step.action!.ja).toContain(variant === 'ipad' ? '長押し' : variant === 'more' ? '「詳細」' : 'タブ');
    const opened = drive(before, t.id, answers, 'root-login-open'), address = currentEnteStep(opened, enteTask(opened, t.id)!);
    expect(address.copyUrl).toBe('https://auth.ente.com/'); expect(address.url).toBeUndefined(); expect(enteTask(opened, t.id)!.records['root-factor-use']).toBeUndefined();
    const done = drive(opened, t.id, answers), task = enteTask(done, t.id)!;
    expect(task.status).toBe('completed'); expect(task.history.indexOf('signin/root/browser-new')).toBeLessThan(task.history.indexOf('root-login-open')); expect(task.history.filter(id => id === 'root-factor-use')).toHaveLength(1); expect(done.guide).toEqual(f.data.guide);
  }, workflowTimeout);

  it('does not count an existing private code list and restarts only the attempt', () => {
    const f = fixture(), t = account(f), before = drive(t.data, t.id, {}, 'signin/root/session'), record = enteTask(before, t.id)!.records['root-passkey-list'];
    const blocked = answerEnte(before, t.id, 'signed-in', at()) as CurrentDataset; expect(currentEnteStep(blocked, enteTask(blocked, t.id)!).id).toBe('signin/root/session-not-fresh'); expect(enteTask(blocked, t.id)!.records['root-factor-use']).toBeUndefined(); expect(enteTask(blocked, t.id)!.records['root-data-read']).toBeUndefined();
    const restarted = restartEnteSignIn(blocked, t.id, at()) as CurrentDataset; expect(currentEnteStep(restarted, enteTask(restarted, t.id)!).id).toBe('signin/root/browser'); expect(enteReceiptCurrent(enteStore(restarted)!, record)).toBe(true); expect(restarted.guide).toEqual(f.data.guide);
  }, workflowTimeout);

  it('uses an already prepared unsigned-in profile without making the user open private tabs', () => {
    const f = fixture(), t = account(f), done = drive(t.data, t.id, { 'signin/root/browser': 'ready' }), task = enteTask(done, t.id)!;
    expect(task.status).toBe('completed'); expect(task.history.some(id => id.startsWith('signin/root/browser-'))).toBe(false); expect(task.history).toContain('signin/root/session'); expect(task.history.filter(id => id === 'root-factor-use')).toHaveLength(1);
  }, workflowTimeout);

  it('withdraws a previous browser attempt when its browser choice is corrected', () => {
    const f = fixture(), t = account(f), before = drive(t.data, t.id, {}, 'signin/root/session'), old = enteTask(before, t.id)!.records['root-login-open'];
    const back = navigateEnte(before, t.id, 'signin/root/browser', at()), changed = answerEnte(back, t.id, 'firefox', at()) as CurrentDataset;
    expect(enteReceiptCurrent(enteStore(changed)!, old)).toBe(false);
    const answers = { 'signin/root/browser': 'firefox', 'signin/root/firefox-close-tabs': 'off' }, next = drive(changed, t.id, answers, 'signin/root/session');
    expect(enteTask(next, t.id)!.records['root-login-open']).not.toBe(old); expect(enteTask(next, t.id)!.records['signin/root/firefox-keep-tabs']).toBeUndefined(); expect(next.securityModel.entities.find(e => e.id === f.passkeyRef)).toEqual(f.data.securityModel.entities.find(e => e.id === f.passkeyRef)); expect(next.guide).toEqual(f.data.guide);
  }, workflowTimeout);

  it('keeps the previous actual-screen recipe and partial position when browser opening was not part of the stored task', async () => {
    const f = fixture(), t = account(f), legacy = putEnteTask(t.data, { ...enteTask(t.data, t.id)!, browserOpeningV1: undefined });
    const before = drive(legacy, t.id, {}, 'signin/root/after-factor'), sealed = await createEncryptedVault('stored browser recipe fixture phrase', before), opened = (await decryptVault(sealed.envelope, 'stored browser recipe fixture phrase')).data;
    expect(currentEnteStep(opened, enteTask(opened, t.id)!).id).toBe('signin/root/after-factor'); expect(enteTask(opened, t.id)!.answers['signin/root/browser']).toBeUndefined(); expect(enteTask(opened, t.id)!.browserOpeningV1).toBeUndefined(); const done = drive(opened as CurrentDataset, t.id); expect(enteTask(done, t.id)!.status).toBe('completed'); expect(done.guide).toEqual(f.data.guide);
  }, workflowTimeout);

  it('adds browser instructions to a previous recipe only when its sign-in is explicitly restarted', () => {
    const f = fixture(), t = account(f), legacy = putEnteTask(t.data, { ...enteTask(t.data, t.id)!, browserOpeningV1: undefined });
    const before = drive(legacy, t.id, {}, 'signin/root/after-factor'), old = enteTask(before, t.id)!, expired = answerEnte(before, t.id, 'expired', at()), restarted = restartEnteSignIn(expired, t.id, at()) as CurrentDataset;
    expect(enteTask(restarted, t.id)!.browserOpeningV1).toBe(1); expect(currentEnteStep(restarted, enteTask(restarted, t.id)!).id).toBe('signin/root/browser'); expect(enteReceiptCurrent(enteStore(restarted)!, old.records['root-passkey-list'])).toBe(true); expect(enteReceiptCurrent(enteStore(restarted)!, old.records['root-factor-use'])).toBe(false); expect(restarted.securityModel.entities.find(e => e.id === f.passkeyRef)).toEqual(f.data.securityModel.entities.find(e => e.id === f.passkeyRef)); expect(restarted.guide).toEqual(f.data.guide);
  }, workflowTimeout);

  it('offers retaining Firefox’s existing privacy setting instead of forcing a change', () => {
    const f = fixture(), t = account(f), before = drive(t.data, t.id, { 'signin/root/browser': 'firefox' }, 'signin/root/firefox-close-tabs'), blocked = answerEnte(before, t.id, 'keep', at()) as CurrentDataset;
    expect(currentEnteStep(blocked, enteTask(blocked, t.id)!).id).toBe('signin/root/firefox-tabs-unavailable'); expect(enteTask(blocked, t.id)!.records['signin/root/firefox-keep-tabs']).toBeUndefined(); expect(enteTask(blocked, t.id)!.records['root-login-open']).toBeUndefined(); expect(blocked.guide).toEqual(f.data.guide);
  }, workflowTimeout);
});
