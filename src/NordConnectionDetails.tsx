import { ArrowRight } from 'lucide-react';
import type { Dataset, Language } from './models';
import { nordSsoStore } from './nordSsoSchemas';
import { selectNordSsoAccount, selectNordSsoProvider, undoNordSsoEvidence } from './nordSso';
import { cloudInstallation, cloudVault, chooseCloudDevice, selectedCloudInstallation } from './cloudManagers';
import { beginRecipe, move } from './guideEngine';
import { AccessChecks } from './AccessChecks';
import { tx } from './ui';
export function NordConnectionDetails({ data, id, language, startGuide, missing }: { data: Dataset; id: string; language: Language; startGuide: (d: Dataset) => Promise<void>; missing: string | readonly string[] }) {
  const b = nordSsoStore(data)?.bindings.find(b => b.grantRef === id || (data.version === 2 && data.securityModel.entities.some(e => e.id === id && e.nordSsoGrant === 'v1' && e.nordSsoBindingRef === b.id)));
  if (data.version !== 2 || !b) return null;
  const root = data.assets.find(a => a.id === b.rootRef), provider = data.assets.find(a => a.id === b.providerRef), vault = data.securityModel.entities.find(e => e.kind === 'vault' && e.productId === 'nordpass' && e.authenticationAccountRef === b.rootRef && !e.mergedIntoRef);
  const current = b.grantRef === id, life = data.securityModel.lifecycle[id], revoked = life?.evidence === 'user-confirmed' && ['revoked', 'deleted', 'retired', 'transferred'].includes(life.state);
  const confirmed = current && !revoked && !!b.records.connection && data.securityModel.relations.some(r => r.nordSsoEvidence === 'v1' && r.nordSsoBindingRef === b.id && r.evidence === 'user-confirmed');
  const open = (undo = false) => {
    if (!vault) return;
    let next = selectNordSsoAccount(selectNordSsoProvider(data, b.rootRef, b.provider), b.rootRef, b.providerRef);
    const selected = selectedCloudInstallation(next, vault.id), app = selected?.vaultRef === vault.id ? selected : data.securityModel.entities.find(e => e.kind === 'installation' && e.vaultRef === vault.id && !e.mergedIntoRef);
    if (!app || !cloudInstallation(next, app.id) || !cloudVault(next, vault.id) || typeof app.deviceRef !== 'string') return;
    next = chooseCloudDevice(next, vault.id, app.deviceRef, app.id);
    if (undo && b.records.connection) next = undoNordSsoEvidence(next, b.records.connection.key);
    void startGuide(undo ? move(next, `cloud-sso-state/${vault.id}`) : beginRecipe(next, app.id, `cloud-sso-prepare:${b.id}`, true));
  };
  return <section className="panel map-details"><h2>{tx(language, 'Connected Nord sign-in', 'Nordへの接続ログイン')}</h2><p>{provider?.name} → {root?.name}</p><p><strong>{tx(language, revoked ? 'Revoked permission recorded' : confirmed ? 'Connected setting recorded' : 'Connection unconfirmed', revoked ? '権限の失効を記録済み' : confirmed ? '接続済みの設定の記録あり' : '接続は未確認')}</strong></p><p className="subtle">{tx(language, 'A connected setting does not prove fresh sign-in, provider recovery, or vault decryption. The exact provider account and Nord Account remain separate.', '接続済みの設定だけでは、新しいログイン・提供元の復旧・保管庫の解除を確認したことにはなりません。実際の提供元アカウントとNord Accountを分けて扱います。')}</p><button className="button secondary" onClick={() => open()}>{tx(language, 'Review this connection', 'この接続を確認する')}<ArrowRight size={16} /></button>{current && b.records.connection && <button className="text-button" onClick={() => open(true)}>{tx(language, 'Undo the connection record', '接続の記録を取り消す')}</button>}<AccessChecks data={data} targetId={b.providerRef} credentialRef={id} missing={missing} language={language} /><AccessChecks data={data} targetId={b.rootRef} credentialRef={id} missing={missing} language={language} /></section>;
}
