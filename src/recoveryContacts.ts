import { canBeMailAccount } from './accountRoles';
import { addRelation, move, taskCursor } from './guideEngine';
import type { Dataset } from './models';

export function resumeAfterRecoveryContact(data: Dataset, accountId: string, mailboxId?: string): Dataset {
  if (data.guide.cursor !== `recovery-email-link/${accountId}`) return data;
  const key = `recovery-mail-return:${accountId}`, target = data.guide.answers[key];
  const recipe=target===taskCursor(accountId,'email-mfa','state')?'email-mfa':target===taskCursor(accountId,'recovery','email-independent')?'recovery':undefined;
  const confirmed = recipe && ['prep-email-access', 'prep-email-registered'].some(id => data.guide.steps[taskCursor(accountId, recipe, id)]?.status === 'done');
  if (!recipe || !confirmed) return move(data, taskCursor(accountId, 'email-mfa', 'ready'));
  if (mailboxId && (mailboxId === accountId || !data.assets.some(a => a.id === mailboxId && canBeMailAccount(a)))) return data;
  const next = mailboxId ? addRelation(data, accountId, mailboxId, 'recovery-email') : data;
  const answers = { ...next.guide.answers }; delete answers[key];
  return move({ ...next, guide: { ...next.guide, answers } }, target);
}
