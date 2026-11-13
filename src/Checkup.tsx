import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleHelp, ExternalLink, Laptop, LockKeyhole, ShieldCheck } from 'lucide-react';
import { CHECKUP_CONTROLS, CHECKUP_DOMAINS, controlKey, localized, OS_UPDATE_GUIDES } from './checkupCatalog';
import type { CheckupControl, CheckupDomainId } from './checkupCatalog';
import type { AssessmentAnswer, Asset, ControlState, Dataset, Language, OperatingSystem } from './models';

const tx = (language: Language, en: string, ja: string) => language === 'ja' ? ja : en;
const answerOptions: { id: AssessmentAnswer['response']; en: string; ja: string }[] = [
  { id: 'yes', en: 'Yes', ja: 'はい' }, { id: 'no', en: 'No', ja: 'いいえ' },
  { id: 'unsure', en: 'Not sure', ja: 'わからない' }, { id: 'not-applicable', en: 'Not applicable', ja: '該当しない' },
];
const osNames: Record<OperatingSystem, [string, string]> = {
  windows: ['Windows', 'Windows'], macos: ['macOS', 'macOS'], ubuntu: ['Ubuntu', 'Ubuntu'], ios: ['iPhone / iPad', 'iPhone / iPad'],
  android: ['Android', 'Android'], chromeos: ['ChromeOS', 'ChromeOS'], other: ['Other OS', 'その他のOS'], unknown: ['Choose an operating system', 'OSを選択'],
};

type Props = { data: Dataset; language: Language; persist: (next: Dataset) => Promise<void> };
type Entry = { control: CheckupControl; asset?: Asset; key: string };

