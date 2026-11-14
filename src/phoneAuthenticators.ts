import {enteSnapshot} from './enteSchemas';
import {twofasSnapshot} from './twofasSchemas';
import {fileTransferSteps} from './phoneFileTransfer';
import type { Asset, Dataset } from './models';
import type { PhoneWorkflow } from './phoneSchemas';
import type { PhoneChoice, PhoneStep } from './phoneCatalog';
import { AUTHENTICATORS, authenticator, type AuthenticatorInstallation, type AuthenticatorProduct } from './authenticatorGuide';
import { c, deviceRecipe, type Copy } from './guideCatalog';

export const MOVE_PRODUCTS = { ente:'ente-auth', twofas:'2fas-auth', microsoft: 'microsoft-authenticator', bitwarden: 'bitwarden-authenticator' } as const;
const choice = (value: string, en: string, ja = en): PhoneChoice => ({ value, label: c(en, ja) });
const ask = (id: string, title: Copy, choices: PhoneChoice[], text?: Copy, meta?: PhoneStep['authenticatorQuestion']): PhoneStep => ({ id, kind: 'question', title, choices, text, answerKey: id, refs: [], sources: [], authenticatorQuestion: meta });
const act = (id: string, title: Copy, place: Copy, action: Copy, expected: Copy, refs: string[], sources: string[], extra: Partial<PhoneStep> = {}): PhoneStep => ({ id, kind: 'action', title, place, action, expected, refs, sources, button: c('I checked this', '確認しました'), ...extra });
const blocked = (id: string, title: Copy, text: Copy, refs: string[], sources: string[] = []): PhoneStep => ({ id, kind: 'blocked', title, text, refs, sources });
export function recordedAuthenticators(data: Dataset, deviceId?: string) {
  return data.version === 2 ? data.securityModel.entities.filter((e): e is AuthenticatorInstallation => e.kind === 'installation' && !e.mergedIntoRef && e.deviceRef === deviceId && !!authenticator(data, e.id) && (e.controls?.opened === 'verified' || data.securityModel.entities.some(s => s.kind === 'credential' && s.storageRef === e.id))) : [];
}
export const hasRecordedAuthenticators = (data: Dataset, deviceId: string) => recordedAuthenticators(data, deviceId).length > 0;
export function needsGoogleTransfer(data: Dataset, w: PhoneWorkflow) {
  return w.answers.authenticator === 'google' || recordedAuthenticators(data, w.oldDeviceRef).some(a => a.productId === 'google-authenticator') || (w.answers.authenticator !== 'none' && Object.entries(w.answers).some(([k, v]) => /^auth-add:\d+$/.test(k) && v === 'google'));
}
export function migrationAuthenticators(data: Dataset, w: PhoneWorkflow) {
  const refs = recordedAuthenticators(data, w.oldDeviceRef).filter(a => a.productId !== 'google-authenticator').map(a => a.id);
  if (Object.hasOwn(MOVE_PRODUCTS, w.answers.authenticator)) refs.push(w.answers['auth-primary-ref']);
  for (let i = 0; w.answers.authenticator !== 'none' && i < 32; i++) {
    if (!w.answers[`auth-add:${i}`] || ['none', 'other'].includes(w.answers[`auth-add:${i}`])) break;
    if (Object.hasOwn(MOVE_PRODUCTS, w.answers[`auth-add:${i}`])) refs.push(w.answers[`auth-add-ref:${i}`]);
  }
  return [...new Set(refs)].map(ref => authenticator(data, ref)).filter((a): a is AuthenticatorInstallation => !!a && a.deviceRef === w.oldDeviceRef && a.productId !== 'google-authenticator');
}
export function authenticatorInventory(data: Dataset, w: PhoneWorkflow): { steps: PhoneStep[]; ready: boolean } {
  if (w.answers.authenticator === 'none' || (!migrationAuthenticators(data, w).length && !Object.hasOwn(MOVE_PRODUCTS, w.answers.authenticator))) return { steps: [], ready: true };
  const steps: PhoneStep[] = [];
  if (Object.hasOwn(MOVE_PRODUCTS, w.answers.authenticator) && !authenticator(data, w.answers['auth-primary-ref'])) { steps.push(blocked('auth-primary-missing', c('Choose the existing app again', '使っているアプリを選び直す'), c('The selected app profile is missing. Keep existing records and review the authenticator selection.', '選んだアプリの登録が見つかりません。既存の記録は残し、認証アプリの選択を確認してください。'), [w.oldDeviceRef!])); return { steps, ready: true }; }
  for (let i = 0; i < 32; i++) {
    steps.push(ask(`auth-add:${i}`, c('Do you use another authenticator?', 'ほかにも認証アプリを使っていますか？'), [choice('ente','Ente Auth'),choice('twofas','2FAS Auth'), choice('microsoft', 'Microsoft Authenticator'), choice('bitwarden', 'Bitwarden Authenticator (standalone)', 'Bitwarden Authenticator（単独アプリ）'), choice('google', 'Google Authenticator', 'Google 認証システム'), choice('none', 'That is all', 'これですべてです'), choice('other', 'Another product / not sure', '別の製品・分からない')], c('Add only apps you actually use. Each saved profile will be checked separately.', '実際に使うものだけ選んでください。登録済みの保存先も、それぞれ確認します。'), { kind: 'product', index: i }));
    const prior = [w.answers.authenticator, ...Array.from({ length: i }, (_, j) => w.answers[`auth-add:${j}`])];
    steps[steps.length - 1].choices = steps[steps.length - 1].choices?.filter(v => !['google', 'microsoft', 'bitwarden','twofas','ente'].includes(v.value) || !prior.includes(v.value));
    const value = w.answers[`auth-add:${i}`];
    if (Object.hasOwn(MOVE_PRODUCTS, value) && !authenticator(data, w.answers[`auth-add-ref:${i}`])) { steps.push(blocked(`auth-add-missing:${i}`, c('Choose this app again', 'このアプリを選び直す'), c('Its saved profile is missing. Return to this selection without deleting existing records.', '保存先の登録が見つかりません。既存の記録は消さず、この選択へ戻って確認します。'), [w.oldDeviceRef!])); return { steps, ready: true }; }
    if (!value) return { steps, ready: false };
    if (value === 'none') return { steps, ready: true };
    if (value === 'other') { steps.push(blocked('auth-extra-unsupported', c('Keep the remaining app transfer unfinished', '残るアプリの移行を未完了で残す'), c('Keep its old codes and recovery methods. The product-specific transfer still needs a verified recipe.', '旧アプリのコードと復旧手段は残してください。この製品に合う移行手順は追加対象です。'), [w.oldDeviceRef!, w.newDeviceRef!])); return { steps, ready: true }; }
  }
  steps.push(blocked('auth-inventory-limit', c('Review the remaining profiles', '残る保存先を確認する'), c('This task has reached its profile limit. Keep the previous phone and split the remaining work into another task.', '今回の作業の保存先の上限です。旧端末を残し、残りは別の作業として確認します。'), [w.oldDeviceRef!]));
  return { steps, ready: true };
}
export const moveTargets = (data: Dataset, sourceRef: string) => data.version === 2 ? [...new Set(data.securityModel.entities.filter(e => e.kind === 'credential' && e.credentialType === 'totp' && e.storageRef === sourceRef).map(e => e.kind === 'credential' ? e.subjectRef : ''))].filter(id => data.assets.some(a => a.id === id && a.kind === 'account')) : [];
const productName = (app: AuthenticatorInstallation) => AUTHENTICATORS[app.productId as AuthenticatorProduct];

