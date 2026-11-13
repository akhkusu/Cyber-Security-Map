import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, FileLock2, Fingerprint, GitBranch, HardDrive,
  KeyRound, Laptop, LockKeyhole, Mail, Shield, ShieldCheck, Smartphone, Sparkles, Wifi,
} from 'lucide-react';
import {
  DEMO_DATA, datasetSchema, makeAsset, newDataset, type ControlState, type Dataset, type Language,
} from './models';
import { createEncryptedVault, decryptVault, deleteEnvelope, readEnvelope, rekeyVault, updateEncryptedVault, writeEnvelope, type UnlockContext } from './crypto';
import { CHECKUP_CONTROLS, controlKey } from './checkupCatalog';

const WorkspacePage = lazy(() => import('./Workspace').then((module) => ({ default: module.Workspace })));

type Notice = { kind: 'success' | 'error'; text: string } | null;
const tx = (language: Language, en: string, ja: string) => language === 'ja' ? ja : en;
const detectedLanguage = (): Language => {
  let saved: string | null = null;
  // Preserve the existing preference key across display-name changes.
  try { saved = localStorage.getItem('pcos-language'); } catch { /* Storage can be disabled by the browser. */ }
  if (saved === 'en' || saved === 'ja') return saved;
  try {
    const browserLanguage = navigator.language.toLowerCase();
    if (browserLanguage.startsWith('ja')) return 'ja';
    if (browserLanguage.startsWith('en')) return 'en';
  } catch { /* Use Japanese when the browser does not expose a locale. */ }
  return 'ja';
};

function App() {
  const [envelope, setEnvelope] = useState<Awaited<ReturnType<typeof readEnvelope>>>(null);
  const [data, setData] = useState<Dataset | null>(null);
  const [language, setLanguage] = useState<Language>(detectedLanguage);
  const [context, setContext] = useState<UnlockContext | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageFailure, setStorageFailure] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    readEnvelope().then((stored) => { setEnvelope(stored); setReady(true); }).catch(() => { setStorageFailure(true); setReady(true); });
  }, []);

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
    try { localStorage.setItem('pcos-language', next); } catch { /* The encrypted dataset remains the source of truth. */ }
    setData((previous) => previous ? { ...previous, settings: { ...previous.settings, language: next } } : previous);
  }, []);

  const persist = useCallback(async (next: Dataset) => {
    const parsed = datasetSchema.parse(next);
    setData(parsed);
    if (!isDemo && context) {
      const updated = await updateEncryptedVault(parsed, context);
      await writeEnvelope(updated);
      setEnvelope(updated);
    }
  }, [context, isDemo]);

  const createWorkspace = async (passphrase: string, initial: Dataset) => {
    const complete = { ...initial, onboarding: { ...initial.onboarding, complete: true, completedAt: new Date().toISOString() }, settings: { ...initial.settings, language } };
    const created = await createEncryptedVault(passphrase, complete);
    await writeEnvelope(created.envelope);
    setEnvelope(created.envelope); setContext(created.context); setData(complete); setIsDemo(false);
  };

  const unlock = async (passphrase: string) => {
    if (!envelope) return;
    const opened = await decryptVault(envelope, passphrase);
    const sanitized = await updateEncryptedVault(opened.data, opened.context);
    await writeEnvelope(sanitized);
    setEnvelope(sanitized);
    setContext(opened.context); setData(opened.data); setIsDemo(false); changeLanguage(opened.data.settings.language);
  };

  const restoreBackup = async (file: File, passphrase: string) => {
    const parsed = JSON.parse(await file.text());
    const restored = await decryptVault(parsed, passphrase);
    const sanitized = await updateEncryptedVault(restored.data, restored.context);
    await writeEnvelope(sanitized);
    setEnvelope(sanitized); setContext(restored.context); setData(restored.data); setIsDemo(false); changeLanguage(restored.data.settings.language);
  };

  const lock = useCallback(() => {
    if (isDemo) { setIsDemo(false); setData(null); setContext(null); return; }
    setContext(null); setData(null);
  }, [isDemo]);

  useEffect(() => {
    if (!data || isDemo) return;
    const reset = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(lock, data.settings.autoLockMinutes * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    document.addEventListener('visibilitychange', reset);
    reset();
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset));
      document.removeEventListener('visibilitychange', reset);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [data, isDemo, lock]);

  const openDemo = () => { setData(structuredClone(DEMO_DATA)); setLanguage(DEMO_DATA.settings.language); setContext(null); setIsDemo(true); };
  const resetVault = async () => { await deleteEnvelope(); setEnvelope(null); setData(null); setContext(null); setIsDemo(false); };
  const updatePassphrase = async (next: string) => {
    if (!data) return;
    const updated = await rekeyVault(data, next);
    await writeEnvelope(updated.envelope);
    setEnvelope(updated.envelope); setContext(updated.context);
  };

  if (!ready) return <div className="splash"><ShieldCheck size={28} /><span>{tx(language, 'Preparing your private workspace…', 'プライベートな作業領域を準備しています…')}</span></div>;
  if (storageFailure && !envelope) return <StorageRecovery language={language} onLanguage={changeLanguage} onRestore={restoreBackup} onReset={async () => { await resetVault(); setStorageFailure(false); }} />;
  if (!data && !envelope) return <Onboarding language={language} onLanguage={changeLanguage} onCreate={createWorkspace} onDemo={openDemo} onRestore={restoreBackup} />;
  if (!data && envelope) return <UnlockScreen language={language} onLanguage={changeLanguage} onUnlock={unlock} onRestore={restoreBackup} onReset={resetVault} />;
  if (!data) return null;
  return <Suspense fallback={<div className="splash"><ShieldCheck size={28} /><span>{tx(language, 'Opening your private workspace…', 'プライベートなワークスペースを開いています…')}</span></div>}><WorkspacePage data={data} language={language} isDemo={isDemo} notice={notice} setNotice={setNotice} persist={persist} lock={lock} onLanguage={changeLanguage} onDemoExit={lock} onPassphrase={updatePassphrase} onReset={resetVault} onRestore={restoreBackup} envelope={envelope} /></Suspense>;
}

