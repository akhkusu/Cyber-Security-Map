import type { Dataset } from './models';

type RootCopy = { version: 1; rootRef: string; passwordRevision: string; independentOfAccount: true; installationRef: string; vaultRef: string };
export type NativeRootCopyState = 'current' | 'legacy' | 'changed' | 'missing' | 'unsupported';
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const records = (data: Dataset) => [...Object.values(data.guide.steps), ...(data.version === 2 ? data.deviceWorkflows.flatMap(w => Object.values(w.records)) : [])];

/** A copy is shared by the exact account, never by provider name or device. */
export function nativeRootCopyState(data: Dataset, rootRef?: string): NativeRootCopyState {
  if (data.version !== 2 || !rootRef || !data.assets.some(a => a.id === rootRef && a.kind === 'account')) return 'missing';
  const registry = object(data.securityModel.nativeRootCopyStateV1);
  if (data.securityModel.nativeRootCopyStateV1 !== undefined && (!registry || registry.version !== 1 || !Array.isArray(registry.managedRoots) || !registry.managedRoots.every(r => typeof r === 'string'))) return 'unsupported';
  const revision = data.securityModel.lifecycle[rootRef]?.accessResetAt ?? '';
  const proofs = records(data).filter(r => r.status === 'done' || r.status === 'confirmed').map(r => object(r.nativeRootCopyV1)).filter(p => p?.rootRef === rootRef);
  if (proofs.some(p => p?.version !== 1)) return 'unsupported';
  if (proofs.some(p => p?.passwordRevision === revision && p.independentOfAccount === true && typeof p.installationRef === 'string' && typeof p.vaultRef === 'string')) return 'current';
  if (revision) return 'changed';
  // Once a scoped confirmation has been used, undo must not resurrect older flags.
  if ((registry?.managedRoots as string[] | undefined)?.includes(rootRef)) return 'missing';
  const vaults = data.securityModel.entities.filter(e => e.kind === 'vault' && !e.mergedIntoRef && e.storageMode === 'account' && e.authenticationAccountRef === rootRef && ['apple-passwords', 'google-password-manager'].includes(e.productId));
  return data.securityModel.entities.some(e => e.kind === 'installation' && !e.mergedIntoRef && vaults.some(v => v.id === e.vaultRef) && e.controls?.independentRoot === 'verified') ? 'legacy' : 'missing';
}
export const nativeRootCopyReady = (data: Dataset, rootRef?: string) => ['current', 'legacy'].includes(nativeRootCopyState(data, rootRef));

/** Records only the ability to retrieve a copy; no secret or physical-copy count. */
export function nativeRootCopyProof(data: Dataset, rootRef: string, installationRef: string, vaultRef: string, previous?: unknown): RootCopy | undefined {
  if (data.version !== 2 || nativeRootCopyState(data, rootRef) === 'unsupported') return;
  const old = object(previous);
  if (previous !== undefined && (!old || old.version !== 1)) return;
  return { ...old, version: 1, rootRef, passwordRevision: data.securityModel.lifecycle[rootRef]?.accessResetAt ?? '', independentOfAccount: true, installationRef, vaultRef };
}
export function manageNativeRootCopy(data: Dataset, rootRef: string): Dataset {
  if (data.version !== 2 || nativeRootCopyState(data, rootRef) === 'unsupported') return data;
  const previous = object(data.securityModel.nativeRootCopyStateV1);
  return { ...data, securityModel: { ...data.securityModel, nativeRootCopyStateV1: { ...previous, version: 1, managedRoots: [...new Set([...(previous?.managedRoots as string[] | undefined ?? []), rootRef])] } } };
}