export function authenticatorMigrationSteps(data: Dataset, w: PhoneWorkflow, accountSteps: (a: Asset, f: Asset) => PhoneStep[]): { steps: PhoneStep[]; ready: boolean } {
  const steps: PhoneStep[] = [], old = data.assets.find(a => a.id === w.oldDeviceRef), fresh = data.assets.find(a => a.id === w.newDeviceRef);
  if (!old || !fresh || data.version !== 2) return { steps, ready: true };
  for (const app of migrationAuthenticators(data, w)) {
    const prefix = `auth:${app.id}`, ids = [app.id, old.id, fresh.id], bw = app.productId === 'bitwarden-authenticator', name = productName(app);
    const sources = bw ? ['bwAuthenticator', 'bwAuthenticatorExport'] : ['microsoftAuthBackup', 'msAuthRestore'];
    const askForApp = (...args: Parameters<typeof ask>) => ({ ...ask(...args), context: name });
    const oldPlace = c(`Previous phone · ${name.en}`, `旧端末 · ${name.ja}`), newPlace = c(`New phone · ${name.en}`, `新端末 · ${name.ja}`);
    if(app.productId==='ente-auth'){steps.push(act(`${prefix}:ente`,c('Move and test Ente Auth on the new phone','新端末でEnte Authを移し、利用を確認する'),newPlace,c('Follow the separate Ente guide. Preserve existing codes and Accounts; copying alone does not finish this check.','Enteの専用ガイドへ進みます。既存コード・Accountを保ち、コピーだけで確認を終えません。'),c('The intended new codes have been tested in the Ente guide.','専用ガイドで、今回の新しいコードを使って確認できたこと。'),ids,['enteExport','enteFaq'],{enteSourceRef:app.id,requires:['prepare-recovery'],variant:enteSnapshot(data.securityModel,app.id)}));continue;}
    if (w.answers.availability !== 'available') { steps.push(blocked(`${prefix}:old-unavailable`, c('Use a backup-specific recovery path', 'バックアップからの復旧として進める'), c('This direct-move route needs the old app. Keep existing backups; do not reinstall or overwrite them. Backup-only recovery is a separate unfinished task.', 'この直接移行には旧アプリが必要です。既存バックアップを残し、再インストールや上書きをしないでください。バックアップだけからの復旧は、別の未完了作業として残します。'), ids, sources)); continue; }
    if(app.productId==='2fas-auth'){steps.push(act(`${prefix}:twofas`,c('Move and test 2FAS on the new phone','新端末で2FASを移し、利用を確認する'),newPlace,c('Follow the separate 2FAS guide. Keep both phones and existing codes; a copy alone does not finish the transfer.','2FASの専用ガイドを進めます。両端末と既存コードを残し、コピーだけでは移行完了にしません。'),c('The intended new codes have been tested in the 2FAS guide.','専用ガイドで、今回の新コードを使って確認できたこと。'),ids,['twofasTransfer','twofasTutorial'],{twofasSourceRef:app.id,requires:['prepare-recovery'],variant:twofasSnapshot(data.securityModel,app.id)}));continue;}
    steps.push(act(`${prefix}:old-open`, c(`Open the existing ${name.en}`, `旧端末で${name.ja}を開く`), oldPlace, c('Open the existing app and review all code groups. Keep every existing code. Identify local entries, synced groups and any work or passwordless registrations.', '今使っているアプリを開き、すべてのグループを確認します。既存コードは残し、端末内の項目・同期のグループ・仕事用やパスワードレスの登録を見分けてください。'), c('The intended existing app is open and its groups can be checked.', '元のアプリで、今回移す項目を確認できること。'), [app.id, old.id], sources, { extraControls: [{ targetRef: app.id, controlId: 'opened' }], authenticatorEffect: { kind: 'open', sourceRef: app.id, installationRef: app.id } }));
    const destKey = `auth-destination:${app.id}`;
    const candidates = data.securityModel.entities.filter(e => e.kind === 'installation' && !e.mergedIntoRef && e.productId === app.productId && e.deviceRef === fresh.id);
    steps.push(askForApp(destKey, c('Which app profile on the new phone will you use?', '新端末のどのアプリ・保存先へ移しますか？'), [...candidates.map(e => choice(`installation:${e.id}`, e.label)), choice('add', 'Prepare a new app profile', '新しいアプリ・保存先として準備する')], c('Reusing an entry keeps its identity; it does not confirm a transfer or copy any completion.', '既存の項目を使う場合は同じIDを保ちます。選択だけで移行済みにはせず、確認記録もコピーしません。'), { kind: 'destination', sourceRef: app.id }));
    const dest = authenticator(data, w.answers[destKey]);
    if (!dest || dest.deviceRef !== fresh.id || dest.productId !== app.productId) return { steps, ready: false };
    const refs = [app.id, dest.id, old.id, fresh.id];
    const modeKey = `auth-mode:${app.id}`;
    steps.push(askForApp(modeKey, bw ? c('Which groups are in the old Authenticator?', '旧Authenticatorには、どのグループがありますか？') : c('What kinds of registrations need to move?', 'どの種類の認証を引き継ぎますか？'), bw ? [choice('local', 'Local Codes only', 'Local Codes・端末内のコードだけ'), choice('sync', 'Vault-synced groups only', '保管庫と同期するグループだけ'), choice('both', 'Both local and synced groups', '端末内と同期の両方'), choice('unsure', 'Not sure', '分からない')] : [choice('totp', 'Personal and third-party codes only', '個人用・外部サービスのコードだけ'), choice('mixed', 'Microsoft work/school, push or passwordless registrations', 'Microsoftの仕事・学校用、通知・パスワードレスもある'), choice('unsure', 'Not sure', '分からない')], bw ? c('A previous Save here choice describes that new code only. Inspect the whole app now.', '以前の「Save here」の記録は、そのとき追加したコードの保存先です。今回はアプリ全体を確認します。') : c('Microsoft work/school credentials need re-registration even when a changing code was used. A restored account name is not a restored credential.', 'Microsoftの仕事・学校用は、変わるコードを使う場合も再登録が必要です。名前が戻っただけでは、その認証が使えるとは扱いません。')));
    const mode = w.answers[modeKey]; if (!mode) return { steps, ready: false };
    if (!(bw ? ['local', 'sync', 'both'] : ['totp', 'mixed']).includes(mode)) { steps.push(blocked(`${prefix}:mode-unknown`, c('Keep the code groups unfinished', 'コードの保存方法を未確認で残す'), c('Use the in-app help to identify the groups. Keep old codes and backups.', 'アプリ内の「うまくいかない」からグループを確認し、旧コードとバックアップを残してください。'), refs, sources)); continue; }
    if (!bw && old.operatingSystem !== fresh.operatingSystem) { steps.push(blocked(`${prefix}:cross-os`, c('Register each service on the other operating system', '異なるOSでは、サービスごとの登録が必要です'), c('Microsoft backup restoration is limited to the same OS. Keep the old app and recovery methods; do not treat a phone copy as restored authentication.', 'Microsoftのバックアップ復元は同じOS間の経路です。旧アプリと復旧手段を残し、端末コピーを認証の復元済みとは扱いません。'), refs, sources)); continue; }
    if (!bw && mode === 'mixed') steps.push(blocked(`${prefix}:work-registration`, c('Keep non-code registrations unfinished', '仕事用・通知・パスワードレスの登録を残す'), c('The following steps check changing codes. Work and passwordless access need their own sign-in and registration on the new phone before handover.', 'これから確認するのは一定時間で変わるコードです。仕事用やパスワードレスは、新端末で個別のログイン・登録が必要です。引き渡し前の未完了として残します。'), refs, sources));
    const openedId = `${prefix}:open`;
    steps.push(act(openedId, c(`Open ${name.en} on the new phone`, `新端末で${name.ja}を開く`), newPlace, c(bw ? 'Install or open the official standalone Bitwarden Authenticator (iOS 15+ / Android 9+). Preserve any entries already there.' : 'Install or open the official Microsoft Authenticator. Keep any existing new-phone codes; do not uninstall or sign out to force a restore.', bw ? '正規の単独アプリBitwarden Authenticator（iOS 15以降／Android 9以降）を入れるか、導入済みなら開いてください。新端末の既存項目も残します。' : '正規のMicrosoft Authenticatorを入れるか、導入済みなら開いてください。新端末の既存コードを残し、復元のためにアンインストール・サインアウトはしません。'), c('The correct app opens and existing entries are preserved.', '正しいアプリが開き、既存の項目も残っていること。'), [dest.id, fresh.id], sources, { url: bw ? fresh.operatingSystem === 'ios' ? 'https://apps.apple.com/us/app/bitwarden-authenticator/id6497335175' : 'https://play.google.com/store/apps/details?id=com.bitwarden.authenticator' : 'https://www.microsoft.com/security/mobile-authenticator-app', extraControls: [{ targetRef: dest.id, controlId: 'opened' }], authenticatorEffect: { kind: 'open', sourceRef: app.id, installationRef: dest.id } }));
    const lockId = `${prefix}:lock`, lock = deviceRecipe(fresh.operatingSystem!).steps.find(s => s.id === 'lock')!;
    const ownLock = Object.values(w.records).some(r => r.stepId === lockId);
    if (!['implemented', 'verified'].includes(fresh.controls.screenLock) || ownLock || w.cursor === lockId) steps.push(act(lockId, lock.title, lock.place, lock.action, lock.expected, [fresh.id], lock.sources, { extraControls: [{ targetRef: fresh.id, controlId: 'screenLock' }] }));
    if (!bw) steps.push(act(`${prefix}:app-lock`, c('Check App Lock on the new phone', '新端末のアプリロックを確認する'), newPlace, c('In Authenticator Settings check App Lock. Reopen the app and confirm local PIN or biometric authentication is required.', 'Authenticatorの「Settings」で「App Lock」を確認してください。アプリを開き直し、端末のPIN・生体認証が必要か確かめます。'), c('The app requires the expected local authentication.', 'アプリを開くと、設定した本人確認が必要になること。'), [dest.id, fresh.id], ['microsoftAuthFaq'], { extraControls: [{ targetRef: dest.id, controlId: 'appLock' }] }));
    const required = [`${prefix}:old-open`, openedId, ...steps.filter(s => s.id === lockId || s.id === `${prefix}:app-lock`).map(s => s.id)];
    const itemsId = `${prefix}:items`, rootRefs: string[] = [];
    const stateKey = `${prefix}:restore-state`;
    steps.push(askForApp(stateKey, c('What is shown in the new Authenticator?', '新しいAuthenticatorは、どの状態ですか？'), bw ? [choice('fresh', 'The intended codes still need to move', '今回のコードを、これから移す'), choice('present', 'All the intended code entries are already present', '今回必要なコードは、すでにすべて表示されている'), choice('other', 'Not sure', '分からない')] : [choice('fresh', 'A fresh app with no codes or sign-in', 'コード・ログインがまだない新しいアプリ'), choice('present', 'All the intended code entries have already appeared', '今回必要なコードの項目は、すでにすべて表示されている'), choice('other', 'Other codes / already signed in / not sure', '別のコードがある・ログイン済み・分からない')], c('Keep existing codes. A complete existing move can be checked without repeating a restore. Do not reinstall or sign out to get a fresh-app screen.', '既存コードは残します。すでに移っていれば、復元し直さずに確認できます。最初の画面へ合わせるための再インストール・サインアウトはしません。')));
    const state = w.answers[stateKey]; if (!state) return { steps, ready: false };
    if (state === 'other') { steps.push(blocked(`${prefix}:existing-new-data`, c('Keep the new phone’s existing codes', '新端末にあるコードを残す'), c('Use help to identify the missing group without resetting the app. Restoration must not remove the new phone’s only codes.', 'アプリをリセットせず、「うまくいかない」から不足するグループを確認します。新端末だけにあるコードを復元操作で失わないようにしてください。'), refs, sources)); continue; }
    if (bw && state !== 'present' && ['local', 'both'].includes(mode)) {
      const exported = `${prefix}:export`, sent = `${prefix}:send`;
      steps.push(act(exported, c('Export the old app’s local codes', '旧アプリの端末内コードを書き出す'), oldPlace, c('In Settings → Export choose JSON, then Export items. Save only this migration file privately. It contains readable secret keys; synced vault codes are excluded.', '「Settings」→「Export」でJSONを選び、「Export items」で書き出してください。秘密キーを含む読取り可能な移行用ファイルです。本人だけが扱える場所に保存します。同期中の保管庫項目は含まれません。'), c('A private JSON export of the local codes exists.', '端末内コードのJSONを、本人が管理する場所に保存できたこと。'), [app.id, old.id], sources, { requires: [`${prefix}:old-open`, 'prepare-recovery'], authenticatorEffect: { kind: 'export', sourceRef: app.id } }));
      const transfer = fileTransferSteps(app.id, old, fresh, refs, exported, w); steps.push(...transfer.steps); if (!transfer.ready) return { steps, ready: false }; if (transfer.steps.some(s => s.kind === 'blocked')) continue;
      steps.push(act(`${prefix}:import`, c('Import the local-code file', '端末内コードのファイルを読み込む'), newPlace, c('Choose Settings → Import → File format → Authenticator Export (JSON). Select the transferred JSON in the device file picker. Keep existing entries.', '「Settings」→「Import」の「File format」で「Authenticator Export (JSON)」を選び、端末のファイル選択画面で移したJSONを読み込んでください。既存の項目は残します。'), c('The intended local code entries appear in the new app.', '新アプリに、今回の端末内コードの項目が表示されること。'), refs, sources, { requires: [openedId, sent] })); required.push(`${prefix}:import`);
    }
    if (bw && ['sync', 'both'].includes(mode)) {
      const versionKey = `${prefix}:sync-platform`;
      if (fresh.operatingSystem === 'android') { steps.push(askForApp(versionKey, c('Does the new Android run version 12 or later?', '新しいAndroidは12以降ですか？'), [choice('supported', 'Android 12 or later', 'Android 12以降'), choice('unsupported', 'Older / not sure', 'それ以前・分からない')])); if (!w.answers[versionKey]) return { steps, ready: false }; if (w.answers[versionKey] !== 'supported') { steps.push(blocked(`${prefix}:sync-platform-blocked`, c('Keep vault sync unfinished', '保管庫との同期を未完了で残す'), c('This sync feature requires Android 12 or later. Keep local and vault copies intact.', 'この同期機能はAndroid 12以降が対象です。端末内と保管庫の元の情報を残してください。'), refs, ['bwAuthSync'])); continue; } }
      const roots = rootQuestions(data, w, app, 'bitwarden', true); steps.push(...roots.steps); if (!roots.ready) return { steps, ready: false }; rootRefs.push(...roots.refs);
      if (!rootRefs.length) { steps.push(blocked(`${prefix}:sync-root-missing`, c('Identify the vault account first', '同期している保管庫のアカウントを確認する'), c('A local export does not include vault-synced codes. Select each actual Bitwarden account shown by the old app.', '端末内の書き出しに同期コードは含まれません。旧アプリに表示される実際のBitwardenアカウントを、それぞれ選んでください。'), refs, ['bwAuthSync'])); continue; }
      for (const rootRef of rootRefs) {
        const root = data.assets.find(a => a.id === rootRef)!;
        const rootPrefix = `${prefix}:root:${rootRef}`;
        const rootSteps = accountSteps(root, fresh).map(s => ({ ...s, id: `${rootPrefix}:${s.id}`, requires: [openedId] })); steps.push(...rootSteps); required.push(...rootSteps.map(s => s.id));
        const syncId = `${rootPrefix}:sync`;
        steps.push(act(syncId, c(`Show ${root.name}’s synced codes`, `${root.name}の同期コードを表示する`), c('New phone · Bitwarden Password Manager, then Authenticator', '新端末 · Bitwardenのパスワード管理用アプリ → Authenticator'), c('In the correct signed-in Password Manager account open Settings → Account security → Allow authenticator syncing. In Authenticator check the codes under that account’s email heading. Keep vault login available.', 'パスワード管理用アプリの今回のアカウントで「Settings」→「Account security」→「Allow authenticator syncing」を確認します。Authenticatorに、そのアカウントのメール見出しでコードが表示されるか確かめてください。保管庫のログインは保ちます。'), c('This exact vault’s code group appears in Authenticator.', '今回の正しい保管庫のコードがAuthenticatorに表示されること。'), [dest.id, fresh.id, rootRef], ['bwAuthSync'], { requires: rootSteps.map(s => s.id), authenticatorEffect: { kind: 'sync', sourceRef: app.id, installationRef: dest.id, rootRef } })); required.push(syncId);
      }
    }
    if (!bw && state === 'fresh') {
      const roots = rootQuestions(data, w, app, old.operatingSystem === 'ios' ? 'apple' : 'microsoft', false); steps.push(...roots.steps); if (!roots.ready) return { steps, ready: false }; rootRefs.push(...roots.refs);
      if (!rootRefs.length) continue;
      if (old.operatingSystem === 'ios') {
        const versionKey = `${prefix}:version`;
        steps.push(askForApp(versionKey, c('Is the old Authenticator version 6.8.33 or later?', '旧Authenticatorは6.8.33以降ですか？'), [choice('supported', 'Yes, 6.8.33 or later', 'はい・6.8.33以降'), choice('unknown', 'Older / not sure', 'それ以前・分からない')], c('Check the app’s version. Keep it installed while checking; do not reinstall to find a version.', 'アプリの版を確認してください。確認のために再インストールせず、元のアプリを残します。')));
        if (!w.answers[versionKey]) return { steps, ready: false };
        if (w.answers[versionKey] !== 'supported') { steps.push(blocked(`${prefix}:version-blocked`, c('Update and confirm the existing app first', '旧アプリの更新と版を先に確認する'), c('Use the official store to update, keep the codes, then confirm version 6.8.33 or later before continuing.', '正規ストアで旧アプリを更新し、コードを残したまま6.8.33以降か確認してから戻ってください。'), refs, sources)); continue; }
        for (const [which, device] of [['old', old], ['new', fresh]] as const) {
          const cloudPlace = c(`${which === 'old' ? 'Previous' : 'New'} phone · Settings → your name → iCloud`, `${which === 'old' ? '旧' : '新'}端末 ·「設定」→自分の名前→「iCloud」`);
          for (const [suffix, title, instruction, src] of [
            ['drive', c('Check iCloud Drive', 'iCloud Driveを確認する'), c('Check that this is the chosen Apple Account. Open Drive (or iCloud Drive) and check Sync this iPhone. If a different account or data reset is shown, stop and use help.', '選んだApple Accountか確かめ、「Drive」（iCloud Drive）の「Sync this iPhone」を確認してください。別アカウントやデータのリセットが表示されたら止めて、補助へ進みます。'), 'iCloudDrive'],
            ['keychain', c('Check iCloud Keychain', 'iCloudキーチェーンを確認する'), c('Under Saved to iCloud open Passwords (Passwords and Keychain on iOS 17 or earlier) and check Sync this iPhone. Preserve existing encrypted data.', '「Saved to iCloud」の「Passwords」（iOS 17以前は「Passwords and Keychain」）で、このiPhoneの同期を確認します。既存の暗号化データは残してください。'), 'appleKeychain'],
            ['include', c('Include Authenticator in iCloud', 'AuthenticatorをiCloudの対象にする'), c('Open See All beside Saved to iCloud, find Authenticator and check that its toggle is on.', '「Saved to iCloud」横の「See All」で「Authenticator」を探し、対象がオンか確認してください。'), 'iCloudApps'],
          ] as const) { const id = `${prefix}:${which}-${suffix}`; steps.push(act(id, title, cloudPlace, instruction, c('The required setting is on for the intended Apple Account.', '今回のApple Accountで、必要な設定がオンであること。'), [device.id, rootRefs[0]], [src, 'microsoftAuthBackup'])); required.push(id); }
          const backup = which === 'old' ? deviceRecipe('ios').steps.filter(s => s.id.startsWith('backup-')) : [];
          if (which === 'new') { const id = `${prefix}:new-backup-on`; steps.push(act(id, c('Check iCloud Backup on the new phone', '新端末のiCloudバックアップを確認する'), cloudPlace, c('Open iCloud Backup and check that backup of this iPhone is enabled. Do not overwrite the old backup to force a restore.', '「iCloud Backup」で、このiPhoneのバックアップがオンか確認してください。復元に合わせるために旧バックアップを上書きしません。'), c('iCloud Backup is enabled on the intended new phone.', '今回の新端末でiCloudバックアップがオンであること。'), [fresh.id, rootRefs[0]], ['microsoftAuthBackup'])); required.push(id); }
          for (const s of backup) { const id = `${prefix}:${which}-${s.id}`; steps.push(act(id, s.title, cloudPlace, s.action, s.expected, [device.id, rootRefs[0]], s.sources)); required.push(id); }
        }
        const backupId = `${prefix}:backup`;
        steps.push(act(backupId, c('Open the old app after preparing backup', 'バックアップ準備後に旧アプリを開く'), oldPlace, c('Open the updated old Authenticator at least once before switching phones. Keep its codes and the confirmed iCloud backup.', '更新済みの旧Authenticatorを、端末を切り替える前に少なくとも一度開いてください。コードと、確認したiCloudバックアップは残します。'), c('The updated old app has been opened and backup prerequisites are confirmed.', '更新した旧アプリを起動でき、バックアップの前提も確認できたこと。'), [app.id, old.id, rootRefs[0]], sources, { requires: [...required], authenticatorEffect: { kind: 'backup', sourceRef: app.id, rootRef: rootRefs[0] } })); required.push(backupId);
      } else {
        const backupKey = `${prefix}:backup-method`;
        steps.push(askForApp(backupKey, c('Which backup setting does the old app show?', '旧アプリには、どのバックアップ設定が表示されますか？'), [choice('cloud', 'Cloud Backup with a personal Microsoft account', '個人Microsoftアカウントを使うCloud Backup'), choice('google-one', 'Google One backup', 'Google Oneのバックアップ'), choice('unknown', 'Not sure / not available', '分からない・項目がない')], c('The Android backup method is scheduled to change in January 2027. Follow the actual app, not the date alone.', 'Androidの方式は2027年1月に変更予定です。日付だけで決めず、実際の表示を確認します。')));
        if (!w.answers[backupKey]) return { steps, ready: false };
        if (w.answers[backupKey] !== 'cloud') { steps.push(blocked(`${prefix}:backup-method-blocked`, c('Keep this backup version unfinished', 'この方式の復元を未完了で残す'), c('The Google One and other-version restore recipe still needs verification. Keep the old app and existing backup intact.', 'Google One等の版別の復元手順は照合が必要です。旧アプリと既存バックアップをそのまま残してください。'), refs, sources)); continue; }
        const backupId = `${prefix}:backup`;
        steps.push(act(backupId, c('Check the old app’s cloud backup', '旧アプリのクラウドバックアップを確認する'), oldPlace, c('Open Settings → Cloud Backup. Enable it if needed, select the exact personal Microsoft account chosen here, then OK. Keep an existing correct backup; do not delete it to repeat this guide.', '「Settings」→「Cloud Backup」で、必要ならオンにし、今回選んだ個人Microsoftアカウントを指定して「OK」を選びます。正しい既存バックアップは残し、案内を繰り返すために削除しません。'), c('Cloud Backup uses the intended recovery account.', '今回の復旧用アカウントでCloud Backupが有効であること。'), [app.id, old.id, rootRefs[0]], sources, { requires: [`${prefix}:old-open`], authenticatorEffect: { kind: 'backup', sourceRef: app.id, rootRef: rootRefs[0] } })); required.push(backupId);
      }
      if (state === 'fresh') {
        const restoreId = `${prefix}:restore`;
        steps.push(act(restoreId, c('Restore the intended code backup', '今回のコードのバックアップを復元する'), newPlace, c(old.operatingSystem === 'ios' ? 'Open Authenticator with the checked iCloud settings. The backed-up code entries should appear. Do not reinstall if they do not appear; use help while keeping both apps.' : 'Before signing in choose Restore from backup (or Begin recovery). Use the exact personal Microsoft recovery account chosen here. Do not register an empty replacement account.', old.operatingSystem === 'ios' ? '確認したiCloud設定でAuthenticatorを開き、バックアップのコードが現れるか確かめます。表示されなくても再インストールせず、新旧のアプリを残して補助へ進んでください。' : 'ログインを始める前に「Restore from backup」（または「Begin recovery」）を選び、今回選んだ個人Microsoftの復旧用アカウントを使います。空のアカウントを作り直しません。'), c('The intended backed-up code entries appear; account names alone are not enough.', '今回のバックアップのコード項目が現れること。名前だけでは確認済みにしません。'), [dest.id, fresh.id, rootRefs[0]], sources, { requires: [...required] })); required.push(restoreId);
      }
    }
    steps.push(act(itemsId, c('Compare the transferred code entries', '引き継いだコードの項目を照合する'), newPlace, c('Compare the exact accounts and groups with the old app. Each intended entry must display a changing code, not only an account name or a sign-in-to-restore message. Keep all old entries.', '旧アプリと、アカウント・グループを照合します。必要な各項目に変わるコードが表示され、名前だけ・復元のためのログイン待ちではないか確認してください。旧項目はすべて残します。'), c('Every intended group is present and produces codes. Service checks follow.', '必要なグループでコードが表示されること。次にサービスで使えるか確認します。'), refs, sources, { requires: [...required], extraControls: [{ targetRef: dest.id, controlId: 'storageChecked' }], variant: JSON.stringify([mode, rootRefs, w.answers[`${prefix}:restore-state`], w.answers[`${prefix}:backup-method`], w.answers[`${prefix}:cross-share`]]), authenticatorEffect: state === 'present' ? undefined : { kind: 'items', sourceRef: app.id, installationRef: dest.id } }));
    const targets = moveTargets(data, app.id), checkedIds: string[] = [];
    let coverageClosed = false;
    for (let i = 0; i <= data.assets.filter(a => a.kind === 'account').length; i++) {
      const targetRef = i < targets.length ? targets[i] : w.answers[`auth-target-ref:${app.id}:${i - targets.length}`];
      if (i >= targets.length) {
        const questionId = `auth-target:${app.id}:${i - targets.length}`;
        const chosenBefore = [...targets, ...Array.from({ length: i - targets.length }, (_, j) => w.answers[`auth-target-ref:${app.id}:${j}`])];
        steps.push(askForApp(questionId, c('Which other account has a code in this app?', 'このアプリに、ほかのアカウントのコードはありますか？'), [...data.assets.filter(a => a.kind === 'account' && !chosenBefore.includes(a.id)).map(a => choice(`account:${a.id}`, a.name)), choice('done', 'Every code has a service check above', 'すべてのコードを、上のサービスで確認できた'), choice('missing', 'An account is missing / not sure', '未登録のアカウントがある・分からない')], c('Match the real account, including personal and work identities. Code contents are never entered here.', '個人用・仕事用も含め、実際のアカウントに合わせます。コードの中身は入力しません。'), { kind: 'target', sourceRef: app.id, index: i - targets.length }));
        const answer = w.answers[questionId]; if (!answer) return { steps, ready: false };
        if (answer === 'done' || answer === 'missing') {
          coverageClosed = true;
          if (answer === 'missing' || !checkedIds.length) steps.push(blocked(`${prefix}:coverage`, c('Some codes still need account checks', 'サービス側での確認が残っています'), c('Keep the old phone until every code is checked with its exact service. Add missing accounts when their verified guide is available.', 'すべてのコードを正しいサービスで確認するまで、旧端末を残します。未登録のアカウントは、確認済みガイドが用意できたら追加します。'), refs, sources));
          break;
        }
      }
      const target = data.assets.find(a => a.id === targetRef && a.kind === 'account');
      if (!target) { steps.push(blocked(`${prefix}:target-missing`, c('Choose the actual account', '実際のアカウントを選び直す'), c('The saved account is unavailable. Keep the old app and review this selection.', '保存されたアカウントが見つかりません。旧アプリを残して選択を確認してください。'), refs)); break; }
      const service = accountSteps(target, fresh).find(s => s.access?.purpose === 'sign-in');
      if (!service || target.purpose === 'work' || target.provider === 'apple') { steps.push(blocked(`${prefix}:unsupported:${target.id}`, c(`Keep ${target.name}’s verification unfinished`, `${target.name}の確認を未完了で残す`), c('This account needs a separate verified authenticator-use recipe. Keep its existing methods.', 'このアカウントには、別の確認済みの認証利用手順が必要です。既存の方法は残してください。'), [...refs, target.id], sources)); continue; }
      let codeRoot: string | undefined;
      if (bw && rootRefs.length) {
        const groupKey = `${prefix}:group:${target.id}`;
        steps.push(askForApp(groupKey, c(`Which group holds ${target.name}’s code?`, `${target.name}のコードは、どのグループですか？`), [...(mode === 'both' ? [choice('local', 'Local Codes', 'Local Codes・端末内')] : []), ...rootRefs.map(ref => choice(`root:${ref}`, data.assets.find(a => a.id === ref)!.name)), choice('unknown', 'Not sure', '分からない')], c('Choose the actual heading above this code. Different vault accounts and local codes have different dependencies.', '今回のコードの上にある実際の見出しを選んでください。端末内・別々の保管庫で、必要なものが異なります。')));
        const group = w.answers[groupKey]; if (!group) return { steps, ready: false };
        if (group === 'unknown') { steps.push(blocked(`${prefix}:group-unknown:${target.id}`, c('Keep this code’s storage group unfinished', 'このコードの保存元を未確認で残す'), c('Check the group without moving or deleting the code.', 'コードを移動・削除せず、どのグループの項目か確認してください。'), refs, ['bwAuthSync'])); continue; }
        if (group.startsWith('root:')) codeRoot = group.slice('root:'.length);
      }
      const id = `${prefix}:code:${target.id}`; checkedIds.push(id);
      const open = target.provider === 'bitwarden' ? c('Open your existing web vault’s address in a private browser window, using the same US, EU or self-hosted server. Keep the mobile app signed in.', 'プライベート画面で、今使っているWeb保管庫のURL（US・EU・セルフホストの同じサーバー）を開いてください。モバイルアプリのログインは残します。') : target.provider === '1password' ? c('In a private browser window open the Sign-in address in your existing Emergency Kit. Keep the app signed in.', 'プライベート画面で、保管済みEmergency Kitの「Sign-in address」を開いてください。アプリのログインは残します。') : undefined;
      steps.push(act(id, c(`Use the new code with ${target.name}`, `${target.name}で、新端末のコードを使う`), c(`New phone · ${name.en} → official ${target.name} sign-in`, `新端末 · ${name.ja} → ${target.name}の正規ログイン`), c(`${open?.en ?? 'Keep existing sessions. In a private browser window open the official sign-in below.'} Sign in to this exact account and select its authenticator-code method. Enter the current code from this new app. If another method is used instead, keep this check unfinished.`, `${open?.ja ?? '現在のログインを残し、プライベート画面で下の正規ログインを開きます。'}今回の正しいアカウントで認証コードの方式を選び、新アプリの現在のコードを入力してください。別の方法で入れた場合は、この確認を未完了で残します。`), c('The official service accepts this new app’s code and completes sign-in for the exact account.', '正規サービスが今回の新アプリのコードを受け付け、正しいアカウントへのログインが完了すること。'), [dest.id, fresh.id, target.id, ...(codeRoot ? [codeRoot] : [])], [...new Set([...sources, ...service.sources])], { url: service.url, access: { targetRef: target.id, purpose: 'sign-in' }, requires: [...required, itemsId], authenticatorEffect: { kind: 'code', sourceRef: app.id, installationRef: dest.id, accountRef: target.id, rootRef: codeRoot }, button: c('The new code worked', '新端末のコードで利用できました'), variant: JSON.stringify([mode, rootRefs, codeRoot]) }));
    }
    if (!coverageClosed) steps.push(blocked(`${prefix}:coverage-limit`, c('Some code checks remain', '残るコードの確認が必要です'), c('The account-check limit for this task was reached. Keep the previous phone and continue the remaining checks in another task.', '今回のアカウント確認の上限です。旧端末を残し、残るコードは別の作業で確認してください。'), refs, sources));
    if (bw && state !== 'present' && ['local', 'both'].includes(mode)) steps.push(act(`${prefix}:cleanup`, c('Remove temporary readable migration files', '一時的な移行用ファイルを片付ける'), c('Previous and new phone · file locations used for this transfer', '新旧端末 · 今回の移行用ファイルを置いた場所'), c('After every new code works and independent recovery is available, delete only the temporary JSON copies from both file locations and transfer downloads. Review their recently-deleted folders. Keep the authenticator entries and any independent protected backup.', 'すべての新コードが使え、独立した復旧手段もあることを確認してから、今回の一時JSONだけを新旧端末の保存先・受信フォルダで削除し、最近削除した項目も確認してください。認証アプリの項目と、別に保護したバックアップは残します。'), c('Temporary readable copies are removed; working codes and independent recovery remain.', '一時的な読取り可能なコピーを整理し、使えるコード・独立した復旧手段は残っていること。'), refs, sources, { requires: ['prepare-recovery', itemsId, ...checkedIds, ...steps.filter(s => s.kind === 'blocked' && s.id.startsWith(prefix)).map(s => s.id)], authenticatorEffect: { kind: 'cleanup', sourceRef: app.id } }));
  }
  return { steps, ready: true };
}