export default App;

function Button({ children, onClick, variant = 'primary', icon, className = '', disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: ReactNode; className?: string; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{icon}{children}</button>;
}

function StorageRecovery({ language, onLanguage, onRestore, onReset }: { language: Language; onLanguage: (language: Language) => void; onRestore: (file: File, passphrase: string) => Promise<void>; onReset: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null); const [passphrase, setPassphrase] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const restore = async () => {
    if (!file || !passphrase) { setError(tx(language, 'Choose a backup and enter its passphrase.', 'バックアップとパスフレーズを入力してください。')); return; }
    setBusy(true); setError('');
    try { await onRestore(file, passphrase); } catch { setError(tx(language, 'The stored vault is damaged and this backup could not be opened.', '保管庫が破損しており、バックアップも開けませんでした。')); }
    finally { setBusy(false); }
  };
  return <main className="lock-screen"><header className="onboarding-top"><Brand /><LanguagePicker language={language} onChange={onLanguage} /></header><section className="lock-card"><span className="lock-badge"><HardDrive size={23} /></span><div className="eyebrow">{tx(language, 'LOCAL STORAGE NEEDS ATTENTION', 'ローカル保存データの確認')}</div><h1>{tx(language, 'The local vault could not be read.', 'ローカル保管庫を読み込めません。')}</h1><p>{tx(language, 'You can try restoring an encrypted backup. If you do not have one, you may delete the damaged vault and start again.', '暗号化バックアップからの復元を試してください。バックアップがない場合は、破損した保管庫を削除して最初から始められます。')}</p><label className="file-drop">{file?.name ?? tx(language, 'Choose encrypted backup', '暗号化バックアップを選択')}<input type="file" accept="application/json,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><label className="field-label">{tx(language, 'Backup passphrase', 'バックアップのパスフレーズ')}<input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>{error && <p className="error-message">{error}</p>}<Button className="button-full" onClick={() => void restore()} disabled={busy}>{busy ? tx(language, 'Restoring…', '復元中…') : tx(language, 'Restore backup', 'バックアップを復元')}<ArrowRight size={16} /></Button><button className="text-danger" onClick={() => { if (window.confirm(tx(language, 'Permanently delete the unreadable local vault?', '読み込めない保管庫を完全に削除しますか？'))) void onReset(); }}>{tx(language, 'Delete damaged vault', '破損した保管庫を削除')}</button></section></main>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.3} /></span><span className="brand-copy"><strong>Cyber-Security-Map</strong><small>your private security coach</small></span></div>;
}

function LanguagePicker({ language, onChange, small = false }: { language: Language; onChange: (language: Language) => void; small?: boolean }) {
  return <label className={`language-picker ${small ? 'language-small' : ''}`} aria-label="Language"><span className="sr-only">Language</span><select value={language} onChange={(event) => onChange(event.target.value as Language)}><option value="en">EN</option><option value="ja">日本語</option></select><ChevronDown size={14} /></label>;
}

const goalOptions = [
  ['account-takeover', 'Account takeover', 'アカウント乗っ取り'], ['fraud', 'Financial fraud', '金融詐欺'],
  ['privacy-exposure', 'Personal information exposure', '個人情報の公開'], ['device-theft', 'Device loss or theft', '端末の紛失・盗難'],
  ['data-loss', 'Losing important data', '大切なデータの消失'], ['general-security', 'General cybersecurity', '全般的なサイバーセキュリティ'],
];
const quickOptions = [
  { id: 'phone', kind: 'device' as const, type: 'Smartphone', name: 'Primary smartphone', ja: 'メインのスマートフォン', operatingSystem: 'unknown' as const, icon: Smartphone },
  { id: 'computer', kind: 'device' as const, type: 'Laptop', name: 'Primary computer', ja: 'メインのコンピューター', operatingSystem: 'unknown' as const, icon: Laptop },
  { id: 'email', kind: 'account' as const, type: 'Primary email', name: 'Primary email', ja: 'メインのメール', icon: Mail },
  { id: 'passwordManager', kind: 'account' as const, type: 'Password manager', name: 'Password manager', ja: 'パスワードマネージャー', icon: KeyRound },
  { id: 'finance', kind: 'account' as const, type: 'Banking and finance', name: 'Financial account', ja: '金融アカウント', icon: Fingerprint },
  { id: 'backup', kind: 'backup' as const, type: 'Important files', name: 'Important files and backups', ja: '大切なファイルとバックアップ', icon: HardDrive },
  { id: 'network', kind: 'network' as const, type: 'Router', name: 'Home network', ja: 'ホームネットワーク', icon: Wifi },
];
const assessmentQuestions = [
  { id: 'identity.password-manager', answerId: 'passwordManager', en: 'Do you use a password manager?', ja: 'パスワードマネージャーを使っていますか？' },
  { id: 'identity.primary-email-mfa', answerId: 'emailMfa', en: 'Is multi-factor authentication on your main email?', ja: 'メインのメールで多要素認証を使っていますか？' },
  { id: 'device.disk-encryption', answerId: 'computerEncryption', en: 'Is your main computer encrypted?', ja: 'メインのPCは暗号化されていますか？' },
  { id: 'device.auto-updates', answerId: 'automaticUpdates', en: 'Do your devices install security updates automatically?', ja: '端末はセキュリティ更新を自動適用しますか？' },
  { id: 'data.backup-current', answerId: 'backup', en: 'Do you have a recent backup of important files?', ja: '大切なファイルの新しいバックアップがありますか？' },
  { id: 'identity.recovery', answerId: 'recovery', en: 'Have you checked how you would recover your main email?', ja: 'メインのメールを復旧する方法を確認したことがありますか？' },
];
const answerOptions: { id: string; en: string; ja: string }[] = [
  { id: 'yes', en: 'Yes', ja: 'はい' }, { id: 'no', en: 'No', ja: 'いいえ' }, { id: 'unsure', en: 'Not sure', ja: 'わからない' }, { id: 'na', en: 'Not applicable', ja: '該当しない' },
];

function Onboarding({ language, onLanguage, onCreate, onDemo, onRestore }: {
  language: Language; onLanguage: (language: Language) => void; onCreate: (passphrase: string, data: Dataset) => Promise<void>;
  onDemo: () => void; onRestore: (file: File, passphrase: string) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [audience, setAudience] = useState<'self' | 'family'>('self');
  const [knowledge, setKnowledge] = useState<'beginner' | 'comfortable' | 'advanced'>('beginner');
  const [securityPriority, setSecurityPriority] = useState<'convenience' | 'balanced' | 'strongest'>('balanced');
  const [quick, setQuick] = useState<string[]>(['phone', 'computer', 'email']);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (value: string, values: string[], setValues: (next: string[]) => void) => setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const selectedAssets = useMemo(() => quickOptions.filter((item) => quick.includes(item.id)).map((item) => makeAsset({ kind: item.kind, type: item.type, name: language === 'ja' ? item.ja : item.name, importance: item.id === 'email' || item.id === 'passwordManager' ? 'critical' : 'important', ...(item.kind === 'device' ? { operatingSystem: item.operatingSystem } : {}) })), [quick, language]);
  const plan = useMemo(() => {
    const items: string[] = [];
    if (answers.emailMfa === 'no' || answers.emailMfa === 'unsure') items.push(tx(language, 'Check recovery options for your main email', 'メインのメールの復旧方法を確認する'));
    if (answers.computerEncryption === 'no' || answers.computerEncryption === 'unsure') items.push(tx(language, 'Check encryption on your main computer', 'メインPCの暗号化を確認する'));
    if (answers.backup === 'no' || answers.backup === 'unsure') items.push(tx(language, 'Make one recent copy of important files', '大切なファイルの新しいコピーを作る'));
    if (!items.length) items.push(tx(language, 'Verify one recovery method and test a small restore', '復旧方法を一つ確認し、少量の復元を試す'));
    return items.slice(0, 3);
  }, [answers, language]);

  const finish = async () => {
    setBusy(true); setError('');
    try {
      const now = new Date().toISOString();
      const stateFor = (answer?: string): ControlState => answer === 'yes' ? 'implemented' : answer === 'no' ? 'needs-improvement' : answer === 'na' ? 'na' : 'unknown';
      const assets = selectedAssets.map((asset) => {
        const controls = { ...asset.controls };
        const controlEvidence = { ...asset.controlEvidence };
        for (const question of assessmentQuestions) {
          const definition = CHECKUP_CONTROLS.find((item) => item.id === question.id);
          const response = answers[question.answerId];
          if (!definition?.assetControl || definition.assetKind !== asset.kind || !response) continue;
          const matches = question.answerId === 'automaticUpdates'
            || (question.answerId === 'emailMfa' && asset.type === 'Primary email')
            || (question.answerId === 'recovery' && asset.type === 'Primary email')
            || (question.answerId === 'computerEncryption' && asset.type === 'Laptop')
            || (question.answerId === 'backup' && asset.kind === 'backup');
          if (!matches) continue;
          controls[definition.assetControl] = stateFor(response);
          controlEvidence[definition.assetControl] = response === 'na' ? 'not-applicable' : response === 'unsure' ? 'unknown' : 'user-reported';
        }
        return { ...asset, controls, controlEvidence };
      });
      const assessmentAnswers: Dataset['assessmentAnswers'] = {};
      for (const question of assessmentQuestions) {
        const response = answers[question.answerId];
        if (!response) continue;
        const definition = CHECKUP_CONTROLS.find((item) => item.id === question.id);
        const targets = definition?.assetKind ? assets.filter((asset) => asset.kind === definition.assetKind
          && (question.answerId !== 'emailMfa' && question.answerId !== 'recovery' || asset.type === 'Primary email')
          && (question.answerId !== 'computerEncryption' || asset.type === 'Laptop')) : [];
        const relevantTargets = question.answerId === 'automaticUpdates' ? targets : targets.slice(0, 1);
        const answer = { response: response === 'na' ? 'not-applicable' as const : response as 'yes' | 'no' | 'unsure', evidence: 'user-reported' as const, updatedAt: now };
        if (relevantTargets.length) for (const target of relevantTargets) assessmentAnswers[controlKey(question.id, target.id)] = answer;
        else assessmentAnswers[question.id] = answer;
      }
      const initial = {
        ...newDataset(language, goals), assets, assessmentAnswers,
        checkupProgress: { activeDomain: 'identity', startedAt: now, ...(assessmentQuestions.every((question) => answers[question.answerId]) ? { lastCompletedAt: now } : {}) },
        threatModel: { concerns: goals, audience, knowledge, priority: securityPriority },
        onboarding: { complete: true, goals, completedAt: now },
      };
      await onCreate(passphrase, initial);
    } catch { setError(tx(language, 'The private vault could not be created. Check browser storage and try again.', '暗号化ストレージを作成できませんでした。ブラウザーの保存設定を確認して、もう一度お試しください。')); }
    finally { setBusy(false); }
  };

  const restore = async (file?: File) => {
    if (!file || !passphrase) { setError(tx(language, 'Choose a backup and enter its passphrase first.', 'バックアップを選び、パスフレーズを入力してください。')); return; }
    setBusy(true); setError('');
    try { await onRestore(file, passphrase); } catch { setError(tx(language, 'The backup could not be opened. Check the file and passphrase.', 'バックアップを開けませんでした。ファイルとパスフレーズを確認してください。')); }
    finally { setBusy(false); }
  };

  const next = () => {
    if (step === 1) {
      if (passphrase.length < 10) { setError(tx(language, 'Use at least 10 characters for this app passphrase.', 'アプリ用パスフレーズは10文字以上にしてください。')); return; }
      if (passphrase !== confirm) { setError(tx(language, 'The passphrases do not match.', 'パスフレーズが一致しません。')); return; }
    }
    setError(''); setStep((value) => Math.min(5, value + 1));
  };

  return <main className="onboarding-screen">
    <header className="onboarding-top"><Brand /><LanguagePicker language={language} onChange={onLanguage} /></header>
    <div className="onboarding-wrap">
      <div className="onboarding-progress"><span>{tx(language, `STEP ${Math.min(step + 1, 6)} OF 6`, `ステップ ${Math.min(step + 1, 6)} / 6`)}</span><div className="progress-track"><span style={{ width: `${((step + 1) / 6) * 100}%` }} /></div></div>
      {step === 0 && <section className="welcome-panel">
        <div className="welcome-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="welcome-shield"><ShieldCheck size={62} strokeWidth={1.6} /></span><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-dot dot-three" /></div>
        <div className="eyebrow">{tx(language, 'YOUR PERSONAL SECURITY COACH', 'あなたのためのセキュリティコーチ')}</div>
        <h1>{tx(language, 'Understand and improve your digital security.', 'あなたのデジタル生活を、もっと安全に。')}</h1>
        <p className="lead">{tx(language, 'Understand what you own, how it is protected, and what to improve next. Everything stays on your device.', '大切なアカウントや端末、その守られ方、次にすることを整理できます。データはこの端末から出ません。')}</p>
        <div className="privacy-points">
          <div><LockKeyhole size={17} /><span>{tx(language, 'Encrypted on this device', 'この端末内で暗号化')}</span></div>
          <div><FileLock2 size={17} /><span>{tx(language, 'No cloud account or tracking', 'クラウドアカウントや追跡なし')}</span></div>
          <div><KeyRound size={17} /><span>{tx(language, 'Never stores your actual passwords', 'パスワードそのものは保存しない')}</span></div>
        </div>
        <button className="button button-primary button-large" onClick={next}>{tx(language, 'Start Security Checkup', 'セキュリティ診断を始める')}<ArrowRight size={18} /></button>
        <button className="button button-link" onClick={onDemo}>{tx(language, 'Explore a fictional sample', '架空データのサンプルを見る')}</button>
        <div className="restore-inline"><label className="file-label">{restoreFile?.name ?? tx(language, 'Choose encrypted backup', '暗号化バックアップを選択')}<input type="file" accept="application/json,.json" onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} /></label><input className="restore-pass" type="password" placeholder={tx(language, 'Backup passphrase', 'バックアップのパスフレーズ')} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" /><button className="button button-secondary" disabled={!restoreFile || !passphrase || busy} onClick={() => void restore(restoreFile ?? undefined)}>{tx(language, 'Restore', '復元')}</button></div>
      </section>}
      {step === 1 && <section className="wizard-panel">
        <div className="step-icon"><LockKeyhole size={25} /></div><div className="eyebrow">{tx(language, 'YOUR PRIVATE VAULT', 'プライベート保管庫')}</div>
        <h1>{tx(language, 'Create your app passphrase.', 'アプリ用パスフレーズを作成')}</h1>
        <p className="lead">{tx(language, 'This passphrase encrypts the information you add here. It is not an account password, and we never store it.', 'ここに入力する情報を暗号化するためのパスフレーズです。外部アカウントのパスワードではなく、保存もされません。')}</p>
        <div className="security-note"><Shield size={18} /><span>{tx(language, 'If you lose this passphrase and have no backup, the encrypted data cannot be recovered.', 'パスフレーズを忘れてバックアップもない場合、暗号化データは復元できません。')}</span></div>
        <label className="field-label">{tx(language, 'App passphrase', 'アプリ用パスフレーズ')}<input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={10} /></label>
        <label className="field-label">{tx(language, 'Confirm passphrase', 'パスフレーズをもう一度入力')}<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        <div className="inline-hint"><CircleHelp size={15} />{tx(language, 'Use a long phrase that you can remember. A password manager can store this app passphrase.', '覚えやすい長いフレーズにしましょう。アプリ用パスフレーズは既存のパスワードマネージャーに保管できます。')}</div>
        <WizardButtons language={language} back={() => setStep(0)} next={next} />
      </section>}
      {step === 2 && <section className="wizard-panel wide-panel">
        <div className="step-icon"><Sparkles size={25} /></div><div className="eyebrow">{tx(language, 'MAKE THIS YOURS', '関心のあることを選ぶ')}</div>
        <h1>{tx(language, 'What concerns you most?', '何が一番気になりますか？')}</h1><p className="lead">{tx(language, 'Choose as many as you like. We will use this to shape your first steps.', 'いくつでも選べます。最初に取り組む内容の参考にします。')}</p>
        <div className="selection-grid">{goalOptions.map(([id, en, ja]) => <button key={id} className={`selection-card ${goals.includes(id) ? 'selected' : ''}`} onClick={() => toggle(id, goals, setGoals)}><span className="selection-check">{goals.includes(id) && <Check size={15} />}</span><span>{tx(language, en, ja)}</span></button>)}</div>
        <div className="field-two onboarding-threat-fields"><label className="field-label">{tx(language, 'Who are you protecting?', '誰のデジタル生活を守りますか？')}<select value={audience} onChange={(event) => setAudience(event.target.value as 'self' | 'family')}><option value="self">{tx(language, 'Myself', '自分')}</option><option value="family">{tx(language, 'Myself and my family', '自分と家族')}</option></select></label><label className="field-label">{tx(language, 'How comfortable are you with technology?', '技術への慣れ具合は？')}<select value={knowledge} onChange={(event) => setKnowledge(event.target.value as 'beginner' | 'comfortable' | 'advanced')}><option value="beginner">{tx(language, 'Beginner', '初心者')}</option><option value="comfortable">{tx(language, 'Comfortable', 'ある程度慣れている')}</option><option value="advanced">{tx(language, 'Advanced', '詳しい')}</option></select></label><label className="field-label">{tx(language, 'What matters most?', '何を重視しますか？')}<select value={securityPriority} onChange={(event) => setSecurityPriority(event.target.value as 'convenience' | 'balanced' | 'strongest')}><option value="convenience">{tx(language, 'Convenience', '使いやすさ')}</option><option value="balanced">{tx(language, 'Balanced security', 'バランス')}</option><option value="strongest">{tx(language, 'Strongest practical protection', '実用的な範囲で強い保護')}</option></select></label></div>
        <WizardButtons language={language} back={() => setStep(1)} next={next} />
      </section>}
      {step === 3 && <section className="wizard-panel wide-panel">
        <div className="step-icon"><GitBranch size={25} /></div><div className="eyebrow">{tx(language, 'A QUICK INVENTORY', 'かんたんな初期登録')}</div>
        <h1>{tx(language, 'What is part of your digital life?', '普段使うものを選んでください')}</h1><p className="lead">{tx(language, 'Use recognizable nicknames. You do not need to enter email addresses, usernames, or any secrets.', 'メールアドレス、ユーザー名、秘密情報は入力しないでください。')}</p>
        <div className="selection-grid quick-grid">{quickOptions.map((item) => { const Icon = item.icon; return <button key={item.id} className={`selection-card quick-card ${quick.includes(item.id) ? 'selected' : ''}`} onClick={() => toggle(item.id, quick, setQuick)}><span className="quick-icon"><Icon size={19} /></span><span>{tx(language, item.name, item.ja)}</span><span className="selection-check">{quick.includes(item.id) && <Check size={15} />}</span></button>; })}</div>
        <div className="inline-hint"><CircleHelp size={15} />{tx(language, 'Skip anything you do not want to add yet. You can add more later.', '今は登録したくない項目は飛ばせます。後から追加できます。')}</div>
        <WizardButtons language={language} back={() => setStep(2)} next={next} />
      </section>}
      {step === 4 && <section className="wizard-panel wide-panel">
        <div className="step-icon"><Activity size={25} /></div><div className="eyebrow">{tx(language, 'YOUR FIRST CHECK-IN', '最初のセキュリティ確認')}</div>
        <h1>{tx(language, 'A few quick questions.', 'いくつか質問します')}</h1><p className="lead">{tx(language, 'There are no wrong answers. “Not sure” simply helps us find what to check together.', '正解・不正解はありません。「わからない」は一緒に確認する項目として記録します。')}</p>
        <div className="question-list">{assessmentQuestions.map((question) => <div className="question-row" key={question.id}><span>{tx(language, question.en, question.ja)}</span><div className="answer-pills">{answerOptions.map((option) => <button key={option.id} onClick={() => setAnswers((old) => ({ ...old, [question.answerId]: option.id }))} className={`answer-pill ${answers[question.answerId] === option.id ? 'active' : ''}`}>{tx(language, option.en, option.ja)}</button>)}</div></div>)}</div>
        <WizardButtons language={language} back={() => setStep(3)} next={next} />
      </section>}
      {step === 5 && <section className="wizard-panel plan-panel">
        <div className="step-icon"><CheckCircle2 size={25} /></div><div className="eyebrow">{tx(language, 'A CLEAR PLACE TO START', '最初の取り組み')}</div>
        <h1>{tx(language, 'Your first three priorities.', 'まず取り組む3つのこと')}</h1><p className="lead">{tx(language, 'Based on your answers, we will start small and work through each item together.', '回答に合わせて、一つずつ無理なく進められるよう整理しました。')}</p>
        <div className="starter-plan">{plan.map((item, index) => <div className="starter-item" key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong><ArrowRight size={16} /></div>)}</div>
        <div className="security-note"><LockKeyhole size={17} /><span>{tx(language, 'Your inventory will be encrypted in this browser. No information is sent to a server.', '登録した情報はこのブラウザー内で暗号化します。サーバーには送信されません。')}</span></div>
        {error && <p className="error-message">{error}</p>}
        <div className="wizard-actions"><button className="button button-secondary" onClick={() => setStep(4)}>{tx(language, 'Back', '戻る')}</button><button className="button button-primary" onClick={finish} disabled={busy}>{busy ? tx(language, 'Creating your vault…', '保管庫を作成中…') : tx(language, 'Open my workspace', 'ワークスペースを開く')}<ArrowRight size={17} /></button></div>
      </section>}
      {error && step !== 5 && <p className="error-message center-error">{error}</p>}
      <footer className="onboarding-footer">{tx(language, 'Your data belongs to you.', 'データはあなたのものです。')} <span>{tx(language, 'Stored locally · encrypted by default', '端末内に保存 · 常に暗号化')}</span></footer>
    </div>
  </main>;
}

function WizardButtons({ language, back, next }: { language: Language; back: () => void; next: () => void }) {
  return <div className="wizard-actions"><button className="button button-secondary" onClick={back}>{tx(language, 'Back', '戻る')}</button><button className="button button-primary" onClick={next}>{tx(language, 'Continue', '続ける')}<ArrowRight size={17} /></button></div>;
}

function UnlockScreen({ language, onLanguage, onUnlock, onRestore, onReset }: {
  language: Language; onLanguage: (language: Language) => void; onUnlock: (passphrase: string) => Promise<void>;
  onRestore: (file: File, passphrase: string) => Promise<void>; onReset: () => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [showRestore, setShowRestore] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (showRestore && file && !window.confirm(tx(language, 'Replace this browser vault with the selected backup?', 'このブラウザーの保管庫を選択したバックアップで置き換えますか？'))) return; setBusy(true); setError(''); try { if (showRestore && file) await onRestore(file, passphrase); else await onUnlock(passphrase); } catch { setError(tx(language, 'That passphrase did not open the vault. Try again or restore a backup.', 'パスフレーズが違うか、保管庫を開けませんでした。もう一度試すか、バックアップを復元してください。')); } finally { setBusy(false); } };
  return <main className="lock-screen"><header className="onboarding-top"><Brand /><LanguagePicker language={language} onChange={onLanguage} /></header><section className="lock-card"><span className="lock-badge"><LockKeyhole size={24} /></span><div className="eyebrow">{tx(language, 'YOUR PRIVATE WORKSPACE', 'プライベートなワークスペース')}</div><h1>{tx(language, 'Welcome back.', 'おかえりなさい')}</h1><p>{tx(language, 'Your information is encrypted and locked on this device.', '情報はこの端末内で暗号化され、ロックされています。')}</p>
    <form onSubmit={submit}><label className="field-label">{showRestore ? tx(language, 'Backup passphrase', 'バックアップのパスフレーズ') : tx(language, 'App passphrase', 'アプリ用パスフレーズ')}<input autoFocus type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
      {showRestore && <label className="file-drop">{file ? file.name : tx(language, 'Choose encrypted backup file', '暗号化バックアップを選択')}<input type="file" accept="application/json,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>}
      {error && <p className="error-message">{error}</p>}<button className="button button-primary button-full" disabled={busy}>{busy ? tx(language, 'Opening…', '開いています…') : showRestore ? tx(language, 'Restore backup', 'バックアップを復元') : tx(language, 'Unlock workspace', 'ロックを解除')}<ArrowRight size={17} /></button>
    </form><button className="button button-link" onClick={() => { setShowRestore(!showRestore); setError(''); }}>{showRestore ? tx(language, 'Use my app passphrase', 'アプリ用パスフレーズで開く') : tx(language, 'Restore an encrypted backup', '暗号化バックアップを復元')}</button>
    <div className="lock-footer"><p>{tx(language, 'The passphrase is never stored. Keep a current encrypted backup somewhere safe.', 'パスフレーズは保存されません。暗号化バックアップを安全な場所に保管してください。')}</p><button className="text-danger" onClick={() => { if (window.confirm(tx(language, 'Permanently delete this encrypted vault from this browser? This cannot be undone.', 'このブラウザーの暗号化保管庫を完全に削除しますか？取り消せません。'))) void onReset(); }}>{tx(language, 'Delete local vault', 'ローカル保管庫を削除')}</button></div>
  </section></main>;
}
