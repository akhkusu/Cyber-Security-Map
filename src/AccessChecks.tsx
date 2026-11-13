import type { Dataset, Language } from './models';
import { evaluateAccess } from './securityModel';
import { tx } from './ui';

export function AccessChecks({ data, targetId, missing, language }: { data: Dataset; targetId: string; missing: string; language: Language }) {
  if (data.version !== 2) return null;
  const routes = data.securityModel.routes.filter(r => r.targetRef === targetId);
  if (!routes.length) return null;
  const names: Record<string, string> = { 'sign-in': tx(language, 'Use a saved sign-in', '保存情報でログイン'), decrypt: tx(language, 'Read the existing store', '保管庫の保存情報を読む'), 'second-step': tx(language, 'Complete additional authentication', '追加の認証を通る'), 'local-unlock': tx(language, 'Unlock locally', '端末内で解除する'), restore: tx(language, 'Restore stored data', '保存データを復元する') };
  return <div className="access-records"><h3>{tx(language, 'Access checks', 'ログイン・保管庫の利用確認')}</h3><p className="subtle">{tx(language, 'Recorded observations for this context. Sign-in and reading the store are checked separately; recovery is not inferred from either.', 'その場で行った利用確認の記録です。ログインと保管庫の読み取りは別々に確認し、復旧できるとは推測しません。')}</p>{routes.map(r => {
    const result = evaluateAccess(data.securityModel, r.id, { context: r.contexts.includes('new-device') ? 'new-device' : 'normal', unavailableRefs: missing ? [missing] : [], now: new Date().toISOString() });
    return <p key={r.id}>{r.purpose === 'sign-in' && r.contexts.includes('new-device') ? tx(language, 'Sign in on a new device', '新端末でログイン') : names[r.purpose]}：<strong>{tx(language, result.state === 'available' ? 'Use recorded for these conditions' : result.state === 'unavailable' ? 'A required resource is unavailable' : 'Unconfirmed', result.state === 'available' ? 'この条件での利用記録あり' : result.state === 'unavailable' ? '必要な手段が使えない条件' : '未確認')}</strong></p>;
  })}</div>;
}
