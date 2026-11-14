import type { CurrentDataset, Dataset } from './models';
import type { PhoneWorkflow } from './phoneSchemas';
import type { PhoneStep } from './phoneCatalog';
import { c, type Copy, type GuideStep, type Source } from './guideCatalog';
import { cloudAnswer, cloudEnvironmentReady, cloudInstallation, cloudVault, chooseCloudDevice, selectedCloudInstallation, setCloudAnswer, CLOUD_NAMES, type CloudProduct } from './cloudManagers';
import { cloudManagerRecipe } from './cloudManagerCatalog';
import { cloudPasswordRecipe } from './cloudPasswordCatalog';

const source = (title: string, url: string, scope: string): Source => ({ title, url, scope, checked: '2026-11-14', reviewMethod: 'official-documentation' });
export const PHONE_CLOUD_SOURCES = {
  phoneNordLogin: source('NordPass · Sign in and unlock the existing vault', 'https://support.nordpass.com/hc/en-us/articles/360008812097-How-to-log-in-to-NordPass', 'Mobile / existing Nord Account / MFA / separate Master Password'),
  phoneProtonLogin: source('Proton Pass · Existing account on iPhone / iPad', 'https://proton.me/support/pass-setup-ios', 'Existing Proton Account / Sign in / autofill'),
  phoneProtonAndroid: source('Proton Pass · Android use', 'https://proton.me/support/use-pass-android', 'Existing login items / copy or autofill / Android manufacturer differences'),
  phoneProtonExtra: source('Proton Pass · Existing extra password', 'https://proton.me/support/pass-extra-password', 'Optional extra password is needed on sign-in; do not set/change it during migration'),
};
const question = (id: string, title: Copy, options: [string, Copy][], vaultRef?: string, text?: Copy): PhoneStep => ({ id, kind: 'question', title, text, refs: vaultRef ? [vaultRef] : [], sources: [], answerKey: id, choices: options.map(([value, label]) => ({ value, label })) });
const blocked = (id: string, title: Copy, text: Copy, refs: string[], sources: string[]): PhoneStep => ({ id, kind: 'blocked', title, text, refs, sources });
export function oldCloudVaults(data: Dataset, oldDeviceRef?: string) {
  if (data.version !== 2 || !oldDeviceRef) return [];
  const ids = new Set(data.securityModel.entities.filter(e => e.kind === 'installation' && e.deviceRef === oldDeviceRef && !e.mergedIntoRef && e.controls?.opened === 'verified').flatMap(e => e.kind === 'installation' && e.vaultRef ? [cloudVault(data, e.vaultRef)?.id] : []).filter((id): id is string => !!id));
  return [...ids].map(id => cloudVault(data, id)!);
}
export function answerCloudPhoneQuestion(data: CurrentDataset, w: PhoneWorkflow, step: PhoneStep, value: string, previous: PhoneWorkflow): { data: CurrentDataset; workflow: PhoneWorkflow } {
  const meta = step.cloudQuestion;
  if (!meta || !w.newDeviceRef) return { data, workflow: w };
  let next: CurrentDataset = { ...data, securityModel: { ...data.securityModel, revision: data.securityModel.revision >= 3 ? data.securityModel.revision : 2 } }, workflow = w;
  if (meta.kind === 'destination') {
    const vault = cloudVault(data, meta.vaultRef); if (!vault) return { data, workflow: w };
    const oldApp = cloudInstallation(data, previous.answers[step.answerKey!]);
    const existing = value === 'add' ? oldApp?.deviceRef === w.newDeviceRef && oldApp.vaultRef === vault.id ? oldApp.id : undefined : value.startsWith('installation:') ? value.slice('installation:'.length) : undefined;
    if (value !== 'add' && (!existing || cloudInstallation(data, existing)?.deviceRef !== w.newDeviceRef || cloudInstallation(data, existing)?.vaultRef !== vault.id)) return { data, workflow: previous };
    const prepared = chooseCloudDevice(next, vault.id, w.newDeviceRef, existing);
    const app = selectedCloudInstallation(prepared, vault.id); if (!app || prepared.version !== 2) return { data, workflow: previous };
    next = { ...prepared, guide: data.guide };
    // This is the existing logical store even if its first app was created recently.
    next = setCloudAnswer(next, app.id, 'usage', 'existing') as CurrentDataset;
    next = setCloudAnswer(next, app.id, 'account', 'existing') as CurrentDataset;
    const version = w.answers['cloud-phone-version'];
    if (version) next = setCloudAnswer(next, app.id, data.assets.find(a => a.id === w.newDeviceRef)?.operatingSystem === 'ios' ? 'ios' : 'android', version) as CurrentDataset;
    workflow = { ...w, answers: { ...w.answers, [step.answerKey!]: app.id } };
  }
  if (meta.kind === 'version') {
    for (const [key, ref] of Object.entries(w.answers)) if (key.startsWith('cloud-destination:')) {
      const app = cloudInstallation(next, ref); if (app?.deviceRef === w.newDeviceRef) next = setCloudAnswer(next, ref, next.assets.find(a => a.id === w.newDeviceRef)?.operatingSystem === 'ios' ? 'ios' : 'android', value) as CurrentDataset;
    }
  }
  return { data: next, workflow };
}

