import type { Dataset } from './models';
import { nativeInstallation, nativeVault } from './nativeManagers';
import { nativeRootCopyReady, nativeRootCopyState } from './nativeRootCopy';

const key = (account: string, recipe: string, step: string) => `do/${account}/${recipe}/${step}`;
type Binding = { accountRef: string; installationRef: string; vaultRef: string; deviceRef: string; productId: string; storageMode: string; authenticationAccountRef: string; profileLabel: string };
type Candidate = { version: 1; id: string; binding: Binding; generationRef: string; passwordRevision: string; selectionRef: string; method: 'note' | 'paper' };
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function context(data: Dataset, account: string, recipe: string) {
  if (data.version !== 2 || !recipe.startsWith('native-password:')) return;
  const app = nativeInstallation(data, recipe.slice('native-password:'.length)), vault = nativeVault(data, app?.vaultRef);
  if (!app || !vault || !vault.storageMode) return;
  const binding: Binding = { accountRef: account, installationRef: app.id, vaultRef: vault.id, deviceRef: app.deviceRef, productId: vault.productId, storageMode: vault.storageMode, authenticationAccountRef: vault.authenticationAccountRef ?? '', profileLabel: app.profileLabel ?? '' };
  const generated = data.guide.steps[key(account, recipe, 'generate')];
  const generationRef = generated?.status === 'done' ? typeof generated.nativeCandidateGenerationV1 === 'string' ? generated.nativeCandidateGenerationV1 : `legacy:${generated.updatedAt}` : 'unrecorded';
  return { binding, generationRef, passwordRevision: data.securityModel.lifecycle[account]?.accessResetAt ?? '' };
}
export function nativeCurrentPasswordCopyReady(data: Dataset, account: string, recipe: string): boolean {
  const record=data.guide.steps[key(account,recipe,'preserve-current')], scope=context(data,account,recipe);
  if(record?.status!=='done'||!scope)return false;
  if(typeof record.nativeCurrentPasswordRevisionV1==='string')return record.nativeCurrentPasswordRevisionV1===scope.passwordRevision;
  return !scope.passwordRevision || Date.parse(record.updatedAt)>=Date.parse(scope.passwordRevision);
}
export function nativeCandidateMethod(data: Dataset, account: string, recipe: string): Candidate['method'] | undefined {
  const selection = data.guide.steps[key(account, recipe, 'candidate-method')];
  if (selection?.status !== 'done' || typeof selection.nativeCandidateSelectionV1 !== 'string') return;
  const fallback = data.guide.steps[key(account, recipe, 'candidate-note-item')];
  if (fallback?.status === 'done' && fallback.nextStepId === 'candidate-paper' && fallback.nativeCandidateSelectionRefV1 === selection.nativeCandidateSelectionV1) return 'paper';
  return selection.nextStepId === 'candidate-note-open' ? 'note' : selection.nextStepId === 'candidate-paper' ? 'paper' : undefined;
}
export function nativeCandidateCopy(data: Dataset, account: string, recipe: string): Candidate | undefined {
  const expected = context(data, account, recipe), record = data.guide.steps[key(account, recipe, 'candidate-check')];
  const proof = object(record?.nativePasswordCandidateV1), method = nativeCandidateMethod(data, account, recipe);
  if (!expected || record?.status !== 'done' || proof?.version !== 1 || typeof proof.id !== 'string' || proof.method !== method || !method || proof.generationRef !== expected.generationRef || proof.selectionRef !== data.guide.steps[key(account,recipe,'candidate-method')]?.nativeCandidateSelectionV1) return;
  const actual = object(proof.binding);
  if (!actual || Object.entries(expected.binding).some(([field, value]) => actual[field] !== value)) return;
  return proof as unknown as Candidate;
}
export function nativePreparedCandidate(data: Dataset, account: string, recipe: string): Candidate | undefined {
  const proof = nativeCandidateCopy(data, account, recipe), expected = context(data, account, recipe);
  return proof && expected && nativeCurrentPasswordCopyReady(data,account,recipe) && proof.passwordRevision === expected.passwordRevision ? proof : undefined;
}
export function nativeCandidateIndependent(data: Dataset, account: string, recipe: string): boolean {
  const proof = nativePreparedCandidate(data, account, recipe); if (!proof) return false;
  if (proof.method === 'paper') return true;
  const independent = data.guide.steps[key(account, recipe, 'independent-candidate')];
  return independent?.status === 'done' && independent.nativeCandidateRefV1 === proof.id;
}
export function nativePasswordAccepted(data: Dataset, account: string, recipe: string): boolean {
  const revision = context(data, account, recipe)?.passwordRevision;
  const current = (record: Dataset['guide']['steps'][string] | undefined) => record?.status === 'done' && (!revision || Date.parse(record.updatedAt) >= Date.parse(revision));
  const result = data.guide.steps[key(account, recipe, 'candidate-status')];
  return current(data.guide.steps[key(account, recipe, 'apply')]) || (current(result) && result?.nativePasswordAcceptedV1 === true);
}
export function nativePasswordUseCurrent(data: Dataset, account: string, recipe: string): boolean {
  const scope = context(data, account, recipe), asset = data.assets.find(a => a.id === account);
  const app = scope && nativeInstallation(data, scope.binding.installationRef);
  if (!scope || !['implemented', 'verified'].includes(asset?.controls.uniquePassword ?? 'unknown') || app?.controls?.loginUse !== 'verified') return false;
  const record = data.guide.steps[key(account, recipe, 'test')];
  return !scope.passwordRevision || (record?.status === 'done' && Date.parse(record.updatedAt) >= Date.parse(scope.passwordRevision));
}
export function nativeRootCopyPendingAllowed(data: Dataset, account: string, recipe: string, step?: string): boolean {
  return context(data, account, recipe)?.binding.authenticationAccountRef === account && nativeRootCopyState(data, account) !== 'unsupported' && (nativePasswordAccepted(data, account, recipe) || step === 'candidate-status');
}
export function nativePasswordRedirect(data: Dataset, account: string, recipe: string, step: string): string | undefined {
  if (!recipe.startsWith('native-password:')) return;
  const here = (next: string) => key(account, recipe, next), scope = context(data, account, recipe);
  const accepted=nativePasswordAccepted(data,account,recipe);
  if(step==='update-independent-root'&&scope?.binding.authenticationAccountRef===account&&nativeRootCopyReady(data,account))return here('test');
  if(accepted&&['preserve-current','change-open','generate','candidate-method','candidate-note-open','candidate-note-item','candidate-note-edit','candidate-note-save','candidate-paper','candidate-check','independent-candidate','apply'].includes(step))return here('accepted-result');
  if(['test','cleanup','password-unconfirmed'].includes(step)&&accepted&&scope?.binding.authenticationAccountRef===account&&!nativeRootCopyReady(data,account))return here('update-independent-root');
  if (['generate','candidate-method'].includes(step) && !nativeCurrentPasswordCopyReady(data,account,recipe) && !nativePasswordAccepted(data,account,recipe)) return here('preserve-current');
  if (step === 'candidate-check' && !nativeCandidateMethod(data, account, recipe)) return here('candidate-method');
  if (step === 'independent-candidate' && !nativePreparedCandidate(data, account, recipe)) return here('candidate-method');
  if (step !== 'apply') return;
  // A historical acceptance is never an instruction to rotate the password again.
  if (!nativePreparedCandidate(data, account, recipe)) return here('candidate-status');
  if (scope?.binding.authenticationAccountRef === account && !nativeCandidateIndependent(data, account, recipe)) return here('independent-candidate');
}
export function nativePasswordStepMetadata(data: Dataset, account: string, recipe: string, step: string, next?: string): Record<string, unknown> {
  if (!recipe.startsWith('native-password:')) return {};
  if (step === 'update-independent-root') return { nativeUpdatedAccountRevisionV1: context(data,account,recipe)?.passwordRevision };
  if (step === 'preserve-current') return { nativeCurrentPasswordRevisionV1: context(data,account,recipe)?.passwordRevision };
  if (step === 'candidate-method') return { nativeCandidateSelectionV1: crypto.randomUUID() };
  if (step === 'candidate-note-item') return { nativeCandidateSelectionRefV1: data.guide.steps[key(account,recipe,'candidate-method')]?.nativeCandidateSelectionV1 };
  if (step === 'generate') return { nativeCandidateGenerationV1: crypto.randomUUID() };
  if (step === 'candidate-status') return { nativePasswordAcceptedV1: next === 'save-new' };
  if (step === 'candidate-check') {
    const scope = context(data, account, recipe), method = nativeCandidateMethod(data, account, recipe);
    return scope && method ? { nativePasswordCandidateV1: { version: 1, id: crypto.randomUUID(), ...scope, method, selectionRef: String(data.guide.steps[key(account,recipe,'candidate-method')]?.nativeCandidateSelectionV1) } satisfies Candidate } : {};
  }
  if (step === 'independent-candidate') return { nativeCandidateRefV1: nativePreparedCandidate(data, account, recipe)?.id };
  return {};
}
