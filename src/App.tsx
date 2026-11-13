import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { datasetSchema, DEMO_DATA, newDataset, type Dataset, type Language } from './models';
import { createEncryptedVault, decryptVault, deleteEnvelope, downloadStoredBackup, readEnvelope, readStoredEnvelope, rekeyVault, UnsupportedVaultError, updateEncryptedVault, writeEnvelope, type UnlockContext } from './crypto';
import { Brand, LanguagePicker, tx } from './ui';
const Workspace = lazy(() => import('./Workspace').then(m => ({ default: m.Workspace })));
export type Notice = { kind: 'success' | 'error'; text: string } | null;
function compatibilityMessage(error: unknown, language: Language): string | undefined {
  if (!(error instanceof UnsupportedVaultError)) return;
  return error.kind === 'data'
    ? tx(language, 'This vault contains unsupported or damaged data. The saved vault has not been changed. Keep the original file before trying another app version.', '対応していないデータ形式か、データが破損しています。保存内容は変更していません。別の版で開く前に、元の保存ファイルを保管してください。')
    : tx(language, 'This app version cannot open this vault format. The saved vault has not been changed. Keep the original file and use an app version that supports it.', 'この版のアプリでは、この保管庫の形式を開けません。保存内容は変更していません。元の保存ファイルを保管し、対応する版のアプリで開いてください。');
}
function detectedLanguage(): Language {
  try { const saved = localStorage.getItem('pcos-language'); if (saved === 'en' || saved === 'ja') return saved; } catch { /* Preference storage is optional. */ }
  return navigator.language?.startsWith('en') ? 'en' : 'ja';
}
export default function App() {
  const [language, setLanguage] = useState<Language>(detectedLanguage);
  const [envelope, setEnvelope] = useState<Awaited<ReturnType<typeof readEnvelope>>>(null);
  const [context, setContext] = useState<UnlockContext | null>(null);
  const [data, setData] = useState<Dataset | null>(null);
  const [ready, setReady] = useState(false);
  const [storageFailure, setStorageFailure] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  useEffect(() => { readEnvelope().then(setEnvelope).catch(() => setStorageFailure(true)).finally(() => setReady(true)); }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const persist = useCallback(async (next: Dataset) => {
    if (pending.current) throw new Error('save-in-progress');
    pending.current = true; setSaving(true);
    try {
      const parsed = datasetSchema.parse(next);
      if (!isDemo) {
        if (!context) throw new Error('vault-locked');
        const encrypted = await updateEncryptedVault(parsed, context);
        await writeEnvelope(encrypted); setEnvelope(encrypted);
      }
      setData(parsed);
    } finally { pending.current = false; setSaving(false); }
  }, [context, isDemo]);
  const changeLanguage = (next: Language) => {
    if (saving) return;
    setLanguage(next);
    try { localStorage.setItem('pcos-language', next); } catch { /* Optional preference only. */ }
    if (data) void persist({ ...data, settings: { ...data.settings, language: next } }).catch(() => setNotice({ kind: 'error', text: tx(next, 'Language could not be saved.', '言語設定を保存できませんでした。') }));
  };
  const lock = useCallback(() => { if (pending.current) return; setData(null); setContext(null); setIsDemo(false); }, []);
  useEffect(() => {
    if (!data || isDemo) return;
    let timer: number;
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(lock, data.settings.autoLockMinutes * 60000); };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, reset, { passive: true })); reset();
    return () => { window.clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)); };
  }, [data, isDemo, lock]);
  const installVault = async (pass: string) => {
    const initial = newDataset(language);
    initial.onboarding = { complete: true, goals: [], completedAt: new Date().toISOString() };
    const created = await createEncryptedVault(pass, initial);
    await writeEnvelope(created.envelope); setEnvelope(created.envelope); setContext(created.context); setData(initial); setIsDemo(false);
  };
  const unlock = async (pass: string) => {
    if (!envelope) return;
    const opened = await decryptVault(envelope, pass);
    const updated = await updateEncryptedVault(opened.data, opened.context);
    await writeEnvelope(updated); setEnvelope(updated); setContext(opened.context); setData(opened.data); setLanguage(opened.data.settings.language); setIsDemo(false);
  };
  const restore = async (file: File, pass: string) => {
    if (pending.current) throw new Error('save-in-progress');
    pending.current = true; setSaving(true);
    try {
      const restored = await decryptVault(JSON.parse(await file.text()), pass);
      const updated = await updateEncryptedVault(restored.data, restored.context);
      await writeEnvelope(updated); setEnvelope(updated); setContext(restored.context); setData(restored.data); setLanguage(restored.data.settings.language); setIsDemo(false); setStorageFailure(false);
    } finally { pending.current = false; setSaving(false); }
  };
  const rekey = async (pass: string) => {
    if (!data || pending.current) throw new Error('save-in-progress');
    pending.current = true; setSaving(true);
    try {
      const updated = await rekeyVault(data, pass, context ?? undefined);
      await writeEnvelope(updated.envelope); setEnvelope(updated.envelope); setContext(updated.context);
    } finally { pending.current = false; setSaving(false); }
  };
  const erase = async () => { await deleteEnvelope(); setEnvelope(null); setData(null); setContext(null); setIsDemo(false); setStorageFailure(false); };
  const exportOriginal = async () => {
    const stored = await readStoredEnvelope();
    if (stored === null) throw new Error('no-stored-vault');
    downloadStoredBackup(stored);
  };
  if (!ready) return <main className="loading"><ShieldCheck />{tx(language, 'Opening the app…', 'アプリを開いています…')}</main>;
  if (!data) return <Entry language={language} onLanguage={changeLanguage} locked={!!envelope} storageFailure={storageFailure} onCreate={installVault} onUnlock={unlock} onRestore={restore} onReset={erase} onExportOriginal={exportOriginal} onDemo={() => { const demo = structuredClone(DEMO_DATA); demo.settings.language = language; setData(demo); setIsDemo(true); }} />;
  return <Suspense fallback={<main className="loading">{tx(language, 'Opening your guide…', 'ガイドを開いています…')}</main>}><Workspace data={data} language={language} isDemo={isDemo} notice={notice} setNotice={setNotice} persist={persist} saving={saving} lock={lock} onLanguage={changeLanguage} onPassphrase={rekey} onReset={erase} onRestore={restore} envelope={envelope} /></Suspense>;
}

