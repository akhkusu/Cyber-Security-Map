import { onePasswordScope } from './onePasswordAccount';
import { standardContextScope } from './standardContexts';
import type { Dataset } from './models';
import { bitwardenRegion } from './bitwardenServer';

const preparation = ['master-current-copy', 'master-emergency', 'master-email', 'master-candidate', 'master-candidate-paper', 'master-candidate-read', 'master-settings', 'master-tab', 'master-current', 'master-new'];
const key = (accountRef: string, step: string) => `do/${accountRef}/manager/${step}`;
export function standardMasterScope(data: Dataset, accountRef: string): string | undefined {
  const account = data.assets.find(a => a.id === accountRef);
  if (account?.provider === 'bitwarden') {
    const region = bitwardenRegion(data, accountRef);
    return region ? `bitwarden:${region}` : undefined;
  }
  return account?.provider === '1password' ? onePasswordScope(data,accountRef) : undefined;
}
const done = (data: Dataset, accountRef: string, step: string) => {
  const record = data.guide.steps[key(accountRef, step)], scope = standardMasterScope(data, accountRef);
  const receipt = data.guide.steps[key(accountRef, 'master-submit')];
  const sameChange = !step.startsWith('master-change-') || typeof receipt?.standardMasterAttemptV1 === 'string' && record?.standardMasterAttemptV1 === receipt.standardMasterAttemptV1;
  return !!scope && record?.status === 'done' && record.standardMasterScopeV1 === scope && sameChange && (step!=='master-change-test'||record.standardContextV1===standardContextScope(data,accountRef));
};
export const standardMasterStepCurrent = done;
export function standardMasterMetadata(data: Dataset, accountRef: string, step: string) {
  return {
    standardMasterScopeV1: standardMasterScope(data, accountRef),
    ...(step === 'master-submit' ? { standardMasterAttemptV1: crypto.randomUUID() }
      : step.startsWith('master-change-') ? { standardMasterAttemptV1: data.guide.steps[key(accountRef, 'master-submit')]?.standardMasterAttemptV1 } : {}),
  };
}
const hasReceipt = (data: Dataset, accountRef: string) => {
  const record = data.guide.steps[key(accountRef, 'master-submit')];
  return record?.status === 'done' && record.nextStepId === 'master-change-copy';
};
export function standardMasterAccepted(data: Dataset, accountRef: string): boolean {
  return hasReceipt(data, accountRef) && done(data, accountRef, 'master-submit');
}
export function standardMasterResume(data: Dataset, accountRef: string): string | undefined {
  if (hasReceipt(data, accountRef) && !standardMasterAccepted(data, accountRef)) return key(accountRef, 'master-context-changed');
  if (!standardMasterAccepted(data, accountRef)) return;
  const account = data.assets.find(a => a.id === accountRef);
  const pending = ['master-change-copy', ...(account?.provider === '1password'&&!done(data,accountRef,'master-change-policy') ? ['master-change-kit'] : []), 'master-change-test'].find(step => !done(data, accountRef, step));
  return pending ? key(accountRef, pending) : undefined;
}
/** Rendering never writes records; accepted changes resume after the actual change. */
export function standardMasterRedirect(data: Dataset, accountRef: string, step: string): string | undefined {
  if (hasReceipt(data, accountRef) && !standardMasterAccepted(data, accountRef) && step !== 'master-context-changed') return key(accountRef, 'master-context-changed');
  const accepted = standardMasterAccepted(data, accountRef);
  if (accepted && ['install', 'existing', 'master', 'create', 'existing-signin', 'master-review', ...preparation, 'master-submit', 'master-unconfirmed'].includes(step)) {
    return standardMasterResume(data, accountRef) ?? key(accountRef, data.assets.find(a => a.id === accountRef)?.provider === 'bitwarden' ? 'auth-ready' : 'recovery');
  }
  if (['master-change-copy', 'master-change-kit', 'master-change-test', 'master-change-policy', 'master-change-unverified'].includes(step)) {
    if (!accepted) return key(accountRef, 'master-submit');
    const required = step === 'master-change-copy' ? [] : ['master-change-copy', ...(step !== 'master-change-kit' && step !== 'master-change-policy' && !done(data,accountRef,'master-change-policy') && data.assets.find(a => a.id === accountRef)?.provider === '1password' ? ['master-change-kit'] : [])];
    const missing = required.find(id => !done(data, accountRef, id));
    if (missing) return key(accountRef, missing);
  }
  const at = preparation.indexOf(step);
  if (at >= 0 || step === 'master-submit') {
    const required = at >= 0 ? preparation.slice(0, at) : preparation;
    const missing = required.find(id => !done(data, accountRef, id));
    if (missing) return key(accountRef, missing);
  }
}