function rootQuestions(data: Dataset, w: PhoneWorkflow, app: AuthenticatorInstallation, provider: 'apple' | 'microsoft' | 'bitwarden', multiple: boolean) {
  const steps: PhoneStep[] = [], refs: string[] = [];
  for (let i = 0; i < (multiple ? data.assets.filter(a => a.provider === provider).length + 1 : 1); i++) {
    const key = `auth-root:${app.id}:${i}`;
    const choices = data.assets.filter(a => a.kind === 'account' && a.provider === provider && a.purpose !== 'work' && !refs.includes(a.id)).map(a => choice(`account:${a.id}`, a.name));
    choices.push(choice('add', 'Register another existing personal account', '別の既存の個人用アカウントを登録する'));
    choices.push(choice('work', 'Work / school / not sure', '仕事・学校・分からない'));
    if (multiple) choices.push(choice('done', 'These are all the synced accounts', '同期先はこれですべて'));
    steps.push(ask(key, c(`Which actual ${provider === 'apple' ? 'Apple' : provider === 'microsoft' ? 'Microsoft' : 'Bitwarden'} account holds this backup or group?`, `このバックアップ・グループは、どの${provider === 'apple' ? 'Apple' : provider === 'microsoft' ? 'Microsoft' : 'Bitwarden'}アカウントですか？`), choices, c('Select the actual personal account shown by the old app or device settings. This records its identity; it does not create a new online account. Keep its independent recovery available.', '旧アプリや端末設定に表示される実際の個人用アカウントを選びます。登録するのはこのアプリ内の項目で、新しいオンラインアカウントは作りません。独立した復旧手段も確保してください。'), { kind: 'root', sourceRef: app.id, index: i, provider }));
    steps[steps.length - 1].context = productName(app);
    const value = w.answers[key]; if (!value) return { steps, refs, ready: false };
    if (value === 'work') { steps.push(blocked(`auth:${app.id}:root-work`, c('Keep the managed account recovery unfinished', '管理されたアカウントの復旧を未完了で残す'), c('This path uses a personal recovery account. Keep existing backups and follow the organization’s enrollment requirements.', 'この経路は個人用の復旧アカウント向けです。既存バックアップを残し、組織の登録条件を確認してください。'), [app.id])); return { steps, refs, ready: true }; }
    if (value === 'done') return { steps, refs, ready: true };
    const root = data.assets.find(a => a.id === value && a.kind === 'account' && a.provider === provider && a.purpose !== 'work');
    if (!root) return { steps, refs, ready: false };
    refs.push(root.id);
  }
  if (multiple) steps.push(blocked(`auth:${app.id}:root-limit`, c('Review remaining sync accounts', '残る同期先を確認する'), c('Keep the old app until all actual groups have been identified.', '実際のグループをすべて確認するまで、旧アプリを残してください。'), [app.id]));
  return { steps, refs, ready: true };
}