function Entry({ language, onLanguage, locked, storageFailure, onCreate, onUnlock, onRestore, onReset, onExportOriginal, onDemo }: {
  language: Language; onLanguage: (l: Language) => void; locked: boolean; storageFailure: boolean;
  onCreate: (pass: string) => Promise<void>; onUnlock: (pass: string) => Promise<void>; onRestore: (file: File, pass: string) => Promise<void>; onReset: () => Promise<void>; onExportOriginal: () => Promise<void>; onDemo: () => void;
}) {
  const [started, setStarted] = useState(false), [pass, setPass] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [backupError, setBackupError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!locked && (pass.length < 10 || pass !== confirm)) { setError(tx(language, 'Use at least 10 characters and enter the same phrase twice.', '10文字以上で、同じフレーズを2回入力してください。')); return; }
    setBusy(true);
    try { await (locked ? onUnlock(pass) : onCreate(pass)); setPass(''); setConfirm(''); } catch (err) { setError(compatibilityMessage(err, language) ?? tx(language, locked ? 'Could not unlock. Check your passphrase and try again.' : 'Could not save the vault. Check browser storage and try again.', locked ? '保管庫を開けませんでした。パスフレーズを確認してください。' : '保管庫を保存できませんでした。ブラウザーの保存設定を確認してください。')); } finally { setBusy(false); }
  };
  return <div className="entry"><header className="entry-header"><Brand /><LanguagePicker language={language} onChange={onLanguage} /></header><main className="entry-main">
    {storageFailure ? <section className="entry-card"><LockKeyhole className="hero-icon" /><h1>{tx(language, 'Could not read this browser’s vault', '保管庫を読み取れませんでした')}</h1><p>{tx(language, 'Your stored data has not been replaced. Try reopening the app, or restore an encrypted backup below.', '保存データは置き換えていません。アプリを開き直すか、下から暗号化バックアップを復元してください。')}</p></section> : !locked && !started ? <section className="entry-card welcome">
      <span className="eyebrow">{tx(language, 'ONE STEP AT A TIME', '一つずつ、設定まで。')}</span><h1>{tx(language, 'Protect the accounts\nyou rely on.', '大切なアカウントを、\n自分で守れるように。')}</h1><p>{tx(language, 'Choose the service you use. We’ll show you what to open, what to press, and when you’re done.', '使っているサービスを選ぶと、開く画面から設定の確認まで、一つずつ案内します。')}</p>
      <button className="button primary" onClick={() => setStarted(true)}>{tx(language, 'Start the guide', '対策を始める')}<ArrowRight size={18} /></button>
      <p className="subtle">{tx(language, 'No account registration. Your progress is encrypted in this browser.', '会員登録は不要です。進み具合は、このブラウザー内に暗号化して保存します。')}</p>
      <button className="text-button" onClick={onDemo}>{tx(language, 'Try a sample', 'サンプルを試す')}</button>
    </section> : <section className="entry-card"><LockKeyhole className="hero-icon" /><span className="eyebrow">{tx(language, 'SAVE YOUR PROGRESS', '途中から、また続けられるように。')}</span><h1>{tx(language, locked ? 'Continue your guide' : 'Protect this app’s saved progress', locked ? '続きから進める' : '作業の記録に鍵をかける')}</h1><p>{tx(language, locked ? 'Enter this app’s storage passphrase to resume from the same step.' : 'Create a passphrase for this app only. This is separate from your email password and your password manager’s master password.', locked ? 'このアプリの保存用パスフレーズを入力すると、同じ手順から再開できます。' : 'このアプリ専用の保存用パスフレーズを作ります。メールのパスワードや、マネージャーのマスターパスワードとは別のものです。')}</p>
      <form onSubmit={submit}><label>{tx(language, 'App passphrase', 'アプリの保存用パスフレーズ')}<input type="password" autoComplete={locked ? 'current-password' : 'new-password'} required minLength={locked ? undefined : 10} value={pass} onChange={e => setPass(e.target.value)} /></label>
        {!locked && <><label>{tx(language, 'Confirm passphrase', '同じフレーズをもう一度')}<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label><p className="subtle">{tx(language, 'Use a long unique phrase (at least 10 characters). Keep a copy in a secure place. An encrypted backup also needs this phrase to open.', '10文字以上の長い固有のフレーズにし、安全な場所へ控えてください。暗号化バックアップを開くときにも、このフレーズが必要です。')}</p></>}
        {error && <p role="alert" className="error">{error}</p>}<button className="button primary" disabled={busy}>{busy ? tx(language, 'Opening…', '開いています…') : tx(language, locked ? 'Unlock and continue' : 'Save and start', locked ? '開いて再開する' : '保存して始める')}<ArrowRight size={18} /></button></form>
    </section>}
    {(locked || storageFailure) && <div className="entry-restore"><button className="button secondary" disabled={busy} onClick={async () => { setBackupError(''); try { await onExportOriginal(); } catch { setBackupError(tx(language, 'Could not export the original saved file. The stored data has not been changed.', '元の保存ファイルを書き出せませんでした。保存内容は変更していません。')); } }}>{tx(language, 'Export original saved file', '元の保存ファイルを書き出す')}</button>{backupError && <p role="alert" className="error">{backupError}</p>}</div>}
    <details className="entry-restore"><summary>{tx(language, 'Restore an encrypted backup', '暗号化バックアップから復元する')}</summary><RestoreForm language={language} onRestore={onRestore} replace={locked || storageFailure} />{(locked || storageFailure) && <button className="text-button danger" onClick={() => { if (window.confirm(tx(language, 'Permanently delete this browser’s vault? Export a backup first if possible.', 'このブラウザーの保管庫を完全に削除しますか？可能なら先にバックアップを保存してください。'))) void onReset(); }}>{tx(language, 'Delete this browser’s vault', 'このブラウザーの保管庫を削除')}</button>}</details>
    <footer>{tx(language, 'Enter passwords and verification codes only in the official app or website.', '実際のパスワードや認証コードは、各サービスの公式画面だけに入力してください。')}</footer>
  </main></div>;
}
export function RestoreForm({ language, onRestore, replace = false }: { language: Language; onRestore: (file: File, pass: string) => Promise<void>; replace?: boolean }) {
  const [file, setFile] = useState<File | null>(null), [pass, setPass] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <form onSubmit={async e => { e.preventDefault(); if (!file) return; if (replace && !window.confirm(tx(language, 'Replace this browser’s vault with this backup? Save the current backup first.', 'このバックアップで現在の保管庫を置き換えますか？必要なら先に現在のバックアップを保存してください。'))) return; setBusy(true); setError(''); try { await onRestore(file, pass); setPass(''); } catch (err) { setError(compatibilityMessage(err, language) ?? tx(language, 'Could not restore. Check the backup and its passphrase.', '復元できませんでした。ファイルとパスフレーズを確認してください。')); } finally { setBusy(false); } }}>
    <label>{tx(language, 'Encrypted backup file', '暗号化バックアップファイル')}<input type="file" accept="application/json,.json" required onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><label>{tx(language, 'Backup passphrase', 'バックアップのパスフレーズ')}<input type="password" autoComplete="current-password" value={pass} required onChange={e => setPass(e.target.value)} /></label><button className="button secondary" disabled={busy || !file || !pass}>{tx(language, 'Restore backup', 'バックアップを復元する')}</button>{error && <p className="error" role="alert">{error}</p>}
  </form>;
}
