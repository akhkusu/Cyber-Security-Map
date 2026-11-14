import type { Dataset } from './models';

export function standardPasswordScope(data: Dataset): string | undefined {
  const manager = data.assets.find(a => a.id === data.guide.managerId);
  return manager?.provider === 'bitwarden' ? `bitwarden:${data.guide.answers[`${manager.id}:region`] === 'eu' ? 'eu' : 'us'}` : manager?.provider === '1password' ? '1password' : undefined;
}
export function hasSavedPasswordCandidate(data: Dataset, accountId: string): boolean {
  const scope = standardPasswordScope(data), saved = data.guide.steps[`do/${accountId}/password/save-candidate`];
  return !!scope && saved?.status === 'done' && saved.managerRef === data.guide.managerId && saved.managerScope === scope;
}
