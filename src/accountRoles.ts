import type { Asset } from './models';

// An identity used to sign in to a manager or authenticator is not a mailbox.
// Conversely, using a real mail account for another product does not remove
// its mail role. Keep legacy accounts without provider metadata selectable.
export function canBeMailAccount(account: Asset): boolean {
  if (account.kind !== 'account' || ['bitwarden', '1password', 'nord', 'ente', 'line'].includes(account.provider ?? '')) return false;
  if (account.provider && account.provider !== 'other') return true;
  return account.type !== 'Password manager' || account.services.includes('mail');
}
