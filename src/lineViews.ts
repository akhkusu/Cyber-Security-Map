import type { Dataset, Language } from './models';
import { lineStore, lineMoveReady, lineReceiptCurrent,lineRecorded,lineFactCurrent } from './lineSchemas';
import {lineAccessProfile} from './lineAccessSchemas';

export function lineMapStatus(data: Dataset, ref: string, language: Language) {
  const store = lineStore(data), tasks = store?.tasks.filter(t => [t.accountRef, t.sourceAppRef, t.sourceSessionRef, t.destinationAppRef, t.destinationSessionRef, t.dataRef, t.backupRef,lineAccessProfile(data,t.id)?.keyRef].includes(ref)) ?? [];
  const isAccount = data.assets.some(a => a.id === ref && a.provider === 'line');
  if (!tasks.length && !isAccount) return;
  const ja = language === 'ja', current = [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  if(current&&lineAccessProfile(data,current.id)?.keyRef===ref){
    const prepared=lineRecorded(data,current,'access2:key-check'),used=data.version===2&&store?.proofs.some(p=>p.taskRef===current.id&&p.kind==='sign-in'&&data.securityModel.facts.some(f=>f.id===p.factRef&&f.linePasskeyUseV1===ref&&lineFactCurrent(data.securityModel,f)));
    return {tone:used?'recorded':'unknown',label:ja?used?'パスキーでのログインを記録':prepared?'パスキーを準備済み・ログイン未確認':'パスキーの保存先を確認する':used?'Passkey login recorded':prepared?'Passkey prepared; login untested':'Passkey store needs checking',reason:ja?'登録・保存先・実際の利用を区別。履歴復元とは別':'Registration, storage and actual use are separate from chat restoration'};
  }
  const oldEnded = current?.sourceAppRef === ref && current.cutover?.phase === 'applied';
  if (oldEnded) return { tone: 'unknown', label: ja ? '旧メインのLINEは利用終了' : 'Old main LINE session ended', reason: ja ? 'スマホ自体と、ほかのアプリの用途は別' : 'The phone and other apps keep their own roles' };
  if (current?.backupRef === ref) {
    const id = current.records['backup-result'], recorded = id && store && lineReceiptCurrent(store, id);
    return { tone: recorded ? 'recorded' : 'unknown', label: ja ? recorded ? 'バックアップの結果を記録' : 'バックアップの確認待ち' : recorded ? 'Backup result recorded' : 'Backup check needed', reason: ja ? '保存した範囲と日時の記録。復元とは別' : 'Recorded backup scope and date; restoration is separate' };
  }
  const ready = !!current && lineMoveReady(data, current);
  return { tone: ready ? 'recorded' : current?.cutover ? 'needs-work' : 'unknown', label: ja ? ready ? '新端末で選んだ範囲を確認' : current?.cutover ? '引き継ぎ後の確認が必要' : 'LINEの移行は未確認' : ready ? 'Selected new-phone use confirmed' : current?.cutover ? 'Transfer result needs checking' : 'LINE move unconfirmed', reason: ja ? current?.answers.history === 'none' ? 'アカウント利用を記録。履歴の保管・復元は未確認' : 'アカウント・必要な履歴・旧LINEの役割を別に確認' : current?.answers.history === 'none' ? 'Account use recorded; chat preservation unconfirmed' : 'Account, selected history and old LINE role checked separately' };
}
