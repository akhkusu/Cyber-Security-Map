import { Link } from 'react-router-dom';
import type { Dataset, Language } from './models';
import { lineStore } from './lineSchemas';
import { tx } from './ui';
export function LineMapDetails({ data, language, itemRef }: { data: Dataset; language: Language; itemRef: string }) {
  const tasks = lineStore(data)?.tasks.filter(t => [t.accountRef, t.sourceAppRef, t.sourceSessionRef, t.destinationAppRef, t.destinationSessionRef, t.dataRef, t.backupRef].includes(itemRef)) ?? [];
  if (!tasks.length) return null;
  return <div className="line-map-details"><h3>{tx(language, 'LINE phone-change records', 'LINEの機種変更の記録')}</h3>{tasks.map(t => <Link key={t.id} className="record-link" to={`/line/${encodeURIComponent(t.id)}`}>{data.assets.find(a => a.id === t.accountRef)?.name ?? 'LINE'} · {tx(language, t.status === 'completed' ? 'Review this move' : 'Continue this move', t.status === 'completed' ? '移行の記録を見る' : '引き継ぎを続ける')}</Link>)}</div>;
}
