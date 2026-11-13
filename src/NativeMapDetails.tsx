import { ArrowRight } from 'lucide-react';
import type { Dataset, Language } from './models';
import { beginRecipe, move } from './guideEngine';
import { nativeInstallation, nativeSetupRoute, nativeVault } from './nativeManagers';
import { entityKindLabel, mapRelationLabel, typedMapStatus, type MapConnection, type MapItem } from './securityMapViews';
import { tx } from './ui';
import { AccessChecks } from './AccessChecks';

export function NativeMapDetails({ data, item, nodes, connections, language, startGuide, missing }: { data: Dataset; item: MapItem; nodes: MapItem[]; connections: MapConnection[]; language: Language; startGuide: (data: Dataset) => Promise<void>; missing: string }) {
  const entity = data.version === 2 ? data.securityModel.entities.find(e => e.id === item.id) : undefined;
  if (!entity) return null;
  const install = nativeInstallation(data, entity.id), vault = nativeVault(data, install?.vaultRef ?? (entity.kind === 'credential' ? entity.storageRef : entity.id));
  const status = typedMapStatus(data, item, language);
  const root = data.assets.find(a => a.id === vault?.authenticationAccountRef);
  const related = connections.filter(c => c.assetId === item.id || c.recoveryAssetId === item.id);
  const openSetup = () => {
    if (!vault) return;
    const next = { ...data, guide: { ...data.guide, managerId: vault.id, answers: { ...data.guide.answers, ...(install ? { [`${vault.id}:installation`]: install.id } : {}) } } };
    void startGuide(install ? beginRecipe(next, install.id, 'builtin-manager', true) : move(next, nativeSetupRoute(next, vault.id)));
  };
  const labels: Record<string, string> = { opened: tx(language, 'Store opens', '保管庫を開く'), storageChecked: tx(language, 'Storage location checked', '保存先の確認'), independentRoot: tx(language, 'Independent account recovery', '基盤アカウントの独立した控え'), localBackup: tx(language, 'Encrypted local backup copy', 'ローカル保管庫の暗号化した控え'), autofill: tx(language, 'Autofill configuration', '自動入力の設定'), loginUse: tx(language, 'Saved login used', '保存情報でログイン') };
  return <section className="panel map-details"><h2>{item.name}</h2><p>{entityKindLabel(entity.kind, language)} · <strong>{status.label}</strong></p><p className="subtle">{status.reason}</p>{install && <p>{tx(language, 'Device: ', '使う端末：')}{nodes.find(n => n.id === install.deviceRef)?.name}</p>}{vault && <><p>{tx(language, 'Password store: ', '保管庫：')}{vault.label}</p>{root && <p>{tx(language, 'Selected account: ', '選択した基盤アカウント：')}{root.name}</p>}<button className="button secondary" onClick={openSetup}>{tx(language, 'Open this store’s guide', 'この保管庫の手順を開く')}<ArrowRight size={16} /></button></>}
    {Object.keys(item.controls).length > 0 && <ul className="control-list">{Object.entries(item.controls).map(([id, state]) => <li key={id}><span>{labels[id] ?? id}</span><strong>{tx(language, state === 'verified' ? 'Recorded' : 'Unconfirmed', state === 'verified' ? '記録済み' : '未確認')}</strong></li>)}</ul>}
    <AccessChecks data={data} targetId={item.id} missing={missing} language={language} /><h3>{tx(language, 'Confirmed connections', '確認したつながり')}</h3>{related.length ? <ul>{related.map(r => <li key={r.id}>{nodes.find(n => n.id === r.recoveryAssetId)?.name} → {nodes.find(n => n.id === r.assetId)?.name} · {mapRelationLabel(language, r.relation)}</li>)}</ul> : <p className="subtle">{tx(language, 'Choosing an item does not confirm its connections. Check it in the guide first.', '項目を選んだだけでは、つながりを確認済みにしません。先にガイドで確認します。')}</p>}
  </section>;
}
