import { CHECKUP_CONTROLS, controlKey, localized } from './checkupCatalog';
import type { Asset, AssetKind, ControlState, Dataset, Language, RecoveryDependency } from './models';

export type Finding = {
  id: string; source: 'asset' | 'assessment'; assetId: string; assetName: string; kind: AssetKind; controlId: string;
  state: ControlState; priority: 'high' | 'medium' | 'low'; effortMinutes: number; title: string; shortDescription: string;
  why: string; threatScenario: string; mitigationMechanism: string; technicalExplanation: string; limitations: string;
  referenceSources: { title: { en: string; ja: string }; url: string }[]; priorityRationale: string;
  evidence: 'not-assessed' | 'unknown' | 'self-reported' | 'user-confirmed'; how: string; verify: string;
};

const guidance: Record<string, { en: [string, string, string]; ja: [string, string, string] }> = {
  mfa: { en: ['Enable multi-factor authentication', 'A second factor can make a stolen password insufficient by itself.', 'Open the account security settings and add a second sign-in step.'], ja: ['多要素認証を有効にする', '二つ目の認証手段があると、盗まれたパスワードだけではログインできない場合があります。', 'アカウントのセキュリティ設定から二つ目のログイン確認を追加します。'] },
  recovery: { en: ['Review account recovery', 'Recovery settings can become an easy way into an otherwise protected account.', 'Check recovery options from a device you trust. Keep backup methods separate from the account.'], ja: ['アカウントの復旧方法を確認する', '復旧設定が弱いと、保護されたアカウントへの近道になる場合があります。', '信頼できる端末から復旧方法を確認し、予備手段は対象アカウントと分けます。'] },
  encryption: { en: ['Check device encryption', 'Encryption helps protect files if a device is lost or stolen.', 'Find the encryption setting in your operating system and keep any recovery key safely.'], ja: ['端末の暗号化を確認する', '端末を紛失・盗難したとき、暗号化は中のファイルを守る助けになります。', 'OSの暗号化設定を確認し、回復キーは安全な場所に保管します。'] },
  updates: { en: ['Review automatic security updates', 'Updates address known software weaknesses.', 'Open the device maker’s update settings and review automatic update options.'], ja: ['セキュリティ更新の自動適用を確認する', '更新は既知のソフトウェアの弱点を修正します。', '端末メーカーの更新設定を開き、自動更新の選択肢を確認します。'] },
  screenLock: { en: ['Strengthen the screen lock', 'A short idle lock reduces casual access to an unattended device.', 'Set a strong device passcode and a short automatic lock delay.'], ja: ['画面ロックを強化する', '短い自動ロック時間は、放置した端末を操作される可能性を下げます。', '強い端末パスコードと短い自動ロック時間を設定します。'] },
  backup: { en: ['Check your latest backup', 'A recent backup helps you recover from loss, damage, or ransomware.', 'Confirm a recent backup completed and that you know how to restore it.'], ja: ['最新のバックアップを確認する', '新しいバックアップがあれば、紛失・故障・ランサムウェアから復旧しやすくなります。', 'バックアップが最近完了したことと、復元方法を確認します。'] },
  restoreTest: { en: ['Test a small restore', 'A backup is useful only if you can restore what you need.', 'Restore one unimportant sample file to a separate location and confirm it opens.'], ja: ['少量のデータで復元を試す', '必要なものを復元できると確認できて初めて、バックアップが役立ちます。', '重要でないサンプルを別の場所に復元し、開けることを確認します。'] },
  encrypted: { en: ['Confirm backup encryption', 'Encryption limits exposure if a backup device or account is accessed by someone else.', 'Check the backup service or device settings and confirm encryption is enabled.'], ja: ['バックアップの暗号化を確認する', 'バックアップ機器やアカウントに他人がアクセスした場合も、暗号化があれば情報を守りやすくなります。', 'バックアップサービスまたは機器の設定で暗号化を確認します。'] },
  offsite: { en: ['Keep a separate backup copy', 'A separate or offline copy can survive a problem affecting your primary storage.', 'Choose a second location or offline drive and refresh it regularly.'], ja: ['別の場所にバックアップを置く', '別の場所やオフラインのコピーがあれば、元の保存先の障害からも復旧しやすくなります。', '二つ目の保存先またはオフラインドライブを選び、定期的に更新します。'] },
  adminPassword: { en: ['Review router administrator access', 'The router controls the connection used by devices in your home.', 'Use the router’s official settings guide to review administrator access.'], ja: ['ルーター管理画面のアクセスを確認する', 'ルーターは家庭内の多くの端末が使う接続を管理します。', 'ルーターの公式設定ガイドで管理者アクセスを確認します。'] },
  remoteAccess: { en: ['Review remote router access', 'Remote management may expose powerful settings beyond your home network.', 'Disable remote administration if you do not use it.'], ja: ['ルーターの遠隔アクセスを確認する', '遠隔管理は自宅ネットワークの外から強い設定機能を公開する場合があります。', '使っていなければ遠隔管理を無効にします。'] },
  passkey: { en: ['Add a passkey or security key', 'Phishing-resistant sign-in is harder to steal through a fake login page.', 'Check service support and register a passkey or security key if it fits your recovery plan.'], ja: ['パスキーまたはセキュリティキーを追加する', 'フィッシングに強い認証方法は偽のログイン画面で盗まれにくい設計です。', 'サービスの対応状況を確認し、復旧方法も用意してから登録します。'] },
  alerts: { en: ['Enable sign-in alerts', 'An alert can give you a chance to react to an unfamiliar sign-in.', 'Enable alerts for new devices or unfamiliar sign-ins.'], ja: ['ログイン通知を有効にする', '通知があれば不明なログインに対応する機会を得られます。', '新しい端末や見慣れないログインの通知を有効にします。'] },
  privacy: { en: ['Review privacy settings', 'Public profile settings may reveal more than you intend.', 'Review the service’s privacy controls and limit visibility to the intended audience.'], ja: ['プライバシー設定を確認する', 'プロフィールの公開設定が意図より広い場合があります。', 'サービスの公開範囲を見直し、必要な相手に限定します。'] },
};

