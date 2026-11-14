import {EnteGuide} from './EnteGuide';
import {TwofasGuide} from './TwofasGuide';
import { useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Compass, LockKeyhole, Map, Settings, ShieldCheck } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { Dataset, Language, VaultEnvelope } from './models';
import { downloadEncryptedBackup } from './crypto';
import { Guide } from './Guide';
import {DeviceProtectionGuide,DeviceProtectionAccountGuide} from './DeviceProtectionGuide';
import { NordConnectionSession } from './NordConnectionSession';
import { NordRecoveryGuide } from './NordRecoveryGuide';
import { AccessPlanGuide, AccessObservationGuide, FailureGroupGuide } from './AccessPlanGuide';
import { HardwareKeyGuide } from './HardwareKeyGuide';
import { PhoneGuide } from './PhoneGuide';
import { MapRecordGuide, MapConnectionGuide, MapLifecycleGuide } from './MapRecordGuide';
import { MAP_NAME, SecurityMap } from './SecurityMap';
import { Brand, LanguagePicker, tx } from './ui';
import { RestoreForm, type Notice } from './App';

type WorkspaceProps = {
  data: Dataset; language: Language; isDemo: boolean; notice: Notice; setNotice: (n: Notice) => void;
  persist: (d: Dataset) => Promise<void>; saving: boolean; lock: () => void; onLanguage: (l: Language) => void;
  onPassphrase: (p: string) => Promise<void>; onReset: () => Promise<void>; onRestore: (file: File, pass: string) => Promise<void>; envelope: VaultEnvelope | null;
};
export function Workspace(props: WorkspaceProps) {
  const { data, language, saving, isDemo, notice, setNotice } = props;
  const location = useLocation();
  const save = async (next: Dataset) => {
    try { await props.persist(next); return true; } catch { setNotice({ kind: 'error', text: tx(language, 'Could not save. This step has not advanced. Check browser storage and try again.', '保存できませんでした。手順は進めていません。ブラウザーの保存領域を確認して、もう一度お試しください。') }); return false; }
  };
  const nav = [{ path: '/guide', icon: Compass, label: tx(language, 'Continue guide', '対策を進める') }, { path: '/map', icon: Map, label: MAP_NAME }, { path: '/settings', icon: Settings, label: tx(language, 'Settings', '設定') }];
  return <div className={`app-shell ${data.settings.theme === 'dark' ? 'theme-dark' : ''}`}><a className="skip-link" href="#main">{tx(language, 'Skip to content', '本文へ移動')}</a>
    <header className="app-header"><Brand /><nav aria-label={tx(language, 'Main menu', 'メインメニュー')}>{nav.map(({ path, icon: Icon, label }) => <NavLink key={path} to={path} className={({ isActive }) => isActive || (path === '/guide' && (location.pathname.startsWith('/protect/') || location.pathname.startsWith('/ente/') || location.pathname.startsWith('/twofas/') || location.pathname.startsWith('/keys/') || location.pathname.startsWith('/phone/') || location.pathname.startsWith('/recover/') || location.pathname.startsWith('/nord-connection/'))) ? 'active' : undefined}><Icon size={18} /><span>{label}</span></NavLink>)}</nav><div className="header-actions"><LanguagePicker language={language} onChange={props.onLanguage} /><button className="icon-button" disabled={saving} onClick={props.lock} aria-label={tx(language, isDemo ? 'Exit sample' : 'Lock app', isDemo ? 'サンプルを終了' : 'アプリをロック')}><LockKeyhole size={18} /></button></div></header>
    {isDemo && <div className="demo-banner">{tx(language, 'Sample · changes are not saved', 'サンプル · 変更は保存されません')}<button onClick={props.lock}>{tx(language, 'Exit sample', 'サンプルを終了')}</button></div>}
    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`notice ${notice.kind}`}>{notice.text}<button aria-label={tx(language, 'Dismiss message', 'メッセージを閉じる')} onClick={() => setNotice(null)}>×</button></div>}
    <main id="main" className="workspace-main"><fieldset disabled={saving} className="workspace-body" aria-busy={saving}><Routes>
      <Route path="/ente/:taskId" element={<EnteGuide data={data} language={language} save={save}/>} />
      <Route path="/twofas/:taskId" element={<TwofasGuide data={data} language={language} save={save}/>} />
      <Route path="/guide" element={<Guide data={data} language={language} save={save} />} />
      <Route path="/protect/:taskId" element={<DeviceProtectionGuide data={data} language={language} save={save}/>} />
      <Route path="/protect/account/:taskId" element={<DeviceProtectionAccountGuide data={data} language={language} save={save}/>} />
      <Route path="/keys/:taskId" element={<HardwareKeyGuide data={data} language={language} save={save} />} />
      <Route path="/phone/:workflowId" element={<PhoneGuide data={data} language={language} save={save} />} />
      <Route path="/nord-connection/:sessionId" element={<NordConnectionSession data={data} language={language} save={save} />} />
      <Route path="/recover/nord/:taskId" element={<NordRecoveryGuide data={data} language={language} save={save} />} />
      <Route path="/map/method/:draftId" element={<AccessPlanGuide data={data} language={language} save={save}/>} />
      <Route path="/map/check/:observationId" element={<AccessObservationGuide data={data} language={language} save={save}/>} />
      <Route path="/map/shared-loss/:groupDraftId" element={<FailureGroupGuide data={data} language={language} save={save}/>} />
      <Route path="/map/record/:draftId" element={<MapRecordGuide data={data} language={language} save={save} />} />
      <Route path="/map/connection/:draftId" element={<MapConnectionGuide data={data} language={language} save={save} />} />
      <Route path="/map/state/:nodeRef" element={<MapLifecycleGuide data={data} language={language} save={save} />} />
      <Route path="/map" element={<SecurityMap data={data} language={language} save={save} />} />
      <Route path="/settings" element={<SettingsPage {...props} save={save} />} />
      <Route path="*" element={<Navigate to="/guide" replace />} />
    </Routes></fieldset><div className="save-state" role="status">{saving ? tx(language, 'Saving…', '保存中…') : ''}</div></main>
    <footer className="app-footer"><ShieldCheck size={14} />{tx(language, 'Your own work records · encrypted in this browser', '利用者が行った作業の記録 · このブラウザー内に暗号化保存')}</footer>
  </div>;
}
function SettingsPage({ data, language, onLanguage, onPassphrase, onRestore, envelope, lock, onReset, isDemo, save, setNotice }: WorkspaceProps & { save: (d: Dataset) => Promise<boolean> }) {
  const [pass, setPass] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const changePass = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (pass.length < 10 || pass !== confirm) { setError(tx(language, 'Use at least 10 characters and enter the same phrase twice.', '10文字以上で、同じフレーズを2回入力してください。')); return; }
    setBusy(true);
    try { await onPassphrase(pass); setPass(''); setConfirm(''); setNotice({ kind: 'success', text: tx(language, 'The app passphrase was changed. Save a new encrypted backup.', '保存用パスフレーズを変更しました。新しい暗号化バックアップを保存してください。') }); } catch { setError(tx(language, 'Could not change the app passphrase.', '保存用パスフレーズを変更できませんでした。')); } finally { setBusy(false); }
  };
  return <div className="settings-page"><header className="page-heading"><div><span className="eyebrow">{tx(language, 'PREFERENCES & SAVED DATA', '表示と、保存の設定。')}</span><h1>{tx(language, 'Settings', '設定')}</h1></div></header>
    <section className="panel"><h2>{tx(language, 'Language and display', '言語と表示')}</h2><div className="settings-grid"><label>{tx(language, 'Language', '言語')}<select value={language} onChange={e => onLanguage(e.target.value as Language)}><option value="ja">日本語</option><option value="en">English</option></select></label><label>{tx(language, 'Theme', '外観')}<select value={data.settings.theme} onChange={e => void save({ ...data, settings: { ...data.settings, theme: e.target.value as 'light' | 'dark' } })}><option value="light">{tx(language, 'Light', 'ライト')}</option><option value="dark">{tx(language, 'Dark', 'ダーク')}</option></select></label><label>{tx(language, 'Auto-lock after', '自動ロックまでの時間')}<select value={data.settings.autoLockMinutes} onChange={e => void save({ ...data, settings: { ...data.settings, autoLockMinutes: Number(e.target.value) } })}>{[1, 5, 10, 15, 30, 60].map(n => <option key={n} value={n}>{n}{tx(language, ' minutes', '分')}</option>)}</select></label></div><button className="button secondary" onClick={lock}><LockKeyhole size={16} />{tx(language, 'Lock now', '今すぐロックする')}</button></section>
    <section className="panel"><h2>{tx(language, 'Encrypted backup', '暗号化バックアップ')}</h2><p>{tx(language, 'Save a copy outside this browser. Opening it requires the app passphrase used when the backup was made.', 'ブラウザーの外へコピーを保存します。開くには、バックアップ作成時の保存用パスフレーズが必要です。')}</p><button className="button primary" disabled={!envelope || isDemo} onClick={() => envelope && downloadEncryptedBackup(envelope)}><ArrowDownToLine size={17} />{tx(language, 'Download encrypted backup', '暗号化バックアップを保存する')}</button><details><summary>{tx(language, 'Restore a backup', 'バックアップから復元する')}</summary><RestoreForm language={language} onRestore={onRestore} replace /></details></section>
    {!isDemo && <section className="panel"><h2>{tx(language, 'Change this app’s passphrase', 'このアプリの保存用パスフレーズを変更する')}</h2><p>{tx(language, 'This does not change your email password or your password manager’s master password.', 'メールのパスワードや、マネージャーのマスターパスワードは変更されません。')}</p><form onSubmit={changePass}><label>{tx(language, 'New app passphrase', '新しい保存用パスフレーズ')}<input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} required minLength={10} /></label><label>{tx(language, 'Confirm new passphrase', '新しいフレーズをもう一度')}<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label><button className="button secondary" disabled={busy}><Check size={16} />{tx(language, 'Change passphrase', 'パスフレーズを変更する')}</button>{error && <p className="error" role="alert">{error}</p>}</form></section>}
    <section className="panel"><h2>{tx(language, 'About your records', '作業の記録について')}</h2><p>{tx(language, 'This app records what you report doing. It does not inspect accounts or devices automatically. Your answers and connections stay encrypted in this browser; they are not sent to a server or an AI.', 'このアプリは、利用者が行った作業を記録します。アカウントや端末を自動検査するものではありません。回答やつながりはブラウザー内へ暗号化して保存し、サーバーやAIへ送信しません。')}</p><p>{tx(language, 'Anyone able to control your unlocked browser or this app’s code may access its data. Lock the app on shared devices. Existing backup format and completed records are retained when instructions change.', 'ロック解除中のブラウザーやアプリのコードを操作できる人は、データを読める可能性があります。共有端末ではロックしてください。手順の説明を更新しても、既存のバックアップ形式と完了記録は維持します。')}</p></section>
    {!isDemo && <details className="panel danger-zone"><summary>{tx(language, 'Delete this browser’s data', 'このブラウザーのデータを削除する')}</summary><p>{tx(language, 'Save an encrypted backup first if you may need these records.', '記録が必要な場合は、先に暗号化バックアップを保存してください。')}</p><button className="button danger" onClick={() => { if (window.confirm(tx(language, 'Permanently delete this browser’s encrypted vault?', 'このブラウザーの暗号化保管庫を完全に削除しますか？'))) void onReset(); }}>{tx(language, 'Delete the local vault', 'ローカルの保管庫を削除する')}<ArrowRight size={16} /></button></details>}
  </div>;
}