export function CheckupPage({ data, language, persist }: Props) {
  const [searchParams] = useSearchParams();
  const validDomain = (value: string | null): value is CheckupDomainId => CHECKUP_DOMAINS.some((domain) => domain.id === value);
  const [activeDomain, setActiveDomain] = useState<CheckupDomainId>(() => {
    const requested = searchParams.get('domain');
    if (validDomain(requested)) return requested;
    return validDomain(data.checkupProgress.activeDomain) ? data.checkupProgress.activeDomain : 'identity';
  });
  const [localOs, setLocalOs] = useState<Record<string, OperatingSystem>>({});
  const allEntries = useMemo<Entry[]>(() => CHECKUP_CONTROLS.flatMap((control): Entry[] => {
    const assets = control.assetKind ? data.assets.filter((asset) => asset.kind === control.assetKind) : [];
    return assets.length ? assets.map((asset) => ({ control, asset, key: controlKey(control.id, asset.id) })) : [{ control, asset: undefined, key: control.id }];
  }), [data.assets]);
  const entries = allEntries.filter((entry) => entry.control.domain === activeDomain);
  const answeredCount = allEntries.filter((entry) => Boolean(data.assessmentAnswers[entry.key] ?? (!entry.asset ? data.assessmentAnswers[entry.control.id] : undefined))).length;
  const currentDomainIndex = CHECKUP_DOMAINS.findIndex((domain) => domain.id === activeDomain);
  const domainEntries = CHECKUP_DOMAINS.map((domain) => {
    const questions = allEntries.filter((entry) => entry.control.domain === domain.id);
    return { ...domain, count: questions.length, answered: questions.filter((entry) => Boolean(data.assessmentAnswers[entry.key] ?? (!entry.asset ? data.assessmentAnswers[entry.control.id] : undefined))).length };
  });

  useEffect(() => {
    const requested = searchParams.get('domain');
    if (validDomain(requested)) setActiveDomain(requested);
    const question = searchParams.get('question');
    if (question) window.setTimeout(() => Array.from(document.querySelectorAll<HTMLElement>('[data-control-id]')).find((element) => element.dataset.controlId === question)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [searchParams]);

  const goToDomain = async (domain: CheckupDomainId) => {
    setActiveDomain(domain);
    await persist({ ...data, checkupProgress: { ...data.checkupProgress, activeDomain: domain, startedAt: data.checkupProgress.startedAt ?? new Date().toISOString() } });
  };

  const saveAnswer = async (entry: Entry, response: AssessmentAnswer['response'], evidence: AssessmentAnswer['evidence'] = 'user-reported') => {
    const now = new Date().toISOString();
    const answer: AssessmentAnswer = { response, evidence, updatedAt: now };
    const assessmentAnswers = { ...data.assessmentAnswers, [entry.key]: answer };
    const evidenceForAsset: Asset['controlEvidence'][string] = response === 'not-applicable' ? 'not-applicable' : response === 'unsure' ? 'unknown' : evidence;
    const assets = entry.asset && entry.control.assetControl ? data.assets.map((asset) => asset.id !== entry.asset?.id ? asset : {
      ...asset, updatedAt: now,
      controls: { ...asset.controls, [entry.control.assetControl as string]: responseToState(response) },
      controlEvidence: { ...asset.controlEvidence, [entry.control.assetControl as string]: evidenceForAsset },
    }) : data.assets;
    const nowAnswered = allEntries.every((item) => item.key === entry.key || Boolean(assessmentAnswers[item.key] ?? (!item.asset ? assessmentAnswers[item.control.id] : undefined)));
    await persist({
      ...data, assets, assessmentAnswers,
      checkupProgress: { ...data.checkupProgress, activeDomain, startedAt: data.checkupProgress.startedAt ?? now, ...(nowAnswered ? { lastCompletedAt: now } : {}) },
    });
  };

  const saveOperatingSystem = async (entry: Entry, os: OperatingSystem) => {
    if (!entry.asset) { setLocalOs((current) => ({ ...current, [entry.key]: os })); return; }
    await persist({ ...data, assets: data.assets.map((asset) => asset.id === entry.asset?.id ? { ...asset, operatingSystem: os, updatedAt: new Date().toISOString() } : asset) });
  };

  const nextDomain = CHECKUP_DOMAINS[currentDomainIndex + 1]?.id;
  const previousDomain = CHECKUP_DOMAINS[currentDomainIndex - 1]?.id;
  const domain = CHECKUP_DOMAINS[currentDomainIndex];

  return <div className="checkup-page">
    <div className="page-heading"><div><div className="eyebrow">{tx(language, 'GUIDED · PRIVATE · ON YOUR TERMS', 'ガイド付き・プライベート・自分のペースで')}</div><h1>{tx(language, 'Security Checkup', 'セキュリティチェックアップ')}</h1><p>{tx(language, 'Review six parts of your digital life. Your answers stay in this encrypted browser vault.', 'デジタルライフの6領域を確認します。回答はこのブラウザーの暗号化保管庫に保存されます。')}</p></div></div>
    <div className="checkup-privacy-note"><LockKeyhole size={17} /><span>{tx(language, 'This app does not inspect your devices, accounts, network, or installed software. “Yes” means you reported or personally confirmed it.', 'このアプリは端末、アカウント、ネットワーク、インストール済みソフトを検査しません。「はい」はご本人の申告または確認として記録されます。')}</span></div>
    <div className="checkup-overview"><article><span>{tx(language, 'Controls reviewed', '確認した項目')}</span><strong>{answeredCount}<small> / {allEntries.length}</small></strong></article><article><span>{tx(language, 'Needs attention', '確認・対応が必要')}</span><strong>{allEntries.filter((entry) => ['no', 'unsure'].includes(data.assessmentAnswers[entry.key]?.response ?? '')).length}</strong></article><article><span>{tx(language, 'Still unknown', '未評価・不明')}</span><strong>{allEntries.length - answeredCount}</strong></article></div>
    <nav className="checkup-domain-nav" aria-label={tx(language, 'Checkup domains', '診断領域')}>
      {domainEntries.map((item, index) => <button key={item.id} className={`checkup-domain-tab ${item.id === activeDomain ? 'active' : ''}`} onClick={() => void goToDomain(item.id)} aria-current={item.id === activeDomain ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span><strong>{localized(item.title, language)}</strong><small>{item.answered}/{item.count}</small></button>)}
    </nav>
    <section className="checkup-domain-content">
      <header className="checkup-domain-heading"><div><div className="eyebrow">{tx(language, `DOMAIN ${currentDomainIndex + 1} OF ${CHECKUP_DOMAINS.length}`, `領域 ${currentDomainIndex + 1} / ${CHECKUP_DOMAINS.length}`)}</div><h2>{localized(domain.title, language)}</h2><p>{localized(domain.intro, language)}</p></div><span className="domain-count">{domainEntries[currentDomainIndex]?.answered}/{entries.length}</span></header>
      <div className="guided-question-list">{entries.map((entry) => {
        const { control, asset, key } = entry;
        const answer = data.assessmentAnswers[key] ?? (!asset ? data.assessmentAnswers[control.id] : undefined);
        const guideOs = asset?.operatingSystem ?? localOs[key] ?? 'unknown';
        const guide = control.id === 'device.auto-updates' ? OS_UPDATE_GUIDES.find((item) => item.id === guideOs) : undefined;
        return <article className="guided-question-card" id={`control-${encodeURIComponent(key)}`} data-control-id={control.id} key={key}>
          <div className="guided-question-head"><span className="question-icon"><Laptop size={18} /></span><div><div className="eyebrow">{asset ? `${asset.name} · ${tx(language, asset.kind, asset.kind === 'device' ? '端末' : asset.kind === 'account' ? 'アカウント' : asset.kind === 'backup' ? 'バックアップ' : asset.kind === 'network' ? 'ネットワーク' : 'ID')}` : tx(language, 'GENERAL CHECK', '全般の確認')}</div><h3>{localized(control.question, language)}</h3></div><span className={`evidence-state ${answer ? `answered-${answer.response}` : 'unanswered'}`}>{answer ? answerLabel(answer.response, language) : tx(language, 'Not assessed', '未評価')}</span></div>
          {control.id === 'device.auto-updates' && <div className="device-guide-box"><div className="device-guide-title"><ShieldCheck size={16} /><strong>{tx(language, 'Choose your operating system for the steps', '手順を見るOSを選択')}</strong></div><label className="field-label"><span className="sr-only">{tx(language, 'Operating system', 'オペレーティングシステム')}</span><select value={guideOs} onChange={(event) => void saveOperatingSystem(entry, event.target.value as OperatingSystem)}>{(['unknown', 'windows', 'macos', 'ios', 'android', 'chromeos', 'ubuntu', 'other'] as OperatingSystem[]).map((os) => <option key={os} value={os}>{tx(language, osNames[os][0], osNames[os][1])}</option>)}</select></label>{guide ? <><ol>{guide.steps.map((step) => <li key={step.en}>{localized(step, language)}</li>)}</ol><a className="official-guide-link" href={guide.url} target="_blank" rel="noopener noreferrer">{tx(language, `Open ${guide.source} guide`, `${guide.source}のガイドを開く`)}<ExternalLink size={14} /></a><small>{tx(language, 'Menu names can vary by version and device maker. You make any changes yourself.', 'メニュー名はOSの版やメーカーにより異なります。設定変更はご自身で行ってください。')}</small></> : <p>{tx(language, 'Select the OS shown in this device’s settings to see a matching guide.', '端末の設定画面に表示されるOSを選ぶと、対応するガイドが表示されます。')}</p>}</div>}
          {(!answer || answer.response === 'no' || answer.response === 'unsure') && control.id !== 'device.auto-updates' && <div className="question-action"><strong>{localized(control.action, language)}</strong><p>{localized(control.how, language)}</p></div>}
          <div className="answer-pills guided-answer-pills">{answerOptions.map((option) => <button type="button" key={option.id} className={`answer-pill ${answer?.response === option.id ? 'active' : ''}`} aria-pressed={answer?.response === option.id} onClick={() => void saveAnswer(entry, option.id)}>{tx(language, option.en, option.ja)}</button>)}</div>
          {answer && answer.response !== 'not-applicable' && <button className={`confirm-answer ${answer.evidence === 'user-confirmed' ? 'confirmed' : ''}`} onClick={() => void saveAnswer(entry, answer.response, answer.evidence === 'user-confirmed' ? 'user-reported' : 'user-confirmed')}><Check size={14} />{answer.evidence === 'user-confirmed' ? tx(language, 'You confirmed this setting', '設定を確認済み') : tx(language, 'I checked this setting myself', '設定を自分で確認した')}</button>}
          <details className="question-why"><summary><CircleHelp size={14} />{tx(language, 'Why and technical details', '理由・技術的な説明')}</summary><div><p>{localized(control.why, language)}</p><p>{localized(control.technical, language)}</p>{control.references?.map((reference) => <a key={reference.url} href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title[language]}<ExternalLink size={12} /></a>)}</div></details>
        </article>;
      })}</div>
      <div className="checkup-step-actions">{previousDomain ? <button className="button button-secondary" onClick={() => void goToDomain(previousDomain)}><ArrowLeft size={15} />{tx(language, 'Previous area', '前の領域')}</button> : <span />}{nextDomain ? <button className="button button-primary" onClick={() => void goToDomain(nextDomain)}>{tx(language, 'Next area', '次の領域')}<ArrowRight size={15} /></button> : <a className="button button-primary" href="/plan">{tx(language, 'View my protection plan', '保護プランを見る')}<ArrowRight size={15} /></a>}</div>
    </section>
    <div className="checkup-reminder"><BookOpen size={16} /><span>{tx(language, 'You can leave and come back later. Unanswered controls remain “not assessed” and appear as review tasks in your plan.', '途中で閉じても後から再開できます。未回答は「未評価」のまま保護プランの確認項目に表示されます。')}</span></div>
  </div>;
}

function responseToState(response: AssessmentAnswer['response']): ControlState {
  return response === 'yes' ? 'implemented' : response === 'no' ? 'needs-improvement' : response === 'not-applicable' ? 'na' : 'unknown';
}
function answerLabel(response: AssessmentAnswer['response'], language: Language) {
  return answerOptions.find((option) => option.id === response)?.[language] ?? tx(language, 'Not assessed', '未評価');
}