const statusNeedsAction = (state: ControlState) => state === 'unknown' || state === 'needs-improvement';
const priorityWeight = { high: 0, medium: 1, low: 2 };

function importanceText(asset: Asset, language: Language) {
  return language === 'ja' ? asset.importance === 'critical' ? '最重要' : asset.importance === 'important' ? '重要' : '参考' : asset.importance;
}
function stateText(state: ControlState, language: Language) {
  if (language === 'ja') return state === 'unknown' ? '未評価' : state === 'needs-improvement' ? '要対応（本人の申告）' : state === 'implemented' ? '設定済み（本人の申告）' : '本人が確認済み';
  return state === 'unknown' ? 'not assessed' : state === 'needs-improvement' ? 'needs work (user-reported)' : state === 'implemented' ? 'reported as set up' : 'user-confirmed';
}

/** Retained for inventory cards and migration checks; this is always user-provided data. */
export function buildFindings(assets: Asset[], language: Language, dependencies: RecoveryDependency[] = [], threatProfile: 'essential' | 'advanced' | 'high-assurance' = 'essential'): Finding[] {
  const findings: Finding[] = [];
  for (const asset of assets) for (const control of Object.keys(asset.controls)) {
    const state = asset.controls[control] ?? 'unknown';
    if (!statusNeedsAction(state)) continue;
    const copy = guidance[control];
    if (!copy) continue;
    const dependencyCount = dependencies.filter((dependency) => dependency.recoveryAssetId === asset.id).length;
    const score = (asset.importance === 'critical' ? 3 : asset.importance === 'important' ? 2 : 1) + (state === 'needs-improvement' ? 1 : 0) + (dependencyCount ? 1 : 0) + (threatProfile === 'high-assurance' && state === 'unknown' ? 1 : 0);
    const priority = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
    const [title, why, how] = copy[language];
    const knowledgeRefs = control === 'updates' ? [] : [];
    const dependencyReason = dependencyCount ? language === 'ja' ? `、${dependencyCount}件の資産の復旧先にも使われている` : ` and is a recovery method for ${dependencyCount} other asset${dependencyCount === 1 ? '' : 's'}` : '';
    findings.push({
      id: `${asset.id}:${control}`, source: 'asset', assetId: asset.id, assetName: asset.name, kind: asset.kind, controlId: control, state, priority,
      effortMinutes: 10, title, shortDescription: title, why, threatScenario: why, mitigationMechanism: how,
      technicalExplanation: language === 'ja' ? 'この状態は利用者の申告または確認に基づきます。' : 'This state is based on the user’s report or confirmation.',
      limitations: language === 'ja' ? '外部アカウントや端末を独立して検査した結果ではありません。' : 'This is not an independent inspection of an external account or device.',
      referenceSources: knowledgeRefs, priorityRationale: language === 'ja' ? `作業順は選択した重要度「${importanceText(asset, language)}」${dependencyReason}と回答状況「${stateText(state, language)}」に基づきます。侵害や脆弱性の判定ではありません。` : `Task order reflects the selected importance (${importanceText(asset, language)})${dependencyReason} and reported state (${stateText(state, language)}). It is not a compromise or vulnerability verdict.`,
      evidence: asset.controlEvidence[control] === 'user-confirmed' ? 'user-confirmed' : state === 'unknown' ? 'not-assessed' : 'self-reported',
      how, verify: language === 'ja' ? '設定画面を確認して結果を記録します。' : 'Check the setting and record what you found.',
    });
  }
  const controlOrder: Record<string, number> = { mfa: 0, recovery: 1, encryption: 2, updates: 3, screenLock: 4, restoreTest: 5, backup: 6, offsite: 7, passkey: 8, alerts: 9, adminPassword: 10, remoteAccess: 11, encrypted: 12, privacy: 13 };
  return findings.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority] || (controlOrder[a.controlId] ?? 99) - (controlOrder[b.controlId] ?? 99));
}

