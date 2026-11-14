import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { guideSchema, DataUpgradeConflict, type Dataset, type Language } from './models';
import { Guide } from './Guide';
import { saveNordSsoSession, startNordSsoSession } from './nordSso';
import { cloudAnswer, cloudSetupRoute } from './cloudManagers';
import { nordSsoReady, nordSsoStore } from './nordSsoSchemas';
import { tx } from './ui';

type Props = { data: Dataset; language: Language; save: (d: Dataset) => Promise<boolean> };
export function NordConnectionLauncher({ data, language, save, appId, returnTo }: Props & { appId: string; returnTo: string }) {
  const navigate = useNavigate(), [error, setError] = useState('');
  const launch = async () => {
    try { const result = startNordSsoSession(data, appId, returnTo); if (result.id && await save(result.data)) navigate(`/nord-connection/${result.id}`); }
    catch (e) { setError(tx(language, e instanceof DataUpgradeConflict ? 'Saved fields conflict with this feature. Keep the original records and export an encrypted backup in Settings.' : 'Could not start; the previous guide remains saved.', e instanceof DataUpgradeConflict ? '既存の保存項目と新機能が競合しています。元の記録を残し、設定から暗号化バックアップを保存してください。' : '開始できませんでした。元のガイドは保存されています。')); }
  };
  return <><button className="button secondary" onClick={() => void launch()}>{tx(language, 'Check the connected sign-in first', '先に接続先のログインを確認する')}</button>{error && <p className="error" role="alert">{error}</p>}</>;
}
export function NordConnectionSession({ data, language, save }: Props) {
  const { sessionId } = useParams(), session = nordSsoStore(data)?.sessions.find(s => s.id === sessionId), navigate = useNavigate(), [review, setReview] = useState(false);
  if (!session) return <section className="panel"><h1>{tx(language, 'This connection task was not found', 'この接続の作業は見つかりません')}</h1><Link to="/guide">{tx(language, 'Return to guide', 'ガイドへ戻る')}</Link></section>;
  const vault = data.version === 2 ? data.securityModel.entities.find(e => e.id === session.vaultRef && e.kind === 'vault') : undefined, rootRef = typeof vault?.authenticationAccountRef === 'string' ? vault.authenticationAccountRef : undefined;
  const ready = rootRef && (cloudAnswer(data, rootRef, 'method') === 'direct' || nordSsoReady(data, rootRef));
  if (session.finished && ready && !review) return <section className="panel"><h1>{tx(language, 'Connected sign-in checks are recorded', '接続先のログインの確認を記録しました')}</h1><Link className="button primary" to={session.returnTo}>{tx(language, 'Return to my task', '元の作業へ戻る')}</Link><button className="text-button" onClick={() => setReview(true)}>{tx(language, 'Review or correct the work records', '作業の記録を見直す・訂正する')}</button></section>;
  let child = { ...data, guide: guideSchema.parse(session.guide) };
  if (session.finished && !ready) child = { ...child, guide: { ...child.guide, cursor: cloudSetupRoute(child, session.vaultRef) } };
  const saveChild = async (next: Dataset) => {
    const shared = saveNordSsoSession(data, next, session.id), done = nordSsoStore(shared)?.sessions.find(s => s.id === session.id)?.finished;
    const success = await save(shared); if (success && done) navigate(session.returnTo); return success;
  };
  return <div><p className="subtle"><Link to={session.returnTo}>{tx(language, 'Return to my previous task', '元の作業へ戻る')}</Link> · {tx(language, 'Only the needed connected-account work; your main guide is saved', '接続先の必要な作業だけを確認します。通常ガイドは保存されています')}</p><Guide data={child} language={language} save={saveChild} nordSessionRef={session.id} /></div>;
}
