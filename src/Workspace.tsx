import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Fingerprint, GitBranch, HardDrive, House, KeyRound, Laptop,
  LockKeyhole, Mail, Menu, Plus, Search, Settings, Shield, ShieldAlert, ShieldCheck,
  Smartphone, Trash2, Wifi, X, UserRound,
} from 'lucide-react';
import {
  CONTROL_CATALOG, IMPORTANCE, LANGUAGES, assetSchema,
  looksLikeSecret, type Asset, type AssetKind, type ControlState, type Dataset, type Importance, type Language, type OperatingSystem,
} from './models';
import { downloadEncryptedBackup, readEnvelope } from './crypto';
import { buildFindings, buildGuidedFindings, controlsSummary, KIND_LABELS, type Finding } from './rules';
import { CHECKUP_CONTROLS, controlKey } from './checkupCatalog';
import { SecurityExplanation } from './Explain';

const CheckupPage = lazy(() => import('./Checkup').then((module) => ({ default: module.CheckupPage })));

type Notice = { kind: 'success' | 'error'; text: string } | null;
const tx = (language: Language, en: string, ja: string) => language === 'ja' ? ja : en;
const statusLabel = (language: Language, status: ControlState) => ({
  unknown: tx(language, 'Not assessed', '未評価'),
  'needs-improvement': tx(language, 'Needs work', '要対応'),
  implemented: tx(language, 'Reported', '設定済み'),
  verified: tx(language, 'Verified', '確認済み'),
  na: tx(language, 'Not applicable', '該当なし'),
}[status]);
const importanceLabel = (language: Language, value: Importance) => ({
  critical: tx(language, 'Critical', '最重要'), important: tx(language, 'Important', '重要'), useful: tx(language, 'Useful', '参考'),
}[value]);
function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.3} /></span><span className="brand-copy"><strong>personal cyber OS</strong><small>your private security coach</small></span></div>;
}

function LanguagePicker({ language, onChange, small = false }: { language: Language; onChange: (language: Language) => void; small?: boolean }) {
  return <label className={`language-picker ${small ? 'language-small' : ''}`} aria-label="Language"><span className="sr-only">Language</span><select value={language} onChange={(event) => onChange(event.target.value as Language)}><option value="en">EN</option><option value="ja">日本語</option></select><ChevronDown size={14} /></label>;
}