export function cloudPhoneSteps(data: Dataset, w: PhoneWorkflow): { steps: PhoneStep[]; ready: boolean } {
  const steps: PhoneStep[] = [], fresh = data.assets.find(a => a.id === w.newDeviceRef), old = data.assets.find(a => a.id === w.oldDeviceRef);
  if (data.version !== 2 || !fresh || !old) return { steps, ready: true };
  const ask = (...args: Parameters<typeof question>) => {
    const item = question(...args), store = cloudVault(data, args[3]), account = data.assets.find(a => a.id === store?.authenticationAccountRef);
    return { ...item, ...(store ? { context: c(`${store.label}${account ? ` · ${account.name}` : ''}`, `${store.label}${account ? ` · ${account.name}` : ''}`) } : {}) };
  };
  let versionShown = false;
  for (const vault of oldCloudVaults(data, old.id)) {
    const root = data.assets.find(a => a.id === vault.authenticationAccountRef), product = vault.productId as CloudProduct, proton = product === 'proton-pass';
    const name = CLOUD_NAMES[product], prefix = `cloud:${vault.id}:`, refs = [vault.id, fresh.id];
    const sources = proton ? ['phoneProtonLogin', 'phoneProtonExtra', 'phoneProtonAndroid'] : ['phoneNordLogin', 'nordAccount'];
    const use = `cloud-use:${vault.id}`;
    steps.push({ ...ask(use, c(`Where will you keep using ${name.en}?`, `${name.ja}を、どこで使い続けますか？`), [
      ['new', c('On the new phone', '新しいスマホで使う')], ['elsewhere', c('On another device I will keep', '今後も残す、別の端末で使う')], ['old', c('Only on the old phone for now', '今は旧端末だけで使う')],
    ], vault.id), cloudQuestion: { kind: 'use', vaultRef: vault.id } });
    if (!w.answers[use]) return { steps, ready: false };
    if (w.answers[use] === 'old') {
      if (['sell', 'give', 'recycle'].includes(w.answers['old-fate'])) steps.push(blocked(`${prefix}old-only`, c('Move the store before handing over its only phone', '唯一の利用端末を手放す前に、保管庫を引き継ぐ'), c('This store is still used only on the old phone. Keep that phone or choose a destination and verify access there before erasure.', 'この保管庫は、まだ旧端末だけで使う選択です。旧端末を残すか、別の利用場所を選び、そこで使えることを確認してから消去へ進みます。'), [vault.id, old.id], sources));
      continue;
    }
    if (!root || root.purpose !== 'personal' || vault.storageMode !== 'account') { steps.push(blocked(`${prefix}scope`, c('Keep this store’s move unfinished', 'この保管庫の引き継ぎを未完了で残す'), c('Confirm its exact personal backing account first. This route does not replace a managed/shared vault or reset existing data.', '実際に使う個人用の基盤アカウントを先に確認する必要があります。管理用・共有の保管庫を置き換えたり、既存データをリセットしたりしません。'), refs, sources)); continue; }
    if (!proton && cloudAnswer(data, root.id, 'method') !== 'direct') { steps.push(blocked(`${prefix}sso`, c('Keep connected account sign-in intact', '接続しているアカウントのログイン方法を残す'), c('Google/Apple sign-in needs its own account dependencies. The dedicated phone SSO route is not yet verified here. Keep existing access; do not unlink it or create a replacement account.', 'Google・Apple経由のログインには、接続先のアカウントも必要です。この機種変更用のSSO経路はまだ確認できていません。既存の利用手段を残し、接続の解除や別アカウントの作成は行いません。'), refs, ['nordConnected', 'nordSso'])); continue; }
    let place = c(`${w.answers[use] === 'new' ? 'New phone' : 'Device you will keep'} · ${name.en}`, `${w.answers[use] === 'new' ? '新しいスマホ' : '今後も残す別の端末'} · ${name.ja}`);
    const action = (id: string, title: Copy, text: Copy, expected: Copy, requires: string[] = [], extra: Partial<PhoneStep> = {}): PhoneStep => ({ id: `${prefix}${id}`, kind: 'action', title, context: c(`${vault.label} · ${root.name}`, `${vault.label} · ${root.name}`), place, action: text, expected, refs: [vault.id, root.id, fresh.id], sources, requires: requires.map(s => `${prefix}${s}`), button: c('I checked this', '確認しました'), ...extra });
    steps.push(action('recovery', c('Keep backing-account access outside the old phone', '基盤アカウントの利用手段を旧端末の外に残す'),
      c(proton ? 'Retrieve the current Proton Account sign-in information privately without the old phone or this same Pass vault. Keep a working session. Do not create or reset a replacement account.' : 'Retrieve the current Nord Account sign-in information, or confirm access to its registered mailbox, without the old phone or NordPass. Keep a working session. This is separate from the vault Master Password.', proton ? '旧端末や同じPass保管庫を開かなくても、現在のProton Accountのログイン情報を私的に取り出せるか確かめます。使えるログインは残し、アカウントの作り直しやリセットは行いません。' : '旧端末やNordPassを開かなくても、現在のNord Accountのログイン情報を取り出すか、登録メールを受け取れるか確かめます。使えるログインは残してください。これは保管庫用マスターとは別のものです。'),
      c('You have a working way to sign in without relying only on the old phone or the vault itself.', '旧端末や同じ保管庫だけに頼らない、使えるログイン手段があること。'), [], { variant: w.answers[use] }));
    steps.push(action('account-mfa', c('Keep existing account authentication and recovery available', '基盤アカウントの認証・復旧手段を残す'),
      c('If the account uses MFA, keep an existing usable authenticator/key and its recovery information outside the old phone. Complete any separate authenticator move first. If no MFA is configured, do not mark it enabled here. Do not remove or replace authentication methods during this check.', 'MFAを使っている場合は、既存の認証アプリ・キーと復旧用情報を旧端末の外でも使える状態にします。認証アプリの移行が必要なら、先にその作業を済ませてください。未設定のMFAを、ここで有効と記録することはありません。この確認で認証方法を削除・置換しません。'),
      c('The account’s existing authentication/recovery is available without the old phone.', 'アカウントの既存の認証・復旧手段を、旧端末なしで利用できること。'), ['recovery']));
    steps.push(action('vault-secret', c(proton ? 'Keep any existing extra password accessible' : 'Keep the current vault Master Password accessible', proton ? '設定済みの追加パスワードを取り出せるようにする' : '現在の保管庫用マスターを取り出せるようにする'),
      c(proton ? 'Proton Pass normally uses the Proton Account password. If you previously added an extra Pass password, retrieve that existing secret privately outside this same vault and the old phone. Do not set or change an extra password just for the phone move.' : 'Retrieve the existing NordPass Master Password privately outside NordPass and the old phone. It differs from the Nord Account password. Keep the current master; do not create a replacement or reset the vault for this move.', proton ? 'Proton Passは通常、Proton Account用のパスワードを使います。追加のPass用パスワードを設定している場合だけ、その現在の秘密を同じ保管庫や旧端末の外で取り出せるか確かめてください。機種変更だけのための新設・変更は行いません。' : '現在のNordPassのMaster Passwordを、NordPassや旧端末の外から私的に取り出せるか確かめます。Nord Account用のパスワードとは別のものです。今のマスターを使い、この移行のために新しいマスターの作成やリセットは行いません。'),
      c('The existing unlock secret is available privately; no secret was entered here.', '現在の解除に必要な秘密を本人が取り出せること。このアプリへの入力は不要です。'), ['account-mfa']));
    steps.push(action('vault-recovery', c('Keep the current vault recovery copy outside the old phone', '現在の復旧用の控えを旧端末の外に残す'),
      c(proton ? 'Keep your current Proton recovery phrase/Recovery Kit and recovery file privately reachable without Proton Pass, Proton Drive or the old phone. Preserve the existing copies; do not reset the password, rotate recovery or void files to test them.' : 'Retrieve the current 24-symbol NordPass vault Recovery Code privately outside NordPass and the old phone. Keep it labeled separately from the 10 Nord Account MFA backup codes. Do not rotate a valid code or reset the Master Password to test it.', proton ? '現在のProtonの復旧フレーズ・Recovery Kit、復旧ファイルを、Proton Pass・Proton Drive・旧端末を使わず私的に取り出せるように残します。既存の控えを維持し、確認のためのパスワードリセット、再発行、ファイルの失効は行いません。' : '現在の24文字のNordPass保管庫用Recovery Codeを、NordPassや旧端末の外から私的に取り出せるか確かめます。10個のNord AccountのMFA用コードとは、用途を区別して残してください。有効なコードの再発行や、確認目的のマスターのリセットは行いません。'),
      c('The current recovery information remains private and reachable outside the old phone.', '現在の復旧用情報を、旧端末の外から安全に取り出せること。'), ['vault-secret']));
    const destination = `cloud-destination:${vault.id}`;
    if (w.answers[use] === 'elsewhere') {
      steps.push(ask(destination, c('Which registered app on another device will you check?', '今後も残す別の端末の、どのアプリで確認しますか？'), [
        ...data.securityModel.entities.filter(e => e.kind === 'installation' && e.vaultRef === vault.id && !e.mergedIntoRef && e.deviceRef !== old.id && e.deviceRef !== fresh.id).map(e => [`installation:${e.id}`, c(e.label, e.label)] as [string, Copy]),
        ['unlisted', c('The device or app is not registered', '端末・アプリが未登録')],
      ], vault.id));
    } else steps.push({ ...ask(destination, c(`Which ${name.en} app will you use?`, `どの${name.ja}アプリで確認しますか？`), [
      ...data.securityModel.entities.filter(e => e.kind === 'installation' && e.vaultRef === vault.id && e.deviceRef === fresh.id && !e.mergedIntoRef).map(e => [`installation:${e.id}`, c(e.label, e.label)] as [string, Copy]),
      ['add', c('Register a separate app on this new phone', 'この新端末のアプリを別に登録する')],
    ], vault.id, c('Keep an already working app. Selection alone does not confirm installation or migration.', 'すでに使えるアプリはそのまま使います。選んだだけでは、導入・移行を確認済みにしません。')), cloudQuestion: { kind: 'destination', vaultRef: vault.id } });
    const selectedRef = w.answers[destination];
    const app = cloudInstallation(data, selectedRef) ?? cloudInstallation(data, selectedRef?.startsWith('installation:') ? selectedRef.slice('installation:'.length) : undefined), device = data.assets.find(a => a.id === app?.deviceRef);
    if (!w.answers[destination]) return { steps, ready: false };
    if (!app || !device || app.vaultRef !== vault.id || device.id === old.id || (w.answers[use] === 'new' ? device.id !== fresh.id : device.id === fresh.id)) {
      steps.push(blocked(`${prefix}destination-missing`, c('Register the actual destination before checking it', '実際に使う別の端末・アプリの登録が必要です'), c('Keep the store and old phone intact. Choose an actual registered app for this same store. An unnamed destination does not confirm which device will preserve access.', '保管庫と旧端末は残します。同じ保管庫を使う、実際の登録済みアプリを選ぶ必要があります。利用先が未登録のまま、どの端末で使えるかを確認済みにはしません。'), refs, sources)); continue;
    }
    if (w.answers[use] === 'elsewhere' && !cloudEnvironmentReady(data, app.id)) { steps.push(blocked(`${prefix}elsewhere-environment`, c('Check that app’s environment first', 'そのアプリの利用環境を先に確認する'), c('The registered destination needs its verified OS/browser profile. Keep the data and complete that store’s environment questions before this use check.', '登録先のOS・ブラウザープロファイルの確認が必要です。データを残し、その保管庫の利用環境を先に確認してから、この利用確認を進めます。'), [vault.id, app.id, device.id], sources)); continue; }
    if (w.answers[use] === 'new' && (fresh.operatingSystem === 'ios' || !proton) && !versionShown) {
      versionShown = true;
      steps.push({ ...ask('cloud-phone-version', c('Which version does the new phone use?', '新しいスマホのOSは、どの世代ですか？'), fresh.operatingSystem === 'ios' ? [['ios18plus', c('iOS / iPadOS 18 or later', 'iOS / iPadOS 18以降')], ['ios17', c('iOS / iPadOS 17', 'iOS / iPadOS 17')], ['other', c('Older / not sure', '以前のバージョン・分からない')]] : [['android9plus', c('Android 9 or later', 'Android 9以降')], ['other', c('Older / not sure', '以前のバージョン・分からない')]], vault.id), cloudQuestion: { kind: 'version', vaultRef: vault.id } });
      if (!w.answers['cloud-phone-version']) return { steps, ready: false };
    }
    const version = w.answers['cloud-phone-version'];
    if (w.answers[use] === 'new' && (!['ios', 'android'].includes(fresh.operatingSystem ?? '') || (fresh.operatingSystem === 'ios' && !['ios18plus', ...(proton ? ['ios17'] : [])].includes(version ?? '')) || (!proton && fresh.operatingSystem === 'android' && version !== 'android9plus'))) { steps.push(blocked(`${prefix}version`, c('Keep this app’s move unfinished on this OS', 'このOSでの引き継ぎを未完了で残す'), c('The verified app instructions do not cover this OS version. Keep the existing store and other working access. Do not erase or replace data to match the guide.', 'このOSの世代は確認済みのアプリ手順の対象外です。既存の保管庫と、ほかの使える利用手段を残し、案内に合わせるためにデータを消去・置換しないでください。'), refs, sources)); continue; }
    place = c(`${device.name} · ${name.en}`, `${device.name} · ${name.ja}`);
    const wrap = (s: GuideStep, recipeId: string, requires: string[]): PhoneStep => action(s.id, s.title, s.action, s.expected, requires, { refs: [vault.id, app.id, device.id], sources: [...new Set([...s.sources, ...sources])], url: s.url, setupHelp: s.setupHelp, button: s.button, ...(s.control ? { control: { targetRef: app.id, id: s.control } } : {}), extraControls: s.extraControls, cloudContext: { installationRef: app.id, subjectRef: app.id, recipeId, step: s, context: w.answers[use] === 'new' ? 'new-device' : 'normal' } });
    const onboard = cloudManagerRecipe(data, app.id, 'cloud-onboard')!;
    const open = onboard.steps.find(s => s.id === 'open')!;
    steps.push(wrap(open, 'cloud-onboard', ['vault-recovery']));
    const state = `${prefix}state`;
    steps.push(ask(state, c('What does the selected app show now?', '選んだアプリには、何が表示されていますか？'), [['signin', c('Account sign-in is required', 'アカウントへのログインが必要')], ['unlock', c('The account is selected; the vault needs unlocking', 'アカウントは選択済み・保管庫の解除が必要')], ['open', c('The intended vault is already open', '使いたい保管庫を、すでに開ける')]], vault.id));
    if (!w.answers[state]) return { steps, ready: false };
    let beforeUnlock = 'open';
    if (w.answers[state] === 'signin') {
      if (!proton) steps.push(action('email', c('Continue with the existing Nord Account email', '既存のNord Accountのメールで進む'), c('In NordPass enter the email for the selected existing Nord Account and select Continue. Do not create another account.', 'NordPassで、選んだ既存のNord Accountのメールを入力し、「Continue」を選びます。別のアカウントは作りません。'), c('Nord shows sign-in for the intended existing account.', '意図した既存アカウントのログインが表示されること。'), ['open']));
      steps.push(action('credentials', c('Sign in to the existing backing account', '既存の基盤アカウントへログインする'), c(proton ? 'Select Sign in and use the existing Proton Account username and password. Mail, Drive and Pass can share that same account. Enter credentials only in Proton’s screen and keep working sessions.' : 'Use the existing Nord Account password, or its offered one-time email login code, in Nord’s official sign-in screen. Keep the NordPass vault Master Password for the later unlock; it is not the Account password.', proton ? '「Sign in」から、既存のProton Accountのユーザー名とパスワードをProtonの画面だけに入力します。Mail・Drive・Passで同じAccountを使っている場合も、そのまま使います。現在使えるログインは残してください。' : 'Nordの正規のログイン画面で、現在のNord Account用のパスワード、または提示された一回用メールのログインコードを使います。NordPassの保管庫用Master Passwordは、この後の解除に使う別のものです。'), c('The account accepts the credentials or asks for its configured additional authentication.', 'アカウントの情報が受け付けられるか、設定済みの追加認証が求められること。'), [proton ? 'open' : 'email']));
      const mfa = `${prefix}mfa-needed`;
      steps.push(ask(mfa, c('Does this sign-in ask for additional authentication?', 'このログインで、追加の認証を求められていますか？'), [['yes', c('Yes, use the existing registered method', 'はい・登録済みの方法で確認する')], ['no', c('No; the account accepted sign-in', 'いいえ・アカウントのログインが受け付けられた')]], vault.id));
      if (!w.answers[mfa]) return { steps, ready: false };
      if (w.answers[mfa] === 'yes') steps.push(action('mfa', c('Complete the existing additional authentication', '設定済みの追加認証を行う'), c('Use the registered authenticator/security key or another offered existing method only for the sign-in you just started. Enter a code only in the official account screen. Keep all existing authentication methods; use help if the expected one is unavailable.', '今、自分が開始したログインに対して、登録済みの認証アプリ・セキュリティキーなど、表示された既存の方法を使います。コードは正規のアカウント画面だけに入力してください。既存の認証方法はすべて残し、使いたい方法が利用できなければ「うまくいかない」へ進みます。'), c('The official service accepts this sign-in’s additional authentication.', '正規サービスで、今回のログインの追加認証が受け付けられること。'), ['credentials']));
      const signin = onboard.steps.find(s => s.id === 'sign-in')!;
      steps.push({ ...wrap({ ...signin, title: c('Confirm account sign-in was accepted', 'アカウントのログイン完了を確認する'), action: c('Check the app has returned from the correct account’s sign-in to the intended vault or its unlock prompt. This confirms account sign-in only; keep the existing vault and unlock it next.', '正しいアカウントへのログインから、アプリの意図した保管庫、またはその解除画面へ戻ったか確認します。ここではアカウントのログインだけを確認し、既存の保管庫は次に開きます。'), extraControls: undefined }, 'cloud-onboard', [w.answers[mfa] === 'yes' ? 'mfa' : 'credentials']), cloudContext: { installationRef: app.id, subjectRef: app.id, recipeId: 'cloud-onboard', step: signin, completedAccountRef: root.id, context: w.answers[use] === 'new' ? 'new-device' : 'normal' } });
      beforeUnlock = 'sign-in';
    }
    const unlock = onboard.steps.find(s => s.id === 'vault-open')!;
    const unlockStep = wrap({ ...unlock, action: c(proton ? 'Open the same existing Proton Pass store on the selected device. If an extra password is requested, enter the existing extra password only in Pass. Do not set/change one for this move. Read a familiar item without using the old phone; keep all existing vault data.' : 'If the vault is locked, select Use Master Password, enter the existing vault Master Password and select Unlock NordPass. Keep an already-open vault. Read a familiar existing item without the old phone. Do not choose account reset or create a new master for this move.', proton ? '選んだ端末で同じ既存のProton Passの保管庫を開きます。追加パスワードを求められた場合は、現在のものをPassの画面だけに入力してください。この引き継ぎのために新設・変更しません。旧端末を使わず、見覚えのある既存項目を開き、元の保管庫の情報はすべて残します。' : 'ロックされている場合は「Use Master Password」を選び、現在の保管庫用Master Passwordを入力して「Unlock NordPass」で解除します。すでに開ける保管庫はそのまま使います。旧端末を使わず、見覚えのある既存項目を読めるか確かめ、アカウントのリセットや新しいマスターの作成は行いません。') }, 'cloud-onboard', [beforeUnlock]);
    steps.push({ ...unlockStep, explanation: c(proton ? 'Account sign-in and reading encrypted vault contents are different checks. Keep the optional existing extra password if one was configured. An open session or an unlocked device can expose saved items; this move does not prove the device is free from malware.' : 'Nord Account authentication limits who can sign in; the separate Master Password unlocks the encrypted vault. One does not replace the other. An attacker controlling an unlocked device or working session may still read items. Recovery information kept only inside that same vault creates a dependency loop.', proton ? 'アカウントへのログインと、保管庫の保存情報を読めることは別の確認です。追加パスワードを設定済みの場合は、その現在の秘密も必要です。開いたセッションや解除済みの端末を奪われると、保存情報を読まれる可能性があります。この引き継ぎで端末のマルウェアを検査することはできません。' : 'Nord Accountの認証はアカウントへのログインを保護し、別のMaster Passwordが暗号化された保管庫の解除を保護します。一方だけで他方を代替することはできません。解除済みの端末や使えるセッションを奪われると、保存情報を読まれる可能性があります。復旧用情報を同じ保管庫の中だけに置くと、開けないときに取り出せない循環になります。'), cloudContext: { ...unlockStep.cloudContext!, independentOfOld: true } });
    steps.push(wrap(onboard.steps.find(s => s.id === 'storage-check')!, 'cloud-onboard', ['vault-open']));
    let previousStep = 'storage-check';
    let sharedLock: string | undefined;
    for (const s of cloudManagerRecipe(data, app.id, 'cloud-autofill')!.steps) {
      const id = `fill-${s.id}`;
      const own = Object.values(w.records).some(r => r.stepId === `${prefix}${id}`);
      const lock = Object.values(w.records).find(r => r.status === 'confirmed' && r.stepId !== `${prefix}${id}` && ((r.targetRef === device.id && r.controlId === 'screenLock') || r.extraControls?.some(e => e.targetRef === device.id && e.controlId === 'screenLock')));
      if (s.id === 'open' && lock && !own && w.cursor !== `${prefix}${id}`) { sharedLock = lock.stepId; continue; }
      const adapted = { ...s, id };
      steps.push({ ...wrap(adapted, 'cloud-autofill', [previousStep]), ...(sharedLock ? { requires: [`${prefix}${previousStep}`, sharedLock] } : {}), cloudContext: { installationRef: app.id, subjectRef: app.id, recipeId: 'cloud-autofill', step: s, context: w.answers[use] === 'new' ? 'new-device' : 'normal' } });
      sharedLock = undefined;
      previousStep = id;
    }
    const targetKey = `${prefix}target`;
    steps.push(ask(targetKey, c('Which existing saved login will you try?', 'どの保存済みログインを使ってみますか？'), [...data.assets.filter(a => a.kind === 'account').map(a => [a.id, c(a.name, a.name)] as [string, Copy]), ['unlisted', c('The account is not registered here', 'このアプリには未登録のアカウント')]], vault.id, c('Choose an important login already in this exact store. Do not change its password merely to test the phone move.', 'この保管庫に保存している、重要なログインを選びます。機種変更の確認だけのためにパスワードを変更する必要はありません。')));
    if (!w.answers[targetKey]) return { steps, ready: false };
    const target = data.assets.find(a => a.id === w.answers[targetKey] && a.kind === 'account');
    const projection = target ? setCloudAnswer(data, target.id, `password:${app.id}`, 'keep') : data;
    const saved = target ? cloudPasswordRecipe(projection, target, app.id)?.steps.find(s => s.id === 'test') : undefined;
    if (!target || !saved) { steps.push(blocked(`${prefix}target-unsupported`, c('Keep the saved-login check unfinished', '保存ログインの利用確認を未完了で残す'), c('This exact saved account needs its supported official sign-in route. Do not infer successful use from the item list or another account.', '今回の保存アカウントに対応した正規ログインの経路が必要です。一覧の表示や、別アカウントの利用から成功を推測しません。'), refs, sources)); continue; }
    steps.push({ ...wrap({ ...saved, id: 'test', action: c(`${saved.action.en} Complete this check without using the old phone, including any MFA. If the old phone is still the only way, leave the check unfinished.`, `${saved.action.ja} MFAも含め、旧端末を使わずに完了してください。旧端末だけが頼りの場合は、利用確認を未完了で残します。`) }, `cloud-password:${app.id}`, [previousStep]), refs: [vault.id, app.id, device.id, target.id], variant: target.id, explanation: c('Reading a saved item proves that the vault can be read, but its password may be outdated. A fresh sign-in with that password checks the official service accepts it; a passkey or existing session can bypass this test. Testing without the old phone records independence from that phone only, not every other device or every future recovery condition.', '保存項目を開けても、中のパスワードが現在のものとは限りません。そのパスワードで別のログインを行うことで、正規サービスに受け付けられるか確かめます。パスキーや既存のセッションで入るだけでは、この確認を通っていません。旧端末なしで試した結果も、その端末への独立性の確認であり、ほかの端末や将来のすべての復旧条件まで確認したことにはなりません。'), cloudContext: { installationRef: app.id, subjectRef: target.id, recipeId: `cloud-password:${app.id}`, step: saved, independentOfOld: true, completedAccountRef: target.id, context: w.answers[use] === 'new' ? 'new-device' : 'normal' }, control: { targetRef: target.id, id: 'uniquePassword' } });
  }
  return { steps, ready: true };
}