export function buildGuidedFindings(data: Dataset, language: Language): Finding[] {
  const findings: Finding[] = [];
  for (const control of CHECKUP_CONTROLS) {
    const assets = control.assetKind ? data.assets.filter((asset) => asset.kind === control.assetKind) : [];
    const targets: (Asset | undefined)[] = assets.length ? assets : [undefined];
    for (const asset of targets) {
      const id = controlKey(control.id, asset?.id);
      const answer = data.assessmentAnswers[id] ?? (!asset ? data.assessmentAnswers[control.id] : undefined);
      if (answer?.response === 'yes' || answer?.response === 'not-applicable') continue;
      const needsWork = answer?.response === 'no';
      const state: ControlState = needsWork ? 'needs-improvement' : 'unknown';
      const dependentCount = asset ? data.dependencies.filter((edge) => edge.recoveryAssetId === asset.id).length : 0;
      const importance = asset?.importance ?? 'important';
      const concernMatch = data.threatModel.concerns.some((concern) => {
        const map: Record<string, string[]> = {
          'account-takeover': ['identity', 'preparedness'], fraud: ['identity', 'preparedness'], 'privacy-exposure': ['privacy'],
          'device-theft': ['device', 'network'], 'data-loss': ['data'], 'general-security': [control.domain],
          accounts: ['identity', 'preparedness'], identity: ['identity', 'privacy'], devices: ['device'], files: ['data'], network: ['network'],
        };
        return map[concern]?.includes(control.domain) ?? false;
      });
      const score = (importance === 'critical' ? 3 : importance === 'important' ? 2 : 1) + (needsWork ? 1 : 0) + (dependentCount > 0 ? 1 : 0) + (concernMatch ? 1 : 0) + (data.settings.threatProfile === 'high-assurance' && !answer ? 1 : 0) + (data.threatModel.priority === 'strongest' && !answer ? 1 : 0);
      const priority = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
      const title = answer ? localized(control.action, language) : language === 'ja' ? `${localized(control.title, language)}を確認する` : `Check ${localized(control.title, language).toLowerCase()}`;
      const reason = language === 'ja'
        ? `重要度「${asset ? importanceText(asset, language) : '一般'}」${dependentCount ? `、復旧に依存する資産${dependentCount}件` : ''}${concernMatch ? '、選択した関心領域' : ''}と、評価状態「${needsWork ? '本人が未設定と回答' : answer ? 'わからない' : '未評価'}」をもとにした作業順です。侵害確率や安全度ではありません。`
        : `Task order reflects ${asset ? `the selected ${importanceText(asset, language)} importance` : 'a general check'}${dependentCount ? ` and ${dependentCount} recovery-dependent asset${dependentCount === 1 ? '' : 's'}` : ''}${concernMatch ? ' and a concern you selected' : ''}. Evidence is ${needsWork ? 'user-reported as not enabled' : answer ? 'unknown to you' : 'not assessed'}. This is not a compromise probability or security score.`;
      const referenceSources = control.references ?? [];
      findings.push({
        id, source: 'assessment', assetId: asset?.id ?? '', assetName: asset?.name ?? (language === 'ja' ? '全般' : 'General'),
        kind: asset?.kind ?? control.assetKind ?? 'identity', controlId: control.id, state, priority, effortMinutes: control.effortMinutes,
        title, shortDescription: localized(control.question, language), why: localized(control.why, language), threatScenario: localized(control.why, language),
        mitigationMechanism: localized(control.action, language), technicalExplanation: localized(control.technical, language), limitations: localized(control.verify, language),
        referenceSources, priorityRationale: reason,
        evidence: !answer ? 'not-assessed' : answer.response === 'unsure' ? 'unknown' : answer.evidence === 'user-confirmed' ? 'user-confirmed' : 'self-reported',
        how: localized(control.how, language), verify: localized(control.verify, language),
      });
    }
  }
  return findings.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority] || a.effortMinutes - b.effortMinutes);
}

export function controlsSummary(assets: Asset[]) {
  const states = assets.flatMap((asset) => Object.values(asset.controls));
  const assessed = states.filter((state) => state !== 'unknown').length;
  const verified = states.filter((state) => state === 'verified').length;
  const needsWork = states.filter((state) => state === 'needs-improvement').length;
  return { total: states.length, assessed, verified, needsWork, coverage: states.length ? Math.round((assessed / states.length) * 100) : 0 };
}

export function findAsset(dataset: Dataset, id: string) { return dataset.assets.find((asset) => asset.id === id); }
export const KIND_LABELS: Record<AssetKind, { en: string; ja: string }> = {
  device: { en: 'Device', ja: '端末' }, account: { en: 'Account', ja: 'アカウント' },
  backup: { en: 'Backup', ja: 'バックアップ' }, network: { en: 'Home network', ja: 'ホームネットワーク' }, identity: { en: 'Identity', ja: 'デジタルID' },
};
export function isCriticalAccount(asset: Asset): boolean { return asset.kind === 'account' && /primary email|email|password manager/i.test(asset.type); }