const navigation = [
  { to: '/', en: 'Home', ja: 'ホーム', icon: House, end: true },
  { to: '/life', en: 'My digital life', ja: 'デジタルライフ', icon: GitBranch },
  { to: '/checkup', en: 'Security checkup', ja: 'セキュリティチェックアップ', icon: ShieldCheck },
  { to: '/plan', en: 'Protection plan', ja: '保護プラン', icon: CheckCircle2 },
  { to: '/recovery', en: 'Recovery & Emergency', ja: '復旧と緊急時', icon: ShieldAlert },
];
export function Workspace({ data, language, isDemo, notice, setNotice, persist, lock, onLanguage, onDemoExit, onPassphrase, onReset, onRestore, envelope }: {
  data: Dataset; language: Language; isDemo: boolean; notice: Notice; setNotice: (notice: Notice) => void;
  persist: (data: Dataset) => Promise<void>; lock: () => void; onLanguage: (language: Language) => void; onDemoExit: () => void;
  onPassphrase: (passphrase: string) => Promise<void>; onReset: () => Promise<void>; onRestore: (file: File, passphrase: string) => Promise<void>;
  envelope: Awaited<ReturnType<typeof readEnvelope>>;
}) {
  const [assetEditorOpen, setAssetEditorOpen] = useState(false); const [editing, setEditing] = useState<Asset | null>(null); const [mobileNavOpen, setMobileNavOpen] = useState(false); const [userMenuOpen, setUserMenuOpen] = useState(false);
  const navigate = useNavigate();
  const openAdd = () => { setEditing(null); setAssetEditorOpen(true); };
  const openEdit = (asset: Asset) => { setEditing(asset); setAssetEditorOpen(true); };
  const saveAsset = async (asset: Asset) => {
    const found = data.assets.some((item) => item.id === asset.id);
    const assets = found ? data.assets.map((item) => item.id === asset.id ? { ...asset, updatedAt: new Date().toISOString() } : item) : [...data.assets, asset];
    const previous = data.assets.find((item) => item.id === asset.id);
    const assessmentAnswers = { ...data.assessmentAnswers };
    const answerTime = new Date().toISOString();
    for (const [controlId, state] of Object.entries(asset.controls)) {
      const oldState = previous?.controls[controlId] ?? 'unknown';
      if (oldState === state || (!previous && state === 'unknown')) continue;
      const mappedControls = CHECKUP_CONTROLS.filter((control) => control.assetKind === asset.kind && control.assetControl === controlId
        && (control.id !== 'identity.primary-email-mfa' || asset.type === 'Primary email')
        && (control.id !== 'identity.mfa-important' || asset.type !== 'Primary email'));
      const response = state === 'needs-improvement' ? 'no' : state === 'na' ? 'not-applicable' : state === 'unknown' ? undefined : 'yes';
      for (const control of mappedControls) {
        const key = controlKey(control.id, asset.id);
        if (!response) delete assessmentAnswers[key];
        else assessmentAnswers[key] = { response, evidence: state === 'verified' ? 'user-confirmed' : 'user-reported', updatedAt: answerTime };
      }
    }
    const actions = [...data.actions];
    if (previous) {
      for (const [controlId, state] of Object.entries(asset.controls)) {
        const oldState = previous.controls[controlId] ?? 'unknown';
        if ((oldState === 'unknown' || oldState === 'needs-improvement') && (state === 'implemented' || state === 'verified')) {
          const id = `${asset.id}:${controlId}`;
          if (!actions.some((item) => item.id === id && item.completedAt)) {
            const titleEn = previous ? buildFindings([previous], 'en').find((finding) => finding.id === id)?.title : undefined;
            const titleJa = previous ? buildFindings([previous], 'ja').find((finding) => finding.id === id)?.title : undefined;
            actions.push({ id, completedAt: new Date().toISOString(), titleEn, titleJa, assetName: previous?.name });
          }
        }
      }
    }
    await persist({ ...data, assets, actions, assessmentAnswers });
    setAssetEditorOpen(false); setNotice({ kind: 'success', text: tx(language, found ? 'Asset updated in your encrypted vault.' : 'Asset added to your encrypted vault.', found ? '資産情報を暗号化保管庫に保存しました。' : '資産を暗号化保管庫に追加しました。') });
  };
  const changeWorkspaceLanguage = (next: Language) => {
    onLanguage(next);
    void persist({ ...data, settings: { ...data.settings, language: next } });
  };
  const deleteAsset = async (id: string) => {
    if (!window.confirm(tx(language, 'Delete this asset and its linked recovery paths?', 'この資産と関連する復旧経路を削除しますか？'))) return;
    const legacyPrefix = `${id}:`;
    const assessmentAnswers = Object.fromEntries(Object.entries(data.assessmentAnswers).filter(([key]) => !key.endsWith(`@${id}`)));
    await persist({ ...data, assets: data.assets.filter((asset) => asset.id !== id), dependencies: data.dependencies.filter((item) => item.assetId !== id && item.recoveryAssetId !== id), actions: data.actions.filter((item) => !item.id.startsWith(legacyPrefix) && !item.id.startsWith(`${id}@`)), assessmentAnswers });
    setAssetEditorOpen(false); setNotice({ kind: 'success', text: tx(language, 'Asset removed.', '資産を削除しました。') });
  };
  const completeFinding = async (finding: Finding) => {
    if (finding.source === 'assessment') { navigate(`/checkup?domain=${encodeURIComponent(finding.controlId.split('.')[0])}&question=${encodeURIComponent(finding.controlId)}`); return; }
    const asset = data.assets.find((item) => item.id === finding.assetId);
    if (!asset) return;
    setEditing(asset);
    setAssetEditorOpen(true);
  };
  const updateIncident = async (id: string, checked: string[]) => persist({ ...data, incidentProgress: { ...data.incidentProgress, [id]: checked } });
  const addDependency = async (assetId: string, recoveryAssetId: string, relation: string) => persist({ ...data, dependencies: [...data.dependencies, { id: crypto.randomUUID(), assetId, recoveryAssetId, relation, createdAt: new Date().toISOString() }] });
  const deleteDependency = async (id: string) => persist({ ...data, dependencies: data.dependencies.filter((item) => item.id !== id) });
  const addReview = async (kind: 'weekly' | 'monthly') => persist({ ...data, reviews: [{ id: crypto.randomUUID(), completedAt: new Date().toISOString(), kind }, ...data.reviews] });
  const updateWorkflow = async (id: string, checked: string[]) => persist({ ...data, workflowProgress: { ...data.workflowProgress, [id]: checked } });
  const findings = useMemo(() => buildGuidedFindings(data, language), [data, language]);
  const location = useLocation();
  const activePage = navigation.find((item) => item.to === location.pathname);
  const pageTitle = location.pathname === '/settings' ? tx(language, 'Settings & help', '設定・ヘルプ') : activePage ? tx(language, activePage.en, activePage.ja) : tx(language, 'Personal Cyber OS', 'パーソナル・サイバーOS');
  const shared = { data, language, persist, findings, onEdit: openEdit, onAdd: openAdd, onComplete: completeFinding, updateIncident, addDependency, deleteDependency, addReview, updateWorkflow };

  return <div className={`app-shell ${data.settings.theme === 'dark' ? 'theme-dark' : ''}`}>
    <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}><Brand /><div className="workspace-label">{tx(language, 'YOUR WORKSPACE', 'マイワークスペース')}</div>
      <nav className="side-nav">{navigation.map(({ to, en, ja, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={18} /><span>{tx(language, en, ja)}</span>{to === '/plan' && findings.length > 0 && <span className="nav-count">{findings.length}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="local-status"><span className="status-dot" /><span>{tx(language, 'Stored on this device', 'この端末に保存')}</span><LockKeyhole size={14} /></div><div className="sidebar-footnote">{tx(language, 'Your security, your pace.', 'あなたのペースで、安全に。')}</div></div>
    </aside>
    <div className="app-main"><header className="app-topbar"><button className="mobile-menu" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label={tx(language, 'Toggle navigation', 'ナビゲーションを切り替え')}>{mobileNavOpen ? <X size={20} /> : <Menu size={20} />}</button><div className="mobile-brand"><Brand compact /></div><div className="breadcrumb"><span>{tx(language, 'Workspace', 'ワークスペース')}</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div><div className="top-actions">{isDemo && <button className="demo-badge" onClick={onDemoExit}>{tx(language, 'DEMO · EXIT', 'デモ · 終了')}</button>}<LanguagePicker language={language} onChange={changeWorkspaceLanguage} small /><div className="user-menu-wrap"><button className="icon-button" aria-label={tx(language, 'Settings and help', '設定とヘルプ')} aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((open) => !open)}><UserRound size={17} /></button>{userMenuOpen && <div className="user-menu"><Link to="/settings" onClick={() => setUserMenuOpen(false)}><Settings size={15} />{tx(language, 'Settings', '設定')}</Link><Link to="/settings#help" onClick={() => setUserMenuOpen(false)}><CircleHelp size={15} />{tx(language, 'Help & privacy', 'ヘルプ・プライバシー')}</Link><button onClick={() => { setUserMenuOpen(false); lock(); }}><LockKeyhole size={15} />{tx(language, 'Lock workspace', 'ワークスペースをロック')}</button></div>}</div></div></header>
      {notice && <div className={`toast toast-${notice.kind}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label={tx(language, 'Dismiss', '閉じる')}><X size={15} /></button></div>}
      <main className="page-content"><Suspense fallback={<div className="route-loading" role="status">{tx(language, 'Opening this section…', 'ページを開いています…')}</div>}><Routes>
        <Route path="/" element={<Dashboard {...shared} />} />
        <Route path="/life" element={<DigitalLife {...shared} />} />
        <Route path="/checkup" element={<CheckupPage data={data} language={language} persist={persist} />} />
        <Route path="/validation" element={<Navigate to="/recovery" replace />} />
        <Route path="/software" element={<Navigate to="/life" replace />} />
        <Route path="/journey" element={<Navigate to="/checkup" replace />} />
        <Route path="/plan" element={<ProtectionPlan {...shared} />} />
        <Route path="/recovery" element={<RecoveryCenter {...shared} />} />
        <Route path="/progress" element={<ProgressPage {...shared} />} />
        <Route path="/settings" element={<SettingsPage {...shared} onLanguage={changeWorkspaceLanguage} onLock={lock} onPassphrase={onPassphrase} onReset={onReset} onRestore={onRestore} onNotice={setNotice} envelope={envelope} isDemo={isDemo} />} />
        <Route path="*" element={<Dashboard {...shared} />} />
      </Routes></Suspense></main>
      <nav className="mobile-bottom-nav">{navigation.map(({ to, en, ja, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}><Icon size={18} /><span>{tx(language, en === 'My digital life' ? 'Life' : en === 'Security Checkup' ? 'Checkup' : en === 'Recovery & Emergency' ? 'Recovery' : en, ja === 'デジタルライフ' ? 'ライフ' : ja === 'セキュリティチェックアップ' ? '診断' : ja === '復旧と緊急時' ? '復旧' : ja)}</span></NavLink>)}</nav>
    </div>
    {assetEditorOpen && <AssetEditor language={language} asset={editing} onClose={() => setAssetEditorOpen(false)} onSave={saveAsset} onDelete={deleteAsset} />}
  </div>;
}

type PageProps = {
  data: Dataset; language: Language; persist: (data: Dataset) => Promise<void>; findings: Finding[];
  onEdit: (asset: Asset) => void; onAdd: () => void; onComplete: (finding: Finding) => Promise<void>;
  updateIncident: (id: string, checked: string[]) => Promise<void>;
  addDependency: (assetId: string, recoveryAssetId: string, relation: string) => Promise<void>;
  deleteDependency: (id: string) => Promise<void>; addReview: (kind: 'weekly' | 'monthly') => Promise<void>;
  updateWorkflow: (id: string, checked: string[]) => Promise<void>;
};

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}
function Button({ children, onClick, variant = 'primary', icon, className = '', disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: ReactNode; className?: string; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{icon}{children}</button>;
}
function PriorityPill({ language, priority }: { language: Language; priority: 'high' | 'medium' | 'low' }) {
  return <span className={`priority-pill priority-${priority}`}>{tx(language, priority === 'high' ? 'Priority' : priority === 'medium' ? 'Soon' : 'Explore', priority === 'high' ? '優先' : priority === 'medium' ? '次に' : '確認')}</span>;
}
function AssetGlyph({ asset, size = 20 }: { asset: Asset; size?: number }) {
  const icon = asset.kind === 'device' ? (asset.type.toLowerCase().includes('phone') ? Smartphone : Laptop) : asset.kind === 'network' ? Wifi : asset.kind === 'backup' ? HardDrive : asset.type.toLowerCase().includes('email') ? Mail : KeyRound;
  const Icon = icon; return <span className={`asset-glyph glyph-${asset.kind}`}><Icon size={size} /></span>;
}

function Dashboard({ data, language, findings, onAdd, onEdit, onComplete }: PageProps) {
  const [showAll, setShowAll] = useState(false);
  const summary = controlsSummary(data.assets);
  const checkupKeys = CHECKUP_CONTROLS.flatMap((control) => {
    const matches = control.assetKind ? data.assets.filter((asset) => asset.kind === control.assetKind) : [];
    return matches.length ? matches.map((asset) => controlKey(control.id, asset.id)) : [control.id];
  });
  const checkupAssessed = checkupKeys.filter((key) => Boolean(data.assessmentAnswers[key])).length;
  const checkupPercent = checkupKeys.length ? Math.round(checkupAssessed / checkupKeys.length * 100) : 0;
  const lastCheckup = data.checkupProgress.lastCompletedAt;
  const nextCheckup = lastCheckup ? new Date(new Date(lastCheckup).getTime() + data.settings.reviewIntervalDays * 86_400_000) : null;
  const checkupDue = !nextCheckup || nextCheckup.getTime() <= Date.now();
  const next = findings[0];
  const recentActions = data.actions.filter((item) => item.completedAt).slice(0, 3);
  const greeted = language === 'ja' ? '今日も一歩ずつ、デジタルライフを整えましょう。' : 'A little progress makes your digital life safer.';
  return <div className="dashboard-page">
    <div className="dashboard-welcome"><div><div className="eyebrow">{tx(language, 'YOUR PERSONAL SECURITY OVERVIEW', 'セキュリティの現在地')}</div><h1>{tx(language, 'Good to see you.', 'おかえりなさい。')}</h1><p>{greeted}</p></div><div className="welcome-orb"><ShieldCheck size={38} strokeWidth={1.5} /></div></div>
    <div className="dashboard-grid">
      <section className="next-action-card"><div className="card-topline"><span className="eyebrow">{tx(language, 'YOUR NEXT BEST ACTION', '次に取り組むこと')}</span><PriorityPill language={language} priority={next?.priority ?? 'low'} /></div>
        {next ? <><h2>{next.title}</h2><p className="action-asset">{tx(language, 'For', '対象：')} <strong>{next.assetName}</strong></p><span className="effort-label"><Clock3 size={13} />{tx(language, `About ${next.effortMinutes} minutes`, `約${next.effortMinutes}分`)}</span><SecurityExplanation finding={next} language={language} depth={data.settings.explanationDepth} /><div className="action-footer"><Button variant="secondary" onClick={() => void onComplete(next)} icon={<ArrowRight size={16} />}>{tx(language, 'Guide me', '手順を見る')}</Button></div></> : <div className="all-clear"><CheckCircle2 size={31} /><h2>{tx(language, 'You are all caught up.', '確認待ちの項目はありません。')}</h2><p>{tx(language, 'Add another asset or run a recovery check to keep building confidence.', '資産を追加したり、復旧方法を確認したりして備えを続けましょう。')}</p><Button variant="secondary" onClick={onAdd} icon={<Plus size={16} />}>{tx(language, 'Add an asset', '資産を追加')}</Button></div>}
      </section>
      <section className="overview-card"><div className="card-head"><div><div className="eyebrow">{tx(language, 'YOUR DIGITAL LIFE', 'デジタルライフ')}</div><h2>{tx(language, 'A growing picture', '見えてきた全体像')}</h2></div><button className="arrow-link" onClick={() => setShowAll(!showAll)}>{tx(language, 'View all', 'すべて見る')}<ArrowRight size={15} /></button></div><div className="overview-stats"><div className="overview-stat"><strong>{data.assets.length}</strong><span>{tx(language, 'assets', '資産')}</span></div><div className="overview-stat"><strong>{summary.verified}</strong><span>{tx(language, 'verified controls', '確認済み')}</span></div><div className="overview-stat"><strong>{findings.length}</strong><span>{tx(language, 'open checks', '要確認')}</span></div></div>
        <div className="asset-preview">{(showAll ? data.assets : data.assets.slice(0, 4)).map((asset) => <button className="asset-preview-row" key={asset.id} onClick={() => onEdit(asset)}><AssetGlyph asset={asset} size={17} /><span className="asset-preview-name"><strong>{asset.name}</strong><small>{tx(language, KIND_LABELS[asset.kind].en, KIND_LABELS[asset.kind].ja)}</small></span><span className="asset-status-text">{statusLabel(language, assetStatus(asset))}</span><ChevronRight size={15} /></button>)}</div>
        {data.assets.length === 0 && <EmptyState title={tx(language, 'Start with what you use', '普段使うものから')} text={tx(language, 'A phone, a computer, or your main email is a good first step.', 'スマートフォン、PC、メインのメールから始めるのがおすすめです。')} action={tx(language, 'Add your first asset', '最初の資産を登録')} onClick={onAdd} />}
      </section>
      <section className="journey-card"><div className="card-head"><div><div className="eyebrow">{tx(language, 'YOUR SECURITY JOURNEY', 'セキュリティの道のり')}</div><h2>{tx(language, 'Small steps add up', '小さな確認を積み重ねる')}</h2></div><span className="journey-mark"><GitBranch size={17} /></span></div><div className="journey-steps">{[
        [tx(language, 'Know your digital life', 'デジタルライフを把握'), data.assets.length > 0],
        [tx(language, 'Protect key accounts', '大切なアカウントを保護'), data.assets.some((asset) => asset.kind === 'account')],
        [tx(language, 'Prepare for recovery', '復旧に備える'), data.dependencies.length > 0 || data.assets.some((asset) => asset.controls.recovery === 'verified')],
      ].map(([label, done], index) => <div key={String(label)} className={`journey-step ${done ? 'step-done' : ''}`}><span className="step-marker">{done ? <Check size={13} /> : index + 1}</span><span>{label}</span><span className="step-state">{done ? tx(language, 'Started', '開始済み') : tx(language, 'Next', '次へ')}</span></div>)}</div><div className="dashboard-checkup-progress"><div><span>{tx(language, 'Assessment progress', '診断の進捗')}</span><strong>{checkupAssessed}/{checkupKeys.length}</strong></div><div className="progress-track" role="progressbar" aria-label={tx(language, 'Assessment progress', '診断の進捗')} aria-valuemin={0} aria-valuemax={checkupKeys.length} aria-valuenow={checkupAssessed}><span style={{ width: `${checkupPercent}%` }} /></div><small>{!lastCheckup ? tx(language, 'Start your first checkup', '最初の診断を始めましょう') : checkupDue ? tx(language, 'Your next checkup is due', '次回の診断時期です') : tx(language, `Next review ${nextCheckup!.toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium' })}`, `次回の見直し：${nextCheckup!.toLocaleDateString('ja-JP', { dateStyle: 'medium' })}`)}</small></div><Link to="/checkup" className="text-arrow">{tx(language, 'Continue your checkup', 'セキュリティ診断を続ける')}<ArrowRight size={15} /></Link></section>
      <section className="improvements-card"><div className="card-head"><div><div className="eyebrow">{tx(language, 'RECENT IMPROVEMENTS', '最近の改善')}</div><h2>{tx(language, 'Look how far you have come', 'できるようになったこと')}</h2></div><span className="improvement-count">{recentActions.length}</span></div>{recentActions.length ? <div className="improvement-list">{recentActions.map((action) => <div className="improvement-row" key={action.id}><span className="check-round"><Check size={13} /></span><span>{(language === 'ja' ? action.titleJa : action.titleEn) ?? tx(language, 'A security check was completed', 'セキュリティ項目を確認しました')}</span><time>{new Date(action.completedAt!).toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric' })}</time></div>)}</div> : <p className="muted-copy">{tx(language, 'Your completed steps will appear here.', '完了した項目がここに表示されます。')}</p>}</section>
    </div>
  </div>;
}

function EmptyState({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><GitBranch size={22} /></span><h3>{title}</h3><p>{text}</p><Button variant="secondary" onClick={onClick} icon={<Plus size={15} />}>{action}</Button></div>;
}

function DigitalLife({ data, language, onAdd, onEdit }: PageProps) {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState<AssetKind | 'all'>('all'); const [advanced, setAdvanced] = useState(data.settings.mode === 'advanced');
  const filtered = data.assets.filter((asset) => (filter === 'all' || asset.kind === filter) && asset.name.toLowerCase().includes(query.toLowerCase()));
  const groups: AssetKind[] = ['account', 'device', 'backup', 'network', 'identity'];
  return <><PageHeading eyebrow={tx(language, 'YOUR INVENTORY', 'デジタル資産')} title={tx(language, 'My digital life', 'デジタルライフ')} description={tx(language, 'A simple, private picture of the things you rely on.', '日々使っているものを、簡単に整理して安全に把握できます。')} action={<Button onClick={onAdd} icon={<Plus size={16} />}>{tx(language, 'Add something', '追加する')}</Button>} />
    <div className="inventory-toolbar"><div className="search-box"><Search size={17} /><input aria-label={tx(language, 'Search assets', '資産を検索')} placeholder={tx(language, 'Find an account, device, or backup…', 'アカウント、端末、バックアップを検索…')} value={query} onChange={(event) => setQuery(event.target.value)} /></div><select className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value as AssetKind | 'all')}><option value="all">{tx(language, 'All categories', 'すべてのカテゴリ')}</option>{groups.map((kind) => <option key={kind} value={kind}>{tx(language, KIND_LABELS[kind].en, KIND_LABELS[kind].ja)}</option>)}</select><button className={`view-toggle ${advanced ? 'selected' : ''}`} onClick={() => setAdvanced(!advanced)}>{advanced ? tx(language, 'Cards', 'カード表示') : tx(language, 'Details', '詳細表示')}</button></div>
    {data.assets.length === 0 ? <EmptyState title={tx(language, 'Your inventory starts here', 'ここから登録できます')} text={tx(language, 'Add an account, device, network, identity, or backup. No account identifiers needed.', 'アカウント、端末、ネットワーク、ID、バックアップを追加します。識別情報は不要です。')} action={tx(language, 'Add your first asset', '最初の資産を追加')} onClick={onAdd} /> : filtered.length === 0 ? <div className="empty-search">{tx(language, 'No matching assets.', '該当する資産はありません。')}</div> : <div className={`inventory-grid ${advanced ? 'inventory-list-mode' : ''}`}>{filtered.map((asset) => <AssetCard key={asset.id} asset={asset} language={language} onClick={() => onEdit(asset)} details={advanced} />)}</div>}
    <div className="no-secrets-callout"><LockKeyhole size={17} /><span><strong>{tx(language, 'Protection details only.', '保護状況だけを記録します。')}</strong> {tx(language, 'Never enter passwords, recovery codes, private keys, or actual account IDs.', 'パスワード、復旧コード、秘密鍵、実際のアカウントIDは入力しないでください。')}</span></div>
  </>;
}

function AssetCard({ asset, language, onClick, details = false }: { asset: Asset; language: Language; onClick: () => void; details?: boolean }) {
  const values = Object.values(asset.controls); const verified = values.filter((value) => value === 'verified').length;
  const status = assetStatus(asset);
  const controls = CONTROL_CATALOG[asset.kind];
  const localizedType = typeOptions[asset.kind].find((item) => item.en === asset.type);
  return <button className={`asset-card ${details ? 'asset-card-detailed' : ''}`} onClick={onClick}><div className="asset-card-head"><AssetGlyph asset={asset} size={20} /><span className={`importance-chip importance-${asset.importance}`}>{importanceLabel(language, asset.importance)}</span><ChevronRight className="asset-chevron" size={16} /></div><h3>{asset.name}</h3><p>{tx(language, KIND_LABELS[asset.kind].en, KIND_LABELS[asset.kind].ja)} · {localizedType ? tx(language, localizedType.en, localizedType.ja) : asset.type}</p><div className="asset-card-foot"><span className={`state-dot state-${status}`} />{statusLabel(language, status)}<span className="assessment-count">{verified}/{controls.length} {tx(language, 'verified', '確認済み')}</span></div>{details && <div className="asset-detail-strip">{controls.map((control) => <span key={control.id}>{language === 'ja' ? control.ja : control.en}: {statusLabel(language, asset.controls[control.id] ?? 'unknown')}</span>)}</div>}</button>;
}

function assetStatus(asset: Asset): ControlState {
  const states = Object.values(asset.controls);
  if (states.includes('needs-improvement')) return 'needs-improvement';
  if (states.length && states.every((state) => state === 'verified' || state === 'na')) return states.includes('verified') ? 'verified' : 'na';
  if (states.includes('unknown')) return 'unknown';
  if (states.includes('implemented')) return 'implemented';
  return 'unknown';
}

const kinds: { id: AssetKind; en: string; ja: string }[] = [
  { id: 'account', en: 'Account', ja: 'アカウント' }, { id: 'device', en: 'Device', ja: '端末' },
  { id: 'backup', en: 'Data & backup', ja: 'データとバックアップ' }, { id: 'network', en: 'Home network', ja: 'ホームネットワーク' }, { id: 'identity', en: 'Digital identity', ja: 'デジタルID' },
];
const typeOptions: Record<AssetKind, { en: string; ja: string }[]> = {
  account: [{ en: 'Primary email', ja: 'メインのメール' }, { en: 'Secondary email', ja: '予備メール' }, { en: 'Password manager', ja: 'パスワードマネージャー' }, { en: 'Identity provider', ja: 'IDプロバイダー' }, { en: 'Banking and finance', ja: '銀行・金融' }, { en: 'Social media', ja: 'SNS' }, { en: 'Messaging', ja: 'メッセージ' }, { en: 'Cloud storage', ja: 'クラウドストレージ' }, { en: 'Developer account', ja: '開発者アカウント' }, { en: 'Other account', ja: 'その他のアカウント' }],
  device: [{ en: 'Smartphone', ja: 'スマートフォン' }, { en: 'Laptop', ja: 'ノートPC' }, { en: 'Desktop', ja: 'デスクトップPC' }, { en: 'Tablet', ja: 'タブレット' }, { en: 'Security key', ja: 'セキュリティキー' }, { en: 'Smart home device', ja: 'スマートホーム機器' }, { en: 'Other device', ja: 'その他の端末' }],
  backup: [{ en: 'Important files', ja: '大切なファイル' }, { en: 'Photos', ja: '写真' }, { en: 'Work documents', ja: '仕事の書類' }, { en: 'Other data', ja: 'その他のデータ' }],
  network: [{ en: 'Router', ja: 'ルーター' }, { en: 'Wi-Fi network', ja: 'Wi-Fiネットワーク' }, { en: 'Home network', ja: 'ホームネットワーク' }],
  identity: [{ en: 'Email identity', ja: 'メールID' }, { en: 'Phone identity', ja: '電話番号ID' }, { en: 'Domain', ja: 'ドメイン' }, { en: 'Government document metadata', ja: '本人確認書類の管理情報' }, { en: 'Other identity', ja: 'その他のID' }],
};

function AssetEditor({ language, asset, onClose, onSave, onDelete }: { language: Language; asset: Asset | null; onClose: () => void; onSave: (asset: Asset) => void; onDelete: (id: string) => void }) {
  const [kind, setKind] = useState<AssetKind>(asset?.kind ?? 'account');
  const [type, setType] = useState(asset?.type ?? 'Primary email');
  const [name, setName] = useState(asset?.name ?? '');
  const [importance, setImportance] = useState<Importance>(asset?.importance ?? 'important');
  const [controls, setControls] = useState<Record<string, ControlState>>(asset?.controls ?? Object.fromEntries(CONTROL_CATALOG.account.map((item) => [item.id, 'unknown'])));
  const [operatingSystem, setOperatingSystem] = useState<OperatingSystem>(asset?.operatingSystem ?? 'unknown');
  const [notes, setNotes] = useState(asset?.notes ?? ''); const [error, setError] = useState('');
  const changeKind = (next: AssetKind) => { setKind(next); setType(typeOptions[next][0].en); setControls(Object.fromEntries(CONTROL_CATALOG[next].map((control) => [control.id, 'unknown']))); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!name.trim()) { setError(tx(language, 'Add a short nickname.', '短い呼び名を入力してください。')); return; }
    if (looksLikeSecret(name) || looksLikeSecret(notes)) { setError(tx(language, 'This looks like an identifier or secret. Use a nickname and remove sensitive text.', '識別情報や秘密情報のようです。呼び名に置き換え、機密情報を削除してください。')); return; }
    const candidate = { id: asset?.id ?? crypto.randomUUID(), kind, type, name: name.trim(), importance, createdAt: asset?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), controls, controlEvidence: asset?.controlEvidence ?? {}, ...(kind === 'device' ? { operatingSystem } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) };
    const parsed = assetSchema.safeParse(candidate);
    if (!parsed.success) { setError(tx(language, 'Check the information and try again.', '入力内容を確認して、もう一度お試しください。')); return; }
    onSave(parsed.data);
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title"><header className="modal-header"><div><div className="eyebrow">{asset ? tx(language, 'ASSET DETAILS', '資産の詳細') : tx(language, 'ADD TO YOUR DIGITAL LIFE', 'デジタルライフに追加')}</div><h2 id="asset-modal-title">{asset ? tx(language, 'Review this item', '内容を確認') : tx(language, 'Add something', '新しい項目')}</h2></div><button className="icon-button" onClick={onClose} aria-label={tx(language, 'Close', '閉じる')}><X size={18} /></button></header>
    <form onSubmit={submit} className="asset-form"><label className="field-label">{tx(language, 'Category', 'カテゴリ')}<select value={kind} onChange={(event) => changeKind(event.target.value as AssetKind)}>{kinds.map((item) => <option value={item.id} key={item.id}>{tx(language, item.en, item.ja)}</option>)}</select></label>
      <div className="field-two"><label className="field-label">{tx(language, 'Type', '種類')}<select value={type} onChange={(event) => setType(event.target.value)}>{typeOptions[kind].map((item) => <option key={item.en} value={item.en}>{tx(language, item.en, item.ja)}</option>)}</select></label><label className="field-label">{tx(language, 'Importance', '重要度')}<select value={importance} onChange={(event) => setImportance(event.target.value as Importance)}>{IMPORTANCE.map((value) => <option key={value} value={value}>{importanceLabel(language, value)}</option>)}</select></label></div>
      {kind === 'device' && <label className="field-label">{tx(language, 'Operating system', 'オペレーティングシステム')}<select value={operatingSystem} onChange={(event) => setOperatingSystem(event.target.value as OperatingSystem)}><option value="unknown">{tx(language, 'Choose later', '後で選ぶ')}</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="ios">iPhone / iPad</option><option value="android">Android</option><option value="chromeos">ChromeOS</option><option value="ubuntu">Ubuntu</option><option value="other">{tx(language, 'Other', 'その他')}</option></select><small>{tx(language, 'Used only to show the right official setup guide.', '公式の設定ガイドを表示するためにのみ使用します。')}</small></label>}
      <label className="field-label">{tx(language, 'Friendly nickname', 'わかりやすい呼び名')}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder={tx(language, 'For example: Main email', '例：メインのメール')} /><small>{tx(language, 'Use an alias. Do not enter an email address, username, or document number.', '別名を使ってください。メールアドレス、ユーザー名、書類番号は入力しないでください。')}</small></label>
      <label className="field-label">{tx(language, 'Notes (optional)', 'メモ（任意）')}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={300} placeholder={tx(language, 'No secrets or recovery codes.', '秘密情報や復旧コードは入力しないでください。')} /><small className="warning-copy">{tx(language, 'This app never needs the actual secret. Keep notes general.', '秘密そのものは不要です。メモには一般的な情報だけを残してください。')}</small></label>
      <div className="control-editor"><div className="control-editor-heading"><h3>{tx(language, 'Protection check-in', '保護状況の確認')}</h3><p>{tx(language, 'Your answers are self-reported. Choose “verified” only after checking the setting.', '回答は自己申告です。設定を実際に確認してから「確認済み」を選んでください。')}</p></div>{CONTROL_CATALOG[kind].map((control) => <label className="control-row" key={control.id}><span>{tx(language, control.en, control.ja)}</span><select value={controls[control.id] ?? 'unknown'} onChange={(event) => setControls((old) => ({ ...old, [control.id]: event.target.value as ControlState }))}>{(['unknown', 'needs-improvement', 'implemented', 'verified', 'na'] as ControlState[]).map((state) => <option key={state} value={state}>{statusLabel(language, state)}</option>)}</select></label>)}</div>
      {error && <p className="error-message">{error}</p>}<footer className="modal-footer">{asset && <button className="button button-danger" type="button" onClick={() => onDelete(asset.id)}><Trash2 size={15} />{tx(language, 'Delete', '削除')}</button>}<span className="modal-footer-spacer" /><button className="button button-secondary" type="button" onClick={onClose}>{tx(language, 'Cancel', 'キャンセル')}</button><button className="button button-primary" type="submit">{tx(language, asset ? 'Save changes' : 'Add to inventory', asset ? '変更を保存' : '登録する')}<Check size={16} /></button></footer>
    </form></section></div>;
}

export function SecurityJourney({ data, language, findings, updateWorkflow }: PageProps) {
  const modules = [
    { id: 'know', title: tx(language, 'Know your digital life', 'デジタルライフを把握する'), text: tx(language, 'See the accounts, devices, and data that matter to you.', '大切なアカウント、端末、データを整理します。'), icon: GitBranch, items: [{ en: 'Add your important accounts', ja: '大切なアカウントを追加する' }, { en: 'List the devices you use every day', ja: '毎日使う端末を登録する' }, { en: 'Identify where important files are stored', ja: '大切なファイルの保存場所を確認する' }] },
    { id: 'identity', title: tx(language, 'Secure your identity', 'IDを守る'), text: tx(language, 'Protect the email and sign-in methods that connect everything.', 'さまざまなサービスにつながるメールと認証方法を守ります。'), icon: Fingerprint, items: [{ en: 'Review multi-factor authentication on primary email', ja: 'メインメールの多要素認証を確認する' }, { en: 'Check account recovery options', ja: 'アカウントの復旧方法を確認する' }, { en: 'Consider passkeys for critical accounts', ja: '重要アカウントでパスキーを検討する' }] },
    { id: 'devices', title: tx(language, 'Secure your devices', '端末を守る'), text: tx(language, 'Make lost, stolen, or outdated devices less risky.', '紛失、盗難、古い端末のリスクを減らします。'), icon: Laptop, items: [{ en: 'Confirm screen locks', ja: '画面ロックを確認する' }, { en: 'Review device encryption', ja: '端末の暗号化を確認する' }, { en: 'Enable automatic updates', ja: '自動更新を有効にする' }] },
    { id: 'data', title: tx(language, 'Protect your data', 'データを守る'), text: tx(language, 'Build backups you can actually restore.', '実際に復元できるバックアップを用意します。'), icon: HardDrive, items: [{ en: 'Choose an important data category', ja: '大切なデータを選ぶ' }, { en: 'Keep a separate backup copy', ja: '別の場所にバックアップを保管する' }, { en: 'Test restoring one small file', ja: '小さなファイルで復元を試す' }] },
    { id: 'network', title: tx(language, 'Secure your network', 'ネットワークを守る'), text: tx(language, 'Review the router and connections at home.', '自宅のルーターと接続を確認します。'), icon: Wifi, items: [{ en: 'Review router administrator access', ja: 'ルーター管理者のアクセスを確認する' }, { en: 'Check router update settings', ja: 'ルーターの更新設定を確認する' }, { en: 'Review guest and smart-device networks', ja: 'ゲスト用・スマート機器用ネットワークを確認する' }] },
    { id: 'privacy', title: tx(language, 'Protect your privacy', 'プライバシーを守る'), text: tx(language, 'Decide what you share and where.', '何をどこまで公開するか確認します。'), icon: Shield, items: [{ en: 'Review social profile visibility', ja: 'SNSプロフィールの公開範囲を見直す' }, { en: 'Check personal information exposure', ja: '個人情報の公開状況を確認する' }, { en: 'Set a reminder for privacy reviews', ja: 'プライバシー確認をリマインダーに設定する' }] },
    { id: 'incidents', title: tx(language, 'Prepare for incidents', 'インシデントに備える'), text: tx(language, 'Know what to do when a device or account is unavailable.', '端末やアカウントが使えないときの行動を整理します。'), icon: ShieldAlert, items: [{ en: 'Check your lost-phone plan', ja: 'スマートフォン紛失時の手順を確認する' }, { en: 'Review account compromise steps', ja: 'アカウント不正利用時の手順を確認する' }, { en: 'Know how to contact your service provider', ja: 'サービス提供元への連絡方法を確認する' }] },
    { id: 'habits', title: tx(language, 'Build steady habits', '定期的に見直す'), text: tx(language, 'Short check-ins keep your protections current.', '短い定期確認で保護状況を新しく保ちます。'), icon: Clock3, items: [{ en: 'Review overdue actions', ja: '期限を過ぎた項目を確認する' }, { en: 'Check for account security alerts', ja: 'アカウントのセキュリティ通知を確認する' }, { en: 'Schedule a monthly security review', ja: '月次セキュリティレビューを設定する' }] },
  ];
  const doneCount = modules.filter((module) => (data.workflowProgress[module.id]?.length ?? 0) >= 2).length;
  return <><PageHeading eyebrow={tx(language, 'YOUR GUIDED PATH', 'ガイド付きの道のり')} title={tx(language, 'Security journey', 'セキュリティの道のり')} description={tx(language, 'Eight practical modules turn a big topic into manageable steps.', '8つのテーマで、広いセキュリティ領域を取り組みやすい単位に分けます。')} /><div className="journey-overview"><div className="journey-overview-icon"><GitBranch size={25} /></div><div className="journey-overview-copy"><strong>{tx(language, 'Your path, at your pace', '自分のペースで進める')}</strong><span>{tx(language, `${doneCount} of ${modules.length} modules are underway. ${findings.length} checks are ready when you are.`, `${modules.length}テーマのうち${doneCount}件に着手しました。確認できる項目は${findings.length}件です。`)}</span></div><div className="journey-overview-count">{String(doneCount).padStart(2, '0')}<small>/{modules.length}</small></div></div>
    <div className="module-grid">{modules.map((module, index) => { const Icon = module.icon; const checks = data.workflowProgress[module.id] ?? []; const open = checks.length < 2; return <section key={module.id} className="module-card"><div className="module-card-head"><span className="module-number">{String(index + 1).padStart(2, '0')}</span><span className="module-icon"><Icon size={18} /></span><span className={`module-status ${open ? '' : 'complete'}`}>{open ? tx(language, 'In progress', '進行中') : tx(language, 'Good work', '確認済み')}</span></div><h2>{module.title}</h2><p>{module.text}</p><div className="module-tasks">{module.items.map((item, itemIndex) => { const id = `task-${itemIndex}`; const checked = checks.includes(id); return <label className="module-task" key={id}><input type="checkbox" checked={checked} onChange={() => { const next = checked ? checks.filter((entry) => entry !== id) : [...checks, id]; void updateWorkflow(module.id, next); }} /><span>{tx(language, item.en, item.ja)}</span></label>; })}</div><div className="module-footer"><span>{checks.length} / {module.items.length} {tx(language, 'steps', '項目')}</span>{module.id === 'incidents' && <Link to="/recovery" className="text-arrow">{tx(language, 'Open playbooks', '手順を見る')}<ArrowRight size={14} /></Link>}{module.id === 'know' && <Link to="/life" className="text-arrow">{tx(language, 'Open inventory', '資産を見る')}<ArrowRight size={14} /></Link>}{module.id === 'devices' && findings.some((item) => item.kind === 'device') && <Link to="/plan" className="text-arrow">{tx(language, 'Review checks', '確認する')}<ArrowRight size={14} /></Link>}</div></section>; })}</div>
    <section className="learning-section"><div className="section-heading"><div><div className="eyebrow">{tx(language, 'A LITTLE KNOWLEDGE', '知っておきたいこと')}</div><h2>{tx(language, 'Security, in plain language', 'セキュリティをやさしく理解')}</h2></div><BookOpen size={20} /></div><div className="learning-grid">{[
      [tx(language, 'Passkeys', 'パスキー'), tx(language, 'A sign-in method tied to your device. It is designed to resist fake sign-in pages.', '端末と結びついたログイン方法で、偽のログイン画面に強い設計です。')],
      [tx(language, 'MFA', '多要素認証'), tx(language, 'A second check beyond your password. Use a passkey, security key, or authenticator when available.', 'パスワードに加えて本人確認を行います。利用可能ならパスキー、セキュリティキー、認証アプリを使います。')],
      [tx(language, 'Backups', 'バックアップ'), tx(language, 'A backup matters when it is recent, separate, and possible to restore. Test a small file first.', '新しく、別に保管され、復元できるバックアップが大切です。まず小さなファイルで試します。')],
      [tx(language, 'Recovery paths', '復旧経路'), tx(language, 'Accounts often depend on a phone or email. Keep a second recovery route that does not rely on the same device.', 'アカウントの復旧は電話やメールに依存しがちです。同じ端末に頼らない予備経路を用意します。')],
    ].map(([title, text]) => <article className="learning-card" key={title}><span className="learning-icon"><BookOpen size={16} /></span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
  </>;
}

function ProtectionPlan({ language, findings, data, persist, onComplete }: PageProps) {
  const priorities: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
  const completed = data.actions.filter((action) => action.completedAt).length;
  const updateTask = async (finding: Finding, status: NonNullable<Dataset['actions'][number]['status']>) => {
    const now = new Date().toISOString();
    const old = data.actions.find((action) => action.id === finding.id);
    const record = { ...old, id: finding.id, status, updatedAt: now, completedAt: status === 'completed' ? now : undefined, titleEn: old?.titleEn ?? finding.title, titleJa: old?.titleJa ?? finding.title, assetName: finding.assetName };
    await persist({ ...data, actions: [record, ...data.actions.filter((action) => action.id !== finding.id)] });
  };
  return <><PageHeading eyebrow={tx(language, 'YOUR PRACTICAL NEXT STEPS', '実行できる次のステップ')} title={tx(language, 'Protection plan', '保護プラン')} description={tx(language, 'Understand what to do, why it matters, and how to check it worked.', '何をするか、なぜ大切か、どう確認するかを整理します。')} /><div className="plan-summary"><div className="plan-summary-icon"><CheckCircle2 size={23} /></div><div><strong>{tx(language, `${findings.length} open checks`, `確認待ち ${findings.length} 件`)}</strong><p>{tx(language, `${completed} completed improvements are part of your history. Mark a step verified after you confirm the setting yourself.`, `完了した改善は${completed}件です。設定を自分で確認してから「確認済み」にしてください。`)}</p></div></div>
    {findings.length === 0 ? <div className="plan-clear"><span><CheckCircle2 size={28} /></span><h2>{tx(language, 'Nothing needs your attention right now.', '今すぐ確認が必要な項目はありません。')}</h2><p>{tx(language, 'Add another asset, or return later for a quick security check-in.', '資産を追加するか、後で簡単なセキュリティ確認を行いましょう。')}</p></div> : priorities.map((priority) => { const group = findings.filter((item) => item.priority === priority); if (!group.length) return null; return <section className="plan-group" key={priority}><div className="plan-group-title"><h2>{tx(language, priority === 'high' ? 'Start here' : priority === 'medium' ? 'Next up' : 'When you have time', priority === 'high' ? 'まずここから' : priority === 'medium' ? '次に取り組む' : '時間があるときに')}</h2><span>{group.length}</span></div>{group.map((finding) => <ActionCard key={finding.id} finding={finding} language={language} depth={data.settings.explanationDepth} taskStatus={data.actions.find((action) => action.id === finding.id)?.status ?? ''} onStatus={(status) => void updateTask(finding, status)} onEdit={() => void onComplete(finding)} onComplete={() => void onComplete(finding)} />)}</section>; })}
    <div className="plan-disclaimer"><Shield size={16} /><span>{tx(language, 'Recommendations use your answers, selected asset importance, and recorded recovery links. Unknown answers create review tasks. Marking a task complete does not verify a setting; return to the checkup and confirm it yourself.', '提案は回答、選択した資産重要度、記録済みの復旧経路を使います。不明な回答は確認タスクになります。タスクを完了にしても設定の検証にはなりません。チェックアップに戻り、ご自身で確認してください。')}</span></div>
  </>;
}

function ActionCard({ finding, language, depth, taskStatus, onStatus, onEdit, onComplete }: { finding: Finding; language: Language; depth: Dataset['settings']['explanationDepth']; taskStatus: string; onStatus: (status: NonNullable<Dataset['actions'][number]['status']>) => void; onEdit: () => void; onComplete: () => void }) {
  return <article className="action-card"><div className="action-card-main"><PriorityPill language={language} priority={finding.priority} /><div className="action-card-title"><h3>{finding.title}</h3><span>{tx(language, 'For', '対象：')} {finding.assetName}</span></div></div><span className="effort-label"><Clock3 size={13} />{tx(language, `About ${finding.effortMinutes} minutes`, `約${finding.effortMinutes}分`)}</span><SecurityExplanation finding={finding} language={language} depth={depth} /><details className="action-steps"><summary>{tx(language, 'Steps to take', '実施手順')}</summary><div className="action-guidance"><div><span>01</span><p>{finding.how}</p></div><div><span>02</span><p>{finding.verify}</p></div></div></details><div className="action-card-footer"><button className="text-arrow" onClick={onEdit}>{tx(language, 'Review assessment', '評価を確認')}<ArrowRight size={14} /></button><label className="task-status-select"><span className="sr-only">{tx(language, 'Action status', 'タスクの状態')}</span><select value={taskStatus} onChange={(event) => event.target.value && onStatus(event.target.value as NonNullable<Dataset['actions'][number]['status']>)}><option value="">{tx(language, 'Track this step', '進行状況を記録')}</option><option value="in-progress">{tx(language, 'In progress', '対応中')}</option><option value="completed">{tx(language, 'Task completed', 'タスク完了')}</option><option value="remind-me-later">{tx(language, 'Remind me later', '後で確認')}</option><option value="not-applicable">{tx(language, 'Not applicable', '該当しない')}</option></select></label><Button variant="secondary" onClick={onComplete} icon={<ArrowRight size={15} />}>{tx(language, 'Guide me', '手順を見る')}</Button></div></article>;
}

type Playbook = { id: string; title: { en: string; ja: string }; summary: { en: string; ja: string }; steps: { en: string; ja: string }[] };
const playbooks: Playbook[] = [
  { id: 'lost-phone', title: { en: 'Lost or stolen smartphone', ja: 'スマートフォンを紛失・盗難' }, summary: { en: 'Protect your accounts, service, and personal data.', ja: 'アカウント、回線、個人データを守ります。' }, steps: [{ en: 'Use your device maker’s trusted service to mark it lost or lock it.', ja: '端末メーカーの公式サービスから紛失モードまたはロックを有効にする。' }, { en: 'Contact your mobile carrier to suspend the SIM if theft is suspected.', ja: '盗難の可能性があれば、携帯会社に連絡してSIMを停止する。' }, { en: 'From another trusted device, review email and password manager sessions.', ja: '別の信頼できる端末からメールとパスワードマネージャーのセッションを確認する。' }, { en: 'Change access for critical accounts if the lost phone could unlock them.', ja: '紛失した端末で重要アカウントに入れる場合はアクセス方法を変更する。' }, { en: 'Report theft to local authorities and your insurer if appropriate.', ja: '必要に応じて警察や保険会社に届け出る。' }] },
  { id: 'lost-laptop', title: { en: 'Lost or stolen laptop', ja: 'ノートPCを紛失・盗難' }, summary: { en: 'Reduce access to files and accounts from the device.', ja: '端末からのファイルやアカウントへのアクセスを減らします。' }, steps: [{ en: 'Use the platform’s trusted device service to lock or locate it.', ja: 'OS公式の端末サービスからロックや位置確認を行う。' }, { en: 'Revoke active sessions for email, cloud storage, and password manager.', ja: 'メール、クラウドストレージ、パスワードマネージャーのセッションを無効にする。' }, { en: 'Change critical account passwords if they may have been accessible.', ja: '重要アカウント情報が見られた可能性があれば認証情報を変更する。' }, { en: 'Contact your organization if it contains work data.', ja: '仕事のデータが含まれる場合は所属組織に連絡する。' }] },
  { id: 'email-compromise', title: { en: 'Compromised email account', ja: 'メールアカウントの不正利用' }, summary: { en: 'Secure the account that can reset many other accounts.', ja: '多くのアカウントを復旧できるメールを保護します。' }, steps: [{ en: 'Use a trusted device and the provider’s official recovery process.', ja: '信頼できる端末から、サービス提供元の公式復旧手続きを使う。' }, { en: 'Change the account password and sign out other sessions.', ja: 'アカウントのパスワードを変更し、他のセッションを終了する。' }, { en: 'Review recovery email, phone, forwarding, filters, and connected apps.', ja: '復旧用メール・電話、転送、フィルター、連携アプリを確認する。' }, { en: 'Secure important accounts that use this email for recovery.', ja: 'このメールを復旧先にしている重要アカウントも保護する。' }, { en: 'Enable a phishing-resistant sign-in method and check alerts.', ja: 'フィッシングに強い認証方法を設定し、通知を確認する。' }] },
  { id: 'social-compromise', title: { en: 'Compromised social account', ja: 'SNSアカウントの不正利用' }, summary: { en: 'Regain control and protect people who may receive messages.', ja: 'アカウントを取り戻し、連絡先の人も守ります。' }, steps: [{ en: 'Start recovery through the service’s official website or app.', ja: 'サービスの公式サイトまたはアプリから復旧を始める。' }, { en: 'Revoke sessions and remove unfamiliar connected apps.', ja: 'セッションを無効にし、知らない連携アプリを削除する。' }, { en: 'Warn close contacts through another channel about suspicious messages.', ja: '別の連絡手段で知人に不審メッセージへの注意を伝える。' }, { en: 'Review contact details and sign-in alerts.', ja: '登録連絡先とログイン通知を確認する。' }] },
  { id: 'malware', title: { en: 'Suspected malware', ja: 'マルウェア感染の疑い' }, summary: { en: 'Limit damage while protecting evidence and accounts.', ja: '被害を抑え、記録とアカウントを保護します。' }, steps: [{ en: 'Stop using the affected device for sensitive activity.', ja: '影響を受けた端末で重要な操作を続けない。' }, { en: 'Disconnect it from networks if it is behaving suspiciously.', ja: '不審な動作が続く場合はネットワークから切断する。' }, { en: 'From a separate trusted device, secure important accounts.', ja: '別の信頼できる端末から重要アカウントを保護する。' }, { en: 'Use your operating system’s built-in security tools or a trusted professional.', ja: 'OS標準のセキュリティ機能または信頼できる専門家に相談する。' }, { en: 'Preserve relevant messages and timestamps before resetting.', ja: '初期化する前に関連メッセージや時刻の記録を残す。' }] },
  { id: 'sim-swap', title: { en: 'Suspected SIM swap', ja: 'SIMスワップの疑い' }, summary: { en: 'Restore phone service and protect accounts that use SMS.', ja: '回線を取り戻し、SMSを使うアカウントを守ります。' }, steps: [{ en: 'Contact your carrier using a trusted number or visit a store.', ja: '信頼できる電話番号または店舗から携帯会社に連絡する。' }, { en: 'Ask the carrier to secure your account and restore your number.', ja: '回線アカウントを保護し、番号を戻すよう依頼する。' }, { en: 'Use a trusted device to review email, banking, and identity accounts.', ja: '信頼できる端末からメール、金融、本人確認アカウントを確認する。' }, { en: 'Replace SMS recovery with stronger methods where possible.', ja: '可能ならSMSによる復旧をより強い方法へ変更する。' }] },
  { id: 'lost-key', title: { en: 'Lost security key', ja: 'セキュリティキーを紛失' }, summary: { en: 'Use backup sign-in methods and review the accounts it protected.', ja: '予備の認証方法を使い、キーを登録していたアカウントを確認します。' }, steps: [{ en: 'Use a registered backup key or recovery method to sign in.', ja: '登録済みの予備キーまたは復旧方法でログインする。' }, { en: 'Remove the lost key from critical accounts.', ja: '重要アカウントから紛失したキーを削除する。' }, { en: 'Register a replacement and test it before removing any other method.', ja: '他の方法を削除する前に、交換用キーを登録して動作確認する。' }] },
  { id: 'password-manager', title: { en: 'Password manager concern', ja: 'パスワードマネージャーの問題' }, summary: { en: 'Use the provider’s recovery guidance and protect the vault.', ja: 'サービス提供元の復旧手順に従って保管庫を保護します。' }, steps: [{ en: 'Use the provider’s official guidance from a trusted device.', ja: '信頼できる端末からサービス提供元の公式手順を確認する。' }, { en: 'Secure the manager account and sign out other sessions.', ja: 'マネージャーのアカウントを保護し、他のセッションを終了する。' }, { en: 'Review account activity and any emergency access settings.', ja: 'アカウント履歴と緊急アクセス設定を確認する。' }, { en: 'Prioritize changing passwords for critical accounts if exposure is likely.', ja: '情報流出の可能性がある場合は、重要アカウントから認証情報を変更する。' }] },
  { id: 'data-leak', title: { en: 'Personal information leak', ja: '個人情報の漏えい' }, summary: { en: 'Reduce further exposure and watch for targeted scams.', ja: '追加の露出を抑え、狙いを定めた詐欺に注意します。' }, steps: [{ en: 'Identify what information and accounts may be affected.', ja: '影響を受けた情報とアカウントを確認する。' }, { en: 'Change affected passwords from a trusted device if needed.', ja: '必要に応じて信頼できる端末から該当アカウントのパスワードを変更する。' }, { en: 'Enable sign-in and financial alerts.', ja: 'ログイン通知と金融取引の通知を有効にする。' }, { en: 'Be alert for convincing messages that use the exposed information.', ja: '漏えい情報を使った巧妙な連絡に注意する。' }, { en: 'Follow official breach notices and local reporting guidance.', ja: '公式の漏えい通知や地域の報告手順を確認する。' }] },
  { id: 'data-loss', title: { en: 'Major data loss', ja: '大切なデータの消失' }, summary: { en: 'Protect remaining copies and restore carefully.', ja: '残っているコピーを守り、慎重に復元します。' }, steps: [{ en: 'Stop writing to the affected storage if recovery may be needed.', ja: '復旧の可能性がある場合、対象ストレージへの書き込みを止める。' }, { en: 'Check backup dates and restore to a separate location.', ja: 'バックアップの日付を確認し、別の場所に復元する。' }, { en: 'Avoid overwriting the only remaining copy.', ja: '残った唯一のコピーを上書きしない。' }, { en: 'If files may be encrypted by ransomware, disconnect affected devices and seek expert help.', ja: 'ランサムウェアによる暗号化の疑いがあれば端末を切断し、専門家に相談する。' }] },
];

function RecoveryCenter({ data, language, addDependency, deleteDependency, updateIncident }: PageProps) {
  const [formOpen, setFormOpen] = useState(false); const [accountId, setAccountId] = useState(''); const [recoveryId, setRecoveryId] = useState(''); const [relation, setRelation] = useState(''); const [simulation, setSimulation] = useState(''); const [activePlaybook, setActivePlaybook] = useState('');
  const accounts = data.assets.filter((asset) => asset.kind === 'account' || asset.kind === 'identity'); const recoveryAssets = data.assets.filter((asset) => asset.kind === 'device' || asset.kind === 'account' || asset.kind === 'identity');
  const dependents = data.dependencies.filter((item) => item.recoveryAssetId === simulation);
  const submitDependency = (event: FormEvent) => { event.preventDefault(); if (!accountId || !recoveryId || accountId === recoveryId) return; void addDependency(accountId, recoveryId, relation.trim()); setFormOpen(false); setAccountId(''); setRecoveryId(''); setRelation(''); };
  return <><PageHeading eyebrow={tx(language, 'BE READY BEFORE YOU NEED IT', '必要になる前に備える')} title={tx(language, 'Recovery & incidents', '復旧とインシデント')} description={tx(language, 'Map the paths back into your accounts and keep practical incident steps close.', 'アカウントへの復旧経路を整理し、いざというときの手順を用意します。')} action={<Button variant="secondary" onClick={() => downloadEmergencyPlan(data, language)} icon={<ArrowDownToLine size={15} />}>{tx(language, 'Export offline emergency plan', 'オフライン緊急計画を保存')}</Button>} />
    <div className="emergency-plan-note"><ShieldAlert size={16} /><span>{tx(language, 'The exported sheet contains security context. Store it separately from your main device. It never includes passwords, recovery codes, keys, or tokens.', 'エクスポートにはセキュリティ情報が含まれます。メイン端末とは別に保管してください。パスワード、復旧コード、鍵、トークンは含めません。')}</span></div>
    <section className="recovery-sim-card"><div className="recovery-sim-icon"><GitBranch size={22} /></div><div className="recovery-sim-copy"><div className="eyebrow">{tx(language, 'RECOVERY SIMULATION', '復旧シミュレーション')}</div><h2>{tx(language, 'What if this was unavailable?', 'これが使えなくなったら？')}</h2><p>{tx(language, 'Choose a phone, email, or identity. We will show accounts that rely on it for recovery.', '電話、メール、IDなどを選ぶと、それを復旧に使うアカウントを表示します。')}</p></div><select value={simulation} onChange={(event) => setSimulation(event.target.value)} aria-label={tx(language, 'Choose unavailable asset', '使えなくなった資産を選択')}><option value="">{tx(language, 'Choose an asset', '資産を選択')}</option>{recoveryAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></section>
    {simulation && <div className={`simulation-result ${dependents.length ? 'simulation-risk' : 'simulation-ok'}`}><span>{dependents.length ? <ShieldAlert size={19} /> : <CheckCircle2 size={19} />}</span><div><strong>{dependents.length ? tx(language, `${dependents.length} recovery path${dependents.length > 1 ? 's' : ''} ${dependents.length > 1 ? 'depend' : 'depends'} on this asset`, `この資産に依存する復旧経路が${dependents.length}件あります`) : tx(language, 'No linked recovery paths recorded', '登録済みの復旧経路はありません')}</strong><p>{dependents.length ? dependents.map((item) => data.assets.find((asset) => asset.id === item.assetId)?.name).filter(Boolean).join(', ') : tx(language, 'If this is important, add the account and its recovery method to your inventory.', '重要な資産であれば、アカウントと復旧方法を登録しましょう。')}</p></div></div>}
    <section className="dependency-section"><div className="section-heading"><div><div className="eyebrow">{tx(language, 'RECOVERY MAP', '復旧経路')}</div><h2>{tx(language, 'How your accounts connect', 'アカウント同士のつながり')}</h2></div><Button variant="secondary" onClick={() => setFormOpen(!formOpen)} icon={<Plus size={15} />}>{tx(language, 'Link a recovery path', '復旧経路を追加')}</Button></div>
      {formOpen && <form className="dependency-form" onSubmit={submitDependency}><label className="field-label">{tx(language, 'Account that needs recovery', '復旧したいアカウント')}<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">{tx(language, 'Choose an account', 'アカウントを選択')}</option>{accounts.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label><span className="dependency-arrow">→</span><label className="field-label">{tx(language, 'Recovery method it relies on', '復旧に使う方法')}<select required value={recoveryId} onChange={(event) => setRecoveryId(event.target.value)}><option value="">{tx(language, 'Choose a method', '方法を選択')}</option>{recoveryAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label><label className="field-label">{tx(language, 'Optional note', '補足（任意）')}<input value={relation} onChange={(event) => setRelation(event.target.value)} maxLength={80} placeholder={tx(language, 'For example: recovery email', '例：復旧用メール')} /></label><div className="dependency-form-actions"><button className="button button-secondary" type="button" onClick={() => setFormOpen(false)}>{tx(language, 'Cancel', 'キャンセル')}</button><button className="button button-primary" type="submit">{tx(language, 'Save path', '経路を保存')}</button></div></form>}
      {data.dependencies.length ? <div className="dependency-list">{data.dependencies.map((item) => <div className="dependency-row" key={item.id}><span className="dependency-node"><KeyRound size={15} /></span><strong>{data.assets.find((asset) => asset.id === item.assetId)?.name ?? tx(language, 'Removed asset', '削除済み資産')}</strong><ArrowRight size={16} /><span className="dependency-node node-secondary"><Smartphone size={15} /></span><span>{data.assets.find((asset) => asset.id === item.recoveryAssetId)?.name ?? tx(language, 'Removed method', '削除済み方法')}</span>{item.relation && <small>{item.relation}</small>}<button className="icon-button danger-icon" onClick={() => void deleteDependency(item.id)} aria-label={tx(language, 'Remove path', '経路を削除')}><Trash2 size={15} /></button></div>)}</div> : <p className="muted-copy">{tx(language, 'No recovery paths have been added yet. Start with your main email and the method you would use if locked out.', '復旧経路はまだありません。メインのメールと、ロックされたときに使う方法から登録しましょう。')}</p>}
    </section>
    <section className="playbook-section"><div className="section-heading"><div><div className="eyebrow">{tx(language, 'INCIDENT CENTER', 'インシデントセンター')}</div><h2>{tx(language, 'Practical playbooks', 'いざというときの手順')}</h2><p>{tx(language, 'These steps stay available before your inventory is complete.', '資産登録が終わっていなくても、ここから手順を確認できます。')}</p></div><span className="playbook-count">{playbooks.length} {tx(language, 'guides', '件')}</span></div><div className="playbook-list">{playbooks.map((playbook) => { const open = activePlaybook === playbook.id; const checked = data.incidentProgress[playbook.id] ?? []; const title = language === 'ja' ? playbook.title.ja : playbook.title.en; return <article className={`playbook-card ${open ? 'open' : ''}`} key={playbook.id}><button className="playbook-head" onClick={() => setActivePlaybook(open ? '' : playbook.id)}><span className="playbook-symbol"><ShieldAlert size={17} /></span><span className="playbook-title"><strong>{title}</strong><small>{language === 'ja' ? playbook.summary.ja : playbook.summary.en}</small></span><span className="playbook-progress">{checked.length}/{playbook.steps.length}</span>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>{open && <div className="playbook-body"><p className="playbook-disclaimer">{tx(language, 'Use trusted devices and official service channels. This checklist is general guidance, not a live incident response service.', '信頼できる端末とサービス公式の窓口を使ってください。このチェックリストは一般的な案内であり、リアルタイムの対応サービスではありません。')}</p>{playbook.steps.map((step, index) => { const id = `${playbook.id}-${index}`; return <label className="playbook-step" key={id}><input type="checkbox" checked={checked.includes(id)} onChange={() => { const next = checked.includes(id) ? checked.filter((item) => item !== id) : [...checked, id]; void updateIncident(playbook.id, next); }} /><span>{language === 'ja' ? step.ja : step.en}</span></label>; })}<button className="button button-ghost reset-checklist" onClick={() => void updateIncident(playbook.id, [])}>{tx(language, 'Reset checklist', 'チェックをリセット')}</button></div>}</article>; })}</div></section>
  </>;
}

function downloadEmergencyPlan(data: Dataset, language: Language) {
  const categories: [AssetKind, string, string][] = [
    ['device', 'Devices', '端末'], ['account', 'Critical accounts', '重要アカウント'], ['backup', 'Backup methods', 'バックアップ'],
    ['network', 'Home network', 'ホームネットワーク'], ['identity', 'Identity services', 'デジタルID'],
  ];
  const content = [
    tx(language, 'PERSONAL CYBERSECURITY OS — OFFLINE EMERGENCY PLAN', 'PERSONAL CYBERSECURITY OS — オフライン緊急計画'),
    tx(language, 'This sheet contains sensitive security context. Store it securely and separately from your main device.', 'この用紙には機微なセキュリティ情報が含まれます。メイン端末とは別に安全に保管してください。'),
    tx(language, 'It does not contain passwords, recovery codes, private keys, authentication tokens, or seed phrases.', 'パスワード、復旧コード、秘密鍵、認証トークン、シードフレーズは含みません。'),
    '', tx(language, 'YOUR PREPARATION SUMMARY', '事前準備の概要'),
    ...categories.map(([kind, en, ja]) => `${language === 'ja' ? ja : en}: ${data.assets.filter((asset) => asset.kind === kind).length}`),
    `${tx(language, 'Recorded recovery paths', '登録済み復旧経路')}: ${data.dependencies.length}`,
    '', tx(language, 'IF YOUR LAPTOP IS STOLEN', 'ノートPCを盗まれた場合'),
    tx(language, '1. From another trusted device, use the device maker’s official service to lock it if available.', '1. 別の信頼できる端末から、端末メーカー公式のロック機能があれば使用します。'),
    tx(language, '2. Secure your primary email and password manager through their official recovery pages.', '2. メインメールとパスワードマネージャーを公式の復旧手順で保護します。'),
    tx(language, '3. Revoke sessions that may have been active on the missing device.', '3. 紛失端末で使われていた可能性のあるセッションを無効にします。'),
    tx(language, '4. Contact your organization or carrier if work data or mobile service is involved.', '4. 仕事のデータや携帯回線が関係する場合は、所属先や通信会社へ連絡します。'),
    '', tx(language, 'IF A DEVICE MAY BE COMPROMISED', '端末が侵害された可能性がある場合'),
    tx(language, '1. Stop using it for sensitive account recovery. Assessments on a compromised device may not be trustworthy.', '1. 機密性の高いアカウント復旧には使いません。侵害された端末上の検査結果は信頼できない場合があります。'),
    tx(language, '2. Use a separate trusted device to secure important accounts through official provider channels.', '2. 別の信頼できる端末から公式窓口を使い、重要なアカウントを保護します。'),
    tx(language, '3. Preserve relevant notices and timestamps. Avoid destructive cleanup until you understand recovery needs.', '3. 関係する通知と時刻を記録します。復旧の見通しが立つ前に破壊的な初期化をしないでください。'),
    '', tx(language, 'IF YOUR PRIMARY EMAIL OR PASSWORD MANAGER IS COMPROMISED', 'メインメールまたはパスワードマネージャーが侵害された場合'),
    tx(language, '1. Start recovery from the provider’s official website or app using a trusted device.', '1. 信頼できる端末でサービス公式サイトまたはアプリを開き、復旧を始めます。'),
    tx(language, '2. Review recovery methods, active sessions, forwarding rules, and connected applications.', '2. 復旧方法、ログイン中の端末、転送設定、連携アプリを確認します。'),
    tx(language, '3. Secure accounts that depend on the compromised account for recovery.', '3. そのアカウントを復旧先にしている他のアカウントも保護します。'),
    '', tx(language, 'IF IMPORTANT DATA IS LOST', '大切なデータを失った場合'),
    tx(language, '1. Avoid writing new data to the affected storage if recovery may be needed.', '1. 復旧が必要なら、影響を受けた保存先へ新しいデータを書き込まないようにします。'),
    tx(language, '2. Locate the separate backup method recorded in your own secure records.', '2. 自分の安全な記録を使って、別に保管したバックアップを探します。'),
    tx(language, '3. Restore a copy to a separate location and verify it before replacing originals.', '3. 元データを置き換える前に、別の場所へ複製を復元して確認します。'),
    '', tx(language, 'Use official provider support reached through a known bookmark or printed contact method. This plan is general guidance, not a live incident-response service.', '公式サポートへは既知のブックマークや印刷した連絡先からアクセスします。この計画は一般的な案内であり、リアルタイム対応サービスではありません。'),
  ].join('\n');
  const confirmText = language === 'ja'
    ? '資産のカテゴリ件数と一般的な復旧手順を含むテキストを保存します。秘密情報は含みませんが、このファイルも安全に保管してください。'
    : 'Export a text sheet with asset category counts and general recovery steps. It contains no secrets, but still needs secure storage.';
  if (!window.confirm(confirmText)) return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `personal-cyber-os-emergency-plan-${new Date().toISOString().slice(0, 10)}.txt`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProgressPage({ data, language, findings, addReview }: PageProps) {
  const summary = controlsSummary(data.assets); const overallAssessed = summary.total ? summary.coverage : 0;
  const groups = (['account', 'device', 'backup', 'network', 'identity'] as AssetKind[]).map((kind) => {
    const assets = data.assets.filter((asset) => asset.kind === kind); const controls = assets.flatMap((asset) => Object.values(asset.controls)); const assessed = controls.filter((status) => status !== 'unknown').length;
    return { kind, count: assets.length, total: controls.length, assessed, percent: controls.length ? Math.round(assessed / controls.length * 100) : 0 };
  });
  const completed = data.actions.filter((item) => item.completedAt).length;
  const printReport = () => window.print();
  return <><PageHeading eyebrow={tx(language, 'YOUR SECURITY OVER TIME', 'セキュリティの変化')} title={tx(language, 'Progress', '進捗')} description={tx(language, 'Track what you have reviewed, improved, and still want to understand.', '確認したこと、改善したこと、これから知りたいことを記録します。')} action={<Button variant="secondary" onClick={printReport} icon={<ArrowDownToLine size={16} />}>{tx(language, 'Print private report', 'レポートを印刷')}</Button>} />
    <div className="progress-highlight"><div className="progress-highlight-copy"><div className="eyebrow">{tx(language, 'INVENTORY COVERAGE', '評価のカバー率')}</div><h2>{tx(language, `${overallAssessed}% of listed controls have an answer`, `登録済みコントロールの${overallAssessed}%を評価`)}</h2><p>{tx(language, 'This is a coverage measure, not a security score. “Not assessed” stays visible until you review it.', 'これは評価のカバー率であり、安全性のスコアではありません。「未評価」は確認するまで未評価のままです。')}</p></div><div className="coverage-ring" style={{ '--coverage': `${overallAssessed}%` } as React.CSSProperties}><div><strong>{overallAssessed}<small>%</small></strong><span>{tx(language, 'reviewed', '評価済み')}</span></div></div></div>
    <div className="progress-metrics"><article><span className="metric-icon icon-green"><GitBranch size={17} /></span><strong>{data.assets.length}</strong><span>{tx(language, 'assets in inventory', '登録した資産')}</span></article><article><span className="metric-icon icon-blue"><CheckCircle2 size={17} /></span><strong>{summary.verified}</strong><span>{tx(language, 'user-verified controls', '本人が確認した項目')}</span></article><article><span className="metric-icon icon-orange"><CircleHelp size={17} /></span><strong>{findings.length}</strong><span>{tx(language, 'open recommendations', '未完了の提案')}</span></article><article><span className="metric-icon icon-purple"><Check size={17} /></span><strong>{completed}</strong><span>{tx(language, 'improvements completed', '完了した改善')}</span></article></div>
    <section className="progress-section"><div className="section-heading"><div><div className="eyebrow">{tx(language, 'BY CATEGORY', 'カテゴリごと')}</div><h2>{tx(language, 'What you have looked at', '確認できた範囲')}</h2></div><span className="self-report-label"><span className="status-dot" />{tx(language, 'Self-reported', '自己申告')}</span></div><div className="category-progress">{groups.map((group) => <div className="category-progress-row" key={group.kind}><span>{tx(language, KIND_LABELS[group.kind].en, KIND_LABELS[group.kind].ja)}</span><div className="progress-track"><span style={{ width: `${group.percent}%` }} /></div><strong>{group.percent}%</strong><small>{group.count} {tx(language, 'assets', '件')}</small></div>)}</div></section>
    <section className="review-section"><div><div className="eyebrow">{tx(language, 'BUILD A STEADY HABIT', '定期的な確認')}</div><h2>{tx(language, 'A short check-in goes a long way.', '短い見直しを習慣に')}</h2><p>{tx(language, 'Review account alerts, updates, backups, and any recovery changes.', 'アカウント通知、更新、バックアップ、復旧方法の変更を見直します。')}</p></div><div className="review-actions"><Button variant="secondary" onClick={() => void addReview('weekly')} icon={<Clock3 size={16} />}>{tx(language, 'Log weekly check-in', '週次確認を記録')}</Button><Button variant="primary" onClick={() => void addReview('monthly')} icon={<Check size={16} />}>{tx(language, 'Complete monthly review', '月次レビューを完了')}</Button></div></section>
    <section className="history-section"><div className="section-heading"><div><div className="eyebrow">{tx(language, 'YOUR HISTORY', '記録')}</div><h2>{tx(language, 'Security check-ins', 'セキュリティ確認')}</h2></div></div>{data.reviews.length ? <div className="review-history">{data.reviews.map((review) => <div key={review.id} className="review-history-row"><span className="check-round"><Check size={13} /></span><strong>{tx(language, review.kind === 'weekly' ? 'Weekly check-in' : 'Monthly security review', review.kind === 'weekly' ? '週次確認' : '月次セキュリティレビュー')}</strong><time>{new Date(review.completedAt).toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium' })}</time></div>)}</div> : <p className="muted-copy">{tx(language, 'Your completed reviews will appear here.', '完了したレビューがここに表示されます。')}</p>}</section>
    <p className="report-footnote">{tx(language, 'Report note: account and recovery assessments are self-reported or manually confirmed. This app does not inspect devices or external accounts.', 'レポート注記：アカウントや復旧の評価は自己申告または手動確認です。このアプリは端末や外部アカウントを検査しません。')}</p>
  </>;
}

function SettingsPage({ data, language, persist, onLanguage, onLock, onPassphrase, onReset, onRestore, onNotice, envelope, isDemo }: PageProps & {
  onLanguage: (language: Language) => void; onLock: () => void; onPassphrase: (passphrase: string) => Promise<void>;
  onReset: () => Promise<void>; onRestore: (file: File, passphrase: string) => Promise<void>; onNotice: (notice: Notice) => void;
  envelope: Awaited<ReturnType<typeof readEnvelope>>; isDemo: boolean;
}) {
  const [newPass, setNewPass] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [restoreFile, setRestoreFile] = useState<File | null>(null); const [restorePass, setRestorePass] = useState('');
  const changePass = async (event: FormEvent) => { event.preventDefault(); setError(''); if (newPass.length < 10) { setError(tx(language, 'Use at least 10 characters.', '10文字以上にしてください。')); return; } if (newPass !== confirm) { setError(tx(language, 'The passphrases do not match.', 'パスフレーズが一致しません。')); return; } try { await onPassphrase(newPass); setNewPass(''); setConfirm(''); onNotice({ kind: 'success', text: tx(language, 'Your vault has been re-encrypted with the new passphrase.', '新しいパスフレーズで保管庫を再暗号化しました。') }); } catch { setError(tx(language, 'Could not update the passphrase.', 'パスフレーズを変更できませんでした。')); } };
  const importBackup = async () => { if (!restoreFile || !restorePass) { setError(tx(language, 'Choose a backup and enter its passphrase.', 'バックアップとパスフレーズを入力してください。')); return; } if (!window.confirm(tx(language, 'Replace the current local vault with this backup?', '現在のローカル保管庫をこのバックアップで置き換えますか？'))) return; try { await onRestore(restoreFile, restorePass); setRestoreFile(null); setRestorePass(''); setError(''); onNotice({ kind: 'success', text: tx(language, 'Encrypted backup restored.', '暗号化バックアップを復元しました。') }); } catch { setError(tx(language, 'The backup could not be opened. Check the passphrase and file.', 'バックアップを開けません。パスフレーズとファイルを確認してください。')); } };
  const erase = async () => { if (window.confirm(tx(language, 'Permanently delete the encrypted vault from this browser? Export a backup first if you may need this information.', 'このブラウザーの暗号化保管庫を完全に削除しますか？必要な情報は事前にバックアップしてください。'))) await onReset(); };
  return <><PageHeading eyebrow={tx(language, 'YOUR DEVICE, YOUR CHOICES', '端末と設定')} title={tx(language, 'Settings', '設定')} description={tx(language, 'Manage the local vault, language, and privacy controls.', 'ローカル保管庫、言語、プライバシー設定を管理します。')} />
    <section className="settings-card"><div className="settings-card-icon"><GlobeSymbol /></div><div className="settings-card-content"><h2>{tx(language, 'Language, appearance, and guidance', '言語、外観、表示')}</h2><p>{tx(language, 'Choose your language, theme, and level of detail.', '言語、テーマ、情報量を選択します。')}</p><div className="settings-fields"><label className="field-label">{tx(language, 'Language', '言語')}<select value={language} onChange={(event) => onLanguage(event.target.value as Language)}>{LANGUAGES.map((item) => <option value={item} key={item}>{item === 'ja' ? '日本語' : 'English'}</option>)}</select></label><label className="field-label">{tx(language, 'Appearance', '外観')}<select value={data.settings.theme} onChange={(event) => void persist({ ...data, settings: { ...data.settings, theme: event.target.value as 'light' | 'dark' } })}><option value="light">{tx(language, 'Light', 'ライト')}</option><option value="dark">{tx(language, 'Dark', 'ダーク')}</option></select></label><label className="field-label">{tx(language, 'Interface detail', '表示の詳しさ')}<select value={data.settings.mode} onChange={(event) => void persist({ ...data, settings: { ...data.settings, mode: event.target.value as 'guided' | 'advanced' } })}><option value="guided">{tx(language, 'Guided mode', 'ガイドモード')}</option><option value="advanced">{tx(language, 'Advanced detail', '詳細表示')}</option></select></label><label className="field-label">{tx(language, 'Explanation depth', '解説の詳しさ')}<select value={data.settings.explanationDepth} onChange={(event) => void persist({ ...data, settings: { ...data.settings, explanationDepth: event.target.value as Dataset['settings']['explanationDepth'] } })}><option value="action">{tx(language, 'Action first', '操作を優先')}</option><option value="why">{tx(language, 'Include why', '理由も表示')}</option><option value="technical">{tx(language, 'Technical detail', '技術的な解説')}</option></select></label><label className="field-label">{tx(language, 'Guidance profile', 'セキュリティ指針')}<select value={data.settings.threatProfile} onChange={(event) => void persist({ ...data, settings: { ...data.settings, threatProfile: event.target.value as Dataset['settings']['threatProfile'] } })}><option value="essential">{tx(language, 'Essential personal security', '基本的な個人保護')}</option><option value="advanced">{tx(language, 'Advanced personal security', '高度な個人保護')}</option><option value="high-assurance">{tx(language, 'High-assurance guidance', '高い保証を重視')}</option></select></label><label className="field-label">{tx(language, 'Checkup reminder interval', '診断の見直し間隔')}<select value={data.settings.reviewIntervalDays} onChange={(event) => void persist({ ...data, settings: { ...data.settings, reviewIntervalDays: Number(event.target.value) as Dataset['settings']['reviewIntervalDays'] } })}><option value={30}>{tx(language, 'Monthly', '毎月')}</option><option value={90}>{tx(language, 'Quarterly', '3か月ごと')}</option><option value={180}>{tx(language, 'Every six months', '6か月ごと')}</option></select></label></div><p className="settings-hint">{tx(language, 'Guidance profiles are not certifications or guarantees. Review dates are suggestions; the app does not send notifications.', 'セキュリティ指針は認証や安全の保証ではありません。見直し日は目安で、アプリから通知は送られません。')}</p></div></section>
    <section className="settings-card"><div className="settings-card-icon"><Clock3 size={19} /></div><div className="settings-card-content"><h2>{tx(language, 'Automatic lock', '自動ロック')}</h2><p>{tx(language, 'Lock the decrypted workspace after a period of inactivity.', '操作がない状態が続いたら、復号済みのワークスペースをロックします。')}</p><label className="field-label narrow-field">{tx(language, 'Lock after', 'ロックまでの時間')}<select value={data.settings.autoLockMinutes} onChange={(event) => void persist({ ...data, settings: { ...data.settings, autoLockMinutes: Number(event.target.value) } })}>{[1, 5, 10, 15, 30, 60].map((minute) => <option value={minute} key={minute}>{minute} {tx(language, 'minutes', '分')}</option>)}</select></label><Button variant="secondary" onClick={onLock} icon={<LockKeyhole size={15} />}>{tx(language, 'Lock now', '今すぐロック')}</Button></div></section>
    <section className="settings-card"><div className="settings-card-icon"><KeyRound size={19} /></div><div className="settings-card-content"><h2>{tx(language, 'Change app passphrase', 'アプリ用パスフレーズを変更')}</h2><p>{tx(language, 'A new passphrase re-encrypts your entire vault with a new salt.', '新しいパスフレーズで保管庫全体を新しいソルトとともに再暗号化します。')}</p><form className="passphrase-form" onSubmit={changePass}><label className="field-label">{tx(language, 'New app passphrase', '新しいパスフレーズ')}<input type="password" autoComplete="new-password" value={newPass} onChange={(event) => setNewPass(event.target.value)} /></label><label className="field-label">{tx(language, 'Confirm new passphrase', '新しいパスフレーズを再入力')}<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><Button type="submit" variant="secondary" icon={<Check size={15} />}>{tx(language, 'Update passphrase', 'パスフレーズを更新')}</Button></form></div></section>
    <section className="settings-card"><div className="settings-card-icon"><HardDrive size={19} /></div><div className="settings-card-content"><h2>{tx(language, 'Encrypted backup', '暗号化バックアップ')}</h2><p>{tx(language, 'Export the encrypted vault or restore it on another clean browser. The backup still needs your passphrase.', '暗号化保管庫をエクスポートし、別のブラウザーで復元できます。復元にはパスフレーズが必要です。')}</p><div className="backup-actions"><Button variant="secondary" disabled={!envelope || isDemo} onClick={() => envelope && downloadEncryptedBackup(envelope)} icon={<ArrowDownToLine size={15} />}>{tx(language, 'Download encrypted backup', '暗号化バックアップを保存')}</Button><input className="backup-file-input" type="file" accept="application/json,.json" onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} aria-label={tx(language, 'Choose backup file', 'バックアップファイルを選択')} /><input className="backup-pass-input" type="password" placeholder={tx(language, 'Backup passphrase', 'バックアップのパスフレーズ')} value={restorePass} onChange={(event) => setRestorePass(event.target.value)} autoComplete="new-password" /><Button variant="secondary" disabled={!restoreFile || !restorePass} onClick={importBackup} icon={<ArrowRight size={15} />}>{tx(language, 'Restore and replace', '復元して置き換え')}</Button></div>{isDemo && <p className="muted-copy">{tx(language, 'Sample data is in memory only. Exit demo to access vault settings.', 'サンプルデータはメモリ内のみです。デモを終了すると保管庫設定が使えます。')}</p>}</div></section>
    {error && <p className="error-message">{error}</p>}
    <section className="settings-security-note"><ShieldCheck size={20} /><div><strong>{tx(language, 'Local-first by design', 'ローカルファースト設計')}</strong><p>{tx(language, 'No analytics, no cloud sync, no external scripts, and no account credentials. App data is encrypted in IndexedDB while locked.', '分析、クラウド同期、外部スクリプト、アカウント認証情報はありません。ロック中のアプリデータはIndexedDB内で暗号化されています。')}</p></div></section>
    <section className="danger-zone"><div><div className="eyebrow">{tx(language, 'PERMANENT ACTION', '取り消せない操作')}</div><h2>{tx(language, 'Delete local data', 'ローカルデータを削除')}</h2><p>{tx(language, 'This removes the encrypted vault from this browser. Keep a backup first if you may need it.', 'このブラウザーから暗号化保管庫を削除します。必要な場合は先にバックアップを保存してください。')}</p></div><Button variant="danger" onClick={() => void erase()} icon={<Trash2 size={15} />}>{tx(language, 'Delete vault', '保管庫を削除')}</Button></section>
    <p className="version-footnote">{tx(language, 'Personal Cybersecurity OS · Local workspace · On-demand checkups only', 'Personal Cybersecurity OS · ローカルワークスペース · オンデマンド検査のみ')}</p>
  </>;
}
function GlobeSymbol() { return <span className="globe-symbol">あ<br />A</span>; }
