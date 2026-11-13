import { useState } from 'react';
import { SOURCES } from './guideCatalog';
import type { Dataset, Language } from './models';
import { nativeVault, selectedNativeInstallation, NATIVE_NAMES, type NativeProduct } from './nativeManagers';
import { tx } from './ui';

const problems = [
  { en: 'The screen differs', ja: '画面が違う' },
  { en: 'I cannot find the app or item', ja: 'アプリ・項目が見つからない' },
  { en: 'I lack permission', ja: '権限がない' },
  { en: 'This environment is unsupported', ja: 'この環境に対応していない' },
];
export function nativeExceptionPrompt(data: Dataset, vaultId: string, route: string, problem: number, language: Language) {
  const vault = nativeVault(data, vaultId), install = selectedNativeInstallation(data, vaultId);
  const os = data.assets.find(a => a.id === install?.deviceRef)?.operatingSystem;
  const product = vault && NATIVE_NAMES[vault.productId as NativeProduct];
  const sources = vault?.productId === 'apple-passwords' ? [SOURCES.applePasswords, SOURCES.appleKeychain] : [SOURCES.googleManager, SOURCES.chromePasswords];
  return [tx(language, 'Check the latest official information and guide one question or action at a time. Say when you cannot verify current details. Do not request passwords, codes, recovery information or personal details. Do not remove existing access before the replacement works.', '最新の公式情報を確認し、一度に一つの質問または操作を案内してください。最新情報を確認できない場合は明示してください。パスワード・認証コード・復旧情報・個人情報は求めず、新しい方法を使えると確認する前に既存の手段を削除させないでください。'),
    `Product: ${product?.[language] ?? 'Built-in password manager'}`,
    `OS: ${['ios', 'macos', 'android', 'windows', 'ubuntu', 'chromeos'].includes(os ?? '') ? os : 'unconfirmed'}; version: ${install?.platformVariant ?? 'unconfirmed'}`,
    `Task: ${tx(language, 'Open the existing store, confirm its exact backing account, then use a saved login', '既存の保管庫・実際の基盤アカウントを確認し、保存情報を使う')}`,
    `Current step: ${tx(language, route === 'native-managed' ? 'Confirm organization policy before setup' : 'Find a supported procedure for this environment', route === 'native-managed' ? '設定前に管理者の利用条件を確認する' : 'この環境で使える手順を確認する')}`,
    `Expected: ${tx(language, 'The existing store remains accessible; unsupported setup remains unfinished', '既存の保管庫を利用できる状態で残し、未対応の設定は未完了にする')}`,
    `Problem: ${problems[problem]?.[language] ?? problems[0][language]}`,
    'Official sources:', ...sources.map(s => s.url),
  ].join('\n');
}
export function NativeManagerHelp({ data, vaultId, route, language }: { data: Dataset; vaultId: string; route: string; language: Language }) {
  const [problem, setProblem] = useState<number | null>(null), [unresolved, setUnresolved] = useState(false), [status, setStatus] = useState('');
  return <details className="technical"><summary>{tx(language, 'Something is different', 'うまくいかない')}</summary><div className="choices">{problems.map((p, i) => <button key={p.en} className="choice" aria-pressed={problem === i} onClick={() => { setProblem(i); setUnresolved(false); setStatus(''); }}>{p[language]}</button>)}</div>
    {problem !== null && <><p>{tx(language, problem === 2 ? 'Keep organization management intact. Ask the account or device administrator which providers and recovery methods are allowed.' : 'Check the selected device, OS version and exact account in the official app. A similar reset or delete option is not a substitute. Keep the current store and its recovery information.', problem === 2 ? '管理機能は残し、許可される製品・復旧方法をアカウントまたは端末の管理者へ確認してください。' : '選んだ端末・OSの世代・正規のアプリ内のアカウントを確認してください。似た名前のリセット・削除は代わりに選びません。現在の保管庫と復旧用情報を残します。')}</p><button className="text-button" onClick={() => setUnresolved(true)}>{tx(language, 'This still does not resolve it', 'これでは解決しない')}</button></>}
    {unresolved && problem !== null && <><p className="subtle">{tx(language, 'Copy this context for an AI only if needed. Nothing is sent automatically. Hide passwords, codes, recovery information and personal details in any screenshot you choose to attach.', '必要な場合だけ、状況をまとめた相談文をコピーできます。自動送信はしません。画像を添付するときは、パスワード・コード・復旧情報・個人情報を隠してください。')}</p><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(nativeExceptionPrompt(data, vaultId, route, problem, language)); setStatus(tx(language, 'Copied', 'コピーしました')); } catch { setStatus(tx(language, 'Copy failed. Check clipboard permission.', 'コピーできませんでした。クリップボードの権限を確認してください。')); } }}>{tx(language, 'Copy prompt for an AI', 'AIへの相談文をコピーする')}</button><p role="status">{status}</p></>}
  </details>;
}
