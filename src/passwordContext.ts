import type { Dataset } from './models';
import {bitwardenRegion} from './bitwardenServer';

export function standardPasswordScope(data: Dataset): string | undefined {
  const manager = data.assets.find(a => a.id === data.guide.managerId);
  const region=manager?.provider==='bitwarden'?bitwardenRegion(data,manager.id):undefined;
  return manager?.provider === 'bitwarden' ? region?`bitwarden:${region}`:undefined : manager?.provider === '1password' ? '1password' : undefined;
}
export function hasSavedPasswordCandidate(data: Dataset, accountId: string): boolean {
  const scope = standardPasswordScope(data), saved = data.guide.steps[`do/${accountId}/password/save-candidate`];
  return !!scope && saved?.status === 'done' && saved.managerRef === data.guide.managerId && saved.managerScope === scope;
}
